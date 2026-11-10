// Which of Hardcover's search hits are worth showing, and in what order. Hardcover ranks well at the top
// and then pads the list: box sets, foreign-language editions with a handful of readers, stray listings,
// and, because it matches on titles, the real books of a series whose titles do not contain the series
// name sit behind pages of those. This works on the raw hits (camelCase, from the SDK) and never throws.

/**
 * A hit with fewer readers than this share of the most-read relevant hit is dropped. Checked against real
 * searches: "Harry Potter" has seven books with 11,000 to 17,000 readers and its Spanish, Catalan and
 * Polish editions have 1 to 8 (0.05% of the top), while the books that belong there, such as the prequel
 * short story, have 379 (2%). Half a percent sits between them. It is a share of the top rather than a
 * fixed count, so a search for something obscure, whose best match has 12 readers, still shows its matches.
 */
export const MIN_READER_SHARE = 0.005;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Lower case, accents and punctuation gone, words separated by single spaces: "Dog Man: Fetch-22" is "dog man fetch 22". */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether the whole search phrase, as whole words in a row, is in the hit's title, subtitle, series, author
 * or ISBN. "percy jackson" is in "Percy Jackson and the Olympians", the series The Lightning Thief belongs to,
 * though not in its title; and "dog man" is not in "Chainsaw Man, Vol. 1: Dog and Chainsaw", which has both
 * words but not together. Other titles are left out on purpose: publishers list marketing editions there
 * ("Captain Underpants ... Now With a Dog Man Comic!"), which would put those books ahead of Dog Man itself.
 */
function containsPhrase(hit: unknown, phrase: string): boolean {
  if (!phrase || !isRecord(hit)) return false;
  const fields = [
    typeof hit.title === 'string' ? hit.title : '',
    typeof hit.subtitle === 'string' ? hit.subtitle : '',
    ...texts(hit.seriesNames),
    ...texts(hit.authorNames),
    ...texts(hit.isbns),
  ];
  return fields.some((field) => ` ${normalize(field)} `.includes(` ${phrase} `));
}

const readersOf = (hit: unknown) => (isRecord(hit) ? num(hit.usersCount) : undefined);
/** The first author listed, who is the book's author; the rest are often illustrators and editors. */
const primaryAuthor = (hit: unknown) => (isRecord(hit) ? normalize(texts(hit.authorNames)[0] ?? '') : '');
const seriesOf = (hit: unknown) => (isRecord(hit) ? texts(hit.seriesNames).map(normalize) : []);

/**
 * The hits worth showing:
 * - no compilations (box sets, "Complete Collection", "Books 1-5"), unless that leaves nothing;
 * - nothing with a tiny share of the best relevant hit's readers (see MIN_READER_SHARE);
 * - first the hits that contain the whole phrase, most-read first, so a series reads Lightning Thief,
 *   Sea of Monsters and so on rather than in whatever order the title matching produced;
 * - then, in Hardcover's order, only the hits related to those: by the same author or in the same series
 *   (the Tales of Beedle the Bard for "Harry Potter"), not a bestseller that happened to match one word.
 *   When nothing contains the whole phrase (a misspelling, half a title) there is nothing to be related to,
 *   so everything stays, in Hardcover's order.
 * A hit that does not say how many readers it has is kept (and sorts last among its group), and so are
 * malformed hits, which the caller reports.
 */
export function worthShowing(hits: unknown[], query: string): unknown[] {
  const singles = hits.filter((hit) => !(isRecord(hit) && hit.compilation === true));
  const pool = singles.length > 0 ? singles : hits;

  const phrase = normalize(query);
  const strong = pool.filter((hit) => containsPhrase(hit, phrase));
  // The bar is set by the best hit that matches the whole phrase, not by whatever popular book matched one word.
  const basis = strong.length > 0 ? strong : pool;
  const floor = Math.max(0, ...basis.map((hit) => readersOf(hit) ?? 0)) * MIN_READER_SHARE;
  const enough = (hit: unknown) => {
    const readers = readersOf(hit);
    return readers === undefined || readers >= floor;
  };

  const authors = new Set(strong.map(primaryAuthor).filter(Boolean));
  const series = new Set(strong.flatMap(seriesOf));
  const related = (hit: unknown) =>
    strong.length === 0 || !isRecord(hit) || authors.has(primaryAuthor(hit)) || seriesOf(hit).some((name) => series.has(name));

  const strongSet = new Set(strong);
  const byReaders = (a: unknown, b: unknown) => (readersOf(b) ?? -1) - (readersOf(a) ?? -1);
  return [
    ...strong.filter(enough).sort(byReaders),
    ...pool.filter((hit) => !strongSet.has(hit) && enough(hit) && related(hit)),
  ];
}
