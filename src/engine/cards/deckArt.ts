import { Assets, Texture } from 'pixi.js'

import { versioned } from '../assetVersion'
import { runLimited } from '../textureLoad'
import type { LoadProgress } from '../loading'
import type { DeckArt } from './deckAtlas'

/**
 * Загрузка нарисованных иллюстраций колоды.
 *
 * Манифест необязателен. Пока его нет, колода играется на процедурных
 * заглушках — игра не должна ждать художника, чтобы запуститься.
 *
 * Манифест же — и политика колоды: грузится ВСЁ, что в нём перечислено.
 * Каким рангам положена картинка, решает wire_deck.py при публикации
 * (базовой колоде числовые не публикуются, паку таро — публикуются),
 * поэтому здесь никакого фильтра по рангам нет.
 *
 * Формат `public/assets/deck/deck.json`:
 * ```json
 * {
 *   "faces": { "S1": "faces/S1.png", "S2": "faces/S2.png" },
 *   "back": "back.png"
 * }
 * ```
 * Ключ — масть плюс ранг 1..13: туз это 1, валет 11, дама 12, король 13.
 */
export interface DeckManifest {
  faces?: Record<string, string>
  back?: string
  /** false — не рисовать угловой индекс: номинал есть в самом арте. */
  index?: boolean
}

export async function loadDeckArt(
  baseUrl: string,
  progress?: LoadProgress,
  concurrency = 8,
): Promise<DeckArt | undefined> {
  let manifest: DeckManifest

  try {
    const response = await fetch(`${baseUrl}/deck.json`, { cache: 'no-cache' })
    if (!response.ok) return undefined
    manifest = (await response.json()) as DeckManifest
  } catch {
    return undefined
  }

  const entries = Object.entries(manifest.faces ?? {})
  progress?.add(entries.length + (manifest.back ? 1 : 0))

  const art: DeckArt = {}
  if (manifest.index === false) art.hideIndex = true
  const faces = new Map<string, Texture>()

  // Параллельно, а не по одной: полторы дюжины последовательных запросов
  // на мобильной сети складывали свои задержки в секунды чёрного экрана.
  // Мипмапы обязательны: атлас уменьшает 512-пиксельный мастер до ячейки
  // в ~2 раза, и билинейная выборка без мипмапов давит тонкую гравюру
  // арта в кашу. С мипмапами уменьшение идёт через усреднённые уровни.
  const withMips = (t: Texture): Texture => {
    t.source.autoGenerateMipmaps = true
    return t
  }

  // Параллельно, но с потолком одновременных: полусотня лиц колоды таро,
  // распакованных разом рядом со слоями сцены, давала пиковый всплеск
  // памяти, от которого телефон ронял загрузку (§13).
  const tasks: Array<() => Promise<void>> = entries.map(([key, file]) => async () => {
    try {
      faces.set(key, withMips(await Assets.load<Texture>(versioned(`${baseUrl}/${file}`))))
    } catch {
      // Отсутствующая картинка не должна валить всю колоду: эта карта
      // просто останется с заглушкой, остальные нарисуются как есть.
      console.warn(`[deck] не загрузилась иллюстрация ${key}: ${file}`)
    } finally {
      progress?.tick()
    }
  })
  if (manifest.back) {
    const back = manifest.back
    tasks.push(async () => {
      try {
        art.back = withMips(await Assets.load<Texture>(versioned(`${baseUrl}/${back}`)))
      } catch {
        console.warn(`[deck] не загрузилась рубашка: ${back}`)
      } finally {
        progress?.tick()
      }
    })
  }
  await runLimited(tasks, concurrency)

  if (faces.size) art.faces = faces
  return art.faces || art.back ? art : undefined
}
