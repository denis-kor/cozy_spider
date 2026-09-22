/**
 * Бэкенд Cozy Spider: аккаунты, облачные сейвы, энтайтлменты.
 *
 * Нарочно без фреймворков — один файл, одна зависимость (better-sqlite3).
 * На нагрузках пасьянса Express не решает ни одной задачи, которую не
 * решает node:http, а каждая зависимость на сервере — это то, что придётся
 * обновлять по CVE годами.
 *
 * Живёт за nginx: тот терминирует TLS и проксирует /api/ на 127.0.0.1:8787.
 * Данные в SQLite: /var/lib/cozy-api/cozy.db (или $COZY_DB).
 *
 * Аутентификация:
 * - почта+пароль: scrypt из node:crypto, соль на пользователя;
 * - VK / Яндекс: клиент приносит access_token, сервер сам спрашивает у
 *   провайдера, чей это токен, — токену с улицы не верим;
 * - сессия: случайные 32 байта в httpOnly-куке, в базе — только SHA-256
 *   от них: утёкшая база не даёт войти.
 *
 * Пароли и почта — персональные данные. Хранится минимум: почта, хеш,
 * имя для приветствия, аватар. Ни телефонов, ни логов с ПД.
 */
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { mailEnabled, sendMail } from './smtp.mjs'

const PORT = Number(process.env.COZY_PORT ?? 8787)
const DB_PATH = process.env.COZY_DB ?? '/var/lib/cozy-api/cozy.db'
/** Ставится в проде: без него кука не получает флаг Secure (дев по http). */
const SECURE = process.env.COZY_SECURE === '1'
/** Тот же App ID, что в src/app/platform/oauth.ts — нужен для user_info. */
const VK_APP_ID = 54746677

const SESSION_DAYS = 180
const MAX_BODY = 256 * 1024
const MAX_AVATAR = 160 * 1024
const FREE_SKUS = ['pack.pond', 'deck.pond']
const SITE = 'https://cozyspider.ru'
const RESET_TTL = 3600
const CONFIRM_TTL = 7 * 86400

/**
 * ЮKassa. Ключи — в systemd drop-in (как SMTP, см. DEPLOY.md); без них
 * ручка покупки отвечает 503, и лавка честно живёт в режиме fake-door.
 * Цены сервер берёт ТОЛЬКО из каталога — того же shop.json, что видит
 * игрок (в проде фронт лежит рядом, путь переопределяется COZY_CATALOG).
 */
const YK_SHOP_ID = process.env.COZY_YK_SHOP_ID ?? ''
const YK_SECRET = process.env.COZY_YK_SECRET ?? ''
const ykEnabled = Boolean(YK_SHOP_ID && YK_SECRET)
const CATALOG_PATH = process.env.COZY_CATALOG ?? '/var/www/cozy-spider/assets/shop.json'

// ---------------------------------------------------------------- база

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE,
    pass_salt BLOB,
    pass_hash BLOB,
    provider TEXT,
    provider_id TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saves (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entitlements (
    user_id INTEGER NOT NULL REFERENCES users(id),
    sku TEXT NOT NULL,
    PRIMARY KEY (user_id, sku)
  );
  CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, -- id платежа у ЮKassa
    user_id INTEGER NOT NULL REFERENCES users(id),
    sku TEXT NOT NULL,
    amount TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)
// Колонка появилась позже первых установок: мигрируем на ходу.
try {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0')
} catch {
  /* уже есть */
}

// ------------------------------------------------------------- помощники

const now = () => Math.floor(Date.now() / 1000)
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function hashPassword(password, salt = randomBytes(16)) {
  return { salt, hash: scryptSync(password, salt, 32) }
}

/** Соль для «холостого» scrypt на входе с несуществующей почтой: считаем
 *  его всё равно, чтобы время ответа не выдавало, зарегистрирован ли адрес. */
const DUMMY_SALT = randomBytes(16)

function publicUser(u) {
  return {
    id: String(u.id),
    displayName: u.display_name ?? undefined,
    avatarUrl: u.avatar_url ?? undefined,
    // Есть смысл только у почтовых учёток, и только пока письма шлются.
    emailVerified: u.email && mailEnabled ? Boolean(u.email_verified) : undefined,
  }
}

/** Одноразовый токен для письма: в базе — только его хеш. */
function issueEmailToken(userId, kind) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?').run(userId, kind)
  db.prepare('INSERT INTO email_tokens (token_hash, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    kind,
    now(),
  )
  return token
}

function takeEmailToken(token, kind, ttl) {
  const row = db
    .prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND kind = ? AND created_at > ?')
    .get(sha256(String(token)), kind, now() - ttl)
  if (row) db.prepare('DELETE FROM email_tokens WHERE token_hash = ?').run(row.token_hash)
  return row ?? null
}

function sendConfirmMail(user) {
  const link = `${SITE}/?confirm=${issueEmailToken(user.id, 'confirm')}`
  return sendMail(
    user.email,
    'Подтвердите почту — пасьянс «Паук»',
    `Здравствуйте!\n\nВы зарегистрировались в пасьянсе «Паук» (${SITE}).\n` +
      `Подтвердите почту — откройте ссылку:\n\n${link}\n\n` +
      `Если это были не вы, просто удалите письмо.`,
  )
}

function readCookies(req) {
  const out = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function sessionUser(req) {
  const token = readCookies(req).cozy_sid
  if (!token) return null
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.created_at > ?`,
    )
    .get(sha256(token), now() - SESSION_DAYS * 86400)
  return row ?? null
}

function startSession(res, userId) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    now(),
  )
  res.setHeader(
    'Set-Cookie',
    `cozy_sid=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${SECURE ? '; Secure' : ''}`,
  )
}

function json(res, code, body) {
  const data = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(data)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('bad json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Реальный IP клиента. За nginx сокет всегда 127.0.0.1, поэтому берём
 * X-Real-IP — его проставляет nginx (`proxy_set_header X-Real-IP
 * $remote_addr`, см. DEPLOY.md). Заголовок с улицы подделать нельзя:
 * наружу торчит только nginx, а он адрес перезаписывает. Фолбэк на сокет —
 * для локального дева без прокси.
 */
function clientIp(req) {
  const fwd = req.headers['x-real-ip']
  return (typeof fwd === 'string' && fwd.trim()) || req.socket.remoteAddress || 'unknown'
}

/** Наивный лимитер на IP для авторизационных ручек: хватает с запасом. */
const attempts = new Map()
function rateLimited(ip) {
  const t = now()
  const slot = attempts.get(ip) ?? { count: 0, since: t }
  if (t - slot.since > 600) (slot.count = 0), (slot.since = t)
  slot.count += 1
  attempts.set(ip, slot)
  // Карта на IP, а не на один 127.0.0.1: не даём ей расти бесконечно —
  // изредка выметаем протухшие корзины.
  if (attempts.size > 5000) for (const [k, v] of attempts) if (t - v.since > 600) attempts.delete(k)
  return slot.count > 30
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// ------------------------------------------------- проверка OAuth-токенов

async function verifyProviderToken(provider, accessToken) {
  if (provider === 'vk') {
    const r = await fetch('https://id.vk.com/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken, client_id: String(VK_APP_ID) }),
    })
    const data = await r.json()
    const u = data.user
    if (!u?.user_id) return null
    return { providerId: `vk:${u.user_id}`, displayName: u.first_name || null, avatarUrl: u.avatar || null }
  }
  if (provider === 'yandex') {
    const r = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${accessToken}` },
    })
    const u = await r.json()
    if (!u?.id) return null
    return {
      providerId: `ya:${u.id}`,
      displayName: u.display_name || u.real_name || u.login || null,
      avatarUrl:
        u.default_avatar_id && !u.is_avatar_empty
          ? `https://avatars.yandex.net/get-yapic/${u.default_avatar_id}/islands-200`
          : null,
    }
  }
  return null
}

// ---------------------------------------------------------------- ЮKassa

/** Товар из каталога. Читается с диска на каждую покупку: покупки редки,
 *  зато цена всегда та, что видит игрок, и деплой фронта ничего не ломает. */
function catalogSku(sku) {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
  return catalog.skus.find((s) => s.id === sku) ?? null
}

async function ykFetch(method, path, body, idemKey) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${YK_SHOP_ID}:${YK_SECRET}`).toString('base64')}`,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idemKey) headers['Idempotence-Key'] = idemKey
  const r = await fetch(`https://api.yookassa.ru/v3${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`ЮKassa ${r.status}: ${data.description ?? data.code ?? '?'}`)
  return data
}

/** Финал платежа. Идемпотентно: повторный вебхук или гонка с /sync
 *  упираются в PRIMARY KEY энтайтлментов и ничего не портят. */
function settlePayment(id, status) {
  db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
  if (status !== 'succeeded') return
  const p = db.prepare('SELECT user_id, sku FROM payments WHERE id = ?').get(id)
  db.prepare('INSERT OR IGNORE INTO entitlements (user_id, sku) VALUES (?, ?)').run(p.user_id, p.sku)
}

// ----------------------------------------------------------------- ручки

const routes = {
  'POST /api/register': async (req, res, body) => {
    if (rateLimited(clientIp(req))) return json(res, 429, { error: 'Слишком много попыток — позже' })
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Это не похоже на почту' })
    if (password.length < 6) return json(res, 400, { error: 'Пароль короче 6 символов' })
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
      return json(res, 409, { error: 'Эта почта уже зарегистрирована — попробуйте войти' })
    const { salt, hash } = hashPassword(password)
    const name = email.split('@')[0]
    // Без SMTP подтверждать нечем — считаем почту подтверждённой, как
    // до появления писем. С SMTP игрок играет сразу, но видит просьбу
    // подтвердить (мягкий режим: пасьянс — не банк).
    const verified = mailEnabled ? 0 : 1
    const info = db
      .prepare(
        'INSERT INTO users (email, pass_salt, pass_hash, display_name, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(email, salt, hash, name, verified, now())
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
    if (mailEnabled) sendConfirmMail(u).catch((e) => console.error('confirm mail', e))
    startSession(res, u.id)
    json(res, 200, { user: publicUser(u) })
  },

  'POST /api/confirm': async (req, res, body) => {
    const row = takeEmailToken(body.token, 'confirm', CONFIRM_TTL)
    if (!row) return json(res, 400, { error: 'Ссылка устарела — запросите письмо ещё раз' })
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id)
    json(res, 200, {})
  },

  'POST /api/confirm/resend': async (req, res) => {
    if (rateLimited(clientIp(req))) return json(res, 429, { error: 'Слишком много попыток — позже' })
    const u = sessionUser(req)
    if (!u?.email || u.email_verified) return json(res, 400, { error: 'Подтверждать нечего' })
    if (!mailEnabled) return json(res, 503, { error: 'Отправка писем временно недоступна' })
    await sendConfirmMail(u)
    json(res, 200, {})
  },

  'POST /api/reset/request': async (req, res, body) => {
    if (rateLimited(clientIp(req))) return json(res, 429, { error: 'Слишком много попыток — позже' })
    if (!mailEnabled) return json(res, 503, { error: 'Восстановление пароля временно недоступно' })
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Это не похоже на почту' })
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    // Отвечаем одинаково, есть почта в базе или нет: список зарегистрированных
    // адресов — не публичная информация.
    if (u) {
      const link = `${SITE}/?reset=${issueEmailToken(u.id, 'reset')}`
      await sendMail(
        email,
        'Смена пароля — пасьянс «Паук»',
        `Здравствуйте!\n\nКто-то (надеемся, вы) попросил сменить пароль в пасьянсе «Паук» (${SITE}).\n` +
          `Ссылка действует час:\n\n${link}\n\n` +
          `Если это были не вы — ничего не делайте, пароль останется прежним.`,
      ).catch((e) => console.error('reset mail', e))
    }
    json(res, 200, {})
  },

  'POST /api/reset/confirm': async (req, res, body) => {
    const password = String(body.password ?? '')
    if (password.length < 6) return json(res, 400, { error: 'Пароль короче 6 символов' })
    const row = takeEmailToken(body.token, 'reset', RESET_TTL)
    if (!row) return json(res, 400, { error: 'Ссылка устарела — запросите смену пароля ещё раз' })
    const { salt, hash } = hashPassword(password)
    db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ?, email_verified = 1 WHERE id = ?').run(
      salt,
      hash,
      row.user_id,
    )
    // Старые сессии могли быть у того, кто увёл пароль, — выкидываем все.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id)
    startSession(res, row.user_id)
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)
    json(res, 200, { user: publicUser(u) })
  },

  'POST /api/login': async (req, res, body) => {
    if (rateLimited(clientIp(req))) return json(res, 429, { error: 'Слишком много попыток — позже' })
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!u?.pass_hash) {
      // Всё равно гоняем scrypt: без этого ответ на несуществующую почту
      // приходит заметно быстрее и превращается в оракул перечисления.
      hashPassword(password, DUMMY_SALT)
      return json(res, 401, { error: 'Неверная почта или пароль' })
    }
    const { hash } = hashPassword(password, u.pass_salt)
    if (!timingSafeEqual(hash, u.pass_hash)) return json(res, 401, { error: 'Неверная почта или пароль' })
    startSession(res, u.id)
    json(res, 200, { user: publicUser(u) })
  },

  'POST /api/oauth': async (req, res, body) => {
    if (rateLimited(clientIp(req))) return json(res, 429, { error: 'Слишком много попыток — позже' })
    const provider = body.provider === 'vk' || body.provider === 'yandex' ? body.provider : null
    const token = String(body.accessToken ?? '')
    if (!provider || !token) return json(res, 400, { error: 'Нет токена' })
    const info = await verifyProviderToken(provider, token).catch(() => null)
    if (!info) return json(res, 401, { error: 'Провайдер не подтвердил вход' })
    let u = db.prepare('SELECT * FROM users WHERE provider_id = ?').get(info.providerId)
    if (u) {
      // Имя и аватар могли смениться у провайдера — обновляем, но свой
      // загруженный аватар (data:) не затираем.
      db.prepare('UPDATE users SET display_name = ?, avatar_url = CASE WHEN avatar_url LIKE ? THEN avatar_url ELSE ? END WHERE id = ?')
        .run(info.displayName ?? u.display_name, 'data:%', info.avatarUrl ?? u.avatar_url, u.id)
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)
    } else {
      const ins = db
        .prepare('INSERT INTO users (provider, provider_id, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(provider, info.providerId, info.displayName, info.avatarUrl, now())
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(ins.lastInsertRowid)
    }
    startSession(res, u.id)
    json(res, 200, { user: publicUser(u) })
  },

  'POST /api/logout': async (req, res) => {
    const token = readCookies(req).cozy_sid
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
    res.setHeader('Set-Cookie', 'cozy_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
    json(res, 200, {})
  },

  'GET /api/me': async (req, res) => {
    const u = sessionUser(req)
    json(res, 200, { user: u ? publicUser(u) : null })
  },

  'POST /api/avatar': async (req, res, body) => {
    const u = sessionUser(req)
    if (!u) return json(res, 401, { error: 'Нужен вход' })
    const dataUrl = String(body.dataUrl ?? '')
    // Только растровый data:URL в base64. SVG исключаем осознанно: он умеет
    // нести скрипт, а аватар потом попадает в разметку профиля. Клиент и так
    // шлёт canvas.toDataURL('image/jpeg') — под это условие он подходит.
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl) || dataUrl.length > MAX_AVATAR)
      return json(res, 400, { error: 'Картинка не подошла' })
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(dataUrl, u.id)
    json(res, 200, { user: publicUser({ ...u, avatar_url: dataUrl }) })
  },

  'GET /api/save': async (req, res) => {
    const u = sessionUser(req)
    if (!u) return json(res, 401, { error: 'Нужен вход' })
    const row = db.prepare('SELECT data, updated_at FROM saves WHERE user_id = ?').get(u.id)
    json(res, 200, row ? { save: JSON.parse(row.data), updatedAt: row.updated_at } : { save: null })
  },

  'PUT /api/save': async (req, res, body) => {
    const u = sessionUser(req)
    if (!u) return json(res, 401, { error: 'Нужен вход' })
    // Сейв — реплей от сида (§4 дока): {seed, suits, moves}. Валидируем
    // форму, а не правила: сервер не обязан уметь играть в пасьянс.
    if (typeof body.seed !== 'number' || !Array.isArray(body.moves)) return json(res, 400, { error: 'Не сейв' })
    db.prepare(
      `INSERT INTO saves (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(u.id, JSON.stringify(body), now())
    json(res, 200, {})
  },

  'GET /api/entitlements': async (req, res) => {
    const u = sessionUser(req)
    const skus = u
      ? db.prepare('SELECT sku FROM entitlements WHERE user_id = ?').all(u.id).map((r) => r.sku)
      : []
    json(res, 200, { skus: [...new Set([...FREE_SKUS, ...skus])] })
  },

  'POST /api/purchase': async (req, res, body) => {
    const u = sessionUser(req)
    if (!u) return json(res, 401, { error: 'Нужен вход' })
    if (!ykEnabled) return json(res, 503, { error: 'Оплата ещё не подключена' })
    if (rateLimited(clientIp(req))) return json(res, 429, { error: 'Слишком много попыток — позже' })
    const sku = catalogSku(String(body.sku ?? ''))
    if (!sku || !(sku.price > 0)) return json(res, 400, { error: 'Нет такого товара' })
    if (db.prepare('SELECT 1 FROM entitlements WHERE user_id = ? AND sku = ?').get(u.id, sku.id))
      return json(res, 409, { error: 'Уже куплено' })
    const payment = await ykFetch(
      'POST',
      '/payments',
      {
        amount: { value: sku.price.toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: `${SITE}/?purchase=1` },
        description: `${sku.title} — пасьянс «Паук»`.slice(0, 128),
        metadata: { userId: String(u.id), sku: sku.id },
      },
      randomUUID(),
    )
    db.prepare(
      'INSERT INTO payments (id, user_id, sku, amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(payment.id, u.id, sku.id, payment.amount.value, payment.status, now(), now())
    json(res, 200, { confirmationUrl: payment.confirmation?.confirmation_url })
  },

  /**
   * Возврат со страницы оплаты и страховка от потерянного вебхука:
   * перепроверяем незавершённые платежи игрока прямо у ЮKassa.
   */
  'POST /api/purchase/sync': async (req, res) => {
    const u = sessionUser(req)
    if (!u) return json(res, 401, { error: 'Нужен вход' })
    const granted = []
    let pending = 0
    if (ykEnabled) {
      const rows = db
        .prepare(
          `SELECT id, sku FROM payments
           WHERE user_id = ? AND status NOT IN ('succeeded', 'canceled') AND created_at > ?`,
        )
        .all(u.id, now() - 86400)
      for (const row of rows) {
        const p = await ykFetch('GET', `/payments/${row.id}`).catch(() => null)
        if (!p) continue
        if (p.status === 'succeeded') {
          settlePayment(row.id, 'succeeded')
          granted.push(row.sku)
        } else if (p.status === 'canceled') {
          settlePayment(row.id, 'canceled')
        } else {
          pending += 1
        }
      }
    }
    json(res, 200, { granted, pending })
  },

  /**
   * Вебхук ЮKassa. Телу не верим совсем: из него берётся только id, а
   * статус спрашивается у самой ЮKassa по нашему ключу — подделка
   * уведомления ничего не даёт. Незнакомый id — 200, чтобы не ретраила.
   */
  'POST /api/yookassa/webhook': async (req, res, body) => {
    const id = String(body?.object?.id ?? '')
    const known = id && db.prepare('SELECT 1 FROM payments WHERE id = ?').get(id)
    if (!known || !ykEnabled) return json(res, 200, {})
    const p = await ykFetch('GET', `/payments/${id}`)
    if (p.status === 'succeeded' || p.status === 'canceled') settlePayment(id, p.status)
    json(res, 200, {})
  },
}

// ---------------------------------------------------------------- сервер

createServer(async (req, res) => {
  const key = `${req.method} ${new URL(req.url, 'http://x').pathname}`
  const route = routes[key]
  if (!route) return json(res, 404, { error: 'Нет такой ручки' })
  try {
    // Мутирующие ручки принимают только JSON: заодно это и CSRF-барьер —
    // кросс-сайтовая форма не умеет Content-Type: application/json.
    let body = {}
    if (req.method !== 'GET') {
      if (!(req.headers['content-type'] ?? '').includes('application/json'))
        return json(res, 415, { error: 'Только JSON' })
      body = await readBody(req)
    }
    await route(req, res, body)
  } catch (e) {
    json(res, 500, { error: 'Сервер оступился' })
    console.error(key, e)
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`cozy-api on 127.0.0.1:${PORT}, db: ${DB_PATH}`)
})
