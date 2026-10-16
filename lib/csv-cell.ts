// Prefix dangerous spreadsheet cells, including apostrophes, so exports round-trip.
export function csvCell(value: unknown) {
  let text = String(value);
  if (typeof value === 'string' && /^[\s]*[=+@\-']/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function decodeCsvCell(value: string) {
  return /^'[\s]*[=+@\-']/.test(value) ? value.slice(1) : value;
}
