/**
 * Подсказка «поверните телефон» — только для сенсорных устройств в портрете.
 *
 * Игра рисуется на весь вьюпорт и в вертикальном положении играется, но стол
 * сжимается до полоски: восемь колонок на ширину ладони. Поэтому в первые
 * секунды показываем тихую плашку с мигающим значком поворота.
 *
 * Плашка намеренно НЕ блокирует игру: это подсказка, а не стена. Она
 * пропадает сама через пять секунд, мгновенно — при повороте в горизонт, и
 * по тапу, если игрок решил остаться в портрете. Второй раз за сессию не
 * приходит: напоминать взрослому человеку дважды — уже не уют.
 */

/** Сколько плашка висит, если её не поворачивают и не трогают. */
const HINT_MS = 5000

/** Уход плашки должен совпасть с длительностью transition в стилях. */
const FADE_MS = 400

export function mountRotateHint(): void {
  // Десктоп мимо: окно там портретным почти не бывает, а поворачивать нечего.
  if (!window.matchMedia('(pointer: coarse)').matches) return
  if (!isPortrait()) return

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
    <span>Поверните телефон</span>`
  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('show'))

  let gone = false
  const hide = (): void => {
    if (gone) return
    gone = true
    clearTimeout(timer)
    portrait.removeEventListener?.('change', onOrientation)
    window.removeEventListener('orientationchange', onOrientation)
    window.removeEventListener('resize', onOrientation)
    el.classList.remove('show')
    setTimeout(() => el.remove(), FADE_MS)
  }

  // Повернули — плашке больше нечего сказать, уходит сразу.
  const onOrientation = (): void => {
    if (!isPortrait()) hide()
  }

  const portrait = window.matchMedia('(orientation: portrait)')
  portrait.addEventListener?.('change', onOrientation)
  // iOS отдаёт старые размеры сразу после поворота (см. viewport.ts),
  // поэтому слушаем и событие поворота, и ресайз — сработает то, что придёт.
  window.addEventListener('orientationchange', onOrientation)
  window.addEventListener('resize', onOrientation)
  el.addEventListener('pointerdown', hide)

  const timer = setTimeout(hide, HINT_MS)
}

/**
 * Портрет по размерам окна, а не по screen.orientation: в вебвью и на
 * планшетах угол поворота бывает честным, а окно всё равно узкое.
 */
function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth
}
