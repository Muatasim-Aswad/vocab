export const configCopy = {
  readFailed: (path: string) => `Cannot read ${path}.`,
  invalidJson: (path: string) => `${path} is not valid JSON.`,
  expectedObject: (path: string) => `${path} must contain a JSON object.`,
  invalidJournal: (path: string) => `${path} is not a valid pending-change file.`,
} as const;
