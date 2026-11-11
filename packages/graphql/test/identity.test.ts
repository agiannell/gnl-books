import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it, vi } from 'vitest';
import { createCognitoEmailLookup } from '../src/identity';

const attrs = (pairs: Record<string, string>) => ({
  UserAttributes: Object.entries(pairs).map(([Name, Value]) => ({ Name, Value })),
});

function lookupWith(send: (command: AdminGetUserCommand) => unknown) {
  const client = { send: vi.fn(async (command: AdminGetUserCommand) => send(command)) };
  return { lookup: createCognitoEmailLookup({ userPoolId: 'us-west-2_pool', client: client as never }), client };
}

describe('createCognitoEmailLookup', () => {
  it('asks Cognito for the user by sub, in the configured pool', async () => {
    const { lookup, client } = lookupWith(() => attrs({ email: 'a@example.test', email_verified: 'true' }));
    await lookup.verifiedEmail('sub-123');
    const command = client.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(AdminGetUserCommand);
    expect(command.input).toEqual({ UserPoolId: 'us-west-2_pool', Username: 'sub-123' });
  });

  it('returns the email when Cognito says it is verified', async () => {
    const { lookup } = lookupWith(() => attrs({ sub: 'x', email: 'Anthony@Example.test', email_verified: 'true' }));
    expect(await lookup.verifiedEmail('sub-123')).toBe('Anthony@Example.test');
  });

  // The email is how a family is found and what a parent sees, so an address the
  // user has not proved they own must never count.
  it.each([
    ['unverified', { email: 'a@example.test', email_verified: 'false' }],
    ['missing its verified flag', { email: 'a@example.test' }],
    ['absent', { sub: 'x' }],
    ['blank', { email: '   ', email_verified: 'true' }],
  ])('returns null when the email is %s', async (_label, pairs) => {
    const { lookup } = lookupWith(() => attrs(pairs));
    expect(await lookup.verifiedEmail('sub-123')).toBeNull();
  });

  it('returns null when Cognito sent no attributes at all', async () => {
    const { lookup } = lookupWith(() => ({}));
    expect(await lookup.verifiedEmail('sub-123')).toBeNull();
  });

  it('returns null for a user Cognito does not know', async () => {
    const { lookup } = lookupWith(() => {
      throw Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
    });
    expect(await lookup.verifiedEmail('sub-123')).toBeNull();
  });

  it('does not hide other failures, such as a missing permission, as "no email"', async () => {
    const { lookup } = lookupWith(() => {
      throw Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' });
    });
    await expect(lookup.verifiedEmail('sub-123')).rejects.toThrow('not authorized');
  });
});
