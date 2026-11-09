# AI evals

Manual, paid checks of the AI prompts against real Gemini. Run one when changing a model, setting or prompt; never part of `mise run check`.

| Eval            | Command (from `apps/api`) | Checks                                               |
| --------------- | ------------------------- | ---------------------------------------------------- |
| One-word drafts | `pnpm eval:one-word`      | Automatic checks + per-word grading by `local-agent` |
| Meaning match   | `pnpm eval:meaning-match` | Expected decision + the app's validator              |

Needs `VOCAB_GEMINI_API_KEY` in the root `.env` or environment. Optional grading needs a compatible `local-agent` command on `PATH`: it accepts `--agent opus|sol --effort high --schema <JSON-schema-file>`, reads the prompt from stdin, and writes only schema-valid JSON to stdout. It is an external adapter, not supplied by this project; use `--grader none` for the one-word checks without it.

## Options

- `--variant <file.ts>` (repeatable): what to test; omitted = the app's current prompt and settings. A variant module default-exports `{ name, model?, config?, prompt? }` (`lib/variants.ts`): `config` merges over the app's generation settings (e.g. `thinkingConfig`), `prompt` replaces the system instruction, schema or input. Examples: `one-word/variants/`. Once a variant ships, fold it into the app and delete it.
- `--model <id>`: model for variants without one (default `VOCAB_GEMINI_MODEL`).
- `--runs <n>` (default 2), `--cases a,b`, `--concurrency <n>` (default 4), `--out <dir>`, `--yes` (skip the cost prompt).
- One-word only: `--grader opus|sol|none` (default `sol`); `--regrade <results dir>` regrades saved outputs, e.g. with another grader.

Results go to `evals/results/<time>-<eval>/` (ignored): `runs.json` (every output and usage), `grades-<agent>.json`, `report*.md`.

## Workflow

1. Pick a target model and run every case on it once (the baseline).
2. For the failing cases only (`--cases`), change one thing at a time (prompt, settings) as variants until they pass. Never rerun the full set while fixing.
3. Rerun the full set with the winning variant to catch regressions in the cases that passed.

## Reading a one-word report

Automatic checks are facts: forms against the reference sets, flags, term, part of speech, labels. The grader only answers yes/no and coverage checks per output, blind to variant names; the report counts them. Judge the result from the whole report, not one number: essential senses covered, invalid or blended senses, and the per-case notes.

## Reference cases

`one-word/cases.json` holds source-backed references (method and sources inside). Tiers: `essential` (omission is a defect), `valid` (attested, optional), `uncertain` (unverified, never counted against an output). Forms are sets: all `required` must appear; `optional` may. Each case covers distinct failure modes; add a case only for a new one.
