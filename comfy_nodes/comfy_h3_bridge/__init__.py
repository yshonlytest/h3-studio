import logging
import os
import re
import select
import shutil
import signal
import subprocess
import tempfile
import wave
from pathlib import Path

import comfy.model_management as model_management
import comfy.utils
import folder_paths
import numpy as np
from comfy_api.latest import InputImpl
from PIL import Image

try:
    from pipeline.config import (
        DEFAULT_FFMPEG_AUDIO_ARGS,
        DEFAULT_FFMPEG_AUDIO_TRIM_FIRST_FRAME,
        DEFAULT_FFMPEG_ENCODE_ARGS,
        DEFAULT_FFMPEG_TAIL_SEEK,
    )
except ImportError:
    DEFAULT_FFMPEG_ENCODE_ARGS = ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"]
    DEFAULT_FFMPEG_AUDIO_ARGS = ["-c:a", "aac", "-b:a", "192k"]
    DEFAULT_FFMPEG_TAIL_SEEK = "-0.08"
    DEFAULT_FFMPEG_AUDIO_TRIM_FIRST_FRAME = "0.041667"

LOGGER = logging.getLogger("comfy_h3_bridge")

_PROGRESS_RE = re.compile(r"^([A-Za-z0-9 _-]+?)\s+(\d+)/(\d+)\s*$")
_UNCLOSED_TAG_RE = re.compile(r"<(Picture|Video|Audio)\s+(\d+)(?![^<\n>]*>)", re.IGNORECASE)
_PICTURE_TAG_RE = re.compile(r"<\s*picture\s*(\d+)\s*>", re.IGNORECASE)


def _normalize_h3_prompt(prompt_text):
    closed = _UNCLOSED_TAG_RE.sub(
        lambda m: f"<{m.group(1).capitalize()} {m.group(2)}>", str(prompt_text or "")
    )
    return _PICTURE_TAG_RE.sub(lambda m: f"<Picture {int(m.group(1))}>", closed).strip()
_STAGE_WEIGHTS = {
    "tokenizer": (0, 2),
    "text encoder": (2, 18),
    "refine text": (18, 20),
    "precompute AdaLN": (20, 22),
    "load transformer core": (22, 25),
    "denoise": (25, 85),
    "audio VAE": (85, 88),
    "video VAE load": (88, 90),
    "video VAE": (90, 98),
    "FFmpeg": (98, 100),
}


def _terminate_process_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        LOGGER.debug("Process %s already terminated before SIGTERM", getattr(process, "pid", None))
        return
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            LOGGER.debug("Process %s already terminated before SIGKILL", getattr(process, "pid", None))
        process.wait(timeout=2)


def _resolve_h3_paths():
    binary_value = os.environ.get("H3_BINARY") or os.environ.get("H3_BIN_PATH")
    model_value = os.environ.get("H3_MODEL_DIR")
    repo_root = Path(__file__).resolve().parent.parent.parent
    if not binary_value:
        cand_engine = repo_root / "engines" / "h3.c" / "h3"
        cand_legacy = repo_root / "MiniMax-H3-h3c-ComfyUI" / "h3.c" / "h3"
        if cand_engine.is_file():
            binary_value = str(cand_engine)
        elif cand_legacy.is_file():
            binary_value = str(cand_legacy)

    if not model_value:
        cand_models = repo_root / "models" / "MiniMax-H3"
        cand_legacy = repo_root / "MiniMax-H3-h3c-ComfyUI" / "MiniMax-H3"
        if cand_models.is_dir():
            model_value = str(cand_models)
        elif cand_legacy.is_dir():
            model_value = str(cand_legacy)

    if not binary_value or not model_value:
        raise RuntimeError("Set H3_BINARY and H3_MODEL_DIR (or place h3 binary in engines/h3.c/h3) before starting ComfyUI.")

    binary = Path(binary_value).expanduser().resolve()
    model = Path(model_value).expanduser().resolve()
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise RuntimeError(f"H3_BINARY is not an executable file: {binary}")
    if not model.is_dir():
        raise RuntimeError(f"H3_MODEL_DIR is not a directory: {model}")
    return binary, model


def _update_comfy_pbar(token, pbar, last_pct):
    match = _PROGRESS_RE.match(token.strip())
    if not match:
        return last_pct
    phase, done, total = match.group(1).strip(), int(match.group(2)), int(match.group(3))
    lo, hi = _STAGE_WEIGHTS.get(phase, (85, 99))
    ratio = (done / total) if total > 0 else 0.0
    pct = min(100, max(last_pct, int(lo + (hi - lo) * ratio)))
    if pct > last_pct:
        pbar.update_absolute(pct, 100)
    return pct


def _drain_stream(fd, log_fp, tail, pbar, last_pct):
    try:
        chunk = os.read(fd, 1024)
    except BlockingIOError:
        return tail, last_pct, False
    if not chunk:
        return "", last_pct, True
    log_fp.write(chunk)
    log_fp.flush()
    combined = tail + chunk.decode("utf-8", errors="replace")
    parts = re.split(r"[\r\n]", combined)
    for token in parts[:-1]:
        if token:
            last_pct = _update_comfy_pbar(token, pbar, last_pct)
    rem = parts[-1]
    if rem and _PROGRESS_RE.match(rem.strip()):
        last_pct = _update_comfy_pbar(rem, pbar, last_pct)
        rem = ""
    return rem, last_pct, False


def _execute_h3_command(command, binary, log_path, output_path):
    env = dict(os.environ)
    env.setdefault("H3_VAE_PRECISION", "bf16")
    env.setdefault("H3_VAE_PREFETCH", "1")
    pbar = comfy.utils.ProgressBar(100)
    last_pct = 0
    with log_path.open("wb") as log_fp:
        process = subprocess.Popen(
            command, cwd=str(binary.parent), stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=env, shell=False, start_new_session=True,
        )
        os.set_blocking(process.stdout.fileno(), False)
        os.set_blocking(process.stderr.fileno(), False)
        fds = [process.stderr.fileno(), process.stdout.fileno()]
        tails = {fds[0]: "", fds[1]: ""}
        try:
            while fds:
                model_management.throw_exception_if_processing_interrupted()
                ready, _, _ = select.select(fds, [], [], 0.1)
                for fd in ready:
                    tails[fd], last_pct, eof = _drain_stream(fd, log_fp, tails[fd], pbar, last_pct)
                    if eof:
                        fds.remove(fd)
            returncode = process.wait()
            model_management.throw_exception_if_processing_interrupted()
        finally:
            if process.poll() is None:
                _terminate_process_group(process)
                if output_path.exists():
                    output_path.unlink(missing_ok=True)
    if returncode != 0 and output_path.exists():
        output_path.unlink(missing_ok=True)
    return returncode


def _save_image(image, path):
    """Write ComfyUI's first IMAGE batch member as an h3.c-compatible PNG."""
    pixels = image[0].detach().cpu().numpy()
    Image.fromarray(np.clip(pixels * 255.0, 0, 255).astype(np.uint8)).save(path)


def _save_audio(audio, path):
    """Write the first ComfyUI AUDIO batch member as a PCM WAV reference."""
    waveform = audio["waveform"]
    samples = waveform[0].detach().cpu().numpy()
    if samples.ndim != 2 or samples.shape[0] < 1:
        raise RuntimeError("AUDIO must contain samples shaped [batch, channels, frames].")
    pcm = np.rint(np.clip(samples, -1.0, 1.0).T * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(samples.shape[0])
        output.setsampwidth(2)
        output.setframerate(int(audio["sample_rate"]))
        output.writeframes(pcm.tobytes())


def _save_video(video, path):
    """Materialize a VIDEO input without decoding or re-encoding it."""
    source = video.get_stream_source()
    if isinstance(source, (str, os.PathLike)):
        shutil.copyfile(source, path)
        return
    source.seek(0)
    with path.open("wb") as output:
        shutil.copyfileobj(source, output)


def _append_reference(references, reference):
    return tuple(references or ()) + (reference,)


class H3ReferenceImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE", {"tooltip": "Image to append to the ordered Ref2VA sequence."}),
        }, "optional": {
            "references": ("H3_REFERENCES", {"tooltip": "Previous H3 reference sequence."}),
        }}

    RETURN_TYPES = ("H3_REFERENCES",)
    FUNCTION = "append"
    CATEGORY = "video/h3.c/reference"
    DESCRIPTION = "Append an image to h3.c's ordered Ref2VA reference sequence (requires the Ref2VA checkpoint)."

    def append(self, image, references=None):
        return (_append_reference(references, ("image", image)),)


class H3ReferenceVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "video": ("VIDEO", {"tooltip": "Video to append to the ordered Ref2VA sequence."}),
            "audio_mode": (["with_audio", "without_audio"], {"default": "with_audio"}),
        }, "optional": {
            "references": ("H3_REFERENCES", {"tooltip": "Previous H3 reference sequence."}),
        }}

    RETURN_TYPES = ("H3_REFERENCES",)
    FUNCTION = "append"
    CATEGORY = "video/h3.c/reference"
    DESCRIPTION = "Append a video reference, preserving or ignoring its embedded soundtrack (requires Ref2VA)."

    def append(self, video, audio_mode, references=None):
        return (_append_reference(references, ("video", video, audio_mode)),)


class H3ReferenceVideoWithAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "video": ("VIDEO", {"tooltip": "Video to append to the ordered Ref2VA sequence."}),
            "audio": ("AUDIO", {"tooltip": "Replacement soundtrack for this video reference."}),
        }, "optional": {
            "references": ("H3_REFERENCES", {"tooltip": "Previous H3 reference sequence."}),
        }}

    RETURN_TYPES = ("H3_REFERENCES",)
    FUNCTION = "append"
    CATEGORY = "video/h3.c/reference"
    DESCRIPTION = "Append a video reference with an explicit replacement soundtrack (requires Ref2VA)."

    def append(self, video, audio, references=None):
        return (_append_reference(references, ("video_audio", video, audio)),)


class H3ReferenceAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio": ("AUDIO", {"tooltip": "Standalone audio to append after an image or video reference."}),
        }, "optional": {
            "references": ("H3_REFERENCES", {"tooltip": "Previous H3 reference sequence."}),
        }}

    RETURN_TYPES = ("H3_REFERENCES",)
    FUNCTION = "append"
    CATEGORY = "video/h3.c/reference"
    DESCRIPTION = "Append standalone audio to h3.c's ordered Ref2VA sequence (requires Ref2VA)."

    def append(self, audio, references=None):
        return (_append_reference(references, ("audio", audio)),)


class H3NativeVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "prompt": ("STRING", {"multiline": True, "default":
                "A red fox walks through fresh snow in a pine forest. "
                "Medium tracking shot, natural winter light."}),
            "width": ("INT", {"default": 512, "min": 32, "max": 1344, "step": 32}),
            "height": ("INT", {"default": 512, "min": 32, "max": 1344, "step": 32}),
            "frames": ("INT", {"default": 22, "min": 22, "max": 362, "step": 17}),
            "steps": ("INT", {"default": 20, "min": 2, "max": 1000}),
            "layers": (["45", "50", "40"],),
            "reuse": ("INT", {"default": 2, "min": 1, "max": 3}),
            "seed": ("INT", {"default": 42, "min": 0, "max": 0xffffffffffffffff}),
        }, "optional": {
            "first_frame": ("IMAGE", {"tooltip":
                "Optional starting image. Uses only the first image from the batch."}),
            "last_frame": ("IMAGE", {"tooltip":
                "Optional ending image. Uses only the first image from the batch."}),
            "references": ("H3_REFERENCES", {"tooltip":
                "Ordered Ref2VA image, video, and audio references. Requires Ref2VA weights and cannot be combined with frame anchors."}),
            "reference_image_size": (["match", "max"], {"default": "match", "tooltip":
                "Ref2VA image sizing. 'match' is the h3.c default; 'max' retains the largest reference canvas."}),
            "duration_seconds": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 3600.0, "step": 0.125, "tooltip":
                "Duration at 24 fps. A value above zero replaces frames; h3.c rounds upward to a legal temporal shape."}),
            "render_width": ("INT", {"default": 0, "min": 0, "max": 1344, "step": 32, "tooltip":
                "Lower internal render width. Set both render dimensions, keep aspect ratio, and do not exceed output dimensions. Zero uses output width."}),
            "render_height": ("INT", {"default": 0, "min": 0, "max": 1344, "step": 32, "tooltip":
                "Lower internal render height. Set both render dimensions, keep aspect ratio, and do not exceed output dimensions. Zero uses output height."}),
            "core_reuse": ("INT", {"default": 0, "min": 0, "max": 6, "tooltip":
                "0 uses normal denoiser reuse. 1-6 uses core residual reuse instead; 4 is the normal speed preset and 6 is aggressive."}),
            "token_reduction": ("BOOLEAN", {"default": False, "tooltip":
                "Pairs video tokens in middle DiT blocks. Faster, but can alter composition; the bridge rejects the documented 40-layer/reuse-3 artifact combination."}),
            "ssd_streaming": ("BOOLEAN", {"default": False, "tooltip":
                "Streams original BF16 DiT layers from SSD to reduce memory pressure. Cannot be combined with int8 row FC2."}),
            "use_int8_row_fc2": ("BOOLEAN", {"default": False, "tooltip":
                "M5-specific faster one-scale int8 FC2 implementation. It is less numerically conservative and cannot be combined with SSD streaming."}),
            "use_reference_rope": ("BOOLEAN", {"default": False, "tooltip":
                "Restores released/MLX RoPE coordinates for parity checks. Leave off to use h3.c's native 256-square adaptation."}),
            "profile": ("BOOLEAN", {"default": True, "tooltip":
                "Write h3.c phase timings to the retained generation log."}),
        }}

    RETURN_TYPES = ("VIDEO",)
    FUNCTION = "generate"
    CATEGORY = "video/h3.c"
    DESCRIPTION = "Generate video locally with h3.c using text, first/last-frame anchors, and ordered Ref2VA media. Connect to Save Video."

    def generate(self, prompt, width, height, frames, steps, layers, reuse, seed,
                 first_frame=None, last_frame=None, references=None,
                 reference_image_size="match", duration_seconds=0.0,
                 render_width=0, render_height=0, core_reuse=0,
                 token_reduction=False, ssd_streaming=False,
                 use_int8_row_fc2=False, use_reference_rope=False,
                 profile=True):
        binary, model = _resolve_h3_paths()
        if references and (first_frame is not None or last_frame is not None):
            raise RuntimeError(
                "h3.c frame anchors cannot be combined with Ref2VA references. "
                "Use first_frame/last_frame for FL2VA, or use references for Ref2VA."
            )
        if references and not (model / "Ref2VA" / "transformer" /
                               "model.safetensors.index.json").is_file():
            raise RuntimeError(
                "The Ref2VA checkpoint is not installed under H3_MODEL_DIR/Ref2VA. "
                "The current local FL2VA-only model supports text and frame anchors only."
            )
        has_render_width = render_width > 0
        has_render_height = render_height > 0
        if has_render_width != has_render_height:
            raise RuntimeError(
                "render_width and render_height must either both be zero or both be set."
            )
        if has_render_width:
            if render_width > width or render_height > height:
                raise RuntimeError("Internal render dimensions cannot exceed the output dimensions.")
            if render_width * height != render_height * width:
                raise RuntimeError("Internal render dimensions must have the same aspect ratio as output.")
        if core_reuse < 0 or core_reuse > 6:
            raise RuntimeError("core_reuse must be between 0 and 6.")
        if ssd_streaming and use_int8_row_fc2:
            raise RuntimeError("SSD streaming and int8 row FC2 cannot be combined in h3.c.")
        if token_reduction and str(layers) == "40" and reuse == 3 and core_reuse == 0:
            raise RuntimeError(
                "h3.c documents layers=40 with reuse=3 and token reduction as artifact-prone; choose another speed combination."
            )

        model_management.throw_exception_if_processing_interrupted()
        model_management.unload_all_models()
        model_management.soft_empty_cache()
        temp_dir = Path(folder_paths.get_temp_directory())
        temp_dir.mkdir(parents=True, exist_ok=True)
        run_dir = Path(tempfile.mkdtemp(prefix="h3c_", dir=temp_dir))
        output = run_dir / "video.mp4"
        log_path = run_dir / "h3.log"
        command = [str(binary)]
        if profile:
            command.append("--profile")
        command.extend(["-d", str(model), "-p", _normalize_h3_prompt(prompt),
                        "--width", str(width), "--height", str(height)])
        if duration_seconds > 0:
            command.extend(["--seconds", str(duration_seconds)])
        else:
            command.extend(["--frames", str(frames)])
        command.extend(["--steps", str(steps), "--layers", str(layers)])
        if core_reuse > 0:
            command.extend(["--core-reuse", str(core_reuse)])
        else:
            command.extend(["--reuse", str(reuse)])
        command.extend(["--seed", str(seed), "-o", str(output)])
        if has_render_width:
            command.extend(["--render-width", str(render_width),
                            "--render-height", str(render_height)])
        if token_reduction:
            command.append("--token-reduction")
        # The installer sets H3_FORCE_SSD_STREAMING=1 on Macs below 48 GiB of
        # memory. int8 row FC2 cannot stream from SSD, so it keeps priority.
        force_ssd_streaming = (os.environ.get("H3_FORCE_SSD_STREAMING") == "1"
                               and not use_int8_row_fc2)
        if ssd_streaming or force_ssd_streaming:
            command.append("--ssd-streaming")
        if use_int8_row_fc2:
            command.append("--use-int8-row-fc2")
        if use_reference_rope:
            command.append("--use-reference-rope")
        if first_frame is not None:
            image_path = run_dir / "first-frame.png"
            _save_image(first_frame, image_path)
            command.extend(["--first-frame", str(image_path)])
        if last_frame is not None:
            image_path = run_dir / "last-frame.png"
            _save_image(last_frame, image_path)
            command.extend(["--last-frame", str(image_path)])
        if references:
            command.extend(["--ref-image-size", reference_image_size])
        for index, reference in enumerate(references or (), start=1):
            kind = reference[0]
            if kind == "image":
                image_path = run_dir / f"reference-{index}.png"
                _save_image(reference[1], image_path)
                command.extend(["--ref-image", str(image_path)])
            elif kind == "video":
                video_path = run_dir / f"reference-{index}.mp4"
                _save_video(reference[1], video_path)
                flag = "--ref-video" if reference[2] == "with_audio" else "--ref-silent-video"
                command.extend([flag, str(video_path)])
            elif kind == "video_audio":
                video_path = run_dir / f"reference-{index}.mp4"
                audio_path = run_dir / f"reference-{index}.wav"
                _save_video(reference[1], video_path)
                _save_audio(reference[2], audio_path)
                command.extend(["--ref-video-audio", str(video_path), str(audio_path)])
            elif kind == "audio":
                audio_path = run_dir / f"reference-{index}.wav"
                _save_audio(reference[1], audio_path)
                command.extend(["--ref-audio", str(audio_path)])
            else:
                raise RuntimeError(f"Unsupported H3 reference kind: {kind}")
        print(f"h3.c generation log: {log_path}", flush=True)
        returncode = _execute_h3_command(command, binary, log_path, output)
        if returncode != 0:
            raise RuntimeError(f"h3.c exited with code {returncode}. See {log_path}")
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError(f"h3.c did not produce a nonempty video. See {log_path}")
        return (InputImpl.VideoFromFile(str(output)),)


class H3ChainedStoryboardVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "storyboard_grid": ("IMAGE", {"tooltip": "3x3 9-Grid Storyboard image."}),
                "segments_json": ("STRING", {
                    "multiline": True,
                    "default": '[{"title": "Part 1", "end_panel": 3, "prompt": "..."}]',
                    "tooltip": "JSON array of segments: [{'title': '...', 'end_panel': 1-9, 'prompt': '...'}]",
                }),
                "width": ("INT", {"default": 640, "min": 32, "max": 1344, "step": 32}),
                "height": ("INT", {"default": 480, "min": 32, "max": 1344, "step": 32}),
                "frames": ("INT", {"default": 124, "min": 22, "max": 362, "step": 17}),
                "steps": ("INT", {"default": 20, "min": 2, "max": 1000}),
                "layers": (["45", "50", "40"],),
                "reuse": ("INT", {"default": 2, "min": 1, "max": 3}),
                "seed": ("INT", {"default": 20260931, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "core_reuse": ("INT", {"default": 0, "min": 0, "max": 6}),
                "token_reduction": ("BOOLEAN", {"default": False}),
                "render_width": ("INT", {"default": 0, "min": 0, "max": 1344, "step": 32}),
                "render_height": ("INT", {"default": 0, "min": 0, "max": 1344, "step": 32}),
                "ssd_streaming": ("BOOLEAN", {"default": True}),
                "chain_mode": (["motion_context", "first_frame"], {"default": "motion_context"}),
            },
        }

    RETURN_TYPES = ("VIDEO",)
    FUNCTION = "generate_chained"
    CATEGORY = "video/h3.c"
    DESCRIPTION = "Generate N chained 5s video segments from a 3x3 9-grid storyboard (auto-slicing panels, chaining last-frame -> first-frame, trimming initial frame, and concatenating into a single MP4)."

    def generate_chained(
        self,
        storyboard_grid,
        segments_json,
        width,
        height,
        frames,
        steps,
        layers,
        reuse,
        seed,
        core_reuse=0,
        token_reduction=False,
        render_width=0,
        render_height=0,
        ssd_streaming=True,
        chain_mode="motion_context",
    ):
        import json as _json

        binary, model = _resolve_h3_paths()

        segments = _json.loads(segments_json)
        if not isinstance(segments, list) or not segments:
            raise RuntimeError("segments_json must be a non-empty JSON list of segment objects.")

        model_management.throw_exception_if_processing_interrupted()
        model_management.unload_all_models()
        model_management.soft_empty_cache()

        temp_dir = Path(folder_paths.get_temp_directory())
        temp_dir.mkdir(parents=True, exist_ok=True)
        run_dir = Path(tempfile.mkdtemp(prefix="h3c_chain_", dir=temp_dir))
        grid_path = run_dir / "storyboard_9grid.png"
        _save_image(storyboard_grid, grid_path)

        # Slice 3x3 grid into 9 panel images
        im = Image.open(grid_path).convert("RGB")
        gw, gh = im.size
        pw, ph = gw // 3, gh // 3
        panel_paths = {}
        for idx in range(1, 10):
            r, c = divmod(idx - 1, 3)
            crop = im.crop((c * pw + 6, r * ph + 6, (c + 1) * pw - 6, (r + 1) * ph - 6)).resize(
                (width, height), Image.Resampling.LANCZOS
            )
            p_path = run_dir / f"panel_{idx}.png"
            crop.save(p_path)
            panel_paths[idx] = p_path

        seg_videos = []
        prev_video = None
        prev_context = None

        for idx, seg in enumerate(segments, start=1):
            model_management.throw_exception_if_processing_interrupted()
            seg_chain_mode = seg.get("chain_mode", chain_mode)
            use_motion_context = bool(idx > 1 and seg_chain_mode == "motion_context")
            save_ctx = run_dir / f"seg_{idx}.h3ctx"

            if idx == 1:
                first_f = grid_path
            elif use_motion_context:
                first_f = None
            else:
                first_f = run_dir / f"seg_{idx-1}_last.png"
                subprocess.run(
                    ["ffmpeg", "-y", "-sseof", DEFAULT_FFMPEG_TAIL_SEEK, "-i", str(prev_video), "-update", "1", "-q:v", "1", str(first_f)],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30.0,
                )

            end_panel = max(1, min(9, int(seg.get("end_panel", min(9, idx * 3)))))
            last_f = panel_paths.get(end_panel)
            seg_out = run_dir / f"seg_{idx}.mp4"
            log_path = run_dir / f"h3_seg_{idx}.log"

            cmd = [
                str(binary),
                "--profile",
                "-d", str(model),
                "-p", _normalize_h3_prompt(seg.get("prompt", "")),
                "--width", str(width),
                "--height", str(height),
                "--frames", str(frames),
                "--steps", str(steps),
                "--layers", str(layers),
            ]
            if core_reuse > 0:
                cmd.extend(["--core-reuse", str(core_reuse)])
            else:
                cmd.extend(["--reuse", str(reuse)])
            cmd.extend(["--seed", str(seed + idx - 1), "-o", str(seg_out)])
            if render_width > 0 and render_height > 0:
                cmd.extend(["--render-width", str(render_width), "--render-height", str(render_height)])
            if token_reduction:
                cmd.append("--token-reduction")
            if ssd_streaming:
                cmd.append("--ssd-streaming")
            cmd.extend(["--save-context", str(save_ctx)])
            if use_motion_context:
                motion_source = prev_context if (prev_context and prev_context.is_file()) else prev_video
                cmd.extend(["--motion-context", str(motion_source)])
            elif first_f is not None:
                cmd.extend(["--first-frame", str(first_f)])
            if last_f is not None:
                cmd.extend(["--last-frame", str(last_f)])

            print(f"[H3ChainedStoryboardVideo] Segment {idx}/{len(segments)} log: {log_path}", flush=True)
            returncode = _execute_h3_command(cmd, binary, log_path, seg_out)

            if returncode != 0 or not seg_out.is_file():
                raise RuntimeError(f"h3.c segment {idx} failed with code {returncode}. See {log_path}")

            # Trim first frame only if using first_frame anchor
            if not use_motion_context:
                trimmed_out = run_dir / f"seg_{idx}_trimmed.mp4"
                trim_cmd = [
                    "ffmpeg", "-y", "-i", str(seg_out),
                    "-vf", "select='gte(n\\,1)',setpts=PTS-STARTPTS",
                    "-af", f"atrim=start={DEFAULT_FFMPEG_AUDIO_TRIM_FIRST_FRAME},asetpts=PTS-STARTPTS",
                    *DEFAULT_FFMPEG_ENCODE_ARGS,
                    *DEFAULT_FFMPEG_AUDIO_ARGS,
                    str(trimmed_out),
                ]
                trim_res = subprocess.run(
                    trim_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=60.0,
                )
                if trim_res.returncode == 0 and trimmed_out.is_file():
                    shutil.move(str(trimmed_out), str(seg_out))

            seg_videos.append(seg_out)
            prev_video = seg_out
            prev_context = save_ctx

        if len(seg_videos) == 1:
            return (InputImpl.VideoFromFile(str(seg_videos[0])),)

        concat_list = run_dir / "concat.txt"
        concat_list.write_text("\n".join(f"file '{p.resolve()}'" for p in seg_videos) + "\n", encoding="utf-8")
        final_out = run_dir / "chained_merged.mp4"
        concat_cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
            *DEFAULT_FFMPEG_ENCODE_ARGS,
            *DEFAULT_FFMPEG_AUDIO_ARGS,
            str(final_out),
        ]
        subprocess.run(
            concat_cmd,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120.0,
        )
        return (InputImpl.VideoFromFile(str(final_out)),)


NODE_CLASS_MAPPINGS = {
    "H3NativeVideo": H3NativeVideo,
    "H3ChainedStoryboardVideo": H3ChainedStoryboardVideo,
    "H3ReferenceImage": H3ReferenceImage,
    "H3ReferenceVideo": H3ReferenceVideo,
    "H3ReferenceVideoWithAudio": H3ReferenceVideoWithAudio,
    "H3ReferenceAudio": H3ReferenceAudio,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "H3NativeVideo": "H3 Native Video (h3.c)",
    "H3ChainedStoryboardVideo": "H3 Chained Storyboard Video (5+5+5...)",
    "H3ReferenceImage": "H3 Reference Image",
    "H3ReferenceVideo": "H3 Reference Video",
    "H3ReferenceVideoWithAudio": "H3 Reference Video + Audio",
    "H3ReferenceAudio": "H3 Reference Audio",
}
