export const argsCopy = {
  missingType: 'Missing value for "-ft".',
  missingPage: 'Missing value for "-p" (page number).',
  invalidPage: (value: string) => `Ignored invalid page value for "-p": "${value}" (using page 1).`,
  missingLimit: 'Missing value for "-l".',
  invalidLimit: (value: string) => `Ignored invalid limit value: "${value}" (using 10).`,
  retiredFlag: (flag: string) => `Flag "${flag}" is no longer supported and was ignored.`,
} as const;
