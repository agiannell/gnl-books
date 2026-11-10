import react from '@vitejs/plugin-react'
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
          // The web app's tests need a DOM; they have their own project below.
          exclude: ['packages/web/**', '**/node_modules/**'],
          // `graphql` ships ESM and CJS builds. Left external, the tests and
          // src/ load the ESM one while Pothos loads the CJS one, and graphql
          // throws "Duplicate graphql modules". Inlining makes Vite load one
          // copy for all of them. Production is unaffected: esbuild bundles one.
          server: { deps: { inline: ['graphql', /@pothos\//, /@apollo\/server/, /@graphql-tools\//] } },
        },
      },
      {
        extends: true,
        // happy-dom, not jsdom: jsdom 31 needs Node 24.15 or later, and this
        // machine has 24.12 (CI is fine, .nvmrc resolves to the newest 24).
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'happy-dom',
          include: ['packages/web/test/**/*.test.{ts,tsx}'],
          setupFiles: ['packages/web/test/setup.ts'],
        },
      },
    ],
  },
})
