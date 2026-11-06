// Aurora DSQL uses optimistic concurrency, so a transaction can fail at commit
// and must simply be run again. This is the single retry policy for `core`.
//
// OC000 (write conflict) arrives as SQLSTATE 40001. OC001 (schema changed by
// another transaction) arrives under a different SQLSTATE with the OC code only
// in the message, so match on either rather than on `code` alone.
const RETRYABLE_SQLSTATES = new Set(['40001']);
const RETRYABLE_MESSAGE = /\b(OC000|OC001)\b/;

export function isRetryable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && RETRYABLE_SQLSTATES.has(code)) return true;
  return typeof message === 'string' && RETRYABLE_MESSAGE.test(message);
}

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
