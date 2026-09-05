import type { Sku } from './platform/types'

/**
 * Применённые паки (§ PAID-PACKS): выбор живёт в localStorage, смена —
 * перезагрузкой страницы. Пасьянс — не шутер: reload при смене декораций
 * простительна, а горячая смена сцены — это выгрузка всех текстур Pixi,
 * не стоящая своих денег.
 *
 * `main.ts` читает выбор ДО инициализации сцены, сверяет с энтайтлментами
 * и молча падает на бесплатное, если права нет: localStorage правится
 * руками в две секунды, и это не должно открывать платный контент.
 */

const SCENE_KEY = 'cozy.pack.scene'
const DECK_KEY = 'cozy.pack.deck'

/** Что доступно без покупки. Дублирует прайс намеренно: выбор пака должен
 *  работать до сети и без каталога. */
const FREE_SCENE: Sku = 'pack.pond'
const FREE_DECK: Sku = 'deck.pond'

/** Sku сцены -> папка ассетов. Конвенция: `pack.<имя>` -> scene/<имя>. */
export function sceneUrlFor(sku: Sku): string {
  return `/assets/scene/${sku.replace(/^pack\./, '')}`
}

/** Sku колоды -> папка. Базовая колода исторически живёт в /assets/deck. */
export function deckUrlFor(sku: Sku): string {
  const name = sku.replace(/^deck\./, '')
  return name === 'pond' ? '/assets/deck' : `/assets/deck-${name}`
}

function read(key: string): Sku | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function appliedScene(): Sku {
  return read(SCENE_KEY) ?? FREE_SCENE
}

export function appliedDeck(): Sku {
  return read(DECK_KEY) ?? FREE_DECK
}

/** Применить пак. Вступает в силу после перезагрузки — её делает вызывающий. */
export function applyPack(kind: 'scene' | 'deck', sku: Sku): void {
  try {
    localStorage.setItem(kind === 'scene' ? SCENE_KEY : DECK_KEY, sku)
  } catch {
    // Без localStorage выбор не переживёт перезагрузку — и не страшно.
  }
}

export function isApplied(kind: 'scene' | 'deck', sku: Sku): boolean {
  return (kind === 'scene' ? appliedScene() : appliedDeck()) === sku
}

/**
 * Выбор игрока, сверенный с правами. Нет права — бесплатный набор:
 * молча, потому что честный сценарий здесь один — энтайтлмент истёк или
 * приехал с другого аккаунта, и игра обязана запуститься, а не спорить.
 */
export function resolvePacks(owned: Set<Sku>): { sceneUrl: string; deckUrl: string } {
  const scene = appliedScene()
  const deck = appliedDeck()
  return {
    sceneUrl: sceneUrlFor(scene === FREE_SCENE || owned.has(scene) ? scene : FREE_SCENE),
    deckUrl: deckUrlFor(deck === FREE_DECK || owned.has(deck) ? deck : FREE_DECK),
  }
}
