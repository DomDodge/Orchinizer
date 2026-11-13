import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Builds to the default dist/. server/Dockerfile runs `npm run build` and copies
  // dist/ into server/web/static/, which the Go server embeds. Don't point outDir at
  // server/web: it holds embed.go and would be wiped.
  server: {
    // In dev, forward the socket to a locally running Go server.
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
