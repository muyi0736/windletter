import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    outDir: 'scripts/download-smoke-test/.tmp/dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: resolve('scripts/download-smoke-test/test.ts'),
      formats: ['cjs'],
      fileName: () => 'test.cjs'
    },
    rollupOptions: {
      external: [/^node:/]
    }
  }
})
