import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The Cognito app client lists http://localhost:5173 as a callback, so the
    // dev server must not quietly move to another port.
    port: 5173,
    strictPort: true,
    // In production CloudFront serves the API at /graphql on the site's own
    // origin. In development the same path goes to the deployed API.
    proxy: { '/graphql': { target: 'https://books.gnlfamily.com', changeOrigin: true } },
  },
})
