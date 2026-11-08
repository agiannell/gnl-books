import { describe, expect, it } from 'vitest';
import { hashPin, PIN_PATTERN, verifyPin } from '../src/pin';

describe('hashPin', () => {
  it('stores the scheme and parameters, never the PIN', async () => {
    const hash = await hashPin('4821');
    const [scheme, n, r, p, salt, key] = hash.split('$');
    expect([scheme, n, r, p]).toEqual(['scrypt', '32768', '8', '1']);
    expect(salt).toBeTruthy();
    expect(key).toBeTruthy();
    expect(hash).not.toContain('4821');
  });

  it('salts every hash, so equal PINs do not match in the database', async () => {
    expect(await hashPin('4821')).not.toBe(await hashPin('4821'));
  });

  it.each(['', '123', '123456789', 'abcd', '12 34', '12.5', '１２３４'])('rejects the PIN %j', async (pin) => {
    await expect(hashPin(pin)).rejects.toThrow('4 to 8 digits');
  });
});

describe('verifyPin', () => {
  it('accepts the right PIN and rejects a wrong one', async () => {
    const hash = await hashPin('4821');
    expect(await verifyPin('4821', hash)).toBe(true);
    expect(await verifyPin('4822', hash)).toBe(false);
    expect(await verifyPin('', hash)).toBe(false);
  });

  it('is not fooled by a PIN that differs only in length', async () => {
    const hash = await hashPin('4821');
    expect(await verifyPin('48210', hash)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['an unknown scheme', 'bcrypt$10$abc$def'],
    ['missing fields', 'scrypt$32768$8$1'],
    ['non-numeric parameters', 'scrypt$x$y$z$c2FsdA==$aGFzaA=='],
    ['a hash of the wrong length', 'scrypt$32768$8$1$c2FsdA==$aGFzaA=='],
  ])('returns false, without throwing, for a stored value that is %s', async (_name, stored) => {
    expect(await verifyPin('4821', stored)).toBe(false);
  });
});

describe('PIN_PATTERN', () => {
  it.each(['0000', '4821', '12345678'])('accepts %s', (pin) => expect(PIN_PATTERN.test(pin)).toBe(true));
  it.each(['123', '123456789', '12a4', ' 1234', '1234\n'])('rejects %j', (pin) =>
    expect(PIN_PATTERN.test(pin)).toBe(false),
  );
});
