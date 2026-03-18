import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Use our own public/manifest.json
      manifest: false,
      includeAssets: ['icons/*.png'],
      workbox: {
        // Cache the app shell + assets for offline use
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/v1\/agents/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-agents',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 },
            },
          },
          {
            urlPattern: /^\/api\/v1\/metrics/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-metrics',
              expiration: { maxEntries: 100, maxAgeSeconds: 30 },
            },
          },
        ],
      },
      devOptions: {
        // Enable SW in dev so the install prompt fires for testing
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Dev proxy — forward /api and /health to backend
      '/api': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    },
  },
})
