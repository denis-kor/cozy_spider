/**
 * OAuth-входы, работающие без своего бэкенда.
 *
 * Оба провайдера официально поддерживают чисто клиентские приложения:
 * - VK ID — OAuth 2.1 с PKCE: секрета нет, код обменивается на токен
 *   прямо из браузера (это же делает их официальный SDK, CORS открыт);
 * - Яндекс — implicit flow: токен приходит в #фрагменте редиректа.
 *
 * Токены никуда не сохраняются: они нужны один раз, чтобы получить id и
 * имя. Облачных сохранений это не даёт — они по-прежнему ждут бэкенда, —
 * но даёт настоящую личность и честную метрику «сколько людей реально
 * доходит до конца входа», а не «сколько ткнуло в кнопку».
 *
 * Подключение: зарегистрировать приложения и вписать ID ниже.
 * - VK ID: id.vk.com/about/business → создать приложение Web,
 *   в «Доверенный redirect URL» добавить адрес игры (и http://localhost:5173
 *   для дева). Сюда — App ID.
 * - Яндекс: oauth.yandex.ru → создать приложение, платформа
 *   «Веб-сервисы», Redirect URI — адрес игры, доступ «Доступ к логину,
 *   имени и фамилии». Сюда — ClientID.
 *
 * Пока ID не вписаны, кнопки остаются fake-door: клик считается, вход
 * честно отвечает, что ещё не готов. Игра обязана работать без этого
 * файла заполненным — тот же принцип, что с артом.
 */

export const VK_APP_ID: number = 54746677
export const YANDEX_CLIENT_ID: string = '05f467cebe9b43fdaf5e169b0599c404'

export type OAuthProvider = 'vk' | 'yandex'

export interface OAuthUser {
  id: string
  displayName?: string
  avatarUrl?: string
  provider: OAuthProvider
  /** Токен провайдера: бэкенд перепроверяет им вход на своей стороне. */
  accessToken: string
}

export function isConfigured(provider: OAuthProvider): boolean {
  return provider === 'vk' ? VK_APP_ID > 0 : YANDEX_CLIENT_ID !== ''
}

/**
 * Redirect URI должен побайтово совпадать с зарегистрированным у
 * провайдера. Origin + pathname без query и hash: игра живёт на корне.
 */
function redirectUri(): string {
  return location.origin + location.pathname
}

/** Что положили в sessionStorage перед уходом на провайдера. */
interface PendingAuth {
  provider: OAuthProvider
  state: string
  /** PKCE code_verifier — только у VK. */
  verifier?: string
}

const PENDING_KEY = 'cozy.auth.pending'

function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return base64url(buf)
}

function base64url(buf: Uint8Array | ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(buf))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(digest)
}

/** Уводит страницу на провайдера. Обратно она вернётся через редирект. */
export async function beginSignIn(provider: OAuthProvider): Promise<void> {
  const state = randomToken(16)

  if (provider === 'vk') {
    const verifier = randomToken(48)
    const pending: PendingAuth = { provider, state, verifier }
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))

    const u = new URL('https://id.vk.com/authorize')
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', String(VK_APP_ID))
    u.searchParams.set('redirect_uri', redirectUri())
    u.searchParams.set('state', state)
    u.searchParams.set('code_challenge', await s256(verifier))
    u.searchParams.set('code_challenge_method', 'S256')
    location.assign(u.toString())
    return
  }

  const pending: PendingAuth = { provider, state }
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))

  const u = new URL('https://oauth.yandex.ru/authorize')
  u.searchParams.set('response_type', 'token')
  u.searchParams.set('client_id', YANDEX_CLIENT_ID)
  u.searchParams.set('redirect_uri', redirectUri())
  u.searchParams.set('state', state)
  location.assign(u.toString())
}

/**
 * Вызывается один раз при старте. Если страницу только что вернуло от
 * провайдера — доводит вход до конца и отдаёт пользователя, иначе null.
 * Параметры OAuth из адресной строки вычищает в любом исходе.
 */
export async function completeSignIn(): Promise<OAuthUser | null> {
  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) return null
  sessionStorage.removeItem(PENDING_KEY)

  let pending: PendingAuth
  try {
    pending = JSON.parse(raw) as PendingAuth
  } catch {
    return null
  }

  try {
    return pending.provider === 'vk' ? await completeVk(pending) : await completeYandex(pending)
  } finally {
    // Код и токен в адресной строке не должны пережить вход: утекут в
    // историю браузера и в скриншоты.
    history.replaceState(null, '', location.pathname)
  }
}

async function completeVk(pending: PendingAuth): Promise<OAuthUser | null> {
  const q = new URLSearchParams(location.search)
  const code = q.get('code')
  const deviceId = q.get('device_id')
  if (!code || !deviceId || q.get('state') !== pending.state || !pending.verifier) return null

  const res = await fetch('https://id.vk.com/oauth2/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: pending.verifier,
      client_id: String(VK_APP_ID),
      device_id: deviceId,
      redirect_uri: redirectUri(),
      state: pending.state,
    }),
  })
  const data = (await res.json()) as { access_token?: string; user_id?: number }
  if (!data.access_token || !data.user_id) return null

  // Имя и аватар — украшение, а не условие: если запрос не прошёл, вход
  // всё равно состоялся, поприветствуем без них.
  let displayName: string | undefined
  let avatarUrl: string | undefined
  try {
    const info = await fetch('https://id.vk.com/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: data.access_token,
        client_id: String(VK_APP_ID),
      }),
    })
    const payload = (await info.json()) as { user?: { first_name?: string; avatar?: string } }
    displayName = payload.user?.first_name || undefined
    avatarUrl = payload.user?.avatar || undefined
  } catch {
    // Ладно, будет безымянным.
  }

  return { id: `vk:${data.user_id}`, displayName, avatarUrl, provider: 'vk', accessToken: data.access_token }
}

async function completeYandex(pending: PendingAuth): Promise<OAuthUser | null> {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''))
  const token = h.get('access_token')
  if (!token || h.get('state') !== pending.state) return null

  const res = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${token}` },
  })
  const info = (await res.json()) as {
    id?: string
    display_name?: string
    real_name?: string
    login?: string
    default_avatar_id?: string
    is_avatar_empty?: boolean
  }
  if (!info.id) return null

  return {
    id: `ya:${info.id}`,
    displayName: info.display_name || info.real_name || info.login || undefined,
    avatarUrl:
      info.default_avatar_id && !info.is_avatar_empty
        ? `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-200`
        : undefined,
    provider: 'yandex',
    accessToken: token,
  }
}
