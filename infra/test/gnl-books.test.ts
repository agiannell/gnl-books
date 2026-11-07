import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GnlBooksStack } from '../lib/gnl-books-stack';

// The hosted-zone lookup needs a concrete environment. This account is a fake
// placeholder: with no cached context CDK substitutes a dummy zone, so nothing
// here touches AWS.
// An empty list tells CDK not to run esbuild for the migration runner, which
// would be slow and isn't what these tests are about.
const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
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

  // DDL runs as the admin role, so the runner needs the admin connect action.
  // The API has it too until custom database roles exist (see TODO.md); this
  // pins the list so a third function can't pick it up unnoticed.
  it('lets only the runner and the API connect as admin', () => {
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
    expect(roles).toHaveLength(2);
    expect(roles).toEqual(
      expect.arrayContaining([
        expect.stringContaining('MigrationRunner'),
        expect.stringContaining('GraphqlFunction'),
      ]),
    );
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

  it('deploys the placeholder and invalidates the cache', () => {
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      DistributionPaths: ['/*'],
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
