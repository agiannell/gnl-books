import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GnlBooksStack } from '../lib/gnl-books-stack';

// The hosted-zone lookup needs a concrete environment. This account is a fake
// placeholder: with no cached context CDK substitutes a dummy zone, so nothing
// here touches AWS.
const stack = new GnlBooksStack(new cdk.App(), 'TestStack', {
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
