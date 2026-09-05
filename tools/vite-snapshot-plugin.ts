import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Dev-only: POST /__snapshot { name, dataUrl } -> пишет PNG/JPEG в art/_snapshots/.
 *
 * Нужен, чтобы смотреть на результат правок шейдеров, не выгружая base64
 * через консоль. В прод-сборку не попадает: apply: 'serve'.
 */
export function snapshotPlugin(outDir = 'art/_snapshots'): Plugin {
  return {
    name: 'cozy-snapshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__snapshot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('POST only')
        }
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          try {
            const { name, dataUrl } = JSON.parse(body) as { name: string; dataUrl: string }
            const safe = name.replace(/[^a-z0-9._-]/gi, '_')
            const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
            const file = resolve(server.config.root, outDir, safe)
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, Buffer.from(b64, 'base64'))
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true, file }))
          } catch (e) {
            res.statusCode = 400
            res.end(String(e))
          }
        })
      })
    },
  }
}
