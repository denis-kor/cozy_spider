import { track } from '../track'
import type { PlatformAdapter, PurchaseResult, SavedGame, Sku, User } from './types'

/**
 * Локальная платформа: бэкенда нет, и это осознанный этап (§11, шаг 5).
 *
 * Игра без регистрации не подпадает под 152-ФЗ вообще: ноль ПД, ноль
 * юридики, запуск за день. Аккаунты и настоящая ЮKassa придут отдельной
 * реализацией этого же интерфейса, когда будут самозанятость, VPS в РФ и
 * онбординг в кассе.
 *
 * `purchase` — fake-door: записывает намерение и честно отвечает, что
 * товара ещё нет. Ни формы оплаты, ни реквизитов — только счётчик.
 */

export const ENTITLEMENTS_KEY = 'cozy.entitlements'
const SAVE_KEY = 'cozy.save'

/** Что доступно всем без покупки. Стартовая сцена — витрина качества. */
const FREE: Sku[] = ['pack.pond', 'deck.pond']

export class LocalAdapter implements PlatformAdapter {
  private entitlements = new Set<Sku>(FREE)

  async init(): Promise<void> {
    try {
      const stored = JSON.parse(localStorage.getItem(ENTITLEMENTS_KEY) ?? '[]') as Sku[]
      for (const sku of stored) this.entitlements.add(sku)
    } catch {
      // Битый JSON в сторадже — начинаем с бесплатного набора.
    }
  }

  async getUser(): Promise<User | null> {
    return null
  }

  async signIn(_provider: 'vk' | 'yandex' | 'email'): Promise<User> {
    // Не заглушка «потом сделаем», а контракт: локальная платформа
    // принципиально анонимна. UI не должен показывать кнопку входа,
    // пока адаптер не сменится на серверный.
    throw new Error('Аккаунты появятся вместе с бэкендом')
  }

  async signOut(): Promise<void> {
    // Анонимной платформе не из чего выходить.
  }

  async getEntitlements(): Promise<Set<Sku>> {
    return new Set(this.entitlements)
  }

  async purchase(sku: Sku): Promise<PurchaseResult> {
    track('shop_buy_click', { sku })
    return { status: 'unavailable' }
  }

  async loadSave(): Promise<SavedGame | null> {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      return raw ? (JSON.parse(raw) as SavedGame) : null
    } catch {
      return null
    }
  }

  async saveGame(save: SavedGame): Promise<void> {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    } catch {
      // Нет места или приватный режим: игра продолжает жить без сейва.
    }
  }

  getLocale(): string {
    return navigator.language.startsWith('ru') ? 'ru' : 'en'
  }
}
