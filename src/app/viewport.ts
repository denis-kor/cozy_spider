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
}

/**
 * Попросить полный экран, если платформа умеет и это сенсорное устройство.
 *
 * Вызывать только из обработчика жеста (клика) — браузеры требуют
 * пользовательской активации. На iPhone Safari метода нет: молча выходим,
 * там работает «на домашний экран». На десктопе не трогаем — незваный
 * полный экран там пугает.
 */
export function requestFullscreenIfPossible(): void {
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (!coarse) return
    if (document.fullscreenElement) return

    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void
    }
    if (el.requestFullscreen) {
      void Promise.resolve(el.requestFullscreen()).catch(() => {})
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen()
    }
  } catch {
    // Не поддержано или заблокировано — не беда, игра и так на весь вьюпорт.
  }
}
