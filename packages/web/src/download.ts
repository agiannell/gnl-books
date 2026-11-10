/**
 * A file name for a reader's export: `sam-books.csv`. Names can hold anything (spaces, accents, an
 * emoji, slashes), and a file name should hold none of that, so keep letters and digits and join
 * the rest with dashes. A name with nothing usable in it becomes "reader".
 */
export function exportFileName(readerName: string): string {
  const slug = readerName
    .normalize('NFKD')
    // Drops the accents NFKD split off ("é" becomes "e" and a combining mark).
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'reader'}-books.csv`;
}

/** Hands text to the browser as a file to save. */
export function downloadTextFile(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has started the download.
  URL.revokeObjectURL(url);
}
