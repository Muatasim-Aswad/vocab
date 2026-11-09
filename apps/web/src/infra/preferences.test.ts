import { describe, expect, it } from "vite-plus/test";

import { initialLocale, initialTheme, saveLocale, saveTheme } from "./preferences.ts";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing = (): Storage => {
  throw new DOMException("blocked", "SecurityError");
};

describe("interface language preference", () => {
  it("prefers a valid saved choice, then the browser language, then English", () => {
    const saved = memoryStorage({
      "vocab.preferences": JSON.stringify({ version: 1, locale: "nl" }),
    });
    expect(initialLocale(["en-GB"], () => saved)).toBe("nl");
    expect(initialLocale(["fr-FR", "nl-BE"], () => memoryStorage())).toBe("nl");
    expect(initialLocale(["de-DE"], () => memoryStorage())).toBe("en");
  });

  it("ignores unversioned, invalid or corrupt stored values", () => {
    for (const raw of ['{"locale":"nl"}', '{"version":1,"locale":"fr"}', "{nope"]) {
      expect(initialLocale(["nl"], () => memoryStorage({ "vocab.preferences": raw }))).toBe("nl");
    }
  });

  it("saves a versioned value and keeps the choice in memory when storage fails", () => {
    const storage = memoryStorage();
    saveLocale("nl", () => storage);
    expect(JSON.parse(storage.getItem("vocab.preferences")!)).toEqual({ version: 1, locale: "nl" });

    expect(() => saveLocale("en", throwing)).not.toThrow();
    expect(initialLocale(["nl"], throwing)).toBe("en");
  });
});

describe("theme preference", () => {
  it("follows the device until a valid choice is saved, and keeps the saved language", () => {
    const storage = memoryStorage({
      "vocab.preferences": JSON.stringify({ version: 1, locale: "nl" }),
    });
    expect(initialTheme(() => storage)).toBe("system");
    saveTheme("dark", () => storage);
    expect(JSON.parse(storage.getItem("vocab.preferences")!)).toEqual({
      version: 1,
      locale: "nl",
      theme: "dark",
    });
    expect(initialTheme(() => storage)).toBe("dark");
    const invalid = memoryStorage({
      "vocab.preferences": JSON.stringify({ version: 1, theme: "sepia" }),
    });
    expect(initialTheme(() => invalid)).toBe("dark");
  });
});
