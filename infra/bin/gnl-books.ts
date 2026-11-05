#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { GnlBooksStack } from '../lib/gnl-books-stack';

const app = new cdk.App();
new GnlBooksStack(app, 'GnlBooksStack', {
  // The account comes from the deploy environment, never from source: this
  // repo is public. The hosted-zone lookup needs a concrete account and region.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-west-2' },
});
