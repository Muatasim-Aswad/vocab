# Vocab

Vocab is a personal dictionary that grows with your language. Add words and distinct meanings as you encounter them, building a dictionary around your own vocabulary.

Connect words through relationships and context to see how new meanings relate to what you already know. Synonyms, antonyms, word families, collocations, and examples help you explore and connect your vocabulary as it grows.

Vocab currently supports Dutch. Self-host one API for the web app and terminal client.

- **Web:** search and browse entries, capture terms for later, add and edit meanings, and review optional AI suggestions. English/Dutch interface, system/light/dark themes, and an installable app shell.
- **Terminal:** interactive capture, search, structured/JSON entry editing, and study sessions.
- **API:** shared typed contracts, OpenAPI, SQLite storage, explicit migrations, and recoverable writes.

Study mode is currently available in the terminal client, with an experimental memory model that considers correctness, response time, and review history. The web app can reopen its shell offline; reading and saving vocabulary needs a connection.

## Run with Docker

Requires Git, [mise](https://mise.jdx.dev), Docker with Compose, and OpenSSL. Application builds run inside Docker.

```sh
git clone https://github.com/Muatasim-Aswad/vocab.git
cd vocab
mise run setup
docker compose build api
docker compose up -d --no-build --pull never
```

Open <http://127.0.0.1:3000> and sign in with the token from `.env`. Setup creates a private env file and keeps any existing one unchanged. Only the token needs configuration; the local address, port, and storage have defaults. Compose runs migrations first and keeps data in a named volume. No prebuilt image or installable package is published.

Vocab assumes one trusted owner and a private deployment. All authenticated clients access the same data; there are no separate user accounts or tenant boundaries. Keep remote access behind private HTTPS. Optional AI sends requested content to Gemini and requires your own API key. See [security](SECURITY.md) and [data handling](docs/deployment.md#data-and-network).

## Documentation

| I want to… | Read |
| --- | --- |
| Configure, update, back up, or manage with srvr | [Deployment](docs/deployment.md) |
| Use the terminal client or study mode | [Terminal client](docs/cli.md) |
| Develop, test, or contribute | [Development](docs/development.md) · [Contributing](CONTRIBUTING.md) |
| Understand the code and vocabulary model | [Architecture](docs/architecture.md) · [Domain language](CONTEXT.md) · [Decisions](docs/decisions.md) |
| Check security, data handling, or changes | [Security](SECURITY.md) · [Data handling](docs/deployment.md#data-and-network) · [Changelog](CHANGELOG.md) |

Ask questions in [Discussions](https://github.com/Muatasim-Aswad/vocab/discussions); report vulnerabilities through [Security](SECURITY.md).

Licensed under [MIT](LICENSE). Bundled asset attribution is in [third-party notices](THIRD_PARTY_NOTICES.md).
