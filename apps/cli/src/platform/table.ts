import Table from "cli-table3";

/** Bordered table on wide terminals; compact `a | b` rows below `minWidth` columns. */
export function renderTable(
  headers: string[],
  rows: string[][],
  options: { terminalWidth?: number; minWidth?: number } = {},
): string {
  if (rows.length === 0) return "";
  const terminalWidth = options.terminalWidth ?? process.stdout.columns ?? 120;
  if (terminalWidth < (options.minWidth ?? 88))
    return [headers, ...rows].map((row) => row.join(" | ")).join("\n");
  const table = new Table({ head: headers, style: { head: [], border: [] }, wordWrap: true });
  rows.forEach((row) => table.push(row));
  return table.toString();
}
