/**
 * Подсказка «поверните телефон» — только для сенсорных устройств в портрете.
 *
 * Игра рисуется на весь вьюпорт и в вертикальном положении играется, но стол
 * сжимается до полоски: восемь колонок на ширину ладони.
 *
 * Два решения, купленные опытом первой версии:
 *
 * 1. Плашка поднимается СРАЗУ, ещё на заставке (поэтому z-index выше #boot).
 *    Пока едут слои сцены, проходит несколько секунд, и подсказка, заведённая
 *    после загрузки, успевала прожить свой срок незамеченной.
 *
 * 2. Плашка висит, ПОКА телефон в портрете, а не отмеренные пять секунд.
 *    Мигает значок — первые пять секунд, дальше стоит спокойно, чтобы не
 *    дёргать глаз всю партию. Уходит от поворота в горизонт или от тапа;
 *    тап — это «я в курсе, играю стоя», и больше она не возвращается.
 *
 * Плашка намеренно НЕ блокирует игру: это подсказка, а не стена.
 */

/** Сколько значок подмигивает, прежде чем успокоиться. */
const BLINK_MS = 5000

/** Уход плашки должен совпасть с длительностью transition в стилях. */
const FADE_MS = 400

export function mountRotateHint(): void {
  // Десктоп мимо: окно там портретным почти не бывает, а поворачивать нечего.
  if (!window.matchMedia('(pointer: coarse)').matches) return

  const el = document.createElement('div')
  el.className = 'rotate-hint'
  el.innerHTML = `
    <svg class="rotate-hint-icon" viewBox="0 0 64 64" aria-hidden="true">
      <path class="rh-arc" d="M14 26a18 18 0 0 1 36 0" />
      <path class="rh-tip" d="M45 26l5 1 1-6" />
      <g class="rh-phone">
        <rect x="24" y="34" width="16" height="26" rx="3.5" />
        <line x1="29" y1="55.5" x2="35" y2="55.5" />
      </g>
    </svg>
    <span>Поверните телефон</span>
    <small>нажмите, чтобы скрыть</small>`

  let shown = false
  let dismissed = false
  let blinkTimer = 0
  let removeTimer = 0

  const show = (): void => {
    if (shown || dismissed) return
    shown = true
    clearTimeout(removeTimer)
    document.body.appendChild(el)
    requestAnimationFrame(() => el.classList.add('show', 'blink'))
    blinkTimer = window.setTimeout(() => el.classList.remove('blink'), BLINK_MS)
  }

  const hide = (): void => {
    if (!shown) return
    shown = false
    clearTimeout(blinkTimer)
    el.classList.remove('show', 'blink')
    removeTimer = window.setTimeout(() => el.remove(), FADE_MS)
  }

  const sync = (): void => {
    if (isPortrait()) show()
    else hide()
  }

  // Тап — «понял, играю стоя»: убрать и больше не возвращаться.
  el.addEventListener('pointerdown', () => {
    dismissed = true
    hide()
  })

  // iOS отдаёт старые размеры сразу после поворота (см. viewport.ts),
  // поэтому слушаем всё, что может прийти: сработает то, что успеет.
  window.matchMedia('(orientation: portrait)').addEventListener?.('change', sync)
  window.addEventListener('orientationchange', () => {
    sync()
    setTimeout(sync, 350)
  })
  window.addEventListener('resize', sync)

  sync()
}

/**
 * Портрет по размерам окна, а не по screen.orientation: в вебвью и на
 * планшетах угол поворота бывает честным, а окно всё равно узкое.
 */
function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth
}
