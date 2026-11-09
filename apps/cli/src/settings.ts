import { formsConflictModes, writeApiUrl, writePreferences } from "./infra/config.ts";
import type { AppContext } from "./platform/context.ts";
import { renderTable } from "./platform/table.ts";
import { s } from "./platform/terminal.ts";
import { settingsCopy } from "./settings-copy.ts";

function retiredSettingMessage(key: string): string | undefined {
  const reason = settingsCopy.retiredReasons[key];
  return reason ? settingsCopy.retired(key, reason) : undefined;
}

function renderSettings(ctx: AppContext, note?: string): void {
  const { view } = ctx.io;
  const preferences = ctx.preferences();
  const connection = {
    apiUrl: ctx.api.apiUrl,
    token: ctx.api.hasToken() ? settingsCopy.tokenSet : settingsCopy.tokenEmpty,
  };
  view(s.alert(settingsCopy.heading));
  const rows: Array<[string, string]> = [
    ["apiUrl", connection.apiUrl],
    ["apiToken", connection.token],
    ["connectionPath", ctx.paths.connectionFile],
    ["preferencesPath", ctx.paths.preferencesFile],
    ["dark", String(preferences.dark)],
    ["formsConflict", preferences.formsConflict],
  ];
  view(renderTable(settingsCopy.columns, rows));
  for (const [key, value] of rows) view(settingsCopy.row(key, value));
  if (note) view(s.w(note));
  for (const line of settingsCopy.usage) view(line);
}

export function handleSettings(ctx: AppContext, args: string): void {
  const { view } = ctx.io;
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens[0] === "show") return renderSettings(ctx);
  if (tokens[0] !== "set") {
    view(s.e(settingsCopy.unknownCommand(tokens[0]!)));
    return renderSettings(ctx);
  }
  const [rawKey, rawValue] = [tokens[1]?.trim(), tokens[2]?.trim()];
  const retired = rawKey ? retiredSettingMessage(rawKey) : undefined;
  if (retired) return view(s.e(retired));
  if (!rawKey || !rawValue) {
    view(s.e(settingsCopy.missingKeyValue));
    return renderSettings(ctx);
  }
  const preferences = ctx.preferences();
  if (rawKey === "formsConflict") {
    const value = rawValue.toLowerCase();
    const matched = formsConflictModes.find((mode) => mode === value);
    if (!matched) return view(s.e(settingsCopy.invalidFormsConflict(rawValue)));
    const next = { ...preferences, formsConflict: matched };
    writePreferences(ctx.paths, next);
    ctx.setPreferences(next);
    return view(s.w(settingsCopy.updatedFormsConflict(next.formsConflict)));
  }
  if (rawKey === "dark") {
    const value = rawValue.toLowerCase();
    if (value !== "true" && value !== "false") return view(s.e(settingsCopy.invalidDark(rawValue)));
    const next = { ...preferences, dark: value === "true" };
    writePreferences(ctx.paths, next);
    ctx.setPreferences(next);
    return view(s.w(settingsCopy.updatedDark(next.dark)));
  }
  if (rawKey === "apiUrl") {
    let url: URL;
    try {
      url = new URL(rawValue);
    } catch {
      return view(s.e(settingsCopy.invalidApiUrl(rawValue)));
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return view(s.e(settingsCopy.invalidApiUrl(rawValue)));
    writeApiUrl(ctx.paths, rawValue.replace(/\/+$/, ""));
    return view(s.w(settingsCopy.updatedApiUrl(ctx.api.apiUrl)));
  }
  view(s.e(settingsCopy.unknownKey(rawKey)));
  renderSettings(ctx);
}
