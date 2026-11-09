import { z } from "zod";

export const locales = ["en", "nl"] as const;
export type Locale = (typeof locales)[number];

/** `system` follows the device's color scheme. */
export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

const storageKey = "vocab.preferences";
const stored = z.object({
  version: z.literal(1),
  locale: z.enum(locales).optional(),
  theme: z.enum(themes).optional(),
});
type Preferences = Omit<z.infer<typeof stored>, "version">;

let memory: Preferences = {};

/** Saved per-browser preferences; invalid or unreadable storage yields the in-memory choices. */
function readPreferences(storage: () => Storage = () => localStorage): Preferences {
  try {
    const raw = storage().getItem(storageKey);
    if (raw !== null) {
      const parsed = stored.safeParse(JSON.parse(raw));
      if (parsed.success) {
        const { version: _, ...preferences } = parsed.data;
        return preferences;
      }
    }
  } catch {
    // Blocked or corrupt storage falls back to the in-memory choice.
  }
  return memory;
}

/** Keeps the choice in memory when storage is unavailable, so the session still honors it. */
function savePreferences(change: Preferences, storage: () => Storage = () => localStorage): void {
  memory = { ...readPreferences(storage), ...change };
  try {
    storage().setItem(storageKey, JSON.stringify({ version: 1, ...memory }));
  } catch {
    // Storage failure must not prevent use.
  }
}

export function saveLocale(locale: Locale, storage?: () => Storage): void {
  savePreferences({ locale }, storage);
}

export function saveTheme(theme: Theme, storage?: () => Storage): void {
  savePreferences({ theme }, storage);
}

/** Saved preference, else the browser's first supported language, else English. */
export function initialLocale(
  languages: readonly string[] = navigator.languages,
  storage?: () => Storage,
): Locale {
  const saved = readPreferences(storage).locale;
  if (saved) return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "en" || base === "nl") return base;
  }
  return "en";
}

export function initialTheme(storage?: () => Storage): Theme {
  return readPreferences(storage).theme ?? "system";
}

/** Styles read `data-theme` on the root; without it they follow the device. */
export function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
