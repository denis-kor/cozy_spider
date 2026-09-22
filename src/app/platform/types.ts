import type { Move, SuitCount } from '../../core/types'

/**
 * PlatformAdapter (§4 дока) — граница между игрой и «внешним миром»:
 * аккаунты, покупки, сохранения.
 *
 * Интерфейс существует с одной реализацией намеренно. Сегодня за ним
 * localStorage и fake-door витрина, завтра — VPS с ЮKassa, послезавтра —
 * Paddle для Европы. Игра и HUD об этой разнице не узнают.
 */

export interface User {
  id: string
  /**
   * Имя — только для приветствия. На сервере (когда появится) его не
   * храним (§9: минимизация ПД); локальная копия на устройстве игрока —
   * его собственная.
   */
  displayName?: string
  /** Аватар: URL у провайдера или data-URI своей картинки. */
  avatarUrl?: string
  /** Только у почтовых учёток: false, пока письмо не подтверждено. */
  emailVerified?: boolean
}

/** Идентификатор товара, например `pack.winter-cabin`. Прайс — данными. */
export type Sku = string

/**
 * Приветственный триал: sku, открытые новому аккаунту на время, и unix-
 * секунды, когда доступ гаснет. Не покупка — по истечении сервер просто
 * перестаёт отдавать эти sku, и applied-пак молча падает на бесплатный.
 */
export interface TrialInfo {
  skus: Sku[]
  until: number
}

export type PurchaseResult =
  /** Куплено и энтайтлмент выдан. */
  | { status: 'ok' }
  /** Игрок передумал на форме оплаты. */
  | { status: 'cancelled' }
  /**
   * Товар нельзя купить прямо сейчас. Так отвечает fake-door витрина:
   * намерение записано, денег не взяли.
   */
  | { status: 'unavailable' }
  /** Покупка привязывается к аккаунту — сначала нужно войти. */
  | { status: 'signin-required' }

/** Сохранение — реплей от сида (§4): пара килобайт, а не снимок стола. */
export interface SavedGame {
  seed: number
  suits: SuitCount
  moves: Move[]
}

export interface PlatformAdapter {
  init(): Promise<void>
  getUser(): Promise<User | null>
  signIn(provider: 'vk' | 'yandex' | 'email'): Promise<User>
  signOut(): Promise<void>
  /** Сменить аватар. Опционален: анонимной платформе он ни к чему. */
  setAvatar?(dataUrl: string): Promise<User | null>
  /**
   * Почтовые учётки. Опциональны: пока адаптер их не умеет, форма почты
   * работает как fake-door и только считает интерес.
   */
  emailRegister?(email: string, password: string): Promise<User>
  emailLogin?(email: string, password: string): Promise<User>
  /** Письмо со ссылкой на смену пароля. Ответ одинаков для любой почты. */
  requestPasswordReset?(email: string): Promise<void>
  /** Новый пароль по токену из письма; заодно входит. */
  confirmPasswordReset?(token: string, password: string): Promise<User>
  /** Подтверждение почты по токену из письма. */
  confirmEmail?(token: string): Promise<void>
  resendConfirmEmail?(): Promise<void>
  getEntitlements(): Promise<Set<Sku>>
  /**
   * Активный приветственный триал из последнего ответа getEntitlements
   * (или null). Синхронный: читает кеш, поэтому зовётся ПОСЛЕ
   * getEntitlements. Опционален: анонимной платформе триал ни к чему.
   */
  getTrial?(): TrialInfo | null
  purchase(sku: Sku): Promise<PurchaseResult>
  /**
   * Перепроверить незавершённые платежи (возврат со страницы оплаты,
   * опоздавший вебхук). Опционален: локальной платформе нечего сверять.
   */
  syncPurchases?(): Promise<{ granted: Sku[]; pending: number }>
  loadSave(): Promise<SavedGame | null>
  saveGame(save: SavedGame): Promise<void>
  getLocale(): string
}
