/**
 * Деплой бэкенда на VPS: `npm run deploy:api`.
 *
 * Копирует server/ в /opt/cozy-api, ставит зависимости и перезапускает
 * systemd-сервис cozy-api. База (/var/lib/cozy-api) не трогается.
 */
import { spawn } from 'node:child_process'

const HOST = 'root@195.43.142.151'

const remote = [
  'set -e',
  'mkdir -p /opt/cozy-api',
  'tar -xzf - -C /opt/cozy-api',
  'cd /opt/cozy-api && npm install --omit=dev --no-audit --no-fund --loglevel=error',
  'systemctl restart cozy-api',
  'sleep 1',
  'systemctl is-active cozy-api',
].join(' && ')

const tar = spawn('tar', ['-czf', '-', '-C', 'server', 'index.mjs', 'smtp.mjs', 'package.json'], {
  stdio: ['ignore', 'pipe', 'inherit'],
})
const ssh = spawn('ssh', [HOST, remote], { stdio: ['pipe', 'inherit', 'inherit'] })
tar.stdout.pipe(ssh.stdin)

ssh.on('close', (code) => {
  if (code === 0) {
    console.log('API перезапущен: https://cozyspider.ru/api/me')
  } else {
    console.error(`ssh завершился с кодом ${code}`)
    process.exit(code ?? 1)
  }
})
