// Public values: every page load exposes them. They change only if the Cognito
// stack is recreated (see the CDK outputs UserPoolId, WebClientId, HostedUiUrl).
export const COGNITO = {
  region: 'us-west-2',
  userPoolId: 'us-west-2_4TQuvImgw',
  clientId: '1l3hn5l1gsngb3qvvckpogstvc',
  hostedUi: 'https://gnl-books.auth.us-west-2.amazoncognito.com',
};

/** Where the OIDC metadata lives; the Hosted UI's own endpoints are listed in it. */
export const authority = `https://cognito-idp.${COGNITO.region}.amazonaws.com/${COGNITO.userPoolId}`;

/**
 * Cognito has no OIDC end-session endpoint: its own `/logout` ends the Hosted UI
 * session and sends the browser back, to a URL the app client lists as a logout URL.
 */
export const logoutUrl = (origin: string) =>
  `${COGNITO.hostedUi}/logout?client_id=${COGNITO.clientId}&logout_uri=${encodeURIComponent(origin)}`;
