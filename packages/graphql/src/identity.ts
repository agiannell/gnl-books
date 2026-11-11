import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

export interface EmailLookup {
  /** The user's email if Cognito has verified it, else null. Never throws for an unknown or unverified user. */
  verifiedEmail(sub: string): Promise<string | null>;
}

// The access token the API checks carries no email, and an email a client sent
// could not be trusted. So the email comes from Cognito itself, by the `sub`
// the verified token gave. A family can be found by this email, and a join
// request shows it to a parent, so it must be one the user has proved they own.
export function createCognitoEmailLookup(options: {
  userPoolId: string;
  client?: Pick<CognitoIdentityProviderClient, 'send'>;
}): EmailLookup {
  const client = options.client ?? new CognitoIdentityProviderClient({});
  return {
    async verifiedEmail(sub) {
      let attributes;
      try {
        ({ UserAttributes: attributes } = await client.send(
          new AdminGetUserCommand({ UserPoolId: options.userPoolId, Username: sub }),
        ));
      } catch (error) {
        if ((error as { name?: string }).name === 'UserNotFoundException') return null;
        throw error;
      }
      const value = (name: string) => attributes?.find((a) => a.Name === name)?.Value;
      const email = value('email')?.trim();
      return email && value('email_verified') === 'true' ? email : null;
    },
  };
}
