export const settingsCopy = {
  retiredReasons: {
    allowCommit: "storage Git commits were removed; the API owns persistence",
    allowPush: "storage Git pushes were removed; the API owns persistence",
    allowPull: "startup Git pulls were removed; the API owns persistence",
    sync: "startup storage sync was removed; the API owns persistence",
    geminiApiKey: "Gemini is configured only on the API server (VOCAB_GEMINI_API_KEY)",
  } as Record<string, string>,
  retired: (key: string, reason: string) =>
    `Setting "${key}" was retired: ${reason}. Nothing was changed.`,
  tokenSet: "(set)",
  tokenEmpty: "(empty)",
  heading: "\n=== Settings ===",
  columns: ["Setting", "Value"] as [string, string],
  row: (key: string, value: string) => `${key}: ${value}`,
  usage: [
    "Usage: settings | settings set dark <true|false>",
    "       settings set <formsConflict> <ask|inferred|provided|manual>",
    "       settings set apiUrl <url>",
    "The API token is read from VOCAB_API_TOKEN or the connection file, never from commands.",
  ],
  unknownCommand: (command: string) => `Unknown settings command: ${command}`,
  missingKeyValue: "Missing key/value. Example: settings set dark true",
  invalidFormsConflict: (value: string) =>
    `Invalid value for formsConflict: ${value}. Use ask/inferred/provided/manual.`,
  updatedFormsConflict: (value: string) => `Updated formsConflict to ${value}.`,
  invalidDark: (value: string) => `Invalid value for dark: ${value}. Use true/false.`,
  updatedDark: (value: boolean) => `Updated dark to ${value}.`,
  invalidApiUrl: (value: string) => `Invalid value for apiUrl: ${value}. Use an http(s) URL.`,
  updatedApiUrl: (value: string) => `Updated apiUrl to ${value}.`,
  unknownKey: (key: string) => `Unknown setting key: ${key}`,
} as const;
