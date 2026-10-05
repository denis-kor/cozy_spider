import type { Application } from 'pixi.js'

/**
 * Полноэкранная подача и корректный поворот на телефоне.
 *
 * iPhone Safari не умеет программный Fullscreen API вообще (только для
 * видео), поэтому «полный экран» там держится на двух вещах: канвас на весь
 * вьюпорт (#stage — fixed inset:0) и мета-теги apple-mobile-web-app, дающие
 * честный полный экран при добавлении на домашний экран.
 *
 * Больное место, которое здесь лечим, — поворот. После смены ориентации iOS
 * какое-то время отдаёт СТАРЫЕ размеры окна, и Pixi, посчитав по ним, может
 * оставить сцену «портретной» с чёрными полями по бокам. Поэтому на поворот
 * подталкиваем ресайз несколько раз, пока раскладка не устоится.
 */
export function mountViewport(app: Application): void {
  const resize = (): void => {
    try {
      app.resize()
    } catch {
      // Рендерер мог не подняться — тогда и ресайзить нечего.
    }
  }

  // Один поворот — несколько попыток: сейчас, на следующем кадре и с запасом
  // спустя долю секунды, когда iOS наконец сообщит настоящий размер.
  const settle = (): void => {
    resize()
    requestAnimationFrame(resize)
    setTimeout(resize, 250)
    setTimeout(resize, 600)
  }

  window.addEventListener('orientationchange', settle)
  // Панель адресной строки Safari прячется/появляется, меняя высоту — ловим.
  window.visualViewport?.addEventListener('resize', resize)
  // Возврат из фона (свернул-развернул) тоже роняет размеры на iOS.
  window.addEventListener('pageshow', settle)

  // viewport-fit=cover нужен iOS (страница на домашнем экране под чёлкой),
  // а Chrome на Android применяет его только в полном экране — и заводит
  // страницу под вырез камеры, где верх HUD и крайние колонки уходят под
  // него. Безопасные зоны мы нигде не отступаем, поэтому на время полного
  // экрана cover снимаем: Chrome оставит вырез чёрной полосой. На iPhone
  // Fullscreen API нет, событие там не приходит, и мета-тег не трогается.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  const original = meta?.content ?? ''
  document.addEventListener('fullscreenchange', () => {
    if (!meta) return
    meta.content = document.fullscreenElement
      ? original.replace(/,\s*viewport-fit=cover/, '')
      : original
    settle()
  })
}

/** Дольше полного экрана не ждём: отказ или зависший промис не держат игру. */
const FULLSCREEN_WAIT_MS = 700

/**
 * Попросить полный экран, если платформа умеет и это сенсорное устройство.
 *
 * Вызывать только из обработчика жеста (клика) — браузеры требуют
 * пользовательской активации. На iPhone Safari метода нет: молча выходим,
 * там работает «на домашний экран». На десктопе не трогаем — незваный
 * полный экран там пугает.
 *
 * Промис разрешается, когда окно доехало до нового размера (или сразу, если
 * полного экрана не будет). Стартовую раздачу пускать после него: на Android
 * в горизонтали карта в полном экране вырастает на треть-половину, атлас
 * пересобирается, и раздача, начатая раньше, обрывалась на полпути.
 */
export function requestFullscreenIfPossible(): Promise<void> {
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (!coarse) return Promise.resolve()
    if (document.fullscreenElement) return Promise.resolve()

    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void
    }
    let entered: Promise<unknown>
    if (el.requestFullscreen) {
      entered = el.requestFullscreen()
    } else if (el.webkitRequestFullscreen) {
      entered = Promise.resolve(el.webkitRequestFullscreen())
    } else {
      return Promise.resolve()
    }

    // Вход в полный экран — ещё не новый размер: resize приходит следом,
    // а Pixi пересчитывает канвас на ближайшем кадре. Два кадра с запасом.
    const settled = entered
      .then(() => new Promise<void>((r) => setTimeout(r, 120)))
      .then(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
      .catch(() => {})
    const cap = new Promise<void>((r) => setTimeout(r, FULLSCREEN_WAIT_MS))
    return Promise.race([settled, cap])
  } catch {
    // Не поддержано или заблокировано — не беда, игра и так на весь вьюпорт.
    return Promise.resolve()
  }
}
