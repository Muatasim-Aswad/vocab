export const terminalCopy = {
  aborted: "Prompt aborted by user",
  jsonContinuation: "... ",
  option: (index: number, label: string) => `  ${index}) ${label}\n`,
  select: (count: number) => `Select [1-${count}]: `,
} as const;
