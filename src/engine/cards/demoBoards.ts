import { COLUMNS, type Card, type GameState, type Rank, type Suit } from '../../core/types'

/**
 * Подготовленные расклады для съёмки совета «чужак у дна ✅ / в середине ❌»
 * (вызов клавишами 1 и 2, см. main.ts). Снимать контраст не по воле рандома.
 *
 * Собираем руками из полной колоды 4 мастей (104 карты, каждый id ровно
 * один раз), чтобы рендер `CardTable` отработал как с обычной раздачей:
 * спрайты он строит лениво по `card.id`. В историю ходов это не пишется
 * (см. `Game.fromState`): расклад демонстрационный.
 *
 * Ключевая деталь для ролика — колонка-ЦЕЛЬ с открытой дамой Q♦ рядом:
 *  • bottom — валет на верхушке подвижного ряда, ложится на даму → КЛАСТЬ
 *    МОЖНО (✅);
 *  • middle — валет замурован под чужой девяткой, подвижны лишь 8..5, к даме
 *    не подходят → КЛАСТЬ НЕЛЬЗЯ (❌).
 * Пустых колонок не оставляем и открытых девяток не выставляем: иначе у
 * варианта ❌ появился бы обходной ход и разница «можно/нельзя» пропала бы.
 */
export type DemoKind = 'bottom' | 'middle'

/** Демо-колонка и цель ставятся по центру, рядом — для чистого перетаскивания. */
const DEMO_COL = 4
const TARGET_COL = 5

/** Стартовый счёт как в rules.ts (START_SCORE) — держим независимо. */
const START_SCORE = 500

export function buildDemoBoard(kind: DemoKind): GameState {
  const suits: Suit[] = ['S', 'H', 'D', 'C']
  const deck: Card[] = []
  let id = 0
  for (const suit of suits)
    for (let copy = 0; copy < 2; copy++)
      for (let rank = 1; rank <= 13; rank++)
        deck.push({ id: id++, suit, rank: rank as Rank, faceUp: false })

  // Вынуть конкретную карту из колоды (первую копию).
  const take = (suit: Suit, rank: Rank, faceUp = true): Card => {
    const i = deck.findIndex((c) => c.suit === suit && c.rank === rank)
    const card = deck.splice(i, 1)[0]
    card.faceUp = faceUp
    return card
  }

  // Демо-колонка: одномастный ряд K..5 пик с одним «чужаком» червой.
  //  bottom — чужак у самого дна (Q♥ рядом с королём): подвижен ряд J..5,
  //           валет на верхушке.
  //  middle — чужак в середине (9♥): валет замурован, подвижны лишь 8..5.
  const foreignRank: Rank = kind === 'bottom' ? 12 : 9
  const demo: Card[] = []
  for (let rank = 13; rank >= 5; rank--) {
    const suit: Suit = rank === foreignRank ? 'H' : 'S'
    demo.push(take(suit, rank as Rank))
  }

  // Колонка-цель: открытая дама. На неё ложится валет — но дотянется он
  // только в варианте bottom.
  const target: Card[] = [take('D', 12)]

  const tableau: Card[][] = Array.from({ length: COLUMNS }, () => [])
  tableau[DEMO_COL] = demo
  tableau[TARGET_COL] = target

  // Прочие карты — по остальным колонкам (по чуть-чуть, верхняя открыта).
  // Пустых колонок нет; открытую девятку наверх не пускаем, чтобы у ❌ не
  // было обходного хода восьмёркой.
  const others: number[] = []
  for (let c = 0; c < COLUMNS; c++)
    if (c !== DEMO_COL && c !== TARGET_COL) others.push(c)

  const perCol = 4
  for (const col of others)
    for (let k = 0; k < perCol && deck.length > 0; k++) {
      const top = k === perCol - 1
      let idx = 0
      if (top) {
        // верхняя открытая карта — любая, кроме девятки
        const j = deck.findIndex((c) => c.rank !== 9)
        idx = j < 0 ? 0 : j
      }
      const card = deck.splice(idx, 1)[0]
      card.faceUp = top
      tableau[col].push(card)
    }

  const stock: Card[][] = []
  while (deck.length > 0) {
    const row = deck.splice(0, COLUMNS)
    for (const c of row) c.faceUp = false
    stock.push(row)
  }

  return { tableau, stock, foundations: [], moves: 0, score: START_SCORE }
}
