# Development and testing

[README](../README.md) · [Contributing](../CONTRIBUTING.md) · [Architecture](architecture.md)

## Setup

Install [mise](https://mise.jdx.dev), then run from the repository root. [`mise.toml`](../mise.toml) pins Node and pnpm; the lockfile pins dependencies.

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- vp run -r build
```

## Run locally

Create the shared root `.env`, migrate the default database, and start:

```sh
mise run setup
mise exec -- pnpm --filter @vocab/api db:migrate
mise run dev
```

Open <http://localhost:5173> and sign in with `VOCAB_API_TOKEN` from the root `.env`, the same file Docker and the terminal client use. The API listens on `127.0.0.1:3000`; SQLite defaults to `apps/api/data/vocab.db`. Both server startup and migrations use that path. Setup keeps an existing `.env` unchanged.

The Vite proxy preserves the browser's Host header, so local login needs no CORS configuration. Set `VOCAB_API_URL` only when the API is elsewhere. [`.env.example`](../.env.example) documents the shared settings. `mise run dev` loads that file for both watchers; direct API commands also read it from the repository root. See [deployment](deployment.md) for Docker operations.

`mise run dev` builds shared packages, then starts the API and web watchers. Run the [terminal client](cli.md) separately.

## Checks and commands

Install the test browser once, then run the shared local/CI gate:

```sh
mise exec -- pnpm --filter @vocab/web exec playwright install chromium
mise run check
```

`check` builds all packages, checks formatting/lint/types and architecture boundaries, runs migration/recovery/hook checks and package tests, then runs the Chromium smoke tests. Tests use synthetic data and disposable databases; no real token, database, or paid AI access is needed. CI also builds the container and scans push/PR ranges for secrets.

| Command                                         | Purpose                                 |
| ----------------------------------------------- | --------------------------------------- |
| `mise run setup`                                | Create the shared private token config. |
| `mise run dev`                                  | Start API and web development watchers. |
| `mise exec -- vp run -r build`                  | Build all packages and clients.         |
| `mise run check`                                | Run the complete local/CI gate.         |
| `mise exec -- vp check --fix`                   | Apply formatting and lint fixes.        |
| `mise exec -- vp run --filter <package> <task>` | Run a package task.                     |

[`mise.toml`](../mise.toml), package manifests, and Vite configs own task definitions. Deterministic builds and tests are cached; the web build always refreshes Git identity. Architecture and browser checks are uncached. Use `mise exec -- vp run --last-details` to inspect caching, or `mise exec -- vp cache clean` to clear it.

## Database and migrations

- The server opens an existing database; `db:migrate` creates it and applies pending migrations. Server startup never migrates. Readiness rejects pending or diverged migrations.
- After schema changes, run `mise exec -- pnpm --filter @vocab/api db:generate`, review the SQL, and commit it with the schema change. Use Drizzle's custom migration option for data migrations.
- Applied migrations are immutable. Fix mistakes with a new migration; changing an applied file makes migration and readiness checks fail.
- Study sessions and their final history are stored together in SQLite. `GET /api/study/history[/:id]` exports history. The explicit `db:import:study-history` command can import old JSON logs; dry runs are read-only, and applying requires the expected source hash and exclusive database access with the API stopped.

## Conventions

- Import Vitest APIs from `vite-plus/test` and config helpers from `vite-plus`.
- Use `import type` for type-only imports.
- Combine web class lists with `cn` from shared UI. The formatter sorts Tailwind classes, including those inside `cn(...)`.
- Web tests query by role, label, or text. `data-testid="term"` marks a result's term; never select by styling classes.
- Keep unit tests beside code; API and CLI integration tests live in each app's `test/`, and browser tests in `apps/web/e2e/`. Manual paid AI evals live in `apps/api/evals/`; follow their [instructions](../apps/api/evals/README.md) when changing an AI model, prompt, or setting.
- Follow [architecture](architecture.md) for ownership and [decisions](decisions.md) for non-obvious rationale.

## Local hooks

Install the hook with `git config --local core.hooksPath .githooks`. It runs `mise run check` before commits without changing staged content. Uninstall with `git config --local --unset core.hooksPath`.

## Version and source inventory

The root [`package.json`](../package.json) owns the product version. After changing it, run `mise exec -- node scripts/publication/check.mjs --sync-version` to update workspace versions. Runtime identity derives from these manifests; a version change publishes nothing.

Plain Docker builds report revision `dev`. Deployment tools can pass `APP_REVISION`, `APP_COMMIT_TIME`, and `APP_BUILD_TIME` for the exact clean source being built; generated identity stays out of Git.

[`scripts/publication/source-inventory.txt`](../scripts/publication/source-inventory.txt) lists reviewed tracked files. When adding, renaming, or removing public files, stage those changes, run `mise exec -- node scripts/publication/check.mjs --write-inventory`, and review/stage the inventory. The normal gate rejects inventory or version drift and private/generated tracked paths.
