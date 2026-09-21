import { mulberry32, shuffle } from './rng'
import {
  COLUMNS,
  SUITS,
  type Card,
  type GameEvent,
  type GameState,
  type Move,
  type Rank,
  type SuitCount,
} from './types'

/** Стартовый счёт. Каждый ход −1, каждая собранная последовательность +100. */
const START_SCORE = 500
const RUN_BONUS = 100

/**
 * Колода «Паука»: всегда 104 карты, меняется только число мастей.
 * 1 масть — 8 повторов A..K, 2 масти — по 4, 4 масти — по 2.
 */
function buildDeck(suits: SuitCount): Card[] {
  const copies = 8 / suits
  const cards: Card[] = []
  let id = 0

  for (let s = 0; s < suits; s++) {
    for (let c = 0; c < copies; c++) {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ id: id++, suit: SUITS[s], rank: rank as Rank, faceUp: false })
      }
    }
  }
  return cards
}

/**
 * Раздача. 54 карты на стол: первые четыре колонки по 6, остальные по 5.
 * Верхняя в каждой колонке открыта. Оставшиеся 50 — пять раздач по 10.
 */
export function createDeal(seed: number, suits: SuitCount): GameState {
  const deck = shuffle(buildDeck(suits), mulberry32(seed))

  const tableau: Card[][] = Array.from({ length: COLUMNS }, () => [])
  let i = 0
  for (let col = 0; col < COLUMNS; col++) {
    const count = col < 4 ? 6 : 5
    for (let k = 0; k < count; k++) tableau[col].push(deck[i++])
  }
  for (const column of tableau) {
    column[column.length - 1].faceUp = true
  }

  const stock: Card[][] = []
  while (i < deck.length) {
    stock.push(deck.slice(i, i + COLUMNS))
    i += COLUMNS
  }

  return { tableau, stock, foundations: [], moves: 0, score: START_SCORE }
}

/**
 * Длина «хвоста» колонки, который можно взять как единое целое:
 * открытые карты одной масти, идущие строго по убыванию.
 */
export function movableRunLength(column: Card[]): number {
  if (column.length === 0) return 0

  let n = 1
  for (let i = column.length - 1; i > 0; i--) {
    const card = column[i]
    const below = column[i - 1]
    if (!below.faceUp) break
    if (below.suit !== card.suit) break
    if (below.rank !== card.rank + 1) break
    n++
  }
  return n
}

/** Можно ли положить `card` на колонку `target`. Масть при укладке не важна. */
export function canPlace(card: Card, target: Card[]): boolean {
  if (target.length === 0) return true
  const top = target[target.length - 1]
  return top.faceUp && top.rank === card.rank + 1
}

export function isLegal(state: GameState, move: Move): boolean {
  if (move.t === 'deal') {
    // Раздавать из запаса нельзя, пока есть пустая колонка — иначе игрок
    // мгновенно теряет позицию, которую по правилам обязан сначала занять.
    if (state.stock.length === 0) return false
    return state.tableau.every((c) => c.length > 0)
  }

  const { from, to, count } = move
  if (from === to) return false
  if (from < 0 || from >= COLUMNS || to < 0 || to >= COLUMNS) return false

  const source = state.tableau[from]
  if (count <= 0 || count > source.length) return false
  if (count > movableRunLength(source)) return false

  return canPlace(source[source.length - count], state.tableau[to])
}

/** Все допустимые ходы. Нужны для подсказки и для детектора тупика. */
export function getLegalMoves(state: GameState): Move[] {
  const moves: Move[] = []

  for (let from = 0; from < COLUMNS; from++) {
    const run = movableRunLength(state.tableau[from])
    for (let count = 1; count <= run; count++) {
      for (let to = 0; to < COLUMNS; to++) {
        if (isLegal(state, { t: 'move', from, to, count })) {
          moves.push({ t: 'move', from, to, count })
        }
      }
    }
  }

  if (isLegal(state, { t: 'deal' })) moves.push({ t: 'deal' })
  return moves
}

/** Открыть верхнюю карту колонки, если она лежит рубашкой вверх. */
function flipTop(state: GameState, column: number, events: GameEvent[]): void {
  const col = state.tableau[column]
  if (col.length === 0) return
  const top = col[col.length - 1]
  if (top.faceUp) return
  top.faceUp = true
  events.push({ t: 'cardFlipped', card: top.id, column })
}

/**
 * Снять собранную последовательность K..A одной масти.
 *
 * Проверяется после каждого хода и после каждой раздачи: последовательность
 * может сложиться и не тем ходом, которым игрок её задумывал.
 */
function collectRun(state: GameState, column: number, events: GameEvent[]): boolean {
  const col = state.tableau[column]
  if (col.length < 13) return false

  const tail = col.slice(-13)
  if (tail[0].rank !== 13) return false

  for (let i = 0; i < 13; i++) {
    const card = tail[i]
    if (!card.faceUp) return false
    if (card.rank !== 13 - i) return false
    if (card.suit !== tail[0].suit) return false
  }

  col.length -= 13
  state.foundations.push(tail)
  state.score += RUN_BONUS

  events.push({ t: 'runCompleted', cards: tail.map((c) => c.id), column, suit: tail[0].suit })
  flipTop(state, column, events)
  return true
}

/**
 * Применить ход. Мутирует переданное состояние и возвращает события.
 *
 * Бросает на недопустимом ходе: до сюда доходят только проверенные ходы,
 * молчаливое игнорирование прятало бы ошибки в UI.
 */
export function applyMove(state: GameState, move: Move): GameEvent[] {
  if (!isLegal(state, move)) {
    throw new Error(`недопустимый ход: ${JSON.stringify(move)}`)
  }

  const events: GameEvent[] = []

  if (move.t === 'deal') {
    const batch = state.stock.shift()!
    const columns: number[] = []

    batch.forEach((card, i) => {
      card.faceUp = true
      state.tableau[i].push(card)
      columns.push(i)
    })

    state.moves++
    state.score--
    events.push({ t: 'dealt', cards: batch.map((c) => c.id), columns })

    // После раздачи последовательность может сложиться сразу в нескольких
    // колонках — проверяем все, а не только затронутую.
    for (let col = 0; col < COLUMNS; col++) collectRun(state, col, events)
  } else {
    const source = state.tableau[move.from]
    const taken = source.splice(source.length - move.count, move.count)
    state.tableau[move.to].push(...taken)

    state.moves++
    state.score--
    events.push({ t: 'cardsMoved', cards: taken.map((c) => c.id), from: move.from, to: move.to })

    flipTop(state, move.from, events)
    collectRun(state, move.to, events)
  }

  if (state.foundations.length === 8) events.push({ t: 'won' })
  return events
}

/**
 * Оценка полезности хода для подсказки.
 *
 * Легальность и полезность — разные вещи: переложить двойку с тройки на
 * такую же тройку легально, но бессмысленно. Подсказка обязана отличать
 * прогресс от перекладывания ради перекладывания.
 */
function scoreMove(state: GameState, move: Move & { t: 'move' }): number {
  const src = state.tableau[move.from]
  const dst = state.tableau[move.to]
  const moved = src[src.length - move.count]
  const exposed = src[src.length - move.count - 1]
  const top = dst[dst.length - 1]

  let score = 0

  // Продолжаем одномастную последовательность — прямой прогресс к K..A.
  if (top && top.suit === moved.suit) score += 30

  // Вскрывается закрытая карта — новая информация и новые ходы.
  if (exposed && !exposed.faceUp) score += 25

  // Колонка освобождается целиком — пустая ячейка дороже любого хода.
  if (!exposed) score += 20

  // Разрыв уже собранной одномастной связки — шаг назад: то, что
  // собрано, разбирается без выгоды.
  if (exposed && exposed.faceUp && exposed.suit === moved.suit && exposed.rank === moved.rank + 1) {
    score -= 35
  }

  return score
}

/**
 * Лучший ход для подсказки.
 *
 * Возвращает ход только если он даёт настоящий прогресс. Когда полезных
 * перестановок нет — предлагает раздачу, а если и она недоступна, честно
 * возвращает null: плохая подсказка вреднее её отсутствия.
 */
export function bestMove(state: GameState): Move | null {
  let best: Move | null = null
  let bestScore = 0

  for (const move of getLegalMoves(state)) {
    if (move.t !== 'move') continue
    const score = scoreMove(state, move)
    if (score > bestScore) {
      bestScore = score
      best = move
    }
  }

  if (best) return best
  if (isLegal(state, { t: 'deal' })) return { t: 'deal' }
  return null
}

export function isWon(state: GameState): boolean {
  return state.foundations.length === 8
}

/** Тупик: ни одного хода и запас пуст. */
export function isStuck(state: GameState): boolean {
  return !isWon(state) && getLegalMoves(state).length === 0
}

/**
 * Насколько «дружелюбен» расклад для новичка: прогоняем наивного игрока,
 * который всегда делает лучший по подсказке ход (bestMove) и раздаёт, когда
 * полезных ходов нет, и смотрим, как далеко он уходит. Больше — легче.
 *
 * Это дешёвый прокси реальной сложности: честный солвер «Паука» дорог, а
 * жадный автопрогон по 104 крошечным картам считается за доли миллисекунды
 * и хорошо отделяет безнадёжные раздачи от проходибельных.
 */
function greedyProgress(seed: number, suits: SuitCount): number {
  const state = createDeal(seed, suits)
  // Абсолютный предел итераций — страховка от зацикливания жадного выбора.
  for (let guard = 0; guard < 400; guard++) {
    const move = bestMove(state)
    if (!move) break
    applyMove(state, move)
  }

  let buried = 0
  for (const col of state.tableau) for (const c of col) if (!c.faceUp) buried++
  // Собранные связки решают; при равенстве меньше закрытых карт — дружелюбнее.
  return state.foundations.length * 1000 - buried
}

/**
 * Сколько раскладов перебрать при старте партии, по числу мастей. Одно
 * число на масть — вся «сила облегчения». Масти без записи (сейчас только
 * 1) берут обычный случайный сид.
 */
const EASY_ATTEMPTS: Partial<Record<SuitCount, number>> = { 2: 64, 4: 64 }

/**
 * Выбрать сид для новой партии.
 *
 * Для мастей из EASY_ATTEMPTS берём лучший из нескольких кандидатов по
 * greedyProgress — расклад выходит заметно дружелюбнее. Ключевое: сама
 * раздача (createDeal) не меняется, мы лишь выбираем удачное зерно. Поэтому
 * сейвы {seed, suits, moves} и отмена-реплеем продолжают работать как раньше,
 * а на арт это не влияет вовсе.
 */
export function pickEasySeed(suits: SuitCount, rand: () => number = Math.random): number {
  const randSeed = (): number => (rand() * 0x7fffffff) | 0
  const attempts = EASY_ATTEMPTS[suits] ?? 0

  let seed = randSeed()
  if (attempts <= 1) return seed

  let best = greedyProgress(seed, suits)
  for (let i = 1; i < attempts; i++) {
    const candidate = randSeed()
    const score = greedyProgress(candidate, suits)
    if (score > best) {
      best = score
      seed = candidate
    }
  }
  return seed
}
