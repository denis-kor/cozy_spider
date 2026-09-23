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
  // ВРЕМЕННОЕ: кнопка мгновенной победы для отладки торжества. Только в
  // дев-сборке — на проде её быть не должно (раньше открывалась по ?debug
  // в адресе, это лазейка на деплой-сервере). Vite вырежет ветку по DEV.
  // Убрать вместе с data-debug-win ниже, когда эффекты утвердим.
  const debugWin = import.meta.env.DEV

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

  let toastTimer = 0

  function say(text: string): void {
    toast.textContent = text
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600)
  }

  function refresh(): void {
    undoBtn.disabled = !stage.table.game.canUndo

    // Победу показывает плашка (winPlaque) поверх финального эффекта — без
    // маленького тоста: две «собрано» подряд читались как дубль.
    if (stage.table.game.stuck()) say('Ходов больше нет')
  }

  stage.table.onChange = refresh

  q<HTMLButtonElement>('[data-new]').onclick = () => {
    stage.table.newGame()
    refresh()
  }

  q<HTMLButtonElement>('[data-restart]').onclick = () => {
    stage.table.restart()
    refresh()
  }

  undoBtn.onclick = () => {
    stage.table.undo()
    refresh()
  }

  q<HTMLButtonElement>('[data-hint]').onclick = () => {
    // Подсказка живёт на столе: стопка-источник и цель подсвечиваются, а
    // когда единственный ход — раздача, подсвечивается колода в углу. Плашку
    // с текстом оставляем только на случай, когда показать нечего (тупик).
    const move = stage.table.hint()
    if (!move) say('Полезных ходов не видно')
  }

  if (debugWin) {
    q<HTMLButtonElement>('[data-debug-win]').onclick = () => {
      stage.celebrate()
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
      markSuits()
      refresh()
    }
  }

  refresh()
}
