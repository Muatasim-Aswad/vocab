# Contributing

Issues and focused pull requests are welcome. Maintenance is best effort; response times and feature acceptance are not guaranteed. Discuss broad changes in [Discussions](https://github.com/Muatasim-Aswad/vocab/discussions) before implementation. Report vulnerabilities privately using [Security](SECURITY.md).

## Setup and verification

Fork and clone the repository, then follow [development](docs/development.md) for the pinned tools, local configuration, and optional hook. Run `mise run check` before submitting. Tests use disposable databases and fake AI providers; live paid AI evals are separate.

Send focused pull requests from your fork, with meaningful tests for behavior changes. Describe the resulting behavior, privacy implications, migrations/compatibility effects, and checks run; mark inapplicable items. Follow [architecture](docs/architecture.md) and update the authoritative documentation. Changes to the memory model need evaluation evidence as well as calculation tests.

Use synthetic data in tests, screenshots, logs, and reports. Remove real vocabulary, study history, credentials, private hostnames, and personal information. Applied database migrations must not be edited. Commit messages should explain the change; Conventional Commits are optional. Contributions use the repository's [MIT license](LICENSE).
