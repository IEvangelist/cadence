import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: 'dist-mobile',
    rollupOptions: {
      input: fileURLToPath(new URL('./mobile-harness.html', import.meta.url)),
    },
  },
})
