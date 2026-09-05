import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import { fileURLToPath, URL } from 'node:url'

import { snapshotPlugin } from './tools/vite-snapshot-plugin'

export default defineConfig({
  plugins: [
    // #include в шейдерах + hot reload (§3 контекст-дока)
    glsl({ include: ['**/*.glsl', '**/*.vert', '**/*.frag'], minify: false }),
    snapshotPlugin(),
  ],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Бэкенд в деве: `node server/index.mjs` на 8787, фронт ходит на /api.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
})
