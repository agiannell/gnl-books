import {
  AuthenticationError,
  HardcoverClient,
  HardcoverError,
  NetworkError,
  RateLimitError,
  ScopeError,
  ServerError,
  TimeoutError,
} from '@hardcover/sdk';
import { worthShowing } from './relevance';
import { BookSourceError, type BookSearchResult, type BookSource } from './types';

// The only file that knows Hardcover exists. The package is 0.x ("a minor may
// rename or remove things"), and search results are Typesense JSON, so this
// reads everything defensively and drops what it cannot make sense of.

/** What this file uses of the SDK client, so tests can stand in for it. */
export interface HardcoverClientLike {
  search: {
    books(query: string, options?: { perPage?: number; page?: number; filterBy?: string }): Promise<{ hits: unknown[] }>;
  };
  books: {
    get(id: number): Promise<unknown>;
    editions(bookId: number, options?: { limit?: number }): Promise<{ items: unknown[] }>;
  };
}

export interface HardcoverSourceOptions {
  /** A personal access token with only the `read:catalog` scope. */
  token: string;
  userAgent?: string;
  /** For tests. */
  client?: HardcoverClientLike;
  warn?: (message: string, detail?: unknown) => void;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 25;
const MAX_ID = 2_147_483_647;
/**
 * Pages of hits to look through, of MAX_LIMIT each. One page is not enough: once the box sets and
 * stray listings are taken out of a series' search, its later books are on the second page (all of
 * Percy Jackson after the first two are).
 */
const POOL_PAGES = 2;
/** Typesense filter: leave out box sets, so they do not use up the pages. */
const NO_COMPILATIONS = 'compilation:false';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => str(x) ?? []) : []);

const isbn13 = (v: unknown) => str(v)?.replace(/[-\s]/g, '').match(/^\d{13}$/)?.[0];
const isbn10 = (v: unknown) => str(v)?.replace(/[-\s]/g, '').toUpperCase().match(/^\d{9}[\dX]$/)?.[0];

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** One search hit, or undefined if it is not usable (no id, no title). */
function parseHit(hit: unknown): BookSearchResult | undefined {
  if (!isRecord(hit)) return undefined;
  const id = num(hit.id);
  const title = str(hit.title);
  if (id === undefined || !title) return undefined;

  const isbns = strings(hit.isbns);
  const series = isRecord(hit.featuredSeries) ? hit.featuredSeries : undefined;
  const seriesName = (isRecord(series?.series) ? str(series.series.name) : undefined) ?? strings(hit.seriesNames)[0];

  return clean({
    sourceId: String(id),
    title,
    subtitle: str(hit.subtitle),
    authors: dedupe(strings(hit.authorNames)),
    isbn13: isbns.map(isbn13).find(Boolean),
    isbn10: isbns.map(isbn10).find(Boolean),
    pages: num(hit.pages),
    releaseYear: num(hit.releaseYear),
    coverUrl: isRecord(hit.image) ? str(hit.image.url) : undefined,
    seriesName,
    seriesPosition: num(hit.featuredSeriesPosition) ?? num(series?.position),
    description: str(hit.description),
  });
}

/** A book plus its editions. ISBN and publisher live on editions, not on the book. */
function parseDetail(book: unknown, editions: unknown[]): BookSearchResult | undefined {
  if (!isRecord(book)) return undefined;
  const id = num(book.id);
  const title = str(book.title);
  if (id === undefined || !title) return undefined;

  // A null contribution role is the author; others are "Illustrator", "Narrator", and so on.
  const authors = (Array.isArray(book.contributions) ? book.contributions : []).flatMap((c) => {
    if (!isRecord(c) || !isRecord(c.author)) return [];
    const role = str(c.contribution);
    return !role || role.toLowerCase() === 'author' ? (str(c.author.name) ?? []) : [];
  });

  const bookSeries = Array.isArray(book.bookSeries) ? book.bookSeries.find(isRecord) : undefined;
  const featured = isRecord(book.cachedFeaturedSeries) ? book.cachedFeaturedSeries : undefined;
  const seriesName =
    (isRecord(bookSeries?.series) ? str(bookSeries.series.name) : undefined) ??
    (isRecord(featured?.series) ? str(featured.series.name) : undefined);

  // Editions arrive most-read first; take the first with a usable ISBN-13.
  const edition = editions.filter(isRecord).find((e) => isbn13(e.isbn13)) ?? editions.filter(isRecord)[0];

  return clean({
    sourceId: String(id),
    title,
    subtitle: str(book.subtitle),
    authors: dedupe(authors),
    isbn13: isbn13(edition?.isbn13),
    isbn10: isbn10(edition?.isbn10),
    pages: num(book.pages) ?? num(edition?.pages),
    releaseYear: num(book.releaseYear),
    coverUrl: isRecord(book.cachedImage) ? str(book.cachedImage.url) : undefined,
    seriesName,
    seriesPosition: num(bookSeries?.position) ?? num(featured?.position),
    description: str(book.description),
    publisher: isRecord(edition?.publisher) ? str(edition.publisher.name) : undefined,
    binding: str(edition?.editionFormat),
  });
}

/** Drops undefined keys, so a result only carries what the source actually knew. */
function clean(result: BookSearchResult): BookSearchResult {
  return Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined)) as unknown as BookSearchResult;
}

/** Turns an SDK failure into one the UI can act on. Anything that is not the SDK's is a bug, and passes through. */
export function toBookSourceError(error: unknown): unknown {
  if (error instanceof BookSourceError) return error;
  if (error instanceof AuthenticationError || error instanceof ScopeError) {
    return new BookSourceError(
      'unauthorized',
      'Hardcover rejected the API token: it may have expired, been revoked, or lack the read:catalog scope',
      { cause: error },
    );
  }
  if (error instanceof RateLimitError) {
    return new BookSourceError('rate_limited', `Hardcover is rate limiting requests (${error.window} limit)`, {
      cause: error,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
  if (error instanceof TimeoutError) {
    return new BookSourceError('timeout', 'Hardcover took too long to answer', { cause: error });
  }
  if (error instanceof NetworkError || error instanceof ServerError || error instanceof HardcoverError) {
    return new BookSourceError('unavailable', 'Hardcover is unavailable right now', { cause: error });
  }
  return error;
}

export function createHardcoverSource(options: HardcoverSourceOptions): BookSource {
  const client: HardcoverClientLike =
    options.client ?? new HardcoverClient({ token: options.token, userAgent: options.userAgent ?? 'gnl-books' });
  const warn = options.warn ?? ((message, detail) => console.warn(message, detail));

  return {
    name: 'hardcover',

    async search(query, { limit = DEFAULT_LIMIT } = {}) {
      const text = query.trim();
      if (!text) return [];

      /** The candidates for a search: POOL_PAGES pages asked for at once, in Hardcover's order, each book once. */
      const candidates = async (filterBy?: string): Promise<unknown[]> => {
        const pages = await Promise.all(
          Array.from({ length: POOL_PAGES }, (_, i) =>
            client.search.books(text, { perPage: MAX_LIMIT, page: i + 1, ...(filterBy && { filterBy }) }),
          ),
        );
        const seen = new Set<unknown>();
        return pages
          .flatMap((page) => page.hits)
          .filter((hit) => {
            const id = isRecord(hit) ? hit.id : undefined;
            if (id === undefined) return true;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
      };

      try {
        let hits: unknown[];
        try {
          hits = await candidates(NO_COMPILATIONS);
        } catch (error) {
          // The filter is the one thing here that is ours rather than Hardcover's: if it is refused (a field
          // renamed, say) search must not break with it. A bad token, a rate limit or a timeout is not the
          // filter's fault and would fail again, so those are reported as they are.
          const failure = toBookSourceError(error);
          if (!(failure instanceof BookSourceError) || failure.code !== 'unavailable') throw failure;
          hits = await candidates();
        }
        // Nothing that is not a box set matches: show the box sets rather than an empty list.
        if (hits.length === 0) hits = await candidates();

        const results: BookSearchResult[] = [];
        for (const hit of worthShowing(hits, text)) {
          const result = parseHit(hit);
          if (result) results.push(result);
          else warn('Dropped a malformed Hardcover search hit', hit);
        }
        return results.slice(0, Math.max(limit, 1));
      } catch (error) {
        throw toBookSourceError(error);
      }
    },

    async getById(sourceId) {
      if (!/^\d+$/.test(sourceId)) return null;
      const id = Number(sourceId);
      // Hardcover ids are 32-bit. A larger one cannot exist, and Hardcover
      // answers it with a GraphQL error rather than "not found".
      if (id > MAX_ID) return null;
      try {
        const [book, editions] = await Promise.all([client.books.get(id), client.books.editions(id, { limit: 10 })]);
        if (book === null) return null;
        const result = parseDetail(book, editions.items);
        if (!result) warn('Hardcover returned a book this app could not read', book);
        return result ?? null;
      } catch (error) {
        throw toBookSourceError(error);
      }
    },
  };
}
