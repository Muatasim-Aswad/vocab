# Deployment

[README](../README.md#run-with-docker) covers the initial source build. Docker serves the web app and API together; no prebuilt image is published. Build tools run inside Docker, and Compose creates persistent storage and applies migrations before starting the app.

## Configuration

Only `VOCAB_API_TOKEN` is required. Keep it in a mode `0600` root `.env` beside `compose.yaml`, or export it for each Compose command. All other settings have defaults; uncomment only the overrides you need in [`.env.example`](../.env.example).

The default address is <http://127.0.0.1:3000>, with data in the `vocab_data` named volume. [`compose.yaml`](../compose.yaml) owns the port, volume, image, and build settings. Relative application paths and runtime limits are defined in [`apps/api/src/config.ts`](../apps/api/src/config.ts).

For access from other devices, configure a private HTTPS reverse proxy, set `VOCAB_PUBLIC_ORIGIN` to the external origin and `VOCAB_HOSTS` to its hostname, and adjust `VOCAB_BIND` if the proxy cannot reach loopback. CORS is unnecessary when the web app and API share an origin. Add `VOCAB_GEMINI_API_KEY` only if you want AI suggestions; the model defaults in the server.

## Status and updates

Run from the directory containing `compose.yaml` and `.env`:

```sh
docker compose ps
docker compose logs -f api
curl -fsS http://127.0.0.1:3000/api/health/ready
```

Before updating, stop the app and take a [backup](#backup-and-recovery). Keep the previous image ID and its matching backup for recovery. Then update the checkout, build, and recreate:

```sh
git pull --ff-only
docker compose build api
docker compose up -d --no-build --pull never
```

Compose reads `.env` automatically on each command. Data survives container replacement and `docker compose down`; `down -v` deletes it. Changing a mount does not move existing data. Keep SQLite on local storage.

## Manage with srvr

[srvr](https://github.com/Muatasim-Aswad/srvr) can manage source builds, health checks, rollback, and stopped-volume backups. Follow its [installation](https://github.com/Muatasim-Aswad/srvr/blob/main/docs/install.md) and [host setup](https://github.com/Muatasim-Aswad/srvr/blob/main/docs/bootstrap.md), using a version with named-volume backup support.

From a clean source checkout with the root `.env` configured:

```sh
srvr add vocab --kind git --branch main --workdir "$PWD" \
  --compose-file compose.yaml --project vocab \
  --data-volume vocab_data \
  --health http://127.0.0.1:3000/api/health/ready \
  --version-url http://127.0.0.1:3000/version.json
```

Registration leaves running containers alone; add `--start` only for a stopped project. If the Compose project name or port differs, register the actual volume name and health/version URLs. The root `.env` is automatic; use `--env-file` for settings stored elsewhere.

Compose accepts the commit/build identity supplied by srvr; a direct Docker build reports revision `dev`. Use `srvr update vocab --force` for the first srvr-controlled build if necessary. Subsequent operations:

```sh
srvr update vocab --check
srvr update vocab
srvr health vocab
srvr logs vocab -f
```

Configure private HTTPS separately. Follow [srvr recovery](https://github.com/Muatasim-Aswad/srvr/blob/main/docs/updates.md) and the database rules below for rollback; an old image cannot reverse a database migration.

## Backup and recovery

Stop the API and all other database users before copying or restoring data, including one-off migration jobs. Keep the complete data volume and matching image together. Backups contain private vocabulary, history, and AI audit data; protect their location and set your own retention policy.

For the default project and `vocab_data` volume, copy the stopped volume to a new protected directory. Use the existing container's image so no exported `VOCAB_IMAGE` is needed:

```sh
docker compose stop api
mkdir -m 700 /path/to/stopped-copy
image=$(docker compose images -q api)
container=$(docker create --mount type=volume,source=vocab_data,target=/data,readonly "$image")
docker cp "$container:/data/." /path/to/stopped-copy/
docker rm "$container"
```

If the project or volume name differs, use its actual volume name. Copy the complete directory, including any WAL and SHM files. Never copy only the database while it is in use. Keep the image ID printed by `docker compose images -q api` with the backup.

For offline verification, use a source checkout matching that image with dependencies installed and built. The recovery tool operates on the stopped copy, not the live volume:

```sh
node scripts/recovery/recovery.mjs backup /path/to/stopped-copy/vocab.db /path/to/new-backup.db
cp /path/to/new-backup.db /path/to/restored-copy.db
node scripts/recovery/recovery.mjs validate /path/to/restored-copy.db
node scripts/recovery/recovery.mjs compare /path/to/new-backup.db /path/to/restored-copy.db
```

Backup takes exclusive database ownership and refuses an existing destination. Validation is read-only and checks SQLite integrity, foreign keys, migration hashes, and immutable-history triggers. Compare checks history/source digests. Inspect the counts and validate freshly before each restore; these checks do not establish backup freshness or application-level completeness.

Restore with the service stopped into a new volume or location. Preserve the old volume and image until the restored copy is validated with its matching image. Do not run an older image against a newer database. The disposable recovery test in `mise run check` never uses production data.

## Data and network

SQLite retains vocabulary, captures, search history, study sessions and immutable history, mutation receipts, and AI audit records until explicitly deleted or a retention policy is introduced. Backups retain copies independently. The CLI stores preferences and pending writes locally; the browser keeps drafts in memory and preferences in local storage. AI requests go to Gemini only when requested and require configured credentials; SQLite can retain prompts and provider responses. See [Security](../SECURITY.md) for the trusted single-owner deployment boundary.
