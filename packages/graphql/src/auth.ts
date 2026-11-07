import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface TokenVerifier {
  /** Resolves with the token's subject, or rejects if it is invalid or expired. */
  verify(token: string): Promise<{ sub: string }>;
}

// Access tokens, not ID tokens: the API only needs to know who the caller is,
// and `clientId` makes the verifier reject tokens minted for any other client
// of the pool (the Alexa client, later).
export function createCognitoVerifier(options: { userPoolId: string; clientId: string[] }): TokenVerifier {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: options.userPoolId,
    clientId: options.clientId,
    tokenUse: 'access',
  });
  return {
    async verify(token) {
      const payload = await verifier.verify(token);
      return { sub: payload.sub };
    },
  };
}
