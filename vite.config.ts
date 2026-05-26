import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// COOP + COEP headers unlock SharedArrayBuffer, which is needed for the
// multi-threaded FFmpeg WASM core (@ffmpeg/core-mt).
// We use COEP: credentialless (instead of require-corp) so that cross-origin
// embeds like Google AdSense do not need to carry Cross-Origin-Resource-Policy
// headers.  The MT core falls back to the single-threaded core on Safari,
// which does not support credentialless.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      // credentialless allows SharedArrayBuffer (needed for MT FFmpeg) without
      // requiring cross-origin resources (e.g. AdSense iframes) to carry
      // Cross-Origin-Resource-Policy headers. Falls back to ST core in Safari.
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
