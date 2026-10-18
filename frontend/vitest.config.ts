import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@schema': path.resolve(import.meta.dirname, '../schema'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // Same files outside frontend/ as vite.config.ts (schema, help articles).
  server: {
    fs: {
      allow: [
        import.meta.dirname,
        path.resolve(import.meta.dirname, '../schema'),
        path.resolve(import.meta.dirname, '../docs/help'),
      ],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
