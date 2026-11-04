import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // CDK synthesis can take a few seconds.
    testTimeout: 30000,
    projects: [
      {
        extends: true,
        test: {
          name: 'infra',
          include: ['infra/test/**/*.test.ts'],
          setupFiles: ['infra/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'packages',
          include: ['packages/*/test/**/*.test.ts'],
        },
      },
    ],
  },
})
