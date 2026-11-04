import { afterAll } from 'vitest';
import { CloudAssembly } from 'aws-cdk-lib/cx-api';

// Vitest equivalent of aws-cdk-lib/testhelpers/jest-autoclean, which registers
// the same afterAll through Jest's global.
afterAll(() => {
  if (!process.env.CDK_NO_CLEAN_TESTS) CloudAssembly.cleanupTemporaryDirectories();
});
