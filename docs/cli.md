# Terminal client

Build the client with [source setup](development.md#setup), and run the server through Docker or [development](development.md#run-locally). The terminal client connects to `http://127.0.0.1:3000` by default; it never opens the database, starts a server, or calls Gemini directly.

For either Docker or development, use the shared root `.env`:

```sh
mise exec -- node --env-file=.env apps/cli/dist/index.js
```

Set `VOCAB_API_URL` only when the server is elsewhere. A protected environment or connection file can supply the token instead; omit `--env-file` in that case. `--help` describes connection/storage settings; `--version` prints the product version. Type `help` inside the app for supported commands, modes, and flags.

Tab completes commands and known terms; Up and Down recall command history. Interactive menus use arrow keys and Enter; piped input uses numbered choices. Ctrl+C in a text prompt answers `q`.

## Workflow

Fast mode captures a term for later review. Normal and detail modes collect lexical fields; JSON accepts structured entries, and AI requests optional server-side suggestions before review. Search, list, show, edit, delete, captures, and settings use the shared API. Ambiguous meanings require an explicit choice.

Study mode selects entries by review priority or ID range and records correctness, response time, hints, and the resulting memory state. Ending the session stores its final history in SQLite. The model combines elapsed time, strength, difficulty, correctness, speed, and streaks; its constants are hand-selected and its predictive advantage has not been established by a benchmark. See `apps/api/src/modules/study/memory.ts` and its calculation tests.

## Local storage

`VOCAB_API_URL` and `VOCAB_API_TOKEN` override the optional `cli.json` connection file. By default, connection settings and `preferences.json` live under `$XDG_CONFIG_HOME/vocab` (or `~/.config/vocab`); `VOCAB_CLI_CONFIG_DIR` overrides the directory. The pending-write journal `cli-pending.json` lives under `$XDG_STATE_HOME/vocab` (or `~/.local/state/vocab`); `VOCAB_CLI_STATE_DIR` overrides it.

Treat the connection file as a credential and the journal as private vocabulary data. Confirmed writes leave the journal; unresolved writes remain for retry. Resolve pending writes before removing local state, or unconfirmed work can be lost. Preferences and connection settings can be removed after exiting the client. Server data and backups have independent retention; see [deployment](deployment.md#data-and-network).
