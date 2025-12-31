# Migrations

All migration scripts are run with `tsx` (no build step).

## Migrate

Run a converter on every entry in `VOCAB_DATA_PATH` and overwrite the file after creating a backup.

```sh
VOCAB_DATA_PATH=./db/data.json tsx db/migrations/migrate.mts converter.memoryState.mts
VOCAB_DATA_PATH=./db/data.json tsx db/migrations/migrate.mts converter.memoryState.mts --dry-run
```

Backups are written to `./db/migrations/backups` by default:

- `data.json.bak-<migration-name>-<timestamp>`

`<migration-name>` is derived from the converter filename and normalized (lowercase, kebab-case).

### Writing a converter

Create a file in `db/migrations/` named `converter.<name>.mts` exporting `convert` (or a default export):

```ts
export function convert(entry, args, ctx) {
  return { ...entry };
}
export default convert;
```

The signature is:

- `convert(entry: Vocab, args: object, ctx: { nowIso, index, total }) => object`

## Rollback

Restore `VOCAB_DATA_PATH` from a backup file (also creates a rollback backup first):

```sh
VOCAB_DATA_PATH=./db/data.json tsx db/migrations/rollback.mts data.json.bak-20251230-223543
VOCAB_DATA_PATH=./db/data.json tsx db/migrations/rollback.mts data.json.bak-20251230-223543 --dry-run
```

Rollback backups are named:

- `data.json.bak-rollback-<timestamp>`
