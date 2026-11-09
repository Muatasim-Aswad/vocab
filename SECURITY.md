# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Muatasim-Aswad/vocab/security/advisories/new), or email <malasoad2021@gmail.com> if that route is unavailable. Include the affected commit, likely impact, and a minimal synthetic reproduction. Keep vulnerability details, credentials, vocabulary, and study records out of public issues and pull requests. Support is best effort; no response time is promised.

## Supported versions

Before the first release, only `main` receives security fixes. No release artifacts are currently published.

## Trust boundary

Vocab is a single-owner application for trusted private deployments. The server's bearer token grants access to the entire database; the browser exchanges it for a durable HttpOnly session cookie. There are no separate user accounts, tenant isolation, or scoped API permissions. Logout revokes that browser session; rotating the token revokes all sessions. Sessions have no server-side idle or absolute expiry.

Bind published ports to loopback. Remote access requires a private HTTPS reverse proxy, the correct public origin and allowed hosts, trusted clients, and regular updates. Host/origin validation, bounded concurrency, and request limits do not provide a public multi-user security boundary. Do not host untrusted applications on the same origin. Registration with srvr does not configure application authentication or HTTPS.

The CLI connection file contains the bearer token, and its pending-write journal can contain vocabulary. Protect those files, the database, AI eval outputs, and backups. Database history and audit records are retained; deleting an entry does not erase its historical copies. Optional Gemini operations send requested vocabulary/context to Google and can retain prompts/responses in SQLite. Browser preferences persist locally; the service worker caches static assets, not API responses. See [data handling](docs/deployment.md#data-and-network), [CLI storage](docs/cli.md), and [backup/recovery](docs/deployment.md#backup-and-recovery).
