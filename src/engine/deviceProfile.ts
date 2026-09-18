/**
 * Профиль устройства под бюджет видеопамяти.
 *
 * Слои сцены — мастера 2560×1600, каждый ~16 МБ распакованной RGBA-текстуры.
 * Дюжина таких плюс лица колоды — это ~280 МБ в GPU. Десктоп и планшет
 * такое не замечают, но Safari на телефоне держит куда меньший бюджет
 * WebGL и убивает контекст ещё на декоде: заставка застревает на «тасуем
 * колоду…», игра не появляется (§13, реальная жалоба с iPhone).
 *
 * На мобильных поэтому: слои грузим вдвое меньше (площадь — в четверть) и
 * декодируем не всё разом, а небольшими пачками, чтобы не было пикового
 * всплеска памяти на старте.
 */
export interface DeviceProfile {
  /** true — телефон/планшет: экономим память. */
  mobile: boolean
  /**
   * Множитель размера текстур слоёв сцены. 1 — как есть (десктоп),
   * 0.5 — половина стороны, четверть площади и памяти (мобильные).
   */
  layerTextureScale: number
  /** Сколько картинок декодировать одновременно. Меньше — ниже пик памяти. */
  loadConcurrency: number
}

/**
 * Похоже ли устройство на телефон/планшет.
 *
 * Ловим iOS (включая iPadOS, который представляется MacIntel с тач-точками),
 * Android и «грубый указатель на маленьком экране». Десктоп с сенсорным
 * экраном под это не попадает — там экран большой.
 */
function isMobileLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOS =
    /iP(hone|od|ad)/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
  const android = /Android/.test(ua)

  let coarseSmall = false
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const minSide = Math.min(window.screen.width, window.screen.height)
    coarseSmall = coarse && minSide <= 540
  } catch {
    // Нет matchMedia/screen — не страшно, полагаемся на UA.
  }

  return iOS || android || coarseSmall
}

export function detectDeviceProfile(): DeviceProfile {
  const mobile = isMobileLike()
  return {
    mobile,
    layerTextureScale: mobile ? 0.5 : 1,
    loadConcurrency: mobile ? 3 : 8,
  }
}
