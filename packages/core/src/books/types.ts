// The seam that keeps Hardcover a single dependency, so a different catalog
// (Google Books, say) could replace it without touching the rest of the app.

export interface BookSearchResult {
  /** The source's own id, kept as a string whatever the source uses. */
  sourceId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  isbn13?: string;
  isbn10?: string;
  pages?: number;
  releaseYear?: number;
  coverUrl?: string;
  seriesName?: string;
  seriesPosition?: number;
  description?: string;
  publisher?: string;
  binding?: string;
}

export interface BookSource {
  readonly name: 'hardcover' | 'google' | 'manual';
  search(query: string, options?: { limit?: number }): Promise<BookSearchResult[]>;
  /** Null when the source has no such book (or the id is not one of its ids). */
  getById(sourceId: string): Promise<BookSearchResult | null>;
}

/**
 * Why a lookup failed, in terms a UI can act on. `unauthorized` is the one to
 * show prominently: an expired Hardcover token breaks search while books that
 * are already cached keep working, which is a confusing way to fail.
 */
export type BookSourceErrorCode = 'unauthorized' | 'rate_limited' | 'timeout' | 'unavailable';

export class BookSourceError extends Error {
  constructor(
    readonly code: BookSourceErrorCode,
    message: string,
    options: { cause?: unknown; retryAfterSeconds?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'BookSourceError';
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  readonly retryAfterSeconds: number | undefined;
}
