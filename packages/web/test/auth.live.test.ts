import { describe, expect, it, vi } from 'vitest';

// Talks to the real Cognito user pool (public discovery and Hosted UI endpoints,
// no credentials), so it only runs with VITE_LIVE_COGNITO=1.
describe.skipIf(!import.meta.env.VITE_LIVE_COGNITO)('sign-in settings (live)', () => {
  it('finds the Hosted UI through the pool’s OIDC discovery document', async () => {
    const { userManager } = await import('../src/auth.ts');
    const { COGNITO } = await import('../src/config.ts');
    const authorize = await userManager.metadataService.getAuthorizationEndpoint();
    expect(authorize).toBe(`${COGNITO.hostedUi}/oauth2/authorize`);
    expect(await userManager.metadataService.getTokenEndpoint()).toBe(`${COGNITO.hostedUi}/oauth2/token`);
  });

  it('builds an authorization-code + PKCE request for the app client, back to this origin', async () => {
    const { userManager } = await import('../src/auth.ts');
    const { COGNITO } = await import('../src/config.ts');
    // signinRedirect navigates away; capture the address it would go to instead.
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, origin: window.location.origin, assign });
    // It only settles when the page unloads, so wait for the navigation instead.
    void userManager.signinRedirect({ redirectMethod: 'assign', state: { returnTo: '/p/abc' } });
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    vi.unstubAllGlobals();
    const url = new URL(assign.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe(COGNITO.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(window.location.origin);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    // The page to return to is kept with the request's state, in localStorage.
    const saved = JSON.parse(window.localStorage.getItem(`oidc.${url.searchParams.get('state')}`) ?? 'null');
    expect(saved?.data).toEqual({ returnTo: '/p/abc' });
  });
});
