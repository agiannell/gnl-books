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
          // `graphql` ships ESM and CJS builds. Left external, the tests and
          // src/ load the ESM one while Pothos loads the CJS one, and graphql
          // throws "Duplicate graphql modules". Inlining makes Vite load one
          // copy for all of them. Production is unaffected: esbuild bundles one.
          server: { deps: { inline: ['graphql', /@pothos\//, /@apollo\/server/, /@graphql-tools\//] } },
        },
      },
    ],
  },
})
