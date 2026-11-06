import { isOCCError } from '@aws/aurora-dsql-node-postgres-connector';

// Aurora DSQL uses optimistic concurrency, so a transaction can fail at commit
// and must simply be run again. This is the single retry policy for `core`.
//
// The connector's own definition of "retryable" (error.code of OC000, OC001 or
// 40001) is reused so there is one source of truth. Its `pool.transaction()` is
// deliberately not used: Kysely manages BEGIN/COMMIT itself, so the retry wraps
// `db.transaction().execute()` instead (see `withTransaction` in db.ts).
export const isRetryable = isOCCError;

export interface RetryOptions {
  /** Total attempts including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected so tests don't wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Returns a value in [0, 1); injected so tests are deterministic. */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying with exponential backoff and full jitter when DSQL
 * reports a concurrency conflict. `fn` must be idempotent: it is re-run from
 * the top, including any reads it did, each attempt.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 50,
    maxDelayMs = 2000,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || attempt >= maxAttempts) throw err;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(random() * ceiling);
    }
  }
}
