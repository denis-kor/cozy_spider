/**
 * Подсказка «поверните телефон» — только для сенсорных устройств в портрете.
 *
 * Игра рисуется на весь вьюпорт и в вертикальном положении играется, но стол
 * сжимается до полоски: восемь колонок на ширину ладони.
 *
 * Три решения, купленные опытом:
 *
 * 1. Плашка поднимается СРАЗУ, ещё на заставке (поэтому z-index выше #boot).
 *    Пока едут слои сцены, проходит несколько секунд, и подсказка, заведённая
 *    после загрузки, успевала прожить свой срок незамеченной.
 *
 * 2. Плашка висит, ПОКА телефон в портрете, а не отмеренные пять секунд.
 *    Мигает значок — первые пять секунд, дальше стоит спокойно, чтобы не
 *    дёргать глаз всю партию. Уходит от поворота в горизонт или от тапа.
 *
 * 3. Центрируется ОБЁРТКОЙ во весь экран, а не своим transform, и не просит
 *    backdrop-filter. Связка `position: fixed` + `transform: translate(-50%)`
 *    + `backdrop-filter` — известное больное место Safari, панель там
 *    случается невидимой. Обёртка не ловит нажатия (`pointer-events: none`),
 *    поэтому «Играть» под плашкой остаётся доступной: перекрыта только сама
 *    табличка, а тап по ней и так значит «понял, убери».
 *
 * Отладка: `?rotate` в адресе показывает плашку принудительно, на любом
 * устройстве и в любой ориентации — так вид проверяется отдельно от условия.
 */

/** Сколько значок подмигивает, прежде чем успокоиться. */
const BLINK_MS = 5000

/** Уход плашки должен совпасть с длительностью transition в стилях. */
const FADE_MS = 400

export function mountRotateHint(): void {
  const forced = /[?&]rotate(=|&|$)/.test(window.location.search)

  // Десктоп мимо: окно там портретным почти не бывает, а поворачивать нечего.
  if (!forced && !window.matchMedia('(pointer: coarse)').matches) return

  const wrap = document.createElement('div')
  wrap.className = 'rotate-hint-wrap'
  wrap.innerHTML = `
    <div class="rotate-hint">
      <svg class="rotate-hint-icon" viewBox="0 0 64 64" aria-hidden="true">
        <path class="rh-arc" d="M14 26a18 18 0 0 1 36 0" />
        <path class="rh-tip" d="M45 26l5 1 1-6" />
        <g class="rh-phone">
          <rect x="24" y="34" width="16" height="26" rx="3.5" />
          <line x1="29" y1="55.5" x2="35" y2="55.5" />
        </g>
      </svg>
      <span>Поверните телефон</span>
      <small>нажмите, чтобы скрыть</small>
    </div>`

  let shown = false
  let dismissed = false
  let blinkTimer = 0
  let removeTimer = 0

  const show = (): void => {
    if (shown || dismissed) return
    shown = true
    clearTimeout(removeTimer)
    document.body.appendChild(wrap)
    requestAnimationFrame(() => wrap.classList.add('show', 'blink'))
    blinkTimer = window.setTimeout(() => wrap.classList.remove('blink'), BLINK_MS)
  }

  const hide = (): void => {
    if (!shown) return
    shown = false
    clearTimeout(blinkTimer)
    wrap.classList.remove('show', 'blink')
    removeTimer = window.setTimeout(() => wrap.remove(), FADE_MS)
  }

  const sync = (): void => {
    if (forced || isPortrait()) show()
    else hide()
  }

  // Тап по самой табличке — «понял, играю стоя»: убрать и не возвращаться.
  wrap.querySelector('.rotate-hint')?.addEventListener('pointerdown', () => {
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
