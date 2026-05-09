import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-Origin-Opener-Policy + Cross-Origin-Embedder-Policy are required for
// SharedArrayBuffer, which is needed by @ffmpeg/core-mt (multi-threaded WASM).
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
