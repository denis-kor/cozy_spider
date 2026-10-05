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
  /** Логическая ширина карты. Высота — по cardAspect(compact). */
  cardWidth: number
  /**
   * Телефонная карта: вытянутая, индекс на своей шапке, арт ниже целиком.
   * Решает раскладка (см. COMPACT_CORNER_W), атлас только исполняет.
   */
  compact?: boolean
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
  /** Множитель яркости арта (`"brightness"` в deck.json). */
  brightness?: number
  /** Обводка углового номинала (`"outline"` в deck.json). */
  outline?: IndexOutline
  /** Цвет червей и бубён (`"colors".red` в deck.json). По умолчанию RED. */
  red?: number
  /** Цвет пик и треф (`"colors".black`). По умолчанию INK. */
  black?: number
  /**
   * Цвет рамки вокруг арта на лицах и рубашке (`"colors".frame`). По
   * умолчанию — бумага. Касается только карт с картинкой: процедурные
   * лица остаются бумажными, на них рамка — это и есть вся карта.
   */
  frame?: number
  /** Варианты звука раздачи (`"sounds".deal`). Нет — раздача беззвучная. */
  dealSounds?: string[]
}

export interface IndexOutline {
  /** Цвет обводки. По умолчанию — бумага. */
  color?: number
  /** Толщина множителем: 1 — общая, 0 — без обводки. */
  width?: number
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

function cardShape(g: Graphics, w: number, h: number, frame?: number): void {
  const r = w * 0.075
  g.roundRect(0, 0, w, h, r).fill({ color: frame ?? PAPER })
  g.roundRect(0.5, 0.5, w - 1, h - 1, r).stroke({
    color: frame === undefined ? PAPER_EDGE : shade(frame, 0.82),
    width: 1.5,
  })
}

/** Затемнить цвет: кромка рамки чуть темнее самой рамки, как у бумаги. */
function shade(color: number, k: number): number {
  const r = Math.round(((color >> 16) & 0xff) * k)
  const g = Math.round(((color >> 8) & 0xff) * k)
  const b = Math.round((color & 0xff) * k)
  return (r << 16) | (g << 8) | b
}

/**
 * Во сколько раз укрупняется угловой индекс на карте шириной `w`.
 *
 * Постоянная доля карты работает только на просторном экране. На телефоне
 * в портрете десять колонок дают карту ~36 px, и ранг при доле 0.19
 * выходит семь пикселей — не читается вообще. Поэтому чем меньше карта,
 * тем большую её долю занимает индекс: от 1.0 на картах шире 90 px до 1.5
 * на самых мелких. Игрок на телефоне видит из-под накрывающей карты ту же
 * узнаваемую полоску, что и на мониторе, просто более «плакатную».
 */
export function cornerScale(w: number): number {
  const t = Math.min(1, Math.max(0, (90 - w) / (90 - 36)))
  return 1 + t * 0.5
}

/**
 * Нижняя кромка углового индекса в долях ВЫСОТЫ карты.
 *
 * Единственный источник правды для пола `faceUpStep` в раскладке: из-под
 * накрывающей карты ранг и масть обязаны торчать целиком. Раньше порог был
 * вписан в CardTable числом 0.22 и комментарием «подстроен под drawCorner» —
 * такая связь живёт ровно до первой правки уголка.
 */
export function cornerIndexBottom(w: number, compact = false): number {
  if (compact) return COMPACT_HEADER / COMPACT_ASPECT
  // 0.172h — центр значка масти, 0.115w — его размер (половина в долях
  // высоты: 0.0575w / 1.45 ≈ 0.0397h). Оба растут вместе с cornerScale.
  return cornerScale(w) * 0.212
}

/**
 * Ширина карты, ниже которой раскладка переходит на «телефонную» карту.
 *
 * Десять колонок в портрете дают карту ~36 px, и даже укрупнённый в
 * полтора раза столбик «ранг над мастью» выходит рангом в десять
 * пикселей. Портальные пасьянсы решают это одинаково: ранг и масть встают
 * В ОДНУ СТРОКУ поперёк всей карты, ранг почти в половину её ширины.
 *
 * Решает раскладка (CardTable.computeLayout) и только по ширине: мельче
 * 44 px (MIN_CARD_W) карта бывает лишь тогда, когда упёрлась в десять
 * колонок, то есть в портрете телефона. При пороге 56 горизонтальный
 * телефон на втором проходе подбора размера проваливался в телефонный
 * режим и карта ужималась с 57 до 46 px. Атлас получает готовый флаг
 * `compact` и порог сам не сравнивает: иначе раскладка и атлас округляли
 * бы ширину по-разному и на самой границе расходились.
 */
export const COMPACT_CORNER_W = 44

// Геометрия телефонной карты в долях её ШИРИНЫ: ширина у неё — единственная
// данность, высота выводится из шапки и окна арта.
const C_PAD = 0.07
const C_FONT = 0.46
const C_PIP = 0.28
const C_GAP = 0.04
/**
 * Где стоит центр строки ранга и где кончается сам индекс.
 *
 * Текст с якорем 0.5 стоит центром строки: у Georgia 600 высота строки
 * 0.92em над базовой линией и 0.22em под ней, так что база лежит на 0.35em
 * ниже центра. Заглавные (A, K, Q, J) поднимаются на 0.71em над базой, то
 * есть до 0.36em над центром, обводка добавляет ~0.07em — верх индекса на
 * 0.43em выше центра. Цифры Georgia старого стиля: 3, 4, 5, 7, 9 и Q уходят
 * хвостом на 0.18–0.2em под базу — с обводкой низ индекса на 0.62em ниже
 * центра. Замерено measureText в браузере.
 *
 * Первая версия ставила центр на полкегля от кромки, а низ считала по
 * 0.42em: сверху пропадал воздух, снизу хвосты цифр заезжали на арт.
 */
const C_TEXT_Y = C_PAD + C_FONT * 0.43
const C_INDEX_BOTTOM = Math.max(C_TEXT_Y + C_FONT * 0.62, C_TEXT_Y + C_PIP / 2)
/** Высота шапки с индексом: низ индекса плюс воздух до окна арта. */
const COMPACT_HEADER = C_INDEX_BOTTOM + 0.03

// Окно арта — то же, что на обычной карте (drawArtFace): кант 0.035 по
// бокам, а высота такая, что картинка ложится в окно в тех же
// пропорциях и с той же обрезкой, что на десктопе.
const ART_X = 0.035
const ART_W = 0.93
const ART_H = CARD_ASPECT * 0.952
const ART_BOTTOM = CARD_ASPECT * 0.024

/**
 * Пропорция телефонной карты: шапка + окно арта целиком + нижний кант.
 *
 * Крупный индекс поверх арта обычной карты садился у лягушачьей колоды
 * прямо на верхний ряд лягушек — номинал и картинка налезали друг на
 * друга. Шире карта стать не может (десять колонок), а высоты в портрете
 * полэкрана: карта вытягивается, индекс получает свою полоску на рамке, и
 * арт виден целиком, ничем не накрыт.
 */
export const COMPACT_ASPECT = COMPACT_HEADER + ART_H + ART_BOTTOM

/** Пропорция карты в режиме раскладки. */
export function cardAspect(compact: boolean): number {
  return compact ? COMPACT_ASPECT : CARD_ASPECT
}

interface CompactCorner {
  fontSize: number
  pipSize: number
  /** Центр ранга и центр масти. */
  tx: number
  ty: number
  px: number
  py: number
  /** Шире ранг не пускаем: «10» обязан уместиться рядом с мастью. */
  maxTextW: number
  /** Нижняя кромка шапки в px от верха карты — здесь начинается окно арта. */
  header: number
}

function compactCorner(w: number): CompactCorner {
  const pad = w * C_PAD
  const pipSize = w * C_PIP
  const gap = w * C_GAP
  const ty = w * C_TEXT_Y
  return {
    fontSize: w * C_FONT,
    pipSize,
    tx: pad + (w - pad * 2 - pipSize - gap) / 2,
    ty,
    px: w - pad - pipSize / 2,
    py: ty,
    maxTextW: w - pad * 2 - pipSize - gap,
    header: w * COMPACT_HEADER,
  }
}

/** Ужать ранг по ширине, если «10» не влез рядом с мастью. */
function fitText(text: Text, maxW: number): void {
  if (text.width > maxW) text.scale.set(maxW / text.width)
}

function drawCorner(
  parent: Container,
  label: string,
  suit: Suit,
  w: number,
  h: number,
  color: number,
  flip: boolean,
  compact = false,
): void {
  const k = cornerScale(w)
  const pad = w * 0.075
  let fontSize = w * 0.19 * k

  let pipSize = w * 0.115 * k
  // Якорь по центру и поворот на 180°. Отрицательный масштаб при якоре в
  // углу разворачивает глиф ОТ точки привязки, и нижний индекс уезжает за
  // пределы карты — снаружи это читается как чужая карта под текущей.
  let textX = pad + pipSize * 0.62
  let pipX = textX
  // Ранг и масть подтянуты к верхней кромке и друг к другу: в «Пауке»
  // из-под накрывающей карты видна только верхняя полоска, и оба знака
  // обязаны уместиться в неё вместе. Нижняя кромка значка держится выше
  // ~0.215h — под этот порог подстроен пол faceUpStep в раскладке.
  let cyText = h * 0.068 * k
  let cyPip = h * 0.172 * k
  let maxTextW = Infinity

  // Мелкая карта (телефон) — ранг и масть в строку, см. COMPACT_CORNER_W.
  if (compact) {
    const c = compactCorner(w)
    fontSize = c.fontSize
    pipSize = c.pipSize
    textX = c.tx
    pipX = c.px
    cyText = c.ty
    cyPip = c.py
    maxTextW = c.maxTextW
  }

  const mirror = (x: number, y: number): [number, number] => (flip ? [w - x, h - y] : [x, y])

  const [tx, ty] = mirror(textX, cyText)
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
  fitText(text, maxTextW)
  parent.addChild(text)

  const [px, py] = mirror(pipX, cyPip)
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
/** Серый tint = умножение цвета: 0.85 гасит арт на 15%, не трогая оттенок. */
function brightnessTint(v?: number): number {
  const k = Math.round(Math.min(1, Math.max(0, v ?? 1)) * 255)
  return (k << 16) | (k << 8) | k
}

function drawArtFace(
  parent: Container,
  art: Texture,
  w: number,
  h: number,
  bleed: boolean,
  brightness?: number,
  /** Окно арта вместо стандартного (телефонная карта: арт под шапкой). */
  window?: { x: number; y: number; w: number; h: number },
): void {
  const radius = w * 0.075
  // Пейзажная колода (pond) framed под угловой номинал: арт вставляется в
  // окно с кремовым кантом, чтобы фигуры совпадали с числовыми картами.
  // Колода-цельный-дизайн (таро, index:false) несёт собственный кант прямо
  // в арте — там рисуем ПОД ОБРЕЗ: иначе поверх родной рамки ложится ещё и
  // кремовая, карта получает двойную рамку (запрос дизайнера — убрать её).
  const fx = window ? window.x : bleed ? 0 : w * 0.035
  const fy = window ? window.y : bleed ? 0 : h * 0.024
  const fw = window ? window.w : bleed ? w : w * 0.93
  const fh = window ? window.h : bleed ? h : h * 0.952

  const sprite = new Sprite(art)
  sprite.tint = brightnessTint(brightness)
  const scale = Math.max(fw / art.width, fh / art.height)
  sprite.width = art.width * scale
  sprite.height = art.height * scale
  sprite.anchor.set(0.5)
  sprite.position.set(fx + fw / 2, fy + fh / 2)

  const clip = new Graphics()
  // Под обрез скругление окна совпадает со скруглением карты — арт ложится
  // ровно в силуэт, бумаги по краю не остаётся.
  clip.roundRect(fx, fy, fw, fh, bleed ? radius : radius * 0.8).fill({ color: 0xffffff })
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
  outline?: IndexOutline,
  compact = false,
): void {
  const outlineColor = outline?.color ?? PAPER
  const outlineWidth = outline?.width ?? 1
  // ЭКСПЕРИМЕНТ: плашка убрана — индекс лежит прямо на иллюстрации.
  // Читаемость на тёмном/светлом арте держит обводка бумажного цвета у
  // цифры и «гало» под значком масти. Если не приживётся — вернуть
  // roundRect с PAPER 0.93 и маской карты (см. историю файла).
  const k = cornerScale(w)
  let fontSize = w * 0.2 * k
  let pipSize = w * 0.125 * k
  let textX = w * 0.115 * k
  let pipX = textX
  // Тот же поджатый уголок, что у бумажных карт (drawCorner): из-под
  // накрывающей карты ранг и масть должны читаться одинаково независимо
  // от того, лицо это с иллюстрацией или процедурное.
  let cyText = h * 0.068 * k
  let cyPip = h * 0.17 * k
  let maxTextW = Infinity

  if (compact) {
    const c = compactCorner(w)
    fontSize = c.fontSize
    pipSize = c.pipSize
    textX = c.tx
    pipX = c.px
    cyText = c.ty
    cyPip = c.py
    maxTextW = c.maxTextW
  }

  const mirror = (px: number, py: number): [number, number] =>
    flip ? [w - px, h - py] : [px, py]

  const [tx, ty] = mirror(textX, cyText)
  const text = new Text({
    text: label,
    style: {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize,
      fontWeight: '700',
      fill: color,
      // Обводка — настройка колоды: у каждой своя, по умолчанию бумажная.
      ...(outlineWidth > 0
        ? {
            stroke: {
              color: outlineColor,
              width: Math.max(1, fontSize * 0.14 * outlineWidth),
              join: 'round' as const,
            },
          }
        : {}),
    },
  })
  text.anchor.set(0.5)
  text.position.set(tx, ty)
  text.rotation = flip ? Math.PI : 0
  fitText(text, maxTextW)
  parent.addChild(text)

  const [px, py] = mirror(pipX, cyPip)
  // Обводка для Graphics-значка: чуть больший бумажный силуэт под ним.
  if (outlineWidth > 0) {
    const halo = new Graphics()
    drawSuit(halo, suit, px, py, pipSize * (1 + 0.28 * outlineWidth), outlineColor, flip)
    parent.addChild(halo)
  }
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
  const compact = !!style.compact
  const color = isRed(suit) ? (art?.red ?? RED) : (art?.black ?? INK)
  const labels = style.locale === 'ru' ? RANK_LABELS_RU : RANK_LABELS_EN
  const label = labels[rank]

  // Каким рангам положена иллюстрация — решает манифест колоды, а не код:
  // что wire_deck.py опубликовал, то и рисуется. У базовой колоды числовые
  // 2..10 намеренно без картинок (полсотни пейзажей в раскладке сливались
  // в шум), а у паков вроде таро числовые — часть характера колоды.
  const artwork = art?.faces?.get(faceKey(suit, rank))

  const bg = new Graphics()
  cardShape(bg, w, h, artwork ? art?.frame : undefined)
  card.addChild(bg)

  if (artwork) {
    // Колода со своим номиналом в арте (index:false) — цельный дизайн карты:
    // рисуем под обрез, без кремового канта и без нашего углового индекса.
    const bleed = !!art?.hideIndex
    // Бумажный кант гасится вместе с артом: иначе вокруг приглушённой
    // картинки остаётся яркая рамка и карта читается «в паспарту».
    bg.tint = brightnessTint(art?.brightness)
    if (compact && !bleed) {
      // Телефонная карта: индекс на своей полоске рамки, арт ниже целиком
      // (см. COMPACT_ASPECT). Нижнего уголка нет — он лёг бы на арт, а
      // верхний и так виден у любой карты колонки.
      const header = compactCorner(w).header
      drawArtFace(card, artwork, w, h, false, art?.brightness, {
        x: w * ART_X,
        y: header,
        w: w * ART_W,
        h: h - header - w * ART_BOTTOM,
      })
      drawIndexTab(card, label, suit, w, h, color, false, art?.outline, true)
      return card
    }
    drawArtFace(card, artwork, w, h, bleed, art?.brightness)
    if (!art?.hideIndex) {
      drawIndexTab(card, label, suit, w, h, color, false, art?.outline)
      drawIndexTab(card, label, suit, w, h, color, true, art?.outline)
    }
    return card
  }

  // Классическая карта собирается слоями, как настоящая: пожелтевшая
  // бумага -> печать -> износ. Состаривание процедурное и детерминированное,
  // чтобы карта вписывалась в сцену рядом с нарисованными фигурами, а не
  // выглядела ксерокопией из другой колоды.
  const rng = agedRng(suit.charCodeAt(0) * 131 + rank * 17)
  agePaper(card, w, h, rng)

  // На телефонной карте нижний перевёрнутый уголок не нужен: верхний виден
  // и у накрытой карты, и у последней в колонке.
  drawCorner(card, label, suit, w, h, color, false, compact)
  if (!compact) drawCorner(card, label, suit, w, h, color, true)

  if (compact) {
    // Пипсы в 35-пиксельной карте — рябь, а глиф фигуры повторяет индекс.
    // Портальные пасьянсы ставят под индексом один крупный значок масти:
    // масть читается с расстояния вытянутой руки.
    const header = compactCorner(w).header
    const free = h - header
    const big = new Graphics()
    drawSuit(big, suit, w / 2, header + free * 0.5, Math.min(w * 0.62, free * 0.75), color)
    card.addChild(big)
  } else if (rank === 1) {
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
    // Пипсы заполняют лицо во всю высоту, как на настоящей карте: две
    // колонки, крайние ряды у верхней и нижней кромки (ny=±1 -> ~0.17..0.83h).
    // Колонки поджаты внутрь (30/70% ширины), чтобы верхний-левый и
    // нижний-правый пипс расходились с угловым индексом, а не налезали на него.
    const fieldW = w * 0.20
    const fieldH = h * 0.34
    const size = w * 0.17

    // Все пипсы стоят прямо, как на референсе колоды: нижнюю половину НЕ
    // переворачиваем (традиционный «перевёрнутый низ» тут не нужен —
    // дизайнер попросил единую ориентацию значков).
    for (const [nx, ny] of PIPS[rank]) {
      drawSuit(pips, suit, w / 2 + nx * fieldW, h / 2 + ny * fieldH, size, color)
    }
    card.addChild(pips)
  }

  ageWear(card, w, h, rng)

  // Яркость колоды гасит и бумажные карты, а не только иллюстрации: иначе
  // светлые числовые выпадают из приглушённого стола рядом с фигурами.
  if (art?.brightness !== undefined) card.tint = brightnessTint(art.brightness)

  return card
}

function buildBack(
  w: number,
  h: number,
  art?: Texture,
  bleed = false,
  brightness?: number,
  frame?: number,
): Container {
  const back = new Container()
  const r = w * 0.075

  if (art) {
    // Пейзажная рубашка кладётся в то же поле, что и лица: бумажная подложка
    // по краю, арт внутри — иначе рубашка пошла бы в край, а лица с кантом,
    // и колода перестала бы выглядеть колодой. Рубашка-цельный-дизайн (таро)
    // несёт кант в самом арте — её рисуем под обрез, как и лица этой колоды.
    const fx = bleed ? 0 : w * 0.035
    const fy = bleed ? 0 : h * 0.024
    const fw = bleed ? w : w * 0.93
    const fh = bleed ? h : h * 0.952

    if (!bleed) {
      const paper = new Graphics()
      paper.roundRect(0, 0, w, h, r).fill({ color: frame ?? PAPER })
      paper.tint = brightnessTint(brightness)
      back.addChild(paper)
    }

    // Cover, а не растяжка в окно: на обычной карте пропорции рубашки и
    // окна совпадают и разницы нет, а телефонная карта вытянута — растяжка
    // сплющила бы рисунок, cover срезает лишнее по бокам.
    const sprite = new Sprite(art)
    sprite.tint = brightnessTint(brightness)
    const scale = Math.max(fw / art.width, fh / art.height)
    sprite.width = art.width * scale
    sprite.height = art.height * scale
    sprite.anchor.set(0.5)
    sprite.position.set(fx + fw / 2, fy + fh / 2)

    const clip = new Graphics()
    clip.roundRect(fx, fy, fw, fh, bleed ? r : r * 0.8).fill({ color: 0xffffff })
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
  const h = Math.round(style.cardWidth * cardAspect(!!style.compact))
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
  place(buildBack(w, h, art?.back, !!art?.hideIndex, art?.brightness, art?.frame), 'back')
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
