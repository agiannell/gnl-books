import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['infra/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // CDK synthesis can take a few seconds.
    testTimeout: 30000,
  },
})
