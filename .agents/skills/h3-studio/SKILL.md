---
name: h3-studio
description: >-
  Unified entry skill for H3 Storyboard Studio across Web-First, Agent-First, and Hybrid workflows.
  Supports Creative Storyboard and Doc-to-Edu modes across Local Metal (h3.c), Google Colab GPU, and SaaS API routes via python3 -m pipeline.h3_cli.
---

# H3 Storyboard Studio — Unified Agent Workflow & Compute Orchestration

This is the top-level entry skill for H3 Storyboard Studio. All storyboard compilation, validation, environment probing, two-phase consent planning, execution, and verification MUST go through the single deterministic CLI `python3 -m pipeline.h3_cli`.

---

## 1. Workflow Entry Triage (Do Not Assume Manifest Exists)

Determine how the user entered the workflow before searching for files:

1. **Web-First with Inline Payload (`<H3_STORYBOARD_PAYLOAD>`)**:
   - If the user's prompt contains `<H3_STORYBOARD_PAYLOAD>...</H3_STORYBOARD_PAYLOAD>`, save the payload (or the whole prompt file) to disk and pass it directly to `python3 -m pipeline.h3_cli validate-manifest --manifest <file>`.
2. **Web-First with Exported Manifest File (`colab_manifest_*.json`)**:
   - Check the current working directory and `~/Downloads/` for the exact filename named in the prompt. If missing, ask the user to click **"💾 下載分鏡任務檔 (.json)"** in Step 3 of the Web UI. **Never** substitute `examples/storyboards/` demo files without explicit user request.
3. **Agent-First / Repo-Direct Quick-Start**:
   - If the user shares the repo URL or an `【Agent-First 快速啟動任務】` prompt, **do NOT search `~/Downloads` or session relay for an exported manifest**.
   - Probe the environment first (`python3 -m pipeline.h3_cli usage`).
   - If the user chose the **Demo Track**, prepare a 3-segment validation manifest (`quickstart_manifest.json`).
   - If the user chose the **Production Track** (`creative` or `edu`), actively ask the user for their story outline or document path if not yet provided, then compile via `digest` -> Markdown table -> `build-manifest --from-table` -> `validate-manifest`.

---

## 2. Environment Probe & Realistic Colab OAuth Protocol

Always run the read-only environment probe first:
```bash
python3 -m pipeline.h3_cli usage
```
This outputs JSON containing `local_metal_available`, `colab_cli_installed`, `colab_authenticated`, `compute_units`, `saas_api_configured`, `recommended_route`, and `auth_guidance`.

### Colab OAuth 4-Step Authorization Flow (When `--route colab` is selected and `colab_authenticated` is `false`)
Do NOT assume running a background command automatically completes login without user interaction:
1. **Detect**: Check `colab_authenticated` from `python3 -m pipeline.h3_cli usage`.
2. **Initiate & Guide**: If `false`, trigger or provide `colab login` (depending on whether the agent runs on the user's local machine or a remote sandbox) and clearly instruct the user to complete the Google OAuth browser confirmation.
3. **Wait for User Confirmation**: Pause and wait for the user to confirm they have completed browser authorization.
4. **Verify**: Re-run `python3 -m pipeline.h3_cli usage` and confirm `colab_authenticated: true` and `compute_units` balance before proceeding to `plan`.

---

## 3. Two-Phase Consent Guardrail & Four-State Verification

### Stage 1: Dry-Run Plan
```bash
python3 -m pipeline.h3_cli plan --manifest <manifest.json> --route <colab|local|saas_api> --gpu L4 --max-retries 1 --state-file outputs/run.state.json
```
Report to the user: (1) Route & GPU tier, (2) Total segments, (3) Available/estimated compute cost and retry cap, (4) The generated `consent_token`. Wait for explicit user approval.

### Stage 2: Authorized Execution & Artifact Verification
Only after explicit user approval:
```bash
python3 -m pipeline.h3_cli run --manifest <manifest.json> --route <colab|local|saas_api> --gpu L4 --confirm-token <CONSENT_TOKEN> --state-file outputs/run.state.json
python3 -m pipeline.h3_cli status --state-file outputs/run.state.json
python3 -m pipeline.h3_cli verify --video <output.mp4>
```
Never claim completion until `verify` confirms `TASK_ARTIFACT_VERIFIED` with valid `ffprobe` streams and SHA-256 hash.

---

## 4. Specialized Sub-Skills (Backward-Compatible References)

- For Colab-specific watchdog and harness details, see [.agents/skills/minimax-h3-colab/SKILL.md](../minimax-h3-colab/SKILL.md).
- For Local Metal `h3.c` native audio protection, phonetic lexicon, and Doc-to-Edu pacing rules, see [.agents/skills/h3c-local-film-chain/SKILL.md](../h3c-local-film-chain/SKILL.md).
