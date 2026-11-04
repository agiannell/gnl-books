import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { GnlBooksStack } from '../lib/gnl-books-stack';

describe('GnlBooksStack', () => {
  it('synthesizes', () => {
    const stack = new GnlBooksStack(new cdk.App(), 'TestStack');
    expect(Template.fromStack(stack).toJSON()).toBeDefined();
  });
});
