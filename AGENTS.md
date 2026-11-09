# Vocab

Read [development](docs/development.md), [architecture](docs/architecture.md), and [domain language](CONTEXT.md) before project work. [Deployment](docs/deployment.md) owns operations; [decisions](docs/decisions.md) records rationale. Keep Markdown paragraphs unwrapped.

Run `mise run check` before submitting changes. Use synthetic fixtures and disposable databases; keep credentials, real vocabulary/study records, host details, plans, and ledgers out of tracked files. Applied database migrations are immutable.

## Temporary skill-creator workaround

Until openai/codex#36624 and openai/codex#30935 are fixed in the installed system skill:

- When using `skill-creator`, do not execute its bundled Python scripts directly. Resolve `<skill-creator-dir>` from the active skill file path.
- Run the initializer with `python3 <skill-creator-dir>/scripts/init_skill.py ...`.
- Run the metadata generator with `python3 <skill-creator-dir>/scripts/generate_openai_yaml.py ...`.
- Run validation with `uv run --isolated --no-project --with PyYAML python <skill-creator-dir>/scripts/quick_validate.py <skill-folder>`.
- Do not edit the installed `.system` copy to apply this workaround.

Remove this section only after an installed Codex update makes the documented commands work in a clean base Python environment.
