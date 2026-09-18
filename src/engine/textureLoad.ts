import { Assets, Texture } from 'pixi.js'

/**
 * Прогнать задачи с ограничением на число одновременных.
 *
 * Простой пул воркеров: n «рабочих» тянут задачи из общей очереди, пока
 * та не опустеет. Ради потолка пикового потребления памяти при декоде —
 * шестнадцать мастеров 2560×1600, распакованных разом, кладут телефон.
 */
export async function runLimited(
  tasks: ReadonlyArray<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let next = 0
  const workers = Math.max(1, Math.min(limit, tasks.length || 1))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const i = next++
        if (i >= tasks.length) return
        await tasks[i]()
      }
    }),
  )
}

/**
 * Текстура слоя, при необходимости уменьшенная под бюджет памяти телефона.
 *
 * `scale >= 1` — обычная загрузка Pixi, без единого лишнего действия
 * (десктопный путь не меняется вовсе). Иначе картинка декодируется,
 * перерисовывается на канвас в `scale` от своей стороны, и в видеопамять
 * уезжает уменьшенная копия, а мастер 2560×1600 живёт лишь миг на декоде
 * и тут же закрывается. Так iPhone переживает дюжину слоёв.
 *
 * Уменьшение равномерное (сохраняет пропорции слоя), поэтому на экране он
 * должен рисоваться крупнее ровно в `1/scale` раз — за это отвечает
 * `LayerScene` через `layerTexScale`.
 *
 * Если что-то не заладилось (старый Safari без `createImageBitmap` для WebP),
 * честно откатываемся на полноразмерную загрузку: тяжёлый слой лучше дыры
 * в сцене.
 */
export async function loadLayerTexture(url: string, scale: number): Promise<Texture> {
  if (scale >= 1 || typeof createImageBitmap === 'undefined' || typeof document === 'undefined') {
    return Assets.load<Texture>(url)
  }

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`http ${response.status}`)
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)

    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    return Texture.from(canvas)
  } catch (err) {
    console.warn(`[scene] не удалось уменьшить ${url}, гружу как есть:`, err)
    return Assets.load<Texture>(url)
  }
}
