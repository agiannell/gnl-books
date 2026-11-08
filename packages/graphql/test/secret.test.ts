import { describe, expect, it } from 'vitest';
import { jsonSecretValue } from '../src/app';

describe('jsonSecretValue', () => {
  it('reads the named string from a JSON secret', () => {
    expect(jsonSecretValue('{"parentTokenKey":"abc","other":"x"}', 'parentTokenKey')).toBe('abc');
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['plain text (the old, un-keyed secret)', 'justAnOldRawKeyWithNoJsonAtAll'],
    ['JSON with another key', '{"other":"x"}'],
    ['an empty value', '{"parentTokenKey":""}'],
    ['a non-string value', '{"parentTokenKey":42}'],
    ['a JSON array', '["parentTokenKey"]'],
    ['JSON null', 'null'],
  ])('throws for %s', (_name, secret) => {
    expect(() => jsonSecretValue(secret, 'parentTokenKey')).toThrow();
  });
});
