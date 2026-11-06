# Contributing to H3 Studio

Thank you for your interest in contributing to H3 Studio! We welcome improvements, bug fixes, and feature additions.

## Development Workflow

1. **Clone and Install Dev Dependencies**:
   ```bash
   git clone https://github.com/h3-studio/h3-studio.git
   cd h3-studio
   pip install -e ".[dev]"
   ```

2. **Pre-commit Setup**:
   ```bash
   pre-commit install
   ```

3. **Coding Standards**:
   - Every new Python module must include `from __future__ import annotations` as line 1.
   - Maintain function simplicity (target $\le 50$ lines, strict upper bound $\le 80$ lines).
   - Functions taking $> 3$ parameters should encapsulate inputs using `@dataclass(frozen=True)`.
   - Never commit hardcoded personal filesystem paths (e.g. absolute user home paths).

4. **Running Tests**:
   ```bash
   python3 -m unittest discover -s tests
   ```

5. **Code Style & Linting**:
   ```bash
   ruff check .
   ```

## Pull Request Guidelines

- Ensure all 26+ unit tests pass.
- Keep commits atomic with conventional commit format (e.g. `feat: ...`, `fix: ...`).
- Submit PRs targeting the `main` branch.
