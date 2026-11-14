/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Backend port for the dev proxy (Playwright sets it when running on non-default ports).
const backendPort = process.env.VITE_BACKEND_PORT ?? '8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/unit/setup.ts',
    // The transcript-viewer tests render long fixtures; 5 s flaked on a loaded machine.
    testTimeout: 15000,
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/store/**', 'src/hooks/**', 'src/lib/**', 'src/ruleset/**', 'src/utils/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts', 'src/ruleset/classic.ts'],
      // Logic-bearing directories only (components and pages are judged by mutation score and the
      // browser tiers). Enforced by `npm run test:coverage`.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 85,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: `ws://127.0.0.1:${backendPort}`,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path,
        timeout: 0, // Disable timeout for WebSocket connections
        proxyTimeout: 0, // Disable proxy timeout
        configure: (proxy) => {
          // Handle proxy errors gracefully to prevent crashes
          proxy.on('error', (err) => {
            console.log('[vite] ws proxy error:', err.message)
          })
          // Disable socket timeouts for WebSocket connections
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.setTimeout(0)
            socket.setKeepAlive(true, 30000)
            socket.on('error', (err) => {
              console.log('[vite] ws socket error:', err.message)
            })
          })
          proxy.on('open', (proxySocket) => {
            proxySocket.setTimeout(0)
            proxySocket.setKeepAlive(true, 30000)
          })
        },
      },
    },
  },
})
