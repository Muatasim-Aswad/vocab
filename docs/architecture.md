# Architecture

## Layout

| Path | Package | Notes |
| --- | --- | --- |
| `apps/api` | `@vocab/api` | NestJS 12 (ESM), Drizzle + better-sqlite3; also serves the built web app when `VOCAB_WEB_ROOT` is set |
| `apps/web` | `@vocab/web` | React 19 and Tailwind CSS 4 on Vite+; `e2e/` holds the Playwright smoke test |
| `apps/cli` | `@vocab/cli` | Interactive terminal client over `@vocab/api-client`; local preferences and pending-write journal |
| `packages/contracts` | `@vocab/contracts` | Zod schemas and route contracts; built to `dist/` with `vp pack` |
| `packages/api-client` | `@vocab/api-client` | Typed HTTP client over the contracts; built to `dist/` with `vp pack` |

## Sources of truth

- Dependency versions: `pnpm-workspace.yaml` `catalog` for anything shared; package `package.json` otherwise.
- Lint and format rules: root `vite.config.ts` only (`lint.overrides` / `fmt.overrides` for per-package rules). Package `vite.config.ts` files hold build, dev, and test settings.
- Import boundaries: `.dependency-cruiser.mjs`; unused files, exports, and dependencies: `knip.json`; `scripts/verify-architecture.ts` proves both reject forbidden code.
- TypeScript strictness: `tsconfig.base.json`; each package sets its own module settings.
- Web styling: design tokens (colors with their dark values, type scale, weights, widths, shadows) and element base styles in `apps/web/src/app/styles.css` (`@theme`, `@layer base`); shared class lists (buttons, fields, results, terms) and `cn` in `apps/web/src/shared/ui.ts`; components use Tailwind utilities with those tokens, not new CSS or raw values.
- API contracts: `packages/contracts/src` — schemas, error shape, and `routes` (method, path, auth, request/response schemas). The API derives routing, auth, validation, and OpenAPI (`GET /api/openapi.json`) from `routes`; clients use them through `@vocab/api-client`. Apps import built packages; `mise run check` and `mise run dev` build them first.
- Build identity: the Node-only `apps/web/build-info.ts` plugin emits the bundled identity and `version.json`; the web build is uncached because Git state is not a reliable task-cache input.
- Runtime configuration: `apps/api/src/config.ts` (validated at startup). The root `.env`, documented by `.env.example`, supplies the same `VOCAB_` settings to Docker and local development.
- Database schema: `*.schema.ts` files in the owning feature module (`apps/api/src/modules/<feature>/`), except the retained historical import receipt in `infra/db`; generated migrations in `apps/api/drizzle/`.

## Architecture

API (`apps/api/src`):

| Area | Owns | May import |
| --- | --- | --- |
| `main.ts`, `migrate.ts`, `import-study-history.ts`, `app.module.ts` | Composition and offline migration entrypoints | anything |
| `config.ts` | Env parsing and validation into typed config | `shared` |
| `modules/<feature>/` | Controllers, services, repositories, schemas, pure feature functions | other modules' `*.service.ts`, `platform`, `infra`, `shared` |
| `platform/` | HTTP boundary: contract decorator, auth guard, validation, error filter, middleware, logging | `shared` |
| `infra/` | Connections to external systems (`infra/db`: SQLite connection, migrations, readiness) | `shared` |
| `shared/` | Framework-free code: `AppError`, small utilities | nothing in `src` |

- Services own business operations and stay transport-independent (no Express/HTTP types); controllers only bind contracts to services. No separate use-case layer.
- Feature-owned repositories own persistence; pure functions own substantial calculations. Add interfaces only for a concrete boundary or test need.
- Configuration reaches modules through `forRoot`/`register` options, never `process.env`. Vocabulary owns lexical records, inference and search; search history owns recent searches; study owns scheduling, sessions and study history; auth owns browser sessions; AI owns generation.
- Every route uses `@Contract(routes.x)`. Routes are protected unless their contract says `auth: "public"`.
- Throw `AppError` (or `ValidationError`) with a caller-safe `message`/`details.public`; put diagnostics in `internal`/`details.private`/`cause`. `platform/http/error.filter.ts` maps every failure to the contract error body; the request's single log line carries the private parts. Never serialize `AppError`.
- Success bodies are unenveloped; cursor collections use `cursorPage` (`{ items, metadata: { next_cursor } }`).

Across packages:

- Apps never import each other; they talk over HTTP. Packages never import apps.
- Import workspace packages by name only (their `exports`), never their `src`.
- SQLite, Drizzle, NestJS and server secrets stay in the API. The CLI may use Node only for terminal and local config/journal handling; `apps/web/src` and `packages/*/src` must run in a browser.
- The CLI never imports API code, opens SQLite, starts a server or calls Gemini. It uses a bearer token through `@vocab/api-client`. The web uses an HttpOnly cookie session; the API serves the built web assets when `VOCAB_WEB_ROOT` is set.
- Packages export only their public API from `src/index.ts`; tests import modules directly, not through test-only exports.

The CLI groups business commands in `modules`, connections and the pending-write journal in `infra`, terminal mechanisms in `platform`, and display helpers in `shared`. Web features expose cross-feature APIs through `index.ts`; `app` composes them, `infra` owns external access, and `shared` contains reusable primitives. Dependency rules and their negative probes enforce these directions.

The CLI's `app.ts` defines each command's handler, aliases, help and argument-spacing policy together; dispatch and completion use that registry. Vocabulary's `structured-drafts.ts` owns pure draft preparation, payload merging and label-conflict detection; `structured.ts` coordinates prompts and writes. `TerminalIO` uses Inquirer for interactive fields, menus and editor prompts, and readline for command history/completion, multiline JSON and piped input. Prompt transitions preserve command history and leave the terminal streams open; text-prompt cancellation and EOF answer `q`.

Study selection uses vocabulary schema as an explicit SQL integration projection, then fetches lexical entries through the vocabulary service. Module and schema exceptions in `.dependency-cruiser.mjs` support concrete Nest wiring and foreign keys.

See [CONTEXT.md](../CONTEXT.md) for domain language and [decisions](decisions.md) for rationale.
