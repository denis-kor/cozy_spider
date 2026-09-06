import type { SuitCount } from '../core/types'
import type { Stage } from '../engine/Stage'

/**
 * HUD поверх канваса.
 *
 * Намеренно DOM, а не Pixi: текст и кнопки в вебе уже сделаны хорошо —
 * доступность, выделение, масштаб шрифта, экранные читалки. Рисовать их
 * заново в WebGL значит потерять всё это и получить взамен ничего.
 *
 * Живёт вне `world`, поэтому не получает зерно, виньетку и дождь: на
 * цифрах счётчика они читались бы как грязь, а не как атмосфера.
 */
export interface HudHooks {
  /** Открыть лавку. Кнопка не рисуется, если хука нет. */
  onShop?: () => void
  /** Вернуться на титульный экран (там же вход в аккаунт). */
  onMenu?: () => void
}

export function mountHud(stage: Stage, root: HTMLElement, hooks: HudHooks = {}): void {
  // ВРЕМЕННОЕ: кнопка мгновенной победы для отладки торжества. В деве
  // есть всегда, на проде — по ?debug в адресе. Убрать вместе с
  // data-debug-win ниже, когда эффекты утвердим.
  const debugWin = import.meta.env.DEV || new URLSearchParams(location.search).has('debug')

  root.innerHTML = `
    <div class="hud-bar hud-top">
      <div class="hud-group">
        <span class="hud-title">Паук</span>
        <span class="hud-suits">
          мастей
          <span class="hud-seg" data-suits>
            <button data-suit="1">1</button>
            <button data-suit="2">2</button>
            <button data-suit="4">4</button>
          </span>
        </span>
      </div>
      <div class="hud-group hud-stats">
        <span><b data-score>500</b><i>счёт</i></span>
        <span><b data-moves>0</b><i>ходы</i></span>
        <span><b data-time>00:00</b><i>время</i></span>
      </div>
      <div class="hud-group">
        <button data-new>Новая игра</button>
        <button data-restart>Заново</button>
        <button data-undo>Отменить</button>
        <button data-hint>Подсказка</button>
        ${hooks.onShop ? '<button data-shop>Лавка</button>' : ''}
        ${hooks.onMenu ? '<button data-menu>Меню</button>' : ''}
        ${debugWin ? '<button data-debug-win title="отладка: мгновенная победа">🏆</button>' : ''}
      </div>
    </div>
    <div class="hud-toast" data-toast></div>
  `

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T

  const score = q<HTMLElement>('[data-score]')
  const moves = q<HTMLElement>('[data-moves]')
  const time = q<HTMLElement>('[data-time]')
  const toast = q<HTMLElement>('[data-toast]')
  const undoBtn = q<HTMLButtonElement>('[data-undo]')
  const suitButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-suit]'),
  )

  function markSuits(): void {
    const current = String(stage.table.game.suits)
    for (const b of suitButtons) b.classList.toggle('on', b.dataset.suit === current)
  }
  markSuits()

  let started = 0
  let toastTimer = 0

  function say(text: string): void {
    toast.textContent = text
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600)
  }

  function refresh(): void {
    const state = stage.table.game.state
    score.textContent = String(state.score)
    moves.textContent = String(state.moves)
    undoBtn.disabled = !stage.table.game.canUndo

    if (stage.table.game.won()) say('Собрано! 🎉')
    else if (stage.table.game.stuck()) say('Ходов больше нет')
  }

  stage.table.onChange = refresh

  q<HTMLButtonElement>('[data-new]').onclick = () => {
    stage.table.newGame((Math.random() * 0x7fffffff) | 0)
    started = performance.now()
    refresh()
  }

  q<HTMLButtonElement>('[data-restart]').onclick = () => {
    stage.table.restart()
    started = performance.now()
    refresh()
  }

  undoBtn.onclick = () => {
    stage.table.undo()
    refresh()
  }

  q<HTMLButtonElement>('[data-hint]').onclick = () => {
    const move = stage.table.hint()
    if (move?.t === 'move') say(`Подсвечено: колонка ${move.from + 1} → ${move.to + 1}`)
    else if (move?.t === 'deal') say('Полезных ходов нет — раздайте из запаса')
    else say('Полезных ходов не видно')
  }

  if (debugWin) {
    q<HTMLButtonElement>('[data-debug-win]').onclick = () => {
      stage.celebrate()
      say('Собрано! 🎉')
    }
  }

  if (hooks.onShop) {
    q<HTMLButtonElement>('[data-shop]').onclick = hooks.onShop
  }
  if (hooks.onMenu) {
    q<HTMLButtonElement>('[data-menu]').onclick = hooks.onMenu
  }

  for (const b of suitButtons) {
    b.onclick = () => {
      const suits = Number(b.dataset.suit) as SuitCount
      if (suits === stage.table.game.suits) return
      stage.table.setSuits(suits)
      started = performance.now()
      markSuits()
      refresh()
    }
  }

  started = performance.now()
  setInterval(() => {
    const total = Math.floor((performance.now() - started) / 1000)
    const mm = String(Math.floor(total / 60)).padStart(2, '0')
    const ss = String(total % 60).padStart(2, '0')
    time.textContent = `${mm}:${ss}`
  }, 500)

  refresh()
}
