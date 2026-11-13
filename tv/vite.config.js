import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
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
