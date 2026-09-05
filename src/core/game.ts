import { applyMove, createDeal, getLegalMoves, isStuck, isWon } from './rules'
import type { GameEvent, GameState, Move, SuitCount } from './types'

export interface GameSave {
  seed: number
  suits: SuitCount
  moves: Move[]
}

/**
 * Партия = сид + список ходов.
 *
 * Отмена сделана реплеем с нуля, а не обратными командами. Обратные
 * команды пришлось бы писать для каждого побочного эффекта — переворота
 * карты, снятия последовательности, счёта, — и каждый из них стал бы
 * отдельным источником рассинхрона. Реплей 200 ходов занимает доли
 * миллисекунды и по построению не может разойтись с прямым ходом.
 *
 * Побочная выгода: сохранение — это и есть GameSave, пара килобайт (§4).
 */
export class Game {
  private history: Move[] = []
  private current!: GameState

  constructor(
    readonly seed: number,
    readonly suits: SuitCount = 4,
  ) {
    this.current = createDeal(seed, suits)
  }

  static fromSave(save: GameSave): Game {
    const game = new Game(save.seed, save.suits)
    for (const move of save.moves) game.apply(move)
    return game
  }

  get state(): GameState {
    return this.current
  }

  get moveList(): readonly Move[] {
    return this.history
  }

  get canUndo(): boolean {
    return this.history.length > 0
  }

  toSave(): GameSave {
    return { seed: this.seed, suits: this.suits, moves: [...this.history] }
  }

  legalMoves(): Move[] {
    return getLegalMoves(this.current)
  }

  won(): boolean {
    return isWon(this.current)
  }

  stuck(): boolean {
    return isStuck(this.current)
  }

  /** Применить ход. Состояние меняется мгновенно, наружу летят события. */
  apply(move: Move): GameEvent[] {
    const events = applyMove(this.current, move)
    this.history.push(move)
    return events
  }

  /**
   * Отменить последний ход. Возвращает состояние ДО него.
   *
   * События не порождает: рендер после отмены пересобирает раскладку
   * целиком. Анимировать отмену покарточно — отдельная задача, и делать
   * её через тот же поток событий было бы враньём: событий «карта
   * вернулась» в логике не существует.
   */
  undo(): GameState | null {
    if (!this.canUndo) return null

    this.history.pop()
    this.current = createDeal(this.seed, this.suits)
    for (const move of this.history) applyMove(this.current, move)
    return this.current
  }

  /** Начать заново тот же расклад. */
  restart(): GameState {
    this.history = []
    this.current = createDeal(this.seed, this.suits)
    return this.current
  }
}
