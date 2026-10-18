import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@schema': path.resolve(import.meta.dirname, '../schema'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Files outside frontend/ the app bundles: the .ntb schema and the help articles (docs/help, P2-24).
    fs: {
      allow: [
        import.meta.dirname,
        path.resolve(import.meta.dirname, '../schema'),
        path.resolve(import.meta.dirname, '../docs/help'),
      ],
    },
    proxy: {
      // Same path layout as nginx in Docker: /api is forwarded untouched to the Go API.
      '/api': {
        target: process.env.NTB_API_URL ?? 'http://localhost:8069',
        // Keep the browser's Host header (like nginx `$http_host`): the API's CSRF check compares
        // Origin with Host. The string shorthand would set changeOrigin: true and break login.
        changeOrigin: false,
      },
    },
  },
})
