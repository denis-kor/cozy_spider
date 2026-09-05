/**
 * Минимальный SMTP-клиент: одно письмо — одно соединение.
 *
 * Nodemailer здесь был бы третьей зависимостью ради двух писем в день.
 * Наш случай узкий и от того простой: smtps (465, TLS с рукопожатия),
 * AUTH PLAIN, plain-text письмо. Никаких вложений, HTML и пулов.
 *
 * Настройка — переменные окружения сервиса:
 *   COZY_SMTP_URL   smtps://логин:пароль@smtp.yandex.ru:465
 *                   (логин и пароль URL-энкодятся; @ в логине — %40)
 *   COZY_MAIL_FROM  адрес отправителя, по умолчанию логин из URL
 *
 * Пока COZY_SMTP_URL не задан, mailEnabled=false и сервер живёт без
 * писем: регистрация не требует подтверждения, сброс отвечает честным
 * «временно недоступно».
 */
import { connect } from 'node:tls'

const SMTP_URL = process.env.COZY_SMTP_URL ?? ''

export const mailEnabled = SMTP_URL !== ''

function config() {
  const u = new URL(SMTP_URL)
  const user = decodeURIComponent(u.username)
  return {
    host: u.hostname,
    port: Number(u.port || 465),
    user,
    pass: decodeURIComponent(u.password),
    from: process.env.COZY_MAIL_FROM ?? user,
  }
}

/** Тема по-русски обязана ехать в RFC 2047, иначе получатель увидит кашу. */
const utf8Header = (s) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`

export function sendMail(to, subject, text) {
  const { host, port, user, pass, from } = config()
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host })
    socket.setEncoding('utf8')
    socket.setTimeout(15000, () => {
      socket.destroy()
      reject(new Error('smtp timeout'))
    })

    const message =
      [
        `From: =?UTF-8?B?${Buffer.from('Пасьянс «Паук»', 'utf8').toString('base64')}?= <${from}>`,
        `To: <${to}>`,
        `Subject: ${utf8Header(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        text,
      ].join('\r\n') + '\r\n.'

    // Диалог SMTP линеен, поэтому просто очередь: [что шлём, какой код ждём].
    const steps = [
      [null, 220],
      [`EHLO cozyspider.ru`, 250],
      [`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, 235],
      [`MAIL FROM:<${from}>`, 250],
      [`RCPT TO:<${to}>`, 250],
      ['DATA', 354],
      [message, 250],
      ['QUIT', 221],
    ]
    let i = 0
    let buf = ''

    socket.on('data', (chunk) => {
      buf += chunk
      // Ответ может прийти многострочным (250-... 250 ...): ждём финальную
      // строку «код пробел».
      const lines = buf.split('\r\n').filter(Boolean)
      const last = lines[lines.length - 1]
      if (!last || !/^\d{3} /.test(last)) return
      buf = ''
      const code = Number(last.slice(0, 3))
      if (code !== steps[i][1]) {
        socket.destroy()
        reject(new Error(`smtp: ожидали ${steps[i][1]}, получили ${last}`))
        return
      }
      i += 1
      if (i >= steps.length) {
        socket.end()
        resolve()
        return
      }
      socket.write(steps[i][0] + '\r\n')
    })

    socket.on('error', reject)
  })
}
