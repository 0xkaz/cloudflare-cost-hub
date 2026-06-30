// Render rows as RFC-4180 CSV. Values containing a comma, quote, or newline are
// double-quoted with embedded quotes escaped.
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const escape = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((row) => row.map(escape).join(','));
  return lines.join('\r\n');
}
