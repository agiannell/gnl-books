import * as cdk from 'aws-cdk-lib/core';
import * as dsql from '@aws-cdk/aws-dsql-alpha';
import { Construct } from 'constructs';

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
  }
}
