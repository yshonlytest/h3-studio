# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-06

### Added
- **Hardware Perception Engine**: Real-time macOS `vm_stat` Available RAM detection preventing <48 GiB disk swapping crashes.
- **Dynamic Tension Linter**: Kinetic action verbs and cinematic camera motion quality gate preventing character freeze.
- **Anchor Reset Anti-Drift**: Multi-segment keyframe re-anchoring (`--anchor-every`) ensuring consistent character identity across 25s+ productions.
- **Atomic State Machine**: Segment-level checkpoint resumption (`*.state.json`) with deterministic SHA256 config hash and corruption self-healing.
- **Colab NVMe Fast Execution**: Decoupled from Google Drive FUSE latency via sequential `.tar` decompression.
- **PipelineExecutor Protocol**: Seamless dependency injection supporting GPU execution (`H3DirectExecutor`) and lightweight simulation (`NoopExecutor`).
- **Standardized CI & Tests**: GitHub Actions CI matrix, pre-commit guardrails, and 26-test unit suite.

### Changed
- Standardized package imports across `pipeline/` removing legacy `try/except ImportError` dual-branches.
- Replaced 23-argument `run_h3_direct` signature with structured `SegmentJob` dataclass.
- Made Google Drive public sharing opt-in (`H3_GDRIVE_PUBLIC_SHARE=0`) for privacy protection.
