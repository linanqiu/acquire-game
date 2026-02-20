/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

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
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/components/**', 'src/hooks/**', 'src/lib/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
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
