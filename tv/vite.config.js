import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // The Go server embeds this folder with go:embed.
    outDir: '../server/web',
    emptyOutDir: true,
  },
  server: {
    // In dev, forward the socket to a locally running Go server.
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
