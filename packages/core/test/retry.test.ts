import { describe, expect, it, vi } from 'vitest';
import { isRetryable, withRetry } from '../src/retry';

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });
const conflict = () => pgError('40001', 'change conflicts with another transaction, please retry: (OC000)');
const schemaChanged = () => pgError('0A000', 'schema has been updated by another transaction, please retry: (OC001)');

// No real waiting, and no jitter, so delays are exactly the ceiling.
const fast = { sleep: async (_ms: number) => {}, random: () => 1 };

describe('isRetryable', () => {
  it('retries SQLSTATE 40001 (OC000)', () => {
    expect(isRetryable(conflict())).toBe(true);
  });

  it('retries OC001 even though its SQLSTATE is not 40001', () => {
    expect(isRetryable(schemaChanged())).toBe(true);
  });

  it('does not retry unrelated errors', () => {
    expect(isRetryable(pgError('23505', 'duplicate key value'))).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
    expect(isRetryable('OC000')).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the result without retrying when nothing fails', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withRetry(fn, fast)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('recovers after transient conflicts', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(schemaChanged())
      .mockResolvedValue('ok');
    await expect(withRetry(fn, fast)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-retryable error immediately', async () => {
    const err = pgError('23505', 'duplicate key value');
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, fast)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and throws the last conflict', async () => {
    const fn = vi.fn(async () => {
      throw conflict();
    });
    await expect(withRetry(fn, { ...fast, maxAttempts: 3 })).rejects.toThrow('OC000');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially up to the cap', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => {
      throw conflict();
    });
    await expect(
      withRetry(fn, { sleep, random: () => 1, maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 300 }),
    ).rejects.toThrow();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 300, 300]);
  });

  it('applies jitter within the ceiling', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue('ok');
    await withRetry(fn, { sleep, random: () => 0.5, baseDelayMs: 100 });
    expect(sleep).toHaveBeenCalledWith(50);
  });
});
