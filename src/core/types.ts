/**
 * Типы логики пасьянса.
 *
 * Здесь и во всём core/ — ноль импортов DOM, Pixi и сети (§4 дока).
 * Всё, что отсюда выходит наружу, — данные и семантические события;
 * что с ними делает рендер, логику не касается.
 */

export type Suit = 'S' | 'H' | 'D' | 'C'

/** 1 = туз, 13 = король. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13

/** Сколько мастей в раскладе. Классический «Паук» — 4, лёгкий — 1. */
export type SuitCount = 1 | 2 | 4

export interface Card {
  /** Стабильный идентификатор внутри раздачи. Рендер держит спрайты по нему. */
  id: number
  suit: Suit
  rank: Rank
  faceUp: boolean
}

export interface GameState {
  /** 10 колонок стола. */
  tableau: Card[][]
  /** Запас: раздаётся по 10 карт за раз, всего 5 раздач. */
  stock: Card[][]
  /** Собранные последовательности K..A. Победа — когда их 8. */
  foundations: Card[][]
  moves: number
  score: number
}

export type Move =
  | { t: 'move'; from: number; to: number; count: number }
  | { t: 'deal' }

/**
 * Семантические события хода. Логика их порождает мгновенно, рендер
 * превращает в таймлайны и складывает в очередь.
 *
 * Это и есть граница из §4: логика не ждёт анимацию.
 */
export type GameEvent =
  | { t: 'cardsMoved'; cards: number[]; from: number; to: number }
  | { t: 'cardFlipped'; card: number; column: number }
  | { t: 'dealt'; cards: number[]; columns: number[] }
  | { t: 'runCompleted'; cards: number[]; column: number; suit: Suit }
  | { t: 'won' }

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C']

export const COLUMNS = 10

/** Красная масть — только для отрисовки; правилам «Паука» цвет безразличен. */
export function isRed(suit: Suit): boolean {
  return suit === 'H' || suit === 'D'
}

export const RANK_LABELS_EN: Record<Rank, string> = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
}

/**
 * Русская традиция: В / Д / К / Т (§6 дока). Это не строка в i18n, а
 * отдельный набор глифов — но подпись рангов держим здесь, чтобы атлас
 * умел собираться под локаль с самого начала.
 */
export const RANK_LABELS_RU: Record<Rank, string> = {
  1: 'Т', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'В', 12: 'Д', 13: 'К',
}
