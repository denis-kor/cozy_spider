import { track } from '../track'
import { LocalAdapter } from './local'
import { beginSignIn, completeSignIn, isConfigured } from './oauth'
import type { PurchaseResult, SavedGame, Sku, TrialInfo, User } from './types'

/**
 * Серверная платформа: аккаунты, аватары, энтайтлменты и сейвы живут в
 * `server/index.mjs` за nginx на том же домене (`/api/`), сессия — в
 * httpOnly-куке, поэтому здесь про неё ни строчки.
 *
 * Деградирует изящно: без сети или без сессии ведёт себя как LocalAdapter —
 * игра обязана играться и в самолёте. Последний известный профиль лежит в
 * localStorage, чтобы поприветствовать игрока мгновенно и офлайн.
 *
 * OAuth-редиректы остаются клиентскими (`oauth.ts`), но добытый токен
 * уезжает на сервер, и тот сам спрашивает провайдера, чей это токен, —
 * фронтовым данным сервер не верит.
 */

const USER_KEY = 'cozy.user'

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Сервер ответил ${res.status}`)
  return data
}

export class ServerAdapter extends LocalAdapter {
  private user: User | null = null
  /** Триал из последнего /api/entitlements — лавка читает его синхронно. */
  private trial: TrialInfo | null = null

  async init(): Promise<void> {
    await super.init()

    try {
      this.user = JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null
    } catch {
      this.user = null
    }

    // Страницу могло только что вернуть с редиректа провайдера: токен —
    // на сервер, сервер заводит или находит аккаунт и ставит сессию.
    const fresh = await completeSignIn().catch(() => null)
    if (fresh) {
      try {
        const r = await api<{ user: User }>('POST', '/api/oauth', {
          provider: fresh.provider,
          accessToken: fresh.accessToken,
        })
        this.remember(r.user)
        // Пара к signin_click: воронка «нажал → реально вошёл».
        track('signin_done', { provider: fresh.provider })
        return
      } catch {
        // Сервер лёг в самый неудачный момент — хотя бы поприветствуем
        // локально, сессии не будет до следующего входа.
        this.remember({ id: fresh.id, displayName: fresh.displayName, avatarUrl: fresh.avatarUrl })
        return
      }
    }

    // Обычный запуск: спрашиваем сервер, кто мы. Молча — офлайн не ошибка.
    try {
      const me = await api<{ user: User | null }>('GET', '/api/me')
      this.remember(me.user)
    } catch {
      // Остаёмся с кешированным профилем: сессия проверится в другой раз.
    }
  }

  private remember(user: User | null): void {
    this.user = user
    try {
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
      else localStorage.removeItem(USER_KEY)
    } catch {
      // Без localStorage профиль проживёт до перезагрузки — не страшно.
    }
  }

  async getUser(): Promise<User | null> {
    return this.user
  }

  async signIn(provider: 'vk' | 'yandex' | 'email'): Promise<User> {
    if (provider === 'email' || !isConfigured(provider)) {
      // Почта идёт через emailLogin/emailRegister, не сюда.
      throw new Error('Вход через этого провайдера ещё не подключён')
    }
    await beginSignIn(provider)
    // Страница уходит на провайдера; промису некому резолвиться.
    return new Promise<User>(() => {})
  }

  async emailRegister(email: string, password: string): Promise<User> {
    const r = await api<{ user: User }>('POST', '/api/register', { email, password })
    this.remember(r.user)
    track('signin_done', { provider: 'email' })
    return r.user
  }

  async emailLogin(email: string, password: string): Promise<User> {
    const r = await api<{ user: User }>('POST', '/api/login', { email, password })
    this.remember(r.user)
    track('signin_done', { provider: 'email' })
    return r.user
  }

  async requestPasswordReset(email: string): Promise<void> {
    await api('POST', '/api/reset/request', { email })
  }

  async confirmPasswordReset(token: string, password: string): Promise<User> {
    const r = await api<{ user: User }>('POST', '/api/reset/confirm', { token, password })
    this.remember(r.user)
    return r.user
  }

  async confirmEmail(token: string): Promise<void> {
    await api('POST', '/api/confirm', { token })
    if (this.user) this.remember({ ...this.user, emailVerified: true })
  }

  async resendConfirmEmail(): Promise<void> {
    await api('POST', '/api/confirm/resend', {})
  }

  async signOut(): Promise<void> {
    this.remember(null)
    await api('POST', '/api/logout', {}).catch(() => {
      // Кука умрёт по сроку, локально мы уже вышли.
    })
  }

  async setAvatar(dataUrl: string): Promise<User | null> {
    if (!this.user) return null
    try {
      const r = await api<{ user: User }>('POST', '/api/avatar', { dataUrl })
      this.remember(r.user)
    } catch {
      // Сервер недоступен — аватар хотя бы локально, до синка руки дойдут.
      this.remember({ ...this.user, avatarUrl: dataUrl })
    }
    return this.user
  }

  async purchase(sku: Sku): Promise<PurchaseResult> {
    // Метрика клика остаётся той же, что была у fake-door: воронка
    // «нажал → ушёл на кассу → оплатил» сравнима с историей.
    track('shop_buy_click', { sku })
    if (!this.user) return { status: 'signin-required' }
    try {
      const r = await api<{ confirmationUrl: string }>('POST', '/api/purchase', { sku })
      track('purchase_start', { sku })
      location.href = r.confirmationUrl
      // Страница уходит на кассу; промису некому резолвиться.
      return new Promise<PurchaseResult>(() => {})
    } catch {
      // Ключей на сервере ещё нет (503) или сеть упала — честный fake-door.
      return { status: 'unavailable' }
    }
  }

  async syncPurchases(): Promise<{ granted: Sku[]; pending: number }> {
    return api('POST', '/api/purchase/sync', {})
  }

  async getEntitlements(): Promise<Set<Sku>> {
    const local = await super.getEntitlements()
    try {
      const r = await api<{ skus: Sku[]; trial?: TrialInfo | null }>('GET', '/api/entitlements')
      for (const sku of r.skus) local.add(sku)
      this.trial = r.trial ?? null
    } catch {
      // Офлайн: остаёмся на локальном списке. Триал сбрасываем — по
      // устаревшему кешу нельзя рисовать «бесплатно ещё N мин» над кнопкой
      // «Купить»: в local триальных sku уже нет, инвариант onTrial⇒usable
      // сломался бы. Инвариант: триал не null только при удачном запросе.
      this.trial = null
    }
    return local
  }

  getTrial(): TrialInfo | null {
    return this.trial
  }

  async loadSave(): Promise<SavedGame | null> {
    if (this.user) {
      try {
        const r = await api<{ save: SavedGame | null }>('GET', '/api/save')
        if (r.save) return r.save
      } catch {
        // Падаем на локальный сейв ниже.
      }
    }
    return super.loadSave()
  }

  async saveGame(save: SavedGame): Promise<void> {
    // Локально — всегда: это и офлайн-режим, и страховка от падения сети.
    await super.saveGame(save)
    if (this.user) void api('PUT', '/api/save', save).catch(() => {})
  }
}
