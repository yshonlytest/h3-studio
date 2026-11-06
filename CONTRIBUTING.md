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
   - All rules (function length, parameters, error handling, paths) live in [docs/STANDARDS.md](docs/STANDARDS.md), the single source of truth.

4. **Running Tests**:
   ```bash
   python3 -m unittest discover -s tests
   ```

5. **Code Style & Linting**:
   ```bash
   ruff check .
   ```

## Pull Request Guidelines

- Ensure the full unit test suite passes (see `docs/STANDARDS.md`).
- Keep commits atomic with conventional commit format (e.g. `feat: ...`, `fix: ...`).
- Submit PRs targeting the `main` branch.
