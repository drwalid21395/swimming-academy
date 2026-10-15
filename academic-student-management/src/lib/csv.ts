export function toCsv(headers: string[], rows: (string | number | null)[][]) {
  const escapeCell = (value: string | number | null) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(","));

  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
