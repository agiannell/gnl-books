import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as dsql from '@aws-cdk/aws-dsql-alpha';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as triggers from 'aws-cdk-lib/triggers';
import { Construct } from 'constructs';

const ZONE_NAME = 'gnlfamily.com';
const SITE_DOMAIN = 'books.gnlfamily.com';

export class GnlBooksStack extends cdk.Stack {
  readonly cluster: dsql.Cluster;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Database
    this.cluster = new dsql.Cluster(this, 'Cluster', {
      clusterName: 'gnl-books',
      // Both are explicit: the alpha only defaults deletionProtection to true
      // when the removalPolicy prop itself is passed, not when it falls back
      // to Retain.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deletionProtection: true,
    });

    // Applies db/migrations on deploy. The SQL is bundled into the function, so
    // editing a migration changes the handler and `executeOnHandlerChange`
    // runs it again. If it throws, the deploy fails.
    const migrationRunner = new nodejs.NodejsFunction(this, 'MigrationRunner', {
      entry: path.join(__dirname, '..', 'lambda', 'migrate.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: { DSQL_ENDPOINT: this.cluster.clusterEndpoint },
      bundling: {
        // pg loads this optional native addon lazily; it is not installed.
        externalModules: ['pg-native'],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `cp -R ${path.posix.join(inputDir, 'db', 'migrations')} ${path.posix.join(outputDir, 'migrations')}`,
          ],
        },
      },
      // The repo root, so `inputDir` above is where `db/` lives.
      projectRoot: path.join(__dirname, '..', '..'),
      depsLockFilePath: path.join(__dirname, '..', '..', 'yarn.lock'),
    });
    // DDL needs the admin database role.
    this.cluster.grantConnectAdmin(migrationRunner);
    new triggers.Trigger(this, 'MigrationTrigger', {
      handler: migrationRunner,
      executeOnHandlerChange: true,
      executeAfter: [this.cluster],
    });

    // Web
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: ZONE_NAME,
    });

    // CloudFront needs its certificate in us-east-1. DnsValidatedCertificate is
    // deprecated, but it is the way to create one from this us-west-2 stack
    // without bootstrapping us-east-1 (a custom resource calls ACM there).
    // Same approach as smash-bros-battle; if CDK removes the class, this is the
    // only place to change.
    const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName: SITE_DOMAIN,
      hostedZone,
      region: 'us-east-1',
    });

    // The bucket only holds build output that is redeployed every time, so
    // unlike the database it is not worth retaining.
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Paths without a file extension are client-side routes, so serve the SPA
    // shell for them. This is a per-behavior function, not distribution-wide
    // error responses, so errors from an API origin added later are never
    // rewritten into HTML.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewriteFunction', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}`),
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      domainNames: [SITE_DOMAIN],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    const alias = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, 'SiteARecord', {
      zone: hostedZone,
      recordName: SITE_DOMAIN,
      target: alias,
    });
    new route53.AaaaRecord(this, 'SiteAaaaRecord', {
      zone: hostedZone,
      recordName: SITE_DOMAIN,
      target: alias,
    });

    // Placeholder until the SPA build replaces it (build step 6).
    new s3deploy.BucketDeployment(this, 'PlaceholderDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'placeholder'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${SITE_DOMAIN}` });
  }
}
