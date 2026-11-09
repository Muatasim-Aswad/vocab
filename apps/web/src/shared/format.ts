/** Display dates in the system time zone unless a caller chooses another one. */
export function formatDateTime(
  value: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(value);
}

export function formatDecimal(
  value: number,
  locale: string,
  maximumFractionDigits: number,
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}
