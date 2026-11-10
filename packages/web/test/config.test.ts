import { describe, expect, it } from 'vitest';
import { authority, COGNITO, logoutUrl } from '../src/config.ts';

describe('config', () => {
  it('points the OIDC authority at the user pool’s issuer', () => {
    expect(authority).toBe(`https://cognito-idp.us-west-2.amazonaws.com/${COGNITO.userPoolId}`);
  });

  it('builds Cognito’s logout URL, with the return address encoded', () => {
    const url = new URL(logoutUrl('https://books.gnlfamily.com'));
    expect(url.origin).toBe(COGNITO.hostedUi);
    expect(url.pathname).toBe('/logout');
    expect(url.searchParams.get('client_id')).toBe(COGNITO.clientId);
    expect(url.searchParams.get('logout_uri')).toBe('https://books.gnlfamily.com');
    expect(logoutUrl('http://localhost:5173')).toContain('logout_uri=http%3A%2F%2Flocalhost%3A5173');
  });
});
