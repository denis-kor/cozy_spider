import {
  Container,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  Text,
  Texture,
  type Renderer,
} from 'pixi.js'

import {
  RANK_LABELS_EN,
  RANK_LABELS_RU,
  SUITS,
  isRed,
  type Rank,
  type Suit,
} from '../../core/types'
import { drawSuit } from './suits'

/**
 * Композитная колода (§6 дока).
 *
 * 104 отдельные текстуры 512×768 RGBA — это ~160 МБ VRAM и мгновенный
 * вылет вкладки на iPhone. Уникальных лиц максимум 52, числовые карты
 * складываются из рамки и процедурно расставленных пипсов, реально
 * иллюстрировать надо только 12 фигурных.
 *
 * Всё лицо собирается здесь один раз в единый атлас: одна текстура —
 * один draw call на все карты стола.
 *
 * Фигурные карты сейчас — заглушки. Когда появятся иллюстрации, меняется
 * только `drawFigure`.
 */

export type DeckLocale = 'en' | 'ru'

export interface DeckStyle {
  /** Логическая ширина карты. Высота считается по CARD_ASPECT. */
  cardWidth: number
  locale: DeckLocale
  /** Резкость растеризации. Клампится так же, как DPR сцены. */
  resolution: number
}

/**
 * Нарисованные иллюстрации. Всё необязательно: чего нет, то заменяется
 * процедурной заглушкой.
 *
 * Картинка приходит БЕЗ текста: ранг и масть рисуются кодом поверх неё.
 * Модели не умеют надёжно рисовать буквы, а ранг — единственное, что
 * игрок обязан прочесть с накрытой карты.
 */
export interface DeckArt {
  /** Ключ — `${suit}${rank}`, ранги 1..13. Например `S13` или `H7`. */
  faces?: Map<string, Texture>
  /** Рубашка целиком, во весь размер карты. */
  back?: Texture
  /**
   * Не рисовать угловой индекс поверх иллюстраций — номинал нарисован в
   * самом арте (`"index": false` в deck.json). Политика колоды, как и
   * состав лиц: у таро минорка сама показывает счёт, у пруда пейзажи без
   * номинала — там индекс обязателен.
   */
  hideIndex?: boolean
}

export const CARD_ASPECT = 1.45

const PAPER = 0xf3ecdb
const PAPER_EDGE = 0xd9cdb2
const INK = 0x232b28
// Красный заметно ярче чернил. Прежний 0xa8382f на состаренной бумаге
// сливался с тёмно-зелёным INK в общий бурый: в стопке, где видна лишь
// верхняя полоска карты, цвет масти не читался (фидбек тестеров).
const RED = 0xc63c2a

const BACK_FIELD = 0x1f3b3a
const BACK_LINE = 0x8fae9c

/** Раскладка пипсов: x в долях полуширины поля, y — полувысоты. */
const PIPS: Record<number, [number, number][]> = {
  2: [[0, -1], [0, 1]],
  3: [[0, -1], [0, 0], [0, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  7: [[-1, -1], [1, -1], [0, -0.5], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  8: [[-1, -1], [1, -1], [0, -0.5], [-1, 0], [1, 0], [0, 0.5], [-1, 1], [1, 1]],
  9: [
    [-1, -1], [1, -1], [-1, -0.34], [1, -0.34], [0, 0],
    [-1, 0.34], [1, 0.34], [-1, 1], [1, 1],
  ],
  10: [
    [-1, -1], [1, -1], [0, -0.66], [-1, -0.34], [1, -0.34],
    [-1, 0.34], [1, 0.34], [0, 0.66], [-1, 1], [1, 1],
  ],
}

export interface DeckAtlas {
  face(suit: Suit, rank: Rank): Texture
  readonly back: Texture
  readonly slot: Texture
  readonly cardWidth: number
  readonly cardHeight: number
  destroy(): void
}

function faceKey(suit: Suit, rank: Rank): string {
  return `${suit}${rank}`
}

/**
 * Детерминированный ГПСЧ для состаривания.
 *
 * Атлас обязан собираться одинаково от запуска к запуску: пятна, которые
 * прыгают по карте при каждой новой игре, читаются не как возраст бумаги,
 * а как баг рендера. Семя — масть и ранг, поэтому у каждой карты своя,
 * но постоянная биография.
 */
function agedRng(seed: number): () => number {
  let s = (seed % 2147483646) + 1
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const AGE_TONE = 0xdcc7a0
const AGE_STAIN = 0x8a6a42

/** Тонировка бумаги ПОД краской: пожелтевшая основа, а не грязь поверх. */
function agePaper(parent: Container, w: number, h: number, rng: () => number): void {
  const g = new Graphics()
  const r = w * 0.075

  g.roundRect(0, 0, w, h, r).fill({ color: AGE_TONE, alpha: 0.16 })

  // Пара широких разводов тона: равномерно пожелтевшая бумага выглядит
  // перекрашенной, настоящая желтеет пятнами от того, как лежала.
  for (let i = 0; i < 2; i++) {
    const cx = w * (0.2 + rng() * 0.6)
    const cy = h * (0.15 + rng() * 0.7)
    g.ellipse(cx, cy, w * (0.3 + rng() * 0.25), h * (0.2 + rng() * 0.2))
      .fill({ color: AGE_TONE, alpha: 0.10 })
  }

  const clip = new Graphics()
  clip.roundRect(0, 0, w, h, r).fill({ color: 0xffffff })
  g.mask = clip
  parent.addChild(clip, g)
}

/** Износ ПОВЕРХ краски: пятна, крап, потемневший кант, выцветание печати. */
function ageWear(parent: Container, w: number, h: number, rng: () => number): void {
  const g = new Graphics()
  const r = w * 0.075

  // Лёгкая вуаль цвета бумаги поверх всего — печать чуть выцвела.
  g.roundRect(0, 0, w, h, r).fill({ color: PAPER, alpha: 0.08 })

  // Разводы. Три вложенных эллипса вместо блюра — тот же приём, что у
  // контактной тени кассетника: пятно никто не разглядывает в упор.
  const stains = 2 + Math.floor(rng() * 2)
  for (let i = 0; i < stains; i++) {
    const cx = w * (0.1 + rng() * 0.8)
    const cy = h * (0.1 + rng() * 0.8)
    const rad = w * (0.07 + rng() * 0.12)
    for (const [k, alpha] of [[1.0, 0.03], [0.68, 0.035], [0.4, 0.04]] as const) {
      g.ellipse(cx, cy, rad * k, rad * k * (0.7 + rng() * 0.5)).fill({ color: AGE_STAIN, alpha })
    }
  }

  // След от кружки достаётся не каждой карте: примета, а не орнамент.
  if (rng() < 0.35) {
    g.circle(w * (0.25 + rng() * 0.5), h * (0.2 + rng() * 0.6), w * (0.12 + rng() * 0.08))
      .stroke({ color: AGE_STAIN, width: Math.max(1, w * 0.012), alpha: 0.06 })
  }

  // Крап — бурые точки старой бумаги (foxing).
  const specks = 18 + Math.floor(rng() * 14)
  for (let i = 0; i < specks; i++) {
    g.circle(w * rng(), h * rng(), Math.max(0.4, w * (0.002 + rng() * 0.006)))
      .fill({ color: AGE_STAIN, alpha: 0.05 + rng() * 0.09 })
  }

  // Кант затёрт и потемнел: две рамки разной ширины вместо градиента.
  g.roundRect(1, 1, w - 2, h - 2, r).stroke({ color: AGE_STAIN, width: w * 0.045, alpha: 0.05 })
  g.roundRect(1, 1, w - 2, h - 2, r).stroke({ color: AGE_STAIN, width: w * 0.015, alpha: 0.08 })

  const clip = new Graphics()
  clip.roundRect(0, 0, w, h, r).fill({ color: 0xffffff })
  g.mask = clip
  parent.addChild(clip, g)
}

function cardShape(g: Graphics, w: number, h: number): void {
  const r = w * 0.075
  g.roundRect(0, 0, w, h, r).fill({ color: PAPER })
  g.roundRect(0.5, 0.5, w - 1, h - 1, r).stroke({ color: PAPER_EDGE, width: 1.5 })
}

function drawCorner(
  parent: Container,
  label: string,
  suit: Suit,
  w: number,
  h: number,
  color: number,
  flip: boolean,
): void {
  const pad = w * 0.075
  const fontSize = w * 0.21

  const pipSize = w * 0.125
  // Якорь по центру и поворот на 180°. Отрицательный масштаб при якоре в
  // углу разворачивает глиф ОТ точки привязки, и нижний индекс уезжает за
  // пределы карты — снаружи это читается как чужая карта под текущей.
  const cx = pad + pipSize * 0.62
  const cyText = h * 0.078
  const cyPip = h * 0.196

  const mirror = (x: number, y: number): [number, number] => (flip ? [w - x, h - y] : [x, y])

  const [tx, ty] = mirror(cx, cyText)
  const text = new Text({
    text: label,
    style: {
      // Georgia есть в Windows/macOS/Android и содержит кириллицу.
      // Финальную типографику всё равно проверять на В/Д/К/Т (§13).
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize,
      fontWeight: '600',
      fill: color,
    },
  })
  text.anchor.set(0.5)
  text.position.set(tx, ty)
  text.rotation = flip ? Math.PI : 0
  parent.addChild(text)

  const [px, py] = mirror(cx, cyPip)
  const pip = new Graphics()
  drawSuit(pip, suit, px, py, pipSize, color, flip)
  parent.addChild(pip)
}

/**
 * Лицо карты с иллюстрацией.
 *
 * Картинка кладётся по принципу cover — заполняет окно целиком, лишнее
 * срезается маской. Вписывание по contain оставляло бы поля разной ширины
 * на картинках разных пропорций, и колода перестала бы читаться как одна
 * колода.
 *
 * Окно — то же поле, что у рубашки (buildBack): бумажный кант по краю,
 * арт внутри. Раньше иллюстрация шла в самый край карты, и рамки фигурных
 * не совпадали с кремовым кантом числовых — колода разваливалась на две
 * (фидбек тестеров).
 *
 * Пипсы при этом не рисуются вовсе. Десять чёрных значков поверх пейзажа —
 * это не «карта с картинкой», а картинка, испорченная значками. Ранг
 * читается с угловой плашки, и в «Пауке» именно её игрок и читает: у
 * накрытой карты видно только верхнюю полоску.
 */
function drawArtFace(parent: Container, art: Texture, w: number, h: number): void {
  const radius = w * 0.075
  const fx = w * 0.035
  const fy = h * 0.024
  const fw = w * 0.93
  const fh = h * 0.952

  const sprite = new Sprite(art)
  const scale = Math.max(fw / art.width, fh / art.height)
  sprite.width = art.width * scale
  sprite.height = art.height * scale
  sprite.anchor.set(0.5)
  sprite.position.set(fx + fw / 2, fy + fh / 2)

  const clip = new Graphics()
  clip.roundRect(fx, fy, fw, fh, radius * 0.8).fill({ color: 0xffffff })
  sprite.mask = clip

  parent.addChild(clip, sprite)
}

/**
 * Угловой индекс поверх иллюстрации.
 *
 * Отличается от индекса на бумажной карте наличием плашки: без неё ранг
 * тонет на тёмном пейзаже, а светлый вариант — на снежном. Плашка выходит
 * за край карты, поэтому наружные углы срезаются маской карты и скруглён
 * остаётся только внутренний — получается уголок, а не наклейка.
 */
function drawIndexTab(
  parent: Container,
  label: string,
  suit: Suit,
  w: number,
  h: number,
  color: number,
  flip: boolean,
): void {
  // ЭКСПЕРИМЕНТ: плашка убрана — индекс лежит прямо на иллюстрации.
  // Читаемость на тёмном/светлом арте держит обводка бумажного цвета у
  // цифры и «гало» под значком масти. Если не приживётся — вернуть
  // roundRect с PAPER 0.93 и маской карты (см. историю файла).
  const fontSize = w * 0.22
  const pipSize = w * 0.135
  const cx = w * 0.115
  const cyText = h * 0.072
  const cyPip = h * 0.185

  const mirror = (px: number, py: number): [number, number] =>
    flip ? [w - px, h - py] : [px, py]

  const [tx, ty] = mirror(cx, cyText)
  const text = new Text({
    text: label,
    style: {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize,
      fontWeight: '700',
      fill: color,
      stroke: { color: PAPER, width: Math.max(2, fontSize * 0.14), join: 'round' },
    },
  })
  text.anchor.set(0.5)
  text.position.set(tx, ty)
  text.rotation = flip ? Math.PI : 0
  parent.addChild(text)

  const [px, py] = mirror(cx, cyPip)
  // Обводка для Graphics-значка: чуть больший бумажный силуэт под ним.
  const halo = new Graphics()
  drawSuit(halo, suit, px, py, pipSize * 1.28, PAPER, flip)
  parent.addChild(halo)
  const pip = new Graphics()
  drawSuit(pip, suit, px, py, pipSize, color, flip)
  parent.addChild(pip)
}

function buildFace(
  suit: Suit,
  rank: Rank,
  style: DeckStyle,
  w: number,
  h: number,
  art?: DeckArt,
): Container {
  const card = new Container()
  const color = isRed(suit) ? RED : INK
  const labels = style.locale === 'ru' ? RANK_LABELS_RU : RANK_LABELS_EN
  const label = labels[rank]

  const bg = new Graphics()
  cardShape(bg, w, h)
  card.addChild(bg)

  // Каким рангам положена иллюстрация — решает манифест колоды, а не код:
  // что wire_deck.py опубликовал, то и рисуется. У базовой колоды числовые
  // 2..10 намеренно без картинок (полсотни пейзажей в раскладке сливались
  // в шум), а у паков вроде таро числовые — часть характера колоды.
  const artwork = art?.faces?.get(faceKey(suit, rank))

  if (artwork) {
    drawArtFace(card, artwork, w, h)
    if (!art?.hideIndex) {
      drawIndexTab(card, label, suit, w, h, color, false)
      drawIndexTab(card, label, suit, w, h, color, true)
    }
    return card
  }

  // Классическая карта собирается слоями, как настоящая: пожелтевшая
  // бумага -> печать -> износ. Состаривание процедурное и детерминированное,
  // чтобы карта вписывалась в сцену рядом с нарисованными фигурами, а не
  // выглядела ксерокопией из другой колоды.
  const rng = agedRng(suit.charCodeAt(0) * 131 + rank * 17)
  agePaper(card, w, h, rng)

  drawCorner(card, label, suit, w, h, color, false)
  drawCorner(card, label, suit, w, h, color, true)

  if (rank === 1) {
    const ace = new Graphics()
    drawSuit(ace, suit, w / 2, h / 2, w * 0.46, color)
    card.addChild(ace)
  } else if (rank >= 11) {
    const glyph = new Text({
      text: label,
      style: {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: w * 0.4,
        fontWeight: '600',
        fill: color,
      },
    })
    glyph.anchor.set(0.5)
    glyph.position.set(w / 2, h * 0.44)
    card.addChild(glyph)

    const pip = new Graphics()
    drawSuit(pip, suit, w / 2, h * 0.63, w * 0.17, color)
    card.addChild(pip)
  } else {
    const pips = new Graphics()
    // Поле пипсов держится внутри 44..124 по вертикали: выше и ниже стоят
    // угловые индексы, и налезающий на них пипс читается как грязь.
    const fieldW = w * 0.27
    const fieldH = h * 0.20
    const size = w * 0.185

    for (const [nx, ny] of PIPS[rank]) {
      drawSuit(pips, suit, w / 2 + nx * fieldW, h / 2 + ny * fieldH, size, color, ny > 0.01)
    }
    card.addChild(pips)
  }

  ageWear(card, w, h, rng)

  return card
}

function buildBack(w: number, h: number, art?: Texture): Container {
  const back = new Container()
  const r = w * 0.075

  if (art) {
    // Рисунок кладётся в то же поле, что и процедурная рубашка: бумажная
    // подложка по краю, арт внутри. Иначе рубашка идёт в край карты, а
    // лица — с кремовой рамкой, и колода перестаёт выглядеть колодой.
    const paper = new Graphics()
    paper.roundRect(0, 0, w, h, r).fill({ color: PAPER })
    back.addChild(paper)

    const fx = w * 0.035
    const fy = h * 0.024
    const fw = w * 0.93
    const fh = h * 0.952

    const sprite = new Sprite(art)
    sprite.width = fw
    sprite.height = fh
    sprite.position.set(fx, fy)

    const clip = new Graphics()
    clip.roundRect(fx, fy, fw, fh, r * 0.8).fill({ color: 0xffffff })
    sprite.mask = clip

    back.addChild(clip, sprite)
    return back
  }

  const g = new Graphics()
  g.roundRect(0, 0, w, h, r).fill({ color: PAPER })
  g.roundRect(w * 0.035, h * 0.024, w * 0.93, h * 0.952, r * 0.8).fill({ color: BACK_FIELD })
  back.addChild(g)

  // Ромбовидная сетка. Рисуется в маске карты, за края не выходит.
  const net = new Graphics()
  const step = w * 0.135
  for (let i = -Math.ceil(h / step); i < Math.ceil(w / step) + 1; i++) {
    net.moveTo(i * step, 0).lineTo(i * step + h, h)
    net.moveTo(i * step, h).lineTo(i * step + h, 0)
  }
  net.stroke({ color: BACK_LINE, width: Math.max(1, w * 0.008), alpha: 0.28 })

  const clip = new Graphics()
  clip.roundRect(w * 0.035, h * 0.024, w * 0.93, h * 0.952, r * 0.8).fill({ color: 0xffffff })
  net.mask = clip
  back.addChild(clip, net)

  const emblem = new Graphics()
  drawSuit(emblem, 'S', w / 2, h / 2, w * 0.34, BACK_LINE)
  emblem.alpha = 0.45
  back.addChild(emblem)

  return back
}

function buildSlot(w: number, h: number): Container {
  const slot = new Container()
  const g = new Graphics()
  g.roundRect(1, 1, w - 2, h - 2, w * 0.075)
    .fill({ color: 0x000000, alpha: 0.16 })
    .stroke({ color: 0xffffff, width: 2, alpha: 0.14 })
  slot.addChild(g)
  return slot
}

/**
 * Собрать атлас. Требует рендерер, поэтому вызывается после Stage.init().
 *
 * Атлас кладётся в сетку 9×6 = 54 ячейки (52 лица + рубашка + пустое
 * место). Такая форма ближе к квадрату: длинная полоса упирается в лимит
 * размера текстуры на мобильных раньше, чем исчерпает ячейки.
 */
export function buildDeckAtlas(
  renderer: Renderer,
  style: DeckStyle,
  art?: DeckArt,
): DeckAtlas {
  const w = Math.round(style.cardWidth)
  const h = Math.round(style.cardWidth * CARD_ASPECT)
  const cols = 9
  const rows = 6
  // Зазор между ячейками. Без него билинейная фильтрация на краю спрайта
  // подмешивает соседнюю карту, и по периметру идёт цветная кайма.
  const pad = 2

  const stage = new Container()
  const frames = new Map<string, Rectangle>()

  let index = 0
  const place = (child: Container, key: string): void => {
    const x = (index % cols) * (w + pad) + pad
    const y = Math.floor(index / cols) * (h + pad) + pad
    child.position.set(x, y)
    stage.addChild(child)
    frames.set(key, new Rectangle(x, y, w, h))
    index++
  }

  for (const suit of SUITS) {
    for (let rank = 1 as Rank; rank <= 13; rank = (rank + 1) as Rank) {
      place(buildFace(suit, rank, style, w, h, art), faceKey(suit, rank))
    }
  }
  place(buildBack(w, h, art?.back), 'back')
  place(buildSlot(w, h), 'slot')

  const cssW = cols * (w + pad) + pad
  const cssH = rows * (h + pad) + pad

  // Максимум разрешения: печём так, чтобы ячейка карты была не мельче
  // исходника арта — на любом экране карта несёт все пиксели мастера, а
  // вывод в экранный размер идёт по мипмапам атласа. Потолок — лимит
  // текстуры GPU (у мобильных обычно 4096): атлас, не влезший в лимит,
  // молча обрезался бы по правому краю.
  let resolution = style.resolution
  if (art?.faces) {
    let srcW = 0
    for (const t of art.faces.values()) srcW = Math.max(srcW, t.width)
    if (srcW) resolution = Math.max(resolution, srcW / w)
  }
  const maxTexture = 4096
  resolution = Math.max(1, Math.min(resolution, maxTexture / cssW, maxTexture / cssH))

  const target = RenderTexture.create({
    width: cssW,
    height: cssH,
    resolution,
    antialias: true,
    autoGenerateMipmaps: true,
  })
  renderer.render({ container: stage, target })
  // У рендер-текстуры мипмапы сами не пересчитываются — дёрнуть руками,
  // иначе вывод с уменьшением снова пойдёт по верхнему уровню без них.
  target.source.updateMipmaps()
  stage.destroy({ children: true })

  const textures = new Map<string, Texture>()
  for (const [key, frame] of frames) {
    textures.set(key, new Texture({ source: target.source, frame }))
  }

  return {
    face: (suit, rank) => textures.get(faceKey(suit, rank))!,
    back: textures.get('back')!,
    slot: textures.get('slot')!,
    cardWidth: w,
    cardHeight: h,
    destroy() {
      for (const t of textures.values()) t.destroy()
      target.destroy(true)
    },
  }
}
