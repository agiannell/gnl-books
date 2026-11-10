/**
 * `2026-02-14` as "Feb 14, 2026". The API sends calendar dates with no time or
 * zone, so the date is built and formatted in UTC: formatting in the browser's
 * zone would show the day before for anyone west of Greenwich.
 */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "Dog Man #2", "Dog Man #2.5", or just the series name when the position is unknown; null outside a series. */
export const seriesLabel = (book: { seriesName: string | null; seriesPosition: number | null }) =>
  book.seriesName && (book.seriesPosition === null ? book.seriesName : `${book.seriesName} #${book.seriesPosition}`);

/** A rating from 1 to 5 as filled and empty stars: 4 gives ★★★★☆. */
export const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);
