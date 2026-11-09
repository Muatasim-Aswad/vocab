export const helpText = `Usage: vocab [--help | --version]

Interactive Dutch vocabulary terminal client. It talks to a separately running vocab API
and never starts a server or opens a database.

Connection (environment overrides the file):
  VOCAB_API_URL      API origin (default http://127.0.0.1:3000)
  VOCAB_API_TOKEN    API bearer token
  VOCAB_CLI_CONFIG_DIR  directory of cli.json ({"apiUrl","token"}) and preferences.json
                        (default $XDG_CONFIG_HOME/vocab or ~/.config/vocab)
  VOCAB_CLI_STATE_DIR   directory of cli-pending.json, unconfirmed changes kept for retry
                        (default $XDG_STATE_HOME/vocab or ~/.local/state/vocab)

Type 'help' inside the application for commands and modes.`;

export const preferencesFallback = (message: string) => `${message} Using default preferences.`;
