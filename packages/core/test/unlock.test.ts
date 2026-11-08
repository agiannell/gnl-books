import { describe, expect, it } from 'vitest';
import { decideUnlock, LOCKOUT_MS, MAX_PIN_ATTEMPTS, type PinState } from '../src/unlock';

const now = new Date('2026-11-08T12:00:00Z');
const fresh: PinState = { failedAttempts: 0, lockedUntil: null };
const inMs = (ms: number) => new Date(now.getTime() + ms);

describe('decideUnlock', () => {
  it('accepts the right PIN', () => {
    expect(decideUnlock(fresh, true, now)).toEqual({ result: { ok: true }, next: fresh });
  });

  it('clears earlier failures on success', () => {
    const { next } = decideUnlock({ failedAttempts: 3, lockedUntil: null }, true, now);
    expect(next).toEqual(fresh);
  });

  it('counts a wrong guess and says how many are left', () => {
    expect(decideUnlock(fresh, false, now)).toEqual({
      result: { ok: false, reason: 'wrong', attemptsRemaining: MAX_PIN_ATTEMPTS - 1 },
      next: { failedAttempts: 1, lockedUntil: null },
    });
  });

  it('counts down one attempt at a time to the lock', () => {
    let state = fresh;
    const remaining: number[] = [];
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      const step = decideUnlock(state, false, now);
      if (step.result.ok === false && step.result.reason === 'wrong') remaining.push(step.result.attemptsRemaining);
      state = step.next;
    }
    expect(remaining).toEqual([4, 3, 2, 1]);
  });

  it('locks on the final wrong guess, and starts the count over for when it ends', () => {
    const { result, next } = decideUnlock({ failedAttempts: MAX_PIN_ATTEMPTS - 1, lockedUntil: null }, false, now);
    expect(result).toEqual({ ok: false, reason: 'locked', until: inMs(LOCKOUT_MS) });
    expect(next).toEqual({ failedAttempts: 0, lockedUntil: inMs(LOCKOUT_MS) });
  });

  it('keeps the lock at 15 minutes', () => {
    expect(LOCKOUT_MS).toBe(15 * 60 * 1000);
    expect(MAX_PIN_ATTEMPTS).toBe(5);
  });

  describe('while locked', () => {
    const locked: PinState = { failedAttempts: 0, lockedUntil: inMs(60_000) };

    it('refuses even the right PIN', () => {
      expect(decideUnlock(locked, true, now).result).toEqual({ ok: false, reason: 'locked', until: locked.lockedUntil });
    });

    it('does not extend the lock or change any state, however many guesses', () => {
      expect(decideUnlock(locked, false, now).next).toBe(locked);
    });
  });

  describe('after the lock ends', () => {
    const expired: PinState = { failedAttempts: 0, lockedUntil: inMs(-1) };

    it('accepts the right PIN again and clears the lock', () => {
      expect(decideUnlock(expired, true, now)).toEqual({ result: { ok: true }, next: fresh });
    });

    it('treats a wrong guess as the first of a new round', () => {
      expect(decideUnlock(expired, false, now)).toEqual({
        result: { ok: false, reason: 'wrong', attemptsRemaining: MAX_PIN_ATTEMPTS - 1 },
        next: { failedAttempts: 1, lockedUntil: null },
      });
    });

    it('treats a lock that ends exactly now as over', () => {
      const edge: PinState = { failedAttempts: 0, lockedUntil: now };
      expect(decideUnlock(edge, true, now).result).toEqual({ ok: true });
    });
  });
});
