import { types } from 'pg';
import { describe, expect, it } from 'vitest';
import { typeParsers } from '../src/db';

describe('typeParsers', () => {
  it('keeps date columns as plain YYYY-MM-DD strings', () => {
    expect(typeParsers.getTypeParser(1082)('2026-11-06')).toBe('2026-11-06');
  });

  it('leaves every other type to pg, e.g. timestamptz stays a Date', () => {
    const parsed = typeParsers.getTypeParser(1184)('2026-11-06 17:27:22.279+00');
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed).toEqual(types.getTypeParser(1184)('2026-11-06 17:27:22.279+00'));
  });
});
