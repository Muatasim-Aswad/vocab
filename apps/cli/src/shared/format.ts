const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(locale, { timeZone });
}
