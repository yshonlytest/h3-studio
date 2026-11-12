---
name: minimax-h3-colab
description: >-
  Dispatch and monitor H3 video generation on Google Colab GPU via the unified deterministic CLI.
  Use when planning, running dry-run consent checks, or executing Ref2VA multi-shot storyboard jobs on Colab.
---

# MiniMax H3 on Google Colab (Unified Deterministic Pipeline)

This skill guides the AI Agent to run Ref2VA video jobs on Google Colab using the repo's single source of truth CLI `python3 -m pipeline.h3_cli`.

---

## 1. Two-Phase Consent Guardrail Protocol (Strict Ironclad Rule)

AI Agents are **strictly forbidden** from executing Colab GPU batches without explicit, interactive user consent!

### Stage 1: Dry Run & Resource Check
Always run a dry run first to inspect compute balance and generate a bound consent token:
```bash
python3 -m pipeline.h3_cli usage
python3 -m pipeline.h3_cli plan --manifest <path/to/manifest.json> --route colab --gpu L4 --max-retries 1 --state-file outputs/run.state.json
```
- Report to the user:
  1. Target GPU tier (e.g. `L4` or `A100`)
  2. Total job count
  3. Current CU balance
  4. Estimated CU cost (or `UNKNOWN` if indefinite)
  5. Maximum retries (`1`) and fallback policy (`disabled` by default)
  6. The generated `Consent Token` (e.g. `a1b2c3d4e5f67890`)

### Stage 2: User-Authorized Execution
**Only after the user explicitly types approval**, execute with the exact consent token:
```bash
python3 -m pipeline.h3_cli run --manifest <path/to/manifest.json> --route colab --gpu L4 --confirm-token <TOKEN> --state-file outputs/run.state.json
```

---

## 2. Seven-State Verification & Artifact Inspection

Do not claim video generation is completed until the artifact has passed full stream and integrity verification:
```bash
# 1. Query persistent lifecycle state
python3 -m pipeline.h3_cli status --state-file outputs/run.state.json

# 2. Verify artifact streams and SHA-256
python3 -m pipeline.h3_cli verify --video outputs/colab_tutorial_140s/h3_studio_tutorial_140s_144s_seamless_merged.mp4
```
A segment is only finished when it reaches `ARTIFACT_VERIFIED` with valid `ffprobe` video/audio streams and a non-empty SHA-256 hash.

---

## 3. Harness & Sandbox Permissions

- **Google Colab CLI**: Requires internet egress and reads `~/.config/colab-cli/`.
- In Antigravity sandboxed environments, commands invoking the actual external `colab` CLI must set `BypassSandbox: true` upon user permission.
- In native terminals or Gemini CLI, run with standard user privileges.
