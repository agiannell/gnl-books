import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { authority, COGNITO } from './config.ts';

export const userManager = new UserManager({
  authority,
  client_id: COGNITO.clientId,
  // The app client lists the site's origin, with no trailing slash, as a callback.
  redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid email profile',
  // The family tablet should stay signed in (the refresh token lives 365 days),
  // so the session is kept in localStorage rather than sessionStorage, which
  // would sign out whenever the tab closes. The trade-off is that a script
  // injected into the page could read it, so the site must not load third-party
  // scripts.
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
});

/**
 * The access token the API expects, refreshed first if the tab slept past its
 * expiry. Undefined when there is no usable session; the API then answers 401.
 */
export async function getAccessToken(): Promise<string | undefined> {
  let user = await userManager.getUser();
  if (user?.expired) user = await userManager.signinSilent().catch(() => null);
  return user && !user.expired ? user.access_token : undefined;
}
