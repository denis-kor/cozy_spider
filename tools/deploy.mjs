/**
 * Деплой прод-сборки на VPS (RuVDS, cozyspider.ru): `npm run deploy`.
 *
 * Node вместо shell-скрипта не из любви к JS: npm на этой машине запускает
 * `bash` из System32 (заглушка WSL, которого нет), а PowerShell 5.1 портит
 * бинарные пайпы. Node просто соединяет stdout системного tar со stdin ssh
 * байт в байт на любой оболочке.
 *
 * Схема: содержимое dist/ уезжает во временную папку рядом с веб-рутом и
 * подменяет его одним mv — сайт ни секунды не отдаёт полусмешанную версию.
 * Прошлая сборка остаётся в /var/www/cozy-spider.old; откат:
 *   ssh root@195.43.142.151 "rm -rf /var/www/cozy-spider && mv /var/www/cozy-spider.old /var/www/cozy-spider"
 *
 * Доступ — по SSH-ключу этой машины, пароль не нужен.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const HOST = 'root@195.43.142.151'
const ROOT = '/var/www/cozy-spider'

if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.error('dist/index.html не найден — сначала npm run build')
  process.exit(1)
}

const remote = [
  'set -e',
  `rm -rf ${ROOT}.new`,
  `mkdir -p ${ROOT}.new`,
  `tar -xzf - -C ${ROOT}.new`,
  `chown -R root:root ${ROOT}.new`,
  `rm -rf ${ROOT}.old`,
  `mv ${ROOT} ${ROOT}.old`,
  `mv ${ROOT}.new ${ROOT}`,
].join(' && ')

const tar = spawn('tar', ['-czf', '-', '-C', 'dist', '.'], { stdio: ['ignore', 'pipe', 'inherit'] })
const ssh = spawn('ssh', [HOST, remote], { stdio: ['pipe', 'inherit', 'inherit'] })
tar.stdout.pipe(ssh.stdin)

ssh.on('close', (code) => {
  if (code === 0) {
    console.log('Выложено: https://cozyspider.ru (в браузере — Ctrl+F5)')
  } else {
    console.error(`ssh завершился с кодом ${code}`)
    process.exit(code ?? 1)
  }
})
