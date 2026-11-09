export const apiCopy = {
  rejectedToken: (url: string, hint: string) =>
    `The vocab API at ${url} rejected the configured token. Update VOCAB_API_TOKEN or ${hint}.`,
  unexpectedResponse: (url: string, status: number) =>
    `The vocab API at ${url} returned an unexpected response (HTTP ${status}).`,
  unreachable: (url: string) =>
    `Cannot reach the vocab API at ${url}. Start the API separately, then retry.`,
  missingToken: (hint: string) =>
    `No API token is configured. Set VOCAB_API_TOKEN or add "token" to ${hint}.`,
  capturePage: (page: number, pages: number, total: number, limit: number) =>
    `Page ${page} is out of range. Valid pages: 1-${pages} (captured terms: ${total}, page size: ${limit}). Use "-p <page>".`,
  keptForAuth: (message: string, label: string) =>
    `${message} The change "${label}" was kept and will be sent once the token is accepted.`,
  notConfirmed: (message: string, label: string) =>
    `${message} The change "${label}" was not confirmed; it was kept and will be retried with the same identity.`,
  confirmed: (label: string) => `Confirmed pending change: ${label}.`,
  rejected: (label: string, message: string) =>
    `Pending change "${label}" was rejected: ${message}`,
  queued: (blocking: string, label: string) =>
    `A previous change ("${blocking}") is still unconfirmed. The change "${label}" was queued behind it and will be sent after it is confirmed.`,
  captureLabel: (term: string) => `capture "${term}"`,
  addLabel: (term: string) => `add "${term}"`,
  editLabel: (id: number) => `edit entry ${id}`,
  deleteLabel: (id: number) => `delete entry ${id}`,
  studyStartLabel: "start study session",
  studyAnswerLabel: (id: number) => `study answer for entry ${id}`,
  studyEndLabel: "end study session",
} as const;
