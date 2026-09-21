import { describe, expect, it } from 'vitest'

import { Game } from './game'
import { dailySeed, mulberry32 } from './rng'
import {
  applyMove,
  bestMove,
  canPlace,
  createDeal,
  getLegalMoves,
  isLegal,
  movableRunLength,
  pickEasySeed,
} from './rules'
import type { Card, GameState, Rank, Suit, SuitCount } from './types'
import { COLUMNS } from './types'

function card(suit: Suit, rank: Rank, faceUp = true, id = 0): Card {
  return { id, suit, rank, faceUp }
}

/** Пустое состояние — колонки заполняем вручную, чтобы проверять правила точечно. */
function blank(): GameState {
  return {
    tableau: Array.from({ length: COLUMNS }, () => []),
    stock: [],
    foundations: [],
    moves: 0,
    score: 500,
  }
}

function countCards(state: GameState): number {
  return (
    state.tableau.reduce((n, c) => n + c.length, 0) +
    state.stock.reduce((n, b) => n + b.length, 0) +
    state.foundations.reduce((n, f) => n + f.length, 0)
  )
}

describe('ГСЧ', () => {
  it('от одного сида даёт одну и ту же последовательность', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('разные сиды расходятся', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('расклад дня зависит только от даты UTC', () => {
    const a = dailySeed(new Date('2026-08-18T00:30:00Z'))
    const b = dailySeed(new Date('2026-08-18T23:30:00Z'))
    const c = dailySeed(new Date('2026-08-19T00:30:00Z'))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('раздача', () => {
  it.each([1, 2, 4] as SuitCount[])('на %i мастях даёт 104 карты', (suits) => {
    expect(countCards(createDeal(777, suits))).toBe(104)
  })

  it('кладёт 54 карты на стол: 6/6/6/6 и 5 в остальные', () => {
    const s = createDeal(1, 4)
    expect(s.tableau.map((c) => c.length)).toEqual([6, 6, 6, 6, 5, 5, 5, 5, 5, 5])
    expect(s.tableau.reduce((n, c) => n + c.length, 0)).toBe(54)
  })

  it('оставляет ровно 5 раздач по 10 карт в запасе', () => {
    const s = createDeal(1, 4)
    expect(s.stock).toHaveLength(5)
    expect(s.stock.every((b) => b.length === COLUMNS)).toBe(true)
  })

  it('открывает только верхнюю карту каждой колонки', () => {
    const s = createDeal(42, 4)
    for (const column of s.tableau) {
      expect(column[column.length - 1].faceUp).toBe(true)
      expect(column.slice(0, -1).every((c) => !c.faceUp)).toBe(true)
    }
  })

  it('на одном сиде воспроизводится карта в карту', () => {
    const a = createDeal(2026, 4)
    const b = createDeal(2026, 4)
    expect(a.tableau).toEqual(b.tableau)
    expect(a.stock).toEqual(b.stock)
  })

  it('на одной масти использует только пики', () => {
    const s = createDeal(5, 1)
    const all = [...s.tableau.flat(), ...s.stock.flat()]
    expect(all.every((c) => c.suit === 'S')).toBe(true)
  })

  it('даёт по 8 карт каждого ранга на одной масти и по 2 на четырёх', () => {
    for (const [suits, perRank] of [[1, 8], [4, 2]] as const) {
      const s = createDeal(9, suits as SuitCount)
      const all = [...s.tableau.flat(), ...s.stock.flat()]
      const aces = all.filter((c) => c.rank === 1)
      expect(aces).toHaveLength(perRank * suits)
    }
  })

  it('раздаёт уникальные id', () => {
    const s = createDeal(3, 4)
    const ids = [...s.tableau.flat(), ...s.stock.flat()].map((c) => c.id)
    expect(new Set(ids).size).toBe(104)
  })
})

describe('подвижная последовательность', () => {
  it('берёт только одну масть подряд по убыванию', () => {
    const col = [card('S', 9, false), card('H', 7), card('H', 6), card('H', 5)]
    expect(movableRunLength(col)).toBe(3)
  })

  it('обрывается на смене масти', () => {
    const col = [card('S', 7), card('H', 6), card('H', 5)]
    expect(movableRunLength(col)).toBe(2)
  })

  it('обрывается на разрыве в рангах', () => {
    const col = [card('H', 9), card('H', 7), card('H', 6)]
    expect(movableRunLength(col)).toBe(2)
  })

  it('не заходит на закрытые карты', () => {
    const col = [card('H', 7, false), card('H', 6), card('H', 5)]
    expect(movableRunLength(col)).toBe(2)
  })

  it('на пустой колонке равна нулю', () => {
    expect(movableRunLength([])).toBe(0)
  })
})

describe('укладка', () => {
  it('пускает любую карту в пустую колонку', () => {
    expect(canPlace(card('S', 1), [])).toBe(true)
    expect(canPlace(card('S', 13), [])).toBe(true)
  })

  it('пускает на карту рангом выше независимо от масти', () => {
    expect(canPlace(card('H', 6), [card('S', 7)])).toBe(true)
    expect(canPlace(card('S', 6), [card('S', 7)])).toBe(true)
  })

  it('не пускает на равный или неподходящий ранг', () => {
    expect(canPlace(card('H', 6), [card('S', 6)])).toBe(false)
    expect(canPlace(card('H', 6), [card('S', 8)])).toBe(false)
  })

  it('не пускает на закрытую карту', () => {
    expect(canPlace(card('H', 6), [card('S', 7, false)])).toBe(false)
  })
})

describe('ход', () => {
  it('переносит хвост и открывает карту под ним', () => {
    const s = blank()
    s.tableau[0] = [card('C', 4, false, 100), card('H', 6, true, 1), card('H', 5, true, 2)]
    s.tableau[1] = [card('S', 7, true, 3)]

    const events = applyMove(s, { t: 'move', from: 0, to: 1, count: 2 })

    expect(s.tableau[0].map((c) => c.id)).toEqual([100])
    expect(s.tableau[1].map((c) => c.id)).toEqual([3, 1, 2])
    expect(s.tableau[0][0].faceUp).toBe(true)

    expect(events).toEqual([
      { t: 'cardsMoved', cards: [1, 2], from: 0, to: 1 },
      { t: 'cardFlipped', card: 100, column: 0 },
    ])
  })

  it('снимает счёт за ход и считает ходы', () => {
    const s = blank()
    s.tableau[0] = [card('H', 5, true, 1)]
    applyMove(s, { t: 'move', from: 0, to: 1, count: 1 })
    expect(s.moves).toBe(1)
    expect(s.score).toBe(499)
  })

  it('бросает на недопустимом ходе', () => {
    const s = blank()
    s.tableau[0] = [card('H', 5)]
    s.tableau[1] = [card('S', 5)]
    expect(() => applyMove(s, { t: 'move', from: 0, to: 1, count: 1 })).toThrow()
  })

  it('не даёт взять разномастный хвост', () => {
    const s = blank()
    s.tableau[0] = [card('S', 7), card('H', 6)]
    s.tableau[1] = [card('C', 8)]
    expect(isLegal(s, { t: 'move', from: 0, to: 1, count: 2 })).toBe(false)
    expect(isLegal(s, { t: 'move', from: 0, to: 1, count: 1 })).toBe(false)
  })
})

describe('сбор последовательности', () => {
  function fullRun(suit: Suit, idBase = 0): Card[] {
    return Array.from({ length: 13 }, (_, i) =>
      card(suit, (13 - i) as Rank, true, idBase + i),
    )
  }

  it('снимает K..A одной масти и даёт +100', () => {
    const s = blank()
    const run = fullRun('S', 10)
    s.tableau[0] = [card('C', 2, false, 900), ...run.slice(0, 12)]
    s.tableau[1] = [run[12]] // туз отдельно

    const events = applyMove(s, { t: 'move', from: 1, to: 0, count: 1 })

    expect(s.foundations).toHaveLength(1)
    expect(s.tableau[0].map((c) => c.id)).toEqual([900])
    expect(s.score).toBe(500 - 1 + 100)
    expect(events.some((e) => e.t === 'runCompleted')).toBe(true)
    expect(events.some((e) => e.t === 'cardFlipped' && e.card === 900)).toBe(true)
  })

  it('не снимает последовательность из разных мастей', () => {
    const s = blank()
    const mixed = fullRun('S', 0)
    mixed[5] = card('H', 8, true, 500)
    s.tableau[0] = mixed.slice(0, 12)
    s.tableau[1] = [mixed[12]]

    applyMove(s, { t: 'move', from: 1, to: 0, count: 1 })
    expect(s.foundations).toHaveLength(0)
  })

  it('не снимает, если внутри есть закрытая карта', () => {
    const s = blank()
    const run = fullRun('S', 0)
    run[0].faceUp = false
    s.tableau[0] = run.slice(0, 12)
    s.tableau[1] = [run[12]]

    // король закрыт -> хвост не считается собранным
    applyMove(s, { t: 'move', from: 1, to: 0, count: 1 })
    expect(s.foundations).toHaveLength(0)
  })
})

describe('раздача из запаса', () => {
  it('кладёт по карте в каждую колонку лицом вверх', () => {
    const s = createDeal(11, 4)
    const before = s.tableau.map((c) => c.length)

    const events = applyMove(s, { t: 'deal' })

    expect(s.stock).toHaveLength(4)
    s.tableau.forEach((col, i) => {
      expect(col.length).toBe(before[i] + 1)
      expect(col[col.length - 1].faceUp).toBe(true)
    })
    expect(events[0].t).toBe('dealt')
  })

  it('запрещена, пока есть пустая колонка', () => {
    const s = createDeal(11, 4)
    s.tableau[3] = []
    expect(isLegal(s, { t: 'deal' })).toBe(false)
  })

  it('запрещена при пустом запасе', () => {
    const s = createDeal(11, 4)
    s.stock = []
    expect(isLegal(s, { t: 'deal' })).toBe(false)
  })
})

describe('перечень ходов', () => {
  it('на старте всегда есть хотя бы раздача', () => {
    for (let seed = 0; seed < 30; seed++) {
      expect(getLegalMoves(createDeal(seed, 4)).length).toBeGreaterThan(0)
    }
  })

  it('все перечисленные ходы применимы', () => {
    const s = createDeal(2026, 2)
    for (const move of getLegalMoves(s)) {
      expect(isLegal(s, move)).toBe(true)
    }
  })
})

describe('партия', () => {
  it('отмена возвращает ровно предыдущее состояние', () => {
    const game = new Game(4242, 4)
    const before = structuredClone(game.state)

    const move = game.legalMoves().find((m) => m.t === 'move') ?? { t: 'deal' as const }
    game.apply(move)
    expect(game.state).not.toEqual(before)

    game.undo()
    expect(game.state).toEqual(before)
  })

  it('отмена доводит до самого начала', () => {
    const game = new Game(77, 1)
    const start = structuredClone(game.state)

    for (let i = 0; i < 12; i++) {
      const moves = game.legalMoves()
      if (!moves.length) break
      game.apply(moves[0])
    }
    while (game.canUndo) game.undo()

    expect(game.state).toEqual(start)
    expect(game.canUndo).toBe(false)
  })

  it('сохранение восстанавливает партию до карты', () => {
    const game = new Game(31337, 2)
    for (let i = 0; i < 15; i++) {
      const moves = game.legalMoves()
      if (!moves.length) break
      game.apply(moves[moves.length - 1])
    }

    const restored = Game.fromSave(game.toSave())
    expect(restored.state).toEqual(game.state)
  })

  it('сохранение остаётся маленьким', () => {
    const game = new Game(1, 4)
    for (let i = 0; i < 100; i++) {
      const moves = game.legalMoves()
      if (!moves.length) break
      game.apply(moves[0])
    }
    expect(JSON.stringify(game.toSave()).length).toBeLessThan(4096)
  })

  it('карты не теряются и не дублируются за долгую партию', () => {
    const game = new Game(8888, 4)
    for (let i = 0; i < 300; i++) {
      const moves = game.legalMoves()
      if (!moves.length) break
      game.apply(moves[i % moves.length])

      expect(countCards(game.state)).toBe(104)
      const ids = [
        ...game.state.tableau.flat(),
        ...game.state.stock.flat(),
        ...game.state.foundations.flat(),
      ].map((c) => c.id)
      expect(new Set(ids).size).toBe(104)
    }
  })

  it('«заново» даёт тот же расклад', () => {
    const game = new Game(555, 4)
    const start = structuredClone(game.state)
    game.apply(game.legalMoves()[0])
    expect(game.restart()).toEqual(start)
  })
})

describe('подсказка (bestMove)', () => {
  it('не предлагает бесполезное перекладывание между равными позициями', () => {
    // Двойку можно легально положить на другую тройку, но пользы ноль:
    // ничего не вскрывается, масть та же самая ситуация. Подсказка должна
    // предложить раздачу, а не этот ход.
    const s = blank()
    s.tableau[0] = [card('S', 9, false, 1), card('S', 3, true, 2), card('S', 2, true, 3)]
    s.tableau[1] = [card('S', 9, false, 4), card('H', 3, true, 5)]
    for (let i = 2; i < COLUMNS; i++) s.tableau[i] = [card('C', 12, true, 10 + i)]
    s.stock = [[...Array(10)].map((_, i) => card('S', 5, false, 50 + i))]

    // Ход «2 пик -> 3 червей» легален, но score <= 0.
    expect(isLegal(s, { t: 'move', from: 0, to: 1, count: 1 })).toBe(true)
    expect(bestMove(s)).toEqual({ t: 'deal' })
  })

  it('предпочитает продолжение своей масти чужой', () => {
    const s = blank()
    s.tableau[0] = [card('S', 9, false, 1), card('S', 4, true, 2)]
    s.tableau[1] = [card('H', 5, true, 3)]
    s.tableau[2] = [card('S', 5, true, 4)]
    for (let i = 3; i < COLUMNS; i++) s.tableau[i] = [card('C', 12, true, 10 + i)]

    // Четвёрку пик можно на 5 червей и на 5 пик; своя масть лучше.
    expect(bestMove(s)).toEqual({ t: 'move', from: 0, to: 2, count: 1 })
  })

  it('ценит вскрытие закрытой карты', () => {
    const s = blank()
    // В колонке 0 под открытой шестёрк0й лежит закрытая карта.
    s.tableau[0] = [card('S', 11, false, 1), card('H', 6, true, 2)]
    s.tableau[1] = [card('S', 7, true, 3)]
    // Альтернатива: та же шестёрка есть в колонке 2, но под ней открытая своя.
    for (let i = 2; i < COLUMNS; i++) s.tableau[i] = [card('C', 12, true, 10 + i)]

    expect(bestMove(s)).toEqual({ t: 'move', from: 0, to: 1, count: 1 })
  })

  it('не советует рвать собранную одномастную связку без выгоды', () => {
    const s = blank()
    // 8-7 пик уже собраны; перенос семёрки на чужую восьмёрку — шаг назад.
    s.tableau[0] = [card('S', 8, true, 1), card('S', 7, true, 2)]
    s.tableau[1] = [card('H', 8, true, 3)]
    for (let i = 2; i < COLUMNS; i++) s.tableau[i] = [card('C', 12, true, 10 + i)]
    s.stock = [[...Array(10)].map((_, i) => card('S', 5, false, 50 + i))]

    expect(bestMove(s)).toEqual({ t: 'deal' })
  })
})

describe('выбор дружелюбного сида (pickEasySeed)', () => {
  // Тот же прокси «лёгкости», что и в pickEasySeed: как далеко уходит наивный
  // игрок, всегда делающий лучший по подсказке ход. Больше — легче.
  const greedyProgress = (seed: number, suits: SuitCount): number => {
    const s = createDeal(seed, suits)
    for (let guard = 0; guard < 400; guard++) {
      const move = bestMove(s)
      if (!move) break
      applyMove(s, move)
    }
    let buried = 0
    for (const col of s.tableau) for (const c of col) if (!c.faceUp) buried++
    return s.foundations.length * 1000 - buried
  }

  it('для 2 мастей берёт лучший расклад из кандидатов', () => {
    const chosen = pickEasySeed(2, mulberry32(42))

    // Повторяем ту же последовательность кандидатов и ищем argmax.
    const r = mulberry32(42)
    const attempts = 64
    let bestSeed = (r() * 0x7fffffff) | 0
    let best = greedyProgress(bestSeed, 2)
    for (let i = 1; i < attempts; i++) {
      const cand = (r() * 0x7fffffff) | 0
      const score = greedyProgress(cand, 2)
      if (score > best) {
        best = score
        bestSeed = cand
      }
    }

    expect(chosen).toBe(bestSeed)
    // И он действительно не безнадёжнее среднего случайного расклада.
    const rr = mulberry32(42)
    let sum = 0
    for (let i = 0; i < attempts; i++) sum += greedyProgress((rr() * 0x7fffffff) | 0, 2)
    expect(greedyProgress(chosen, 2)).toBeGreaterThanOrEqual(sum / attempts)
  })

  it('для 1 масти сид не перебирается — берётся первый же случайный', () => {
    const chosen = pickEasySeed(1, mulberry32(99))
    expect(chosen).toBe((mulberry32(99)() * 0x7fffffff) | 0)
  })
})
