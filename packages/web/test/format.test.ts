import { describe, expect, it, vi } from 'vitest';
import { formatDate, stars } from '../src/format.ts';

describe('formatDate', () => {
  it.each([
    ['2026-02-14', 'Feb 14, 2026'],
    ['2026-01-01', 'Jan 1, 2026'],
    ['2026-12-31', 'Dec 31, 2026'],
    ['2024-02-29', 'Feb 29, 2024'],
  ])('writes %s as %s', (date, text) => {
    expect(formatDate(date)).toBe(text);
  });

  // Built and written in UTC, so the day never shifts with the machine's zone.
  // (This only fails on a machine west of Greenwich if the zone leaks in.)
  it('keeps the day whatever the machine’s time zone is', () => {
    try {
      for (const zone of ['Pacific/Pago_Pago', 'UTC', 'Pacific/Kiritimati']) {
        vi.stubEnv('TZ', zone);
        expect(formatDate('2026-02-14')).toBe('Feb 14, 2026');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('stars', () => {
  it.each([
    [1, '★☆☆☆☆'],
    [4, '★★★★☆'],
    [5, '★★★★★'],
  ])('shows %i as %s', (rating, text) => {
    expect(stars(rating)).toBe(text);
  });
});
