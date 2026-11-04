import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { GnlBooksStack } from '../lib/gnl-books-stack';

const template = Template.fromStack(new GnlBooksStack(new cdk.App(), 'TestStack'));

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
