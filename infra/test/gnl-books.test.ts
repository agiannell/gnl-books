import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GnlBooksStack } from '../lib/gnl-books-stack';

// The hosted-zone lookup needs a concrete environment. This account is a fake
// placeholder: with no cached context CDK substitutes a dummy zone, so nothing
// here touches AWS.
// An empty list tells CDK not to run esbuild for the migration runner, which
// would be slow and isn't what these tests are about.
// `webDist` points the site deployment at the placeholder page, so these tests need no web build.
const app = new cdk.App({
  context: { 'aws:cdk:bundling-stacks': [], webDist: path.join(__dirname, '..', 'placeholder') },
});
const stack = new GnlBooksStack(app, 'TestStack', {
  env: { account: '111111111111', region: 'us-west-2' },
});
const template = Template.fromStack(stack);

describe('database', () => {
  it('creates exactly one DSQL cluster', () => {
    template.resourceCountIs('AWS::DSQL::Cluster', 1);
  });

  it('retains the cluster if the stack or resource is removed or replaced', () => {
    template.hasResource('AWS::DSQL::Cluster', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  // The alpha omits this property unless it is passed explicitly, so assert it
  // rather than trusting the default.
  it('enables deletion protection', () => {
    template.hasResourceProperties('AWS::DSQL::Cluster', {
      DeletionProtectionEnabled: true,
    });
  });

  it('names the cluster', () => {
    template.hasResourceProperties('AWS::DSQL::Cluster', {
      Tags: [{ Key: 'Name', Value: 'gnl-books' }],
    });
  });

  it('fails a wrong assertion, so the matchers really run', () => {
    expect(() => template.resourceCountIs('AWS::DSQL::Cluster', 2)).toThrow();
  });
});

describe('migrations', () => {
  it('runs a Node 24 function pointed at the cluster', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Environment: {
        Variables: Match.objectLike({ DSQL_ENDPOINT: Match.anyValue() }),
      },
    });
  });

  // DDL, role creation and IAM mapping run as the admin role. This pins the
  // list so no other function can pick the admin connect action up unnoticed.
  it('lets only the runner connect as admin', () => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([Match.objectLike({ Action: 'dsql:DbConnectAdmin' })]),
        },
      },
    });
    const roles = Object.values(policies).flatMap((p) =>
      (p.Properties.Roles as { Ref: string }[]).map((r) => r.Ref),
    );
    expect(roles).toEqual([expect.stringContaining('MigrationRunner')]);
  });

  it('lets the API connect only as the limited role, never as admin', () => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([Match.objectLike({ Action: 'dsql:DbConnect' })]),
        },
      },
    });
    const roles = Object.values(policies).flatMap((p) =>
      (p.Properties.Roles as { Ref: string }[]).map((r) => r.Ref),
    );
    expect(roles).toEqual([expect.stringContaining('GraphqlFunction')]);
  });

  it('tells the API which database role to use, and the runner which role to create', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ DSQL_USER: 'gnl_books_app' }) },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ DSQL_APP_USER: 'gnl_books_app' }) },
    });
  });

  it("maps the API's IAM role to the database role, and only after that role exists", () => {
    const functions = template.findResources('AWS::Lambda::Function');
    const [apiId] = Object.entries(functions).find(([id]) => id.startsWith('GraphqlFunction')) ?? [];
    const [, runner] = Object.entries(functions).find(([id]) => id.startsWith('MigrationRunner')) ?? [];
    const apiRole = functions[apiId!].Properties.Role['Fn::GetAtt'][0];
    expect(runner!.Properties.Environment.Variables.DSQL_APP_ROLE_ARN).toEqual({
      'Fn::GetAtt': [apiRole, 'Arn'],
    });
    template.hasResource('Custom::Trigger', {
      DependsOn: Match.arrayWith([Match.stringLikeRegexp('GraphqlFunction')]),
    });
  });

  it('invokes the runner on deploy, and again whenever its code changes', () => {
    template.resourceCountIs('Custom::Trigger', 1);
    template.hasResourceProperties('Custom::Trigger', {
      HandlerArn: Match.anyValue(),
    });
  });

  it('runs the trigger only after the cluster exists', () => {
    template.hasResource('Custom::Trigger', {
      DependsOn: Match.arrayWith([Match.stringLikeRegexp('Cluster')]),
    });
  });
});

describe('web', () => {
  it('keeps the site bucket private and TLS-only', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('reads the bucket through origin access control, not a public origin', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
      }),
    });
  });

  it('serves books.gnlfamily.com over HTTPS only', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['books.gnlfamily.com'],
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
        ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }),
      }),
    });
  });

  it('requests the certificate in us-east-1, where CloudFront needs it', () => {
    // DnsValidatedCertificate is a custom resource, not AWS::CertificateManager::Certificate.
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      DomainName: 'books.gnlfamily.com',
      Region: 'us-east-1',
    });
  });

  it('rewrites client-side routes per behavior, not with distribution-wide error responses', () => {
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: Match.stringLikeRegexp('/index\\.html'),
    });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })],
        }),
        CustomErrorResponses: Match.absent(),
      }),
    });
  });

  it('points both A and AAAA records at the distribution', () => {
    for (const Type of ['A', 'AAAA']) {
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        Name: 'books.gnlfamily.com.',
        Type,
      });
    }
  });

  it('deploys the site and invalidates the cache', () => {
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      DistributionPaths: ['/*'],
    });
  });
});

describe('web hosting', () => {
  const deployments = () => Object.values(template.findResources('Custom::CDKBucketDeployment')).map((r) => r.Properties);

  it('publishes the site in two deployments, the hashed files and everything else', () => {
    template.resourceCountIs('Custom::CDKBucketDeployment', 2);
    const [assets] = deployments().filter((d) => d.Include);
    const [site] = deployments().filter((d) => !d.Include);
    expect(assets).toMatchObject({ Exclude: ['*'], Include: ['assets/*'] });
    expect(site).toMatchObject({ Exclude: ['assets/*'] });
  });

  it('keeps the hashed files for a year, because their names change when they do', () => {
    const [assets] = deployments().filter((d) => d.Include);
    expect(assets.SystemMetadata['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('makes the browser check index.html every time', () => {
    const [site] = deployments().filter((d) => !d.Include);
    expect(site.SystemMetadata['cache-control']).toBe('no-cache');
  });

  // Excluded files are also skipped when pruning. Without the exclude, the site deployment would delete
  // the hashed files the other deployment just uploaded; without `Prune: false` there, the assets
  // deployment would delete every file that is not under assets/, index.html included.
  it('never deletes the hashed files, and does not prune in the assets deployment at all', () => {
    const [assets] = deployments().filter((d) => d.Include);
    const [site] = deployments().filter((d) => !d.Include);
    expect(assets.Prune).toBe(false);
    expect(site.Exclude).toContain('assets/*');
    expect(site.Prune).not.toBe(false);
  });

  it('invalidates the cache only after the hashed files are there, so no page names a missing file', () => {
    const resources = template.findResources('Custom::CDKBucketDeployment');
    const entries = Object.entries(resources);
    const [assetsId] = entries.find(([, r]) => r.Properties.Include)!;
    const [, site] = entries.find(([, r]) => !r.Properties.Include)!;
    expect(site.DependsOn).toContain(assetsId);
    const [, assets] = entries.find(([, r]) => r.Properties.Include)!;
    // Only the second deployment sends the invalidation.
    expect(assets.Properties.DistributionPaths).toBeUndefined();
    expect(site.Properties.DistributionPaths).toEqual(['/*']);
  });

  describe('security headers', () => {
    const headers = () => {
      const [policy] = Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
      return policy!.Properties.ResponseHeadersPolicyConfig;
    };
    const csp = () => {
      const directives = new Map<string, string[]>();
      for (const part of headers().SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy.split('; ')) {
        const [name, ...values] = part.split(' ');
        directives.set(name!, values);
      }
      return directives;
    };

    it('applies to the site and not to the API', () => {
      template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1);
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({ ResponseHeadersPolicyId: Match.anyValue() }),
        }),
      });
      const [distribution] = Object.values(template.findResources('AWS::CloudFront::Distribution'));
      for (const behavior of distribution!.Properties.DistributionConfig.CacheBehaviors) {
        expect(behavior.ResponseHeadersPolicyId).toBeUndefined();
      }
    });

    it('lets only the site’s own scripts run: no inline scripts, no eval, nothing from other hosts', () => {
      expect(csp().get('script-src')).toEqual(["'self'"]);
      expect(csp().get('default-src')).toEqual(["'self'"]);
      expect(csp().get('object-src')).toEqual(["'none'"]);
    });

    it('allows no wildcard anywhere', () => {
      expect(headers().SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy).not.toMatch(/(^|\s)\*(\s|;|$)/);
    });

    it('lets the page call the API and the two Cognito hosts the sign-in uses, and nothing else', () => {
      expect(csp().get('connect-src')).toEqual([
        "'self'",
        'https://cognito-idp.us-west-2.amazonaws.com',
        'https://gnl-books.auth.us-west-2.amazoncognito.com',
      ]);
    });

    it('lets book covers load from Hardcover', () => {
      expect(csp().get('img-src')).toEqual(["'self'", 'https://assets.hardcover.app', 'data:']);
    });

    it('allows inline style attributes (a reader’s colour) but no inline style elements', () => {
      expect(csp().get('style-src')).toEqual(["'self'"]);
      expect(csp().get('style-src-attr')).toEqual(["'unsafe-inline'"]);
    });

    it('stops the page being framed, and restricts forms and the base address', () => {
      expect(csp().get('frame-ancestors')).toEqual(["'none'"]);
      expect(csp().get('form-action')).toEqual(["'self'"]);
      expect(csp().get('base-uri')).toEqual(["'self'"]);
      expect(headers().SecurityHeadersConfig.FrameOptions).toEqual({ FrameOption: 'DENY', Override: true });
    });

    it('sends the other standard headers, replacing any the origin sets', () => {
      const config = headers().SecurityHeadersConfig;
      expect(config.ContentTypeOptions).toEqual({ Override: true });
      expect(config.ReferrerPolicy).toEqual({ ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true });
      expect(config.StrictTransportSecurity).toMatchObject({ AccessControlMaxAgeSec: 365 * 24 * 60 * 60, Override: true });
      expect(config.ContentSecurityPolicy.Override).toBe(true);
    });

    it('does not make other gnlfamily.com sites HTTPS-only', () => {
      expect(headers().SecurityHeadersConfig.StrictTransportSecurity.IncludeSubdomains).not.toBe(true);
    });

    it('turns off the camera, microphone, location and payments', () => {
      const [header] = headers().CustomHeadersConfig.Items;
      expect(header).toMatchObject({ Header: 'Permissions-Policy', Override: true });
      expect(header.Value).toBe('camera=(), microphone=(), geolocation=(), payment=()');
    });
  });
});

describe('auth', () => {
  it('creates one user pool that is retained and protected from deletion', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: { DeletionProtection: 'ACTIVE' },
    });
  });

  it('only lets an admin create users', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it('signs in by email', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
    });
  });

  it('serves the Hosted UI from a Cognito prefix domain', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: 'gnl-books' });
  });

  it('gives the SPA a public PKCE client with no secret and no implicit flow', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'web',
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: Match.arrayWith(['openid', 'email', 'profile']),
    });
  });

  it('only redirects back to the site and the local dev server', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: ['https://books.gnlfamily.com', 'http://localhost:5173'],
      LogoutURLs: ['https://books.gnlfamily.com', 'http://localhost:5173'],
    });
  });

  it('keeps refresh tokens long-lived but revocable', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      // CDK emits durations in minutes: 365 days.
      RefreshTokenValidity: 365 * 24 * 60,
      TokenValidityUnits: Match.objectLike({ RefreshToken: 'minutes' }),
      EnableTokenRevocation: true,
    });
  });
});

describe('api', () => {
  it('gives the function the cluster and the pool it must verify against', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Environment: {
        Variables: Match.objectLike({
          DSQL_ENDPOINT: Match.anyValue(),
          USER_POOL_ID: Match.anyValue(),
          USER_POOL_WEB_CLIENT_ID: Match.anyValue(),
        }),
      },
    });
  });

  it('generates the parent-token signing key into gnl-books/cdk, not in the template', () => {
    // Only the stack-owned secret: hand-made secrets live in gnl-books/app, outside CDK.
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'gnl-books/cdk',
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: '{}',
        GenerateStringKey: 'parentTokenKey',
        PasswordLength: 64,
        ExcludePunctuation: true,
      }),
    });
    // Nothing that looks like a literal secret value: no SecretString property.
    const [secret] = Object.values(template.findResources('AWS::SecretsManager::Secret'));
    expect(secret.Properties.SecretString).toBeUndefined();
  });

  it('gives the API the secret ARN, and read access to that secret only', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ CDK_SECRET_ARN: Match.anyValue() }) },
    });
    const readers = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith(['secretsmanager:GetSecretValue']) })]),
        },
      },
    });
    const roles = Object.values(readers).flatMap((p) => (p.Properties.Roles as { Ref: string }[]).map((r) => r.Ref));
    expect(roles).toHaveLength(1);
    expect(roles[0]).toContain('GraphqlFunction');
  });

  it('lets the API read the hand-made gnl-books/app secret by name, without CDK owning it', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ APP_SECRET_ID: 'gnl-books/app' }) },
    });
    // Imported, not created: it is still only the one generated secret in the template.
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    // Read (and only read) access, to a name-based ARN with the random suffix wildcarded.
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
      (p) => p.Properties.PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[],
    );
    const forApp = statements.filter((s) => JSON.stringify(s.Resource).includes('secret:gnl-books/app-'));
    expect(forApp).toHaveLength(1);
    expect([forApp[0].Action].flat().sort()).toEqual(['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue']);
  });

  it('exposes GET and POST /graphql on an HTTP API, and nothing else', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'HTTP' });
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
      (r) => r.Properties.RouteKey,
    );
    expect(routes.sort()).toEqual(['GET /graphql', 'POST /graphql']);
  });

  it('throttles the API', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
  });

  // The SPA behavior rewrites paths to /index.html; the API must not get that.
  it('serves /graphql from the same distribution, uncached, over HTTPS only', () => {
    const [distribution] = Object.values(template.findResources('AWS::CloudFront::Distribution'));
    const behaviors = distribution.Properties.DistributionConfig.CacheBehaviors;
    expect(behaviors).toHaveLength(1);
    expect(behaviors[0]).toMatchObject({
      PathPattern: '/graphql',
      ViewerProtocolPolicy: 'https-only',
      AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
    });
    expect(behaviors[0].FunctionAssociations).toBeUndefined();
    // Managed policies: CachingDisabled, AllViewerExceptHostHeader.
    expect(behaviors[0].CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    expect(behaviors[0].OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
  });
});
