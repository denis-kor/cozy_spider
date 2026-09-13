import {
  BlurFilter,
  Container,
  FillGradient,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer,
} from 'pixi.js'

import { Game } from '../../core/game'
import { bestMove, movableRunLength } from '../../core/rules'
import { COLUMNS, type Card, type GameEvent, type Move, type SuitCount } from '../../core/types'
import { Tweener, easing } from '../anim'
import { CardView } from './CardView'
import {
  CARD_ASPECT,
  buildDeckAtlas,
  type DeckArt,
  type DeckAtlas,
  type DeckLocale,
} from './deckAtlas'

export interface TableOptions {
  renderer: Renderer
  locale?: DeckLocale
  resolution?: number
  /** Нарисованные иллюстрации. Нет — колода играется на заглушках. */
  art?: DeckArt
}

interface Layout {
  cardW: number
  cardH: number
  originX: number
  originY: number
  columnStep: number
  faceDownStep: number
  faceUpStep: number
  boardW: number
  topBar: number
  bottomBar: number
  /** Размер уменьшенных карт в нижнем лотке: запас и собранные стопки. */
  trayCardW: number
  stockX: number
  stockY: number
  foundationX: number
  foundationY: number
  foundationStep: number
}

interface DragState {
  cards: CardView[]
  from: number
  count: number
  grabX: number
  grabY: number
  lastX: number
  lastY: number
}

const MIN_CARD_W = 44
const TAP_SLOP = 8

/**
 * Мягкая тень под карту.
 *
 * Блюр применяется один раз при запекании в RenderTexture, в кадре
 * фильтров нет. Паддинг обязателен: без него блюр обрежется по краям
 * и тень получится с прямыми обрубленными сторонами.
 */
function makeShadowTexture(renderer: Renderer, w: number, h: number, resolution: number): Texture {
  const pad = Math.round(w * 0.35)
  const g = new Graphics()
  g.roundRect(pad, pad, w, h, w * 0.09).fill({ color: 0x000000 })
  g.filters = [new BlurFilter({ strength: Math.max(4, w * 0.12), quality: 4 })]

  const target = RenderTexture.create({
    width: w + pad * 2,
    height: h + pad * 2,
    resolution,
    antialias: false,
  })
  renderer.render({ container: g, target })
  g.destroy(true)

  return new Texture({ source: target.source })
}

/**
 * Мягкая подложка под картами — «дыхание» тьмы, а не панель.
 *
 * Раньше это был скруглённый прямоугольник с обводкой, и по его краю на
 * фоне читалась рамка: внутри сцена темнее, снаружи светлее, между ними
 * чёткая линия (фидбек дизайнера). Теперь та же подложка печётся ОДИН раз
 * с блюром в RenderTexture — плотная под картами и тающая в ноль к краям.
 * Ни границы, ни линии; в кадре фильтров нет, как у тени карты.
 */
function makeScrimTexture(
  renderer: Renderer,
  w: number,
  h: number,
  radius: number,
  gradient: FillGradient,
  blur: number,
  pad: number,
  resolution: number,
): Texture {
  const g = new Graphics()
  g.roundRect(pad, pad, w, h, radius).fill(gradient)
  g.filters = [new BlurFilter({ strength: blur, quality: 4 })]

  const target = RenderTexture.create({
    width: w + pad * 2,
    height: h + pad * 2,
    resolution,
    antialias: false,
  })
  renderer.render({ container: g, target })
  g.destroy(true)

  return new Texture({ source: target.source })
}

/**
 * Игровой стол: раскладка, ввод, анимации.
 *
 * Состояние берётся из `core`. Логика меняется мгновенно и возвращает
 * семантические события; стол превращает их в движение. Визуальные
 * позиции — догоняющая интерполяция логических, поэтому клик во время
 * летящей карты ничего не ломает (§4).
 */
export class CardTable {
  readonly root = new Container()
  readonly tweener = new Tweener()

  private readonly scrim = new Sprite()
  private readonly slotLayer = new Container()
  private readonly cardLayer = new Container()
  private readonly dragLayer = new Container()

  private atlas!: DeckAtlas
  private shadowTexture!: Texture
  private scrimTexture?: Texture
  private scrimKey = ''
  private renderer: Renderer
  private locale: DeckLocale
  private resolution: number
  private art?: DeckArt

  private views = new Map<number, CardView>()
  private layout!: Layout
  private viewW = 1
  private viewH = 1

  private drag: DragState | null = null
  private selected: { column: number; count: number } | null = null
  private stockPile = new Container()
  private atlasCardW = 0
  /** Стол взведён под стартовую раздачу: колода ждёт стопкой в углу. */
  private dealPending = false

  game: Game

  /** Дёргается после каждого изменения состояния — HUD подписывается сюда. */
  onChange?: () => void

  /** Дёргается один раз в момент победы — сцена запускает торжество. */
  onWon?: () => void

  constructor(game: Game, options: TableOptions) {
    this.game = game
    this.renderer = options.renderer
    this.locale = options.locale ?? 'en'
    this.resolution = options.resolution ?? 2
    this.art = options.art

    this.root.addChild(this.scrim, this.slotLayer, this.cardLayer, this.stockPile, this.dragLayer)
    this.root.eventMode = 'static'
    this.root.on('pointerdown', this.onPointerDown)
    this.root.on('pointermove', this.onPointerMove)
    this.root.on('pointerup', this.onPointerUp)
    this.root.on('pointerupoutside', this.onPointerUp)
  }

  /**
   * Пересобрать атлас под новый размер карты.
   *
   * Атлас растеризуется под конкретный кегль: тянуть 60-пиксельную карту
   * на 160 — это мыло на подписях рангов. Пересборка идёт только при
   * заметном изменении размера, а не на каждый пиксель ресайза.
   */
  private ensureAtlas(cardW: number): void {
    const target = Math.round(cardW)
    if (this.atlas && Math.abs(target - this.atlasCardW) / this.atlasCardW < 0.25) return

    const old = this.atlas
    this.atlas = buildDeckAtlas(
      this.renderer,
      // Атлас печётся минимум в 2x независимо от DPR экрана: на обычном
      // мониторе (DPR 1) это суперсэмплинг — вывод в размер карты идёт
      // усреднением четырёх текселей, и тонкая гравюра арта не рябит.
      // Для retina (DPR 2) это и есть нативный размер.
      { cardWidth: target, locale: this.locale, resolution: Math.max(2, this.resolution) },
      this.art,
    )
    this.atlasCardW = target

    if (this.shadowTexture) this.shadowTexture.destroy(true)
    this.shadowTexture = makeShadowTexture(
      this.renderer,
      target,
      Math.round(target * CARD_ASPECT),
      1,
    )

    if (old) {
      this.rebuildViews()
      old.destroy()
    }
  }

  private rebuildViews(): void {
    // Стол мог быть спрятан разлётом карт на победе — вернуть как было.
    this.stockPile.alpha = 1
    this.slotLayer.alpha = 1
    // Порядок важен: сначала снять анимации, потом уничтожать цели.
    this.tweener.killAll()
    for (const view of this.views.values()) view.destroy()
    this.views.clear()
    this.cardLayer.removeChildren()
    this.dragLayer.removeChildren()
    this.drag = null
  }

  private viewOf(card: Card): CardView {
    let view = this.views.get(card.id)
    if (!view) {
      // Собственный hit-test карте не нужен: попадание считается по
      // раскладке в hitCard(), а 104 интерактивных объекта — это лишние
      // обходы дерева на каждое движение указателя.
      view = new CardView(card, this.atlas, this.shadowTexture)
      this.views.set(card.id, view)
    }
    view.resize(this.layout.cardW, this.layout.cardH)
    return view
  }

  resize(width: number, height: number): void {
    this.viewW = width
    this.viewH = height
    // Без явной hitArea контейнер получает события только там, где под
    // указателем оказался ребёнок: клик по пустой колонке и по запасу
    // проваливался бы мимо.
    this.root.hitArea = new Rectangle(0, 0, width, height)
    this.layout = this.computeLayout(width, height)
    this.ensureAtlas(this.layout.cardW)
    this.drawScrim()
    this.drawSlots()
    this.sync(false)
  }

  /**
   * Раскладка десяти колонок.
   *
   * Вписываемся строго по ширине: все десять колонок обязаны быть видны
   * одновременно. Перекрытие карт сжимается вертикально, пока самая
   * длинная колонка не влезет в высоту.
   *
   * Портретная ориентация на телефоне остаётся нерешённой (§12): при
   * ширине ~375 px карта выходит ~33 px, ранги не читаются. Здесь стоит
   * нижняя граница MIN_CARD_W, ниже которой стол просто упирается —
   * это честный предел, а не решение.
   */
  private computeLayout(width: number, height: number): Layout {
    const sideMargin = Math.max(10, width * 0.018)
    const gap = Math.max(6, width * 0.011)

    // Верх отдан HUD, низ — запасу и собранным последовательностям.
    // Колонки живут строго между ними: карта, уехавшая под кнопку, — это
    // не «мелочь стиля», в неё физически нельзя попасть пальцем.
    const topBar = Math.max(58, height * 0.088)
    // Низ приподнят под укрупнённый лоток: запас должен читаться как
    // «ещё пять раздач», а не как мусор в углу (фидбек тестеров).
    const bottomBar = Math.max(96, height * 0.16)

    const usable = width - sideMargin * 2 - gap * (COLUMNS - 1)
    // Стол не растягивается во всю ширину. Десять колонок «в край» делают
    // карты громоздкими и давят сцену; референс от дизайнера — компактная
    // раскладка с воздухом по бокам, ближе к настольному «Пауку». Ширину
    // карты держим долей экрана; центрирование ниже уже считает по boardW.
    const maxCardW = width * 0.076
    const cardW = Math.max(MIN_CARD_W, Math.min(usable / COLUMNS, maxCardW))
    const cardH = cardW * CARD_ASPECT

    const columnStep = cardW + gap
    const boardW = columnStep * COLUMNS - gap
    const originX = (width - boardW) / 2 + cardW / 2
    const originY = topBar + cardH / 2 + Math.max(6, height * 0.012)

    // Динамическое перекрытие (§12).
    //
    // Считаем по САМОЙ ДЛИННОЙ колонке сейчас, а не по теоретическому
    // худшему случаю. Иначе на старте карты слиплись бы в комок ради
    // ситуации, которая наступит через полсотни ходов, а половина стола
    // осталась бы пустой.
    const available = height - bottomBar - (originY + cardH / 2)

    let worstFaceDown = 1
    let worstFaceUp = 1
    for (const column of this.game.state.tableau) {
      let down = 0
      let up = 0
      for (const card of column) card.faceUp ? up++ : down++
      worstFaceDown = Math.max(worstFaceDown, down)
      worstFaceUp = Math.max(worstFaceUp, up)
    }

    let faceDownStep = cardH * 0.16
    let faceUpStep = cardH * 0.30
    const needed = worstFaceDown * faceDownStep + worstFaceUp * faceUpStep
    if (needed > available) {
      // Ужимаем перекрытие, но у ЛИЦЕВЫХ карт не режем угловой индекс: ранг
      // и масть обязаны торчать из-под накрывающей карты, иначе стопку не
      // прочитать (запрос дизайнера). Недобор высоты добираем с рубашек —
      // там достаточно щели, чтобы карта читалась как «ещё одна». Пол faceUp
      // равен высоте уголка ранг+масть (~0.22 высоты карты, см. drawCorner).
      const k = available / needed
      faceUpStep = Math.max(cardH * 0.22, faceUpStep * k)
      faceDownStep = Math.max(cardH * 0.05, faceDownStep * k)
    }

    // Карта лотка считается ОТ высоты лотка, а не долей игровой карты:
    // доля на высоких экранах вылезала за нижний край, и тестеры видели
    // обрезанные «слишком маленькие карты в углу».
    // +15% по фидбеку: карты лотка казались мелковаты. Потолок cardW
    // остаётся — лоток не должен спорить с игровыми картами.
    const trayCardW = Math.min(cardW, ((bottomBar - 12) / CARD_ASPECT) * 1.15)

    // Укрупнённая карта уже не помещается в полосу целиком, поэтому центр
    // лотка не середина полосы, а «как можно ниже, но с полем 6 px».
    const trayY = Math.min(
      height - bottomBar * 0.5,
      height - (trayCardW * CARD_ASPECT) / 2 - 6,
    )

    return {
      cardW,
      cardH,
      originX,
      originY,
      columnStep,
      faceDownStep,
      faceUpStep,
      boardW,
      topBar,
      bottomBar,
      trayCardW,
      stockX: originX + boardW - cardW / 2 - trayCardW * 0.3,
      stockY: trayY,
      foundationX: originX + trayCardW * 0.35,
      foundationY: trayY,
      foundationStep: trayCardW * 0.45,
    }
  }

  private drawScrim(): void {
    const l = this.layout
    const margin = l.cardW * 0.32
    const x = l.originX - l.cardW / 2 - margin
    const y = l.originY - l.cardH / 2 - margin
    const w = l.boardW + margin * 2
    // Нижний край уводится ЗА экран: плотной границы снизу быть не должно.
    const h = this.viewH + margin - y
    const radius = l.cardW * 0.2

    // Подложка зависит только от размеров ПОЛЯ (не от длины колонок), поэтому
    // тяжёлое запекание с блюром идёт лишь при смене геометрии, а не на
    // каждый ход, хотя sync() и дёргает drawScrim постоянно.
    const key = `${Math.round(w)}x${Math.round(h)}x${Math.round(radius)}`
    if (key === this.scrimKey) return
    this.scrimKey = key

    // Подложка не украшение: без неё карты теряются на детализированном фоне.
    // Но краёв у неё быть не должно — блюр растворяет их в ноль, чтобы на
    // фоне не читалась рамка. Градиент по вертикали: плотно там, где лежат
    // карты, и почти прозрачно ниже — равномерная заливка гасила бы пруд.
    // Плотность подобрана под ТЁМНУЮ сцену: отделять карты от фона, не гасить
    // фон. Запас (blurPad) обязателен — иначе блюр обрежется по краю текстуры.
    const blurPad = Math.round(Math.max(48, l.cardW * 0.7))
    const gradient = new FillGradient(0, blurPad, 0, blurPad + h)
    gradient.addColorStop(0.0, 'rgba(6, 14, 12, 0.46)')
    gradient.addColorStop(0.45, 'rgba(6, 14, 12, 0.32)')
    gradient.addColorStop(1.0, 'rgba(6, 14, 12, 0.08)')

    if (this.scrimTexture) this.scrimTexture.destroy(true)
    this.scrimTexture = makeScrimTexture(
      this.renderer,
      w,
      h,
      radius,
      gradient,
      Math.max(20, l.cardW * 0.28),
      blurPad,
      1,
    )
    this.scrim.texture = this.scrimTexture
    // Форма нарисована со сдвигом blurPad внутри текстуры — компенсируем.
    this.scrim.position.set(x - blurPad, y - blurPad)
  }

  private drawSlots(): void {
    this.slotLayer.removeChildren()
    for (let i = 0; i < COLUMNS; i++) {
      const slot = new Sprite(this.atlas.slot)
      slot.anchor.set(0.5)
      this.slotLayer.addChild(slot)
    }
    this.positionSlots()
  }

  private positionSlots(): void {
    const l = this.layout
    this.slotLayer.children.forEach((slot, i) => {
      const s = slot as Sprite
      s.width = l.cardW
      s.height = l.cardH
      s.position.set(l.originX + i * l.columnStep, l.originY)
    })
  }

  /** Позиция карты с индексом `index` в колонке `column`. */
  private cardPosition(column: number, index: number): { x: number; y: number } {
    const l = this.layout
    const cards = this.game.state.tableau[column]

    let y = l.originY
    for (let i = 0; i < index; i++) {
      y += cards[i].faceUp ? l.faceUpStep : l.faceDownStep
    }
    return { x: l.originX + column * l.columnStep, y }
  }

  /**
   * Привести вид в соответствие с состоянием.
   *
   * Порядок детей пересобирается целиком: в пасьянсе карт всего 104, а
   * попытки точечно двигать z-index — источник трудноуловимых наложений.
   */
  sync(animate: boolean): void {
    const state = this.game.state

    // Перекрытие зависит от длины колонок, поэтому пересчитывается на
    // каждом изменении состояния, а не только при ресайзе окна.
    this.layout = this.computeLayout(this.viewW, this.viewH)
    this.drawScrim()
    this.positionSlots()

    for (let col = 0; col < COLUMNS; col++) {
      const cards = state.tableau[col]
      for (let i = 0; i < cards.length; i++) {
        const view = this.viewOf(cards[i])
        const p = this.cardPosition(col, i)
        view.homeX = p.x
        view.homeY = p.y
        view.refresh()

        if (view.root.parent !== this.cardLayer) this.cardLayer.addChild(view.root)
        else this.cardLayer.setChildIndex(view.root, this.cardLayer.children.length - 1)

        if (animate) {
          view.moveHome(this.tweener, { duration: 0.26, spring: true })
        } else if (this.dealPending) {
          // Стол взведён: держим всю колоду стопкой в правом нижнем углу,
          // рубашками вверх, пока игрок не нажмёт «Играть» (см. dealOut).
          view.showBack(true)
          view.root.rotation = 0
          view.root.position.set(this.layout.stockX, this.layout.stockY)
        } else {
          view.snapHome()
        }
      }
    }

    // Собранные последовательности уезжают с поля.
    const onTable = new Set<number>()
    for (const col of state.tableau) for (const c of col) onTable.add(c.id)

    for (const [id, view] of this.views) {
      if (onTable.has(id)) continue
      view.kill(this.tweener)
      view.destroy()
      this.views.delete(id)
    }

    this.drawStock()
    this.onChange?.()
  }

  /**
   * Нижний лоток: слева собранные последовательности, справа запас.
   *
   * Уменьшенные карты, потому что лоток — это индикатор, а не игровая
   * зона: единственное действие здесь — клик по запасу.
   */
  private drawStock(): void {
    this.stockPile.removeChildren()
    const l = this.layout
    const tw = l.trayCardW
    const th = tw * CARD_ASPECT

    const deals = this.game.state.stock.length
    for (let i = 0; i < deals; i++) {
      const back = new Sprite(this.atlas.back)
      back.anchor.set(0.5)
      back.width = tw
      back.height = th
      back.position.set(l.stockX - i * tw * 0.14, l.stockY - i * tw * 0.06)
      this.stockPile.addChild(back)
    }

    const done = this.game.state.foundations
    for (let i = 0; i < done.length; i++) {
      const top = new Sprite(this.atlas.face(done[i][0].suit, done[i][0].rank))
      top.anchor.set(0.5)
      top.width = tw
      top.height = th
      top.position.set(l.foundationX + i * l.foundationStep, l.foundationY)
      this.stockPile.addChild(top)
    }

    this.stockPile.eventMode = 'none'
  }

  // ---------------------------------------------------------------- ввод

  private columnAt(x: number): number {
    const l = this.layout
    const i = Math.round((x - l.originX) / l.columnStep)
    return Math.max(0, Math.min(COLUMNS - 1, i))
  }

  private hitCard(event: FederatedPointerEvent): { column: number; index: number } | null {
    const local = this.root.toLocal(event.global)
    const column = this.columnAt(local.x)
    const l = this.layout

    if (local.y > this.viewH - l.bottomBar) return null
    if (Math.abs(local.x - (l.originX + column * l.columnStep)) > l.cardW * 0.55) return null

    const cards = this.game.state.tableau[column]
    // Сверху вниз: верхняя карта перекрывает нижние, она и должна выиграть.
    for (let i = cards.length - 1; i >= 0; i--) {
      const p = this.cardPosition(column, i)
      const top = p.y - l.cardH / 2
      const bottom = i === cards.length - 1 ? p.y + l.cardH / 2 : top + this.stepAfter(column, i)
      if (local.y >= top && local.y <= bottom) return { column, index: i }
    }
    return null
  }

  private stepAfter(column: number, index: number): number {
    const cards = this.game.state.tableau[column]
    return cards[index].faceUp ? this.layout.faceUpStep : this.layout.faceDownStep
  }

  private onPointerDown = (event: FederatedPointerEvent): void => {
    const local = this.root.toLocal(event.global)

    // Запас
    const l = this.layout
    const trayH = l.trayCardW * CARD_ASPECT
    if (
      this.game.state.stock.length > 0 &&
      Math.abs(local.x - l.stockX) < l.trayCardW * 0.9 &&
      Math.abs(local.y - l.stockY) < trayH * 0.6
    ) {
      this.tryMove({ t: 'deal' })
      return
    }

    const hit = this.hitCard(event)
    if (!hit) {
      this.clearSelection()
      return
    }

    const cards = this.game.state.tableau[hit.column]
    const run = movableRunLength(cards)
    const count = cards.length - hit.index

    // Тап по цели, когда что-то уже выбрано.
    if (this.selected && this.selected.column !== hit.column) {
      if (this.tryMove({ t: 'move', from: this.selected.column, to: hit.column, count: this.selected.count })) {
        return
      }
    }

    if (!cards[hit.index].faceUp || count > run) {
      this.clearSelection()
      return
    }

    const views = cards.slice(hit.index).map((c) => this.views.get(c.id)!).filter(Boolean)
    for (const view of views) {
      view.kill(this.tweener)
      this.dragLayer.addChild(view.root)
      view.setLift(1)
    }

    this.drag = {
      cards: views,
      from: hit.column,
      count,
      grabX: local.x - views[0].root.x,
      grabY: local.y - views[0].root.y,
      lastX: local.x,
      lastY: local.y,
    }
  }

  private onPointerMove = (event: FederatedPointerEvent): void => {
    if (!this.drag) return
    const local = this.root.toLocal(event.global)

    const vx = local.x - this.drag.lastX
    const vy = local.y - this.drag.lastY
    this.drag.lastX = local.x
    this.drag.lastY = local.y

    const headX = local.x - this.drag.grabX
    const headY = local.y - this.drag.grabY

    this.drag.cards.forEach((view, i) => {
      view.root.position.set(headX, headY + i * this.layout.faceUpStep)
      // Наклон затухает вниз по стопке — нижние карты «тянутся» за верхней.
      view.setTilt(vx * (1 - i * 0.12), vy * (1 - i * 0.12))
    })
  }

  private onPointerUp = (event: FederatedPointerEvent): void => {
    const drag = this.drag
    if (!drag) return
    this.drag = null

    const local = this.root.toLocal(event.global)
    const travelled = Math.hypot(local.x - (drag.grabX + drag.cards[0].homeX), local.y - (drag.grabY + drag.cards[0].homeY))

    for (const view of drag.cards) {
      view.setLift(0)
      view.resetTilt(this.tweener)
    }

    // Короткий тап без перемещения — это выбор, а не бросок.
    if (travelled < TAP_SLOP) {
      this.returnToTable(drag)
      this.selected = this.selected?.column === drag.from ? null : { column: drag.from, count: drag.count }
      this.sync(false)
      this.onChange?.()
      return
    }

    const target = this.columnAt(local.x)
    const move: Move = { t: 'move', from: drag.from, to: target, count: drag.count }

    if (!this.tryMove(move)) {
      this.returnToTable(drag)
      for (const view of drag.cards) {
        view.moveHome(this.tweener, { duration: 0.36, spring: true })
      }
    }
    this.clearSelection()
  }

  private returnToTable(drag: DragState): void {
    for (const view of drag.cards) this.cardLayer.addChild(view.root)
  }

  private clearSelection(): void {
    if (!this.selected) return
    this.selected = null
    this.onChange?.()
  }

  /** Единственная точка, где меняется состояние. Возвращает, прошёл ли ход. */
  tryMove(move: Move): boolean {
    const legal = this.game.legalMoves()
    const ok = legal.some(
      (m) =>
        m.t === move.t &&
        (m.t === 'deal' || (move.t === 'move' && m.from === move.from && m.to === move.to && m.count === move.count)),
    )
    if (!ok) return false

    const events = this.game.apply(move)
    this.applyEvents(events)
    return true
  }

  /**
   * Превращение событий логики в движение.
   *
   * Логика уже посчитала всё до конца — здесь только подача. Поэтому
   * никакой ветки «а вдруг ход не пройдёт» тут быть не может.
   */
  private applyEvents(events: GameEvent[]): void {
    let dealt = false
    for (const event of events) {
      if (event.t === 'dealt') dealt = true
      if (event.t === 'runCompleted') this.flyOutRun(event.cards)
      if (event.t === 'won') this.onWon?.()
    }

    this.sync(true)

    if (dealt) {
      // Раздача идёт стаггером, а не залпом (§12).
      const state = this.game.state
      for (let col = 0; col < COLUMNS; col++) {
        const cards = state.tableau[col]
        const view = this.views.get(cards[cards.length - 1].id)
        if (!view) continue
        view.root.position.set(this.layout.stockX, this.layout.stockY)
        view.moveHome(this.tweener, { duration: 0.34, delay: col * 0.045, spring: true })
      }
    }
  }

  /**
   * Финал стола в два акта — как выглядит настоящая победа.
   *
   * В «Пауке» выигранная партия — это все карты, собранные в лоток внизу.
   * Поэтому сначала оставшиеся на столе карты слетаются в стопку к
   * собранным (акт 1), а уже из неё колода взрывается веером вверх и
   * тает (акт 2). При честной победе на столе к этому моменту почти
   * пусто — сбор получается коротким сам собой.
   *
   * Состояние игры не трогает: это подача, а не ход. Стол оживает заново
   * через rebuildViews при новой игре или рестарте.
   */
  flyAwayAll(): void {
    const l = this.layout
    const baseX = l.foundationX + this.game.state.foundations.length * l.foundationStep
    const baseY = l.foundationY

    const views = [...this.views]
    const collectDur = 0.45
    const stagger = 0.012
    // Веер стартует, когда долетела последняя карта, плюс короткий вдох.
    const gatherEnd = views.length * stagger + collectDur
    const burstAt = gatherEnd + 0.35

    views.forEach(([id, view], i) => {
      this.views.delete(id)
      this.dragLayer.addChild(view.root)
      view.kill(this.tweener)

      const delay = i * stagger
      const scatter = (Math.random() - 0.5) * l.cardW * 0.2

      this.tweener.to(
        view.root,
        {
          x: baseX + scatter,
          y: baseY + scatter * 0.3,
          rotation: (Math.random() - 0.5) * 0.14,
        },
        {
          duration: collectDur,
          delay,
          ease: easing.inOutCubic,
          // Акт 2 ставится только после акта 1: tweener снимает старые
          // твины по тем же полям, и заказанный заранее веер убил бы
          // сбор на месте.
          onDone: () => {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3
            const dist = Math.max(this.viewW, this.viewH) * (0.6 + Math.random() * 0.5)
            this.tweener.to(
              view.root,
              {
                x: baseX + Math.cos(angle) * dist,
                y: baseY + Math.sin(angle) * dist,
                rotation: (Math.random() - 0.5) * 4,
                alpha: 0,
              },
              {
                duration: 0.9,
                delay: burstAt - (delay + collectDur) + i * 0.005,
                ease: easing.inOutCubic,
                onDone: () => view.destroy(),
              },
            )
          },
        },
      )
    })

    // Лоток и слоты уходят вместе с веером: стол отдан торжеству целиком.
    this.tweener.to(this.stockPile, { alpha: 0 }, { duration: 0.4, delay: burstAt })
    this.tweener.to(this.slotLayer, { alpha: 0 }, { duration: 0.4, delay: burstAt })
  }

  /** Собранная последовательность улетает с лёгким разлётом (§12). */
  private flyOutRun(ids: number[]): void {
    ids.forEach((id, i) => {
      const view = this.views.get(id)
      if (!view) return

      this.views.delete(id)
      this.dragLayer.addChild(view.root)
      view.kill(this.tweener)

      const driftX = (i - ids.length / 2) * this.layout.cardW * 0.14
      this.tweener.to(
        view.root,
        {
          x: this.layout.foundationX + this.game.state.foundations.length * this.layout.foundationStep,
          y: this.layout.foundationY,
          rotation: driftX * 0.006,
          alpha: 0,
        },
        {
          duration: 0.55,
          delay: i * 0.03,
          ease: easing.inOutCubic,
          onDone: () => view.destroy(),
        },
      )
    })
  }

  // ------------------------------------------------------------ действия

  newGame(seed: number, suits: SuitCount = this.game.suits): void {
    this.game = new Game(seed, suits)
    this.selected = null
    this.rebuildViews()
    // Свежий расклад всегда въезжает раздачей из угла, а не появляется разом.
    this.dealOut()
  }

  /**
   * Взвести стартовую раздачу: сложить всю колоду стопкой в правом нижнем
   * углу рубашками вверх и держать так. Вызывается на старте, пока поверх
   * стола висит титульный экран, — раздача играется по «Играть».
   */
  armDeal(): void {
    this.dealPending = true
    this.sync(false)
  }

  /** Разыграть стартовую раздачу, только если стол взведён (вход через титул). */
  dealOutIfArmed(): void {
    if (this.dealPending) this.dealOut()
  }

  /**
   * Стартовая раздача.
   *
   * Вся колода лежит стопкой в правом нижнем углу (там же, где потом запас)
   * и разлетается по десяти колонкам «ряд за рядом, слева направо» — так
   * читается настоящая сдача. Летят рубашки; десять открытых карт (низ
   * каждой колонки) переворачиваются лицом в момент приземления.
   *
   * Состояние уже посчитано логикой — это чистая подача. Клик во время
   * полёта ничего не ломает: попадание считается по раскладке, а не по
   * спрайту (§4).
   */
  dealOut(): void {
    this.dealPending = false
    this.layout = this.computeLayout(this.viewW, this.viewH)
    this.drawScrim()
    this.positionSlots()
    this.tweener.killAll()

    const l = this.layout
    const state = this.game.state

    // Порядок «ряд за рядом»: сначала верхняя карта каждой колонки, потом
    // вторая и так далее. Именно этот проход слева направо и читается глазом
    // как сдача, а не как высыпанная разом стопка.
    const seq: { view: CardView; faceUp: boolean }[] = []
    let maxLen = 0
    for (const col of state.tableau) maxLen = Math.max(maxLen, col.length)
    for (let row = 0; row < maxLen; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        const cards = state.tableau[col]
        if (row >= cards.length) continue
        const view = this.viewOf(cards[row])
        const p = this.cardPosition(col, row)
        view.homeX = p.x
        view.homeY = p.y
        seq.push({ view, faceUp: cards[row].faceUp })
      }
    }

    // Разлёт: карта срывается из угла сразу с ходом и мягко тормозит у места
    // (outCubic). Ни пружины outBack (перелёт места и рывок назад), ни
    // медленного разгона inOutCubic — тот давал «выползающий» старт, когда вся
    // колода секунду почти стоит в углу, и это читалось как подтормаживание.
    // Наклон — едва заметный, чтобы стопка не выглядела штампованной.
    const step = 0.026
    const dur = 0.34
    seq.forEach(({ view, faceUp }, i) => {
      view.kill(this.tweener)
      // Открытые прячем рубашкой на время полёта; закрытые и так рубашкой.
      view.showBack(faceUp)
      view.root.position.set(l.stockX, l.stockY)
      view.root.rotation = (Math.random() - 0.5) * 0.08

      if (view.root.parent !== this.cardLayer) this.cardLayer.addChild(view.root)
      this.cardLayer.setChildIndex(view.root, this.cardLayer.children.length - 1)

      const delay = i * step
      this.tweener.to(view.root, { x: view.homeX, y: view.homeY }, { duration: dur, delay, ease: easing.outCubic })
      // Наклон выправляется тем же темпом — карта «ложится» ровно.
      this.tweener.to(view.root, { rotation: 0 }, { duration: dur, delay, ease: easing.outCubic })
    })

    // Открытые карты (низ каждой колонки) в полёте не раскрываются — ложатся
    // рубашкой вместе со всеми. Когда раздача осела, они вспыхивают лицом
    // волной: от первой колонки слева к последней справа.
    //
    // Ритм волны задаёт waveStep — пауза между СТАРТАМИ соседних карт; от него
    // и зависит общее время «от первой до последней». Сам переворот (flipDur)
    // длиннее шага, поэтому карты открываются внахлёст: пока доворачивается
    // первая, уже пошла вторая, третья. Волна идёт плавной рекой, а не чередой
    // «щелчок-пауза-щелчок», и при этом общий тайминг не растягивается.
    const dealEnd = (seq.length - 1) * step + dur
    const waveStep = 0.075
    const flipDur = 0.45
    for (let col = 0; col < COLUMNS; col++) {
      const cards = state.tableau[col]
      const bottom = cards[cards.length - 1]
      if (!bottom?.faceUp) continue
      this.views.get(bottom.id)?.flip(this.tweener, dealEnd + 0.08 + col * waveStep, flipDur)
    }

    this.drawStock()
    this.onChange?.()
  }

  /** Смена числа мастей — это всегда новый расклад: колода другая. */
  setSuits(suits: SuitCount): void {
    if (suits === this.game.suits) return
    this.newGame((Math.random() * 0x7fffffff) | 0, suits)
  }

  undo(): void {
    if (!this.game.canUndo) return
    this.game.undo()
    this.rebuildViews()
    this.sync(false)
  }

  restart(): void {
    this.game.restart()
    this.rebuildViews()
    this.sync(false)
  }

  /**
   * Лучший ход + подсветка на столе: что взять и куда положить.
   *
   * Сначала вспыхивает переносимая стопка, с небольшим отставанием —
   * карта-цель: задержка и рисует направление «отсюда — туда». Один тост
   * с номерами колонок тестеры расшифровать не могли.
   */
  hint(): Move | null {
    const move = bestMove(this.game.state)
    if (move?.t === 'move') {
      const from = this.game.state.tableau[move.from]
      for (const card of from.slice(from.length - move.count)) {
        this.views.get(card.id)?.flash(this.tweener)
      }
      const to = this.game.state.tableau[move.to]
      const target = to[to.length - 1]
      if (target) this.views.get(target.id)?.flash(this.tweener, 0.4)
      else this.flashSlot(move.to)
    } else if (move?.t === 'deal') {
      // Единственный полезный ход — раздать: подсвечиваем колоду раздачи в
      // углу, без текстовой плашки.
      this.flashStock()
    }
    return move
  }

  /** Ход в пустую колонку: карты-цели нет, вспыхивает сам слот. */
  private flashSlot(column: number): void {
    const l = this.layout
    const g = new Graphics()
    g.roundRect(-l.cardW / 2, -l.cardH / 2, l.cardW, l.cardH, l.cardW * 0.075)
      .fill({ color: 0xffd68c, alpha: 0.3 })
      .stroke({ color: 0xffe0a0, width: Math.max(3, l.cardW * 0.07), alpha: 1 })
    g.blendMode = 'add'
    g.alpha = 0
    g.position.set(l.originX + column * l.columnStep, l.originY)
    this.dragLayer.addChild(g)

    const fade = (up: boolean, left: number): void =>
      this.tweener.to(g, { alpha: up ? 1 : 0 }, {
        duration: up ? 0.22 : 0.38,
        delay: up && left === 2 ? 0.4 : 0,
        onDone: () => {
          if (up) fade(false, left)
          else if (left > 1) fade(true, left - 1)
          else if (!g.destroyed) g.destroy()
        },
      })
    fade(true, 2)
  }

  /**
   * Подсветка колоды раздачи в правом нижнем углу: тёплый пульс на верхней
   * карте запаса — тот же «блик света», что и подсказка на столе. Зовётся,
   * когда единственный полезный ход — раздать из запаса.
   */
  private flashStock(): void {
    const l = this.layout
    const tw = l.trayCardW
    const th = tw * CARD_ASPECT

    // Запас нарисован веером: карты уходят вверх-влево от stockX/stockY, каждая
    // со сдвигом 0.14*tw по X и 0.06*tw по Y (см. drawStock). Подсвечиваем ВСЮ
    // стопку одним контуром по её габаритам, а не одну карту в опорной точке —
    // иначе блик «сидел» на нижней карте веера и выглядел смещённым от колоды.
    const deals = Math.max(1, this.game.state.stock.length)
    const dx = (deals - 1) * tw * 0.14
    const dy = (deals - 1) * tw * 0.06
    const pad = tw * 0.05
    const w = tw + dx + pad * 2
    const h = th + dy + pad * 2
    const cx = l.stockX - dx / 2
    const cy = l.stockY - dy / 2

    const g = new Graphics()
    g.roundRect(-w / 2, -h / 2, w, h, tw * 0.1)
      .fill({ color: 0xffd68c, alpha: 0.22 })
      .stroke({ color: 0xffe0a0, width: Math.max(3, tw * 0.06), alpha: 1 })
    g.blendMode = 'add'
    g.alpha = 0
    g.position.set(cx, cy)
    this.dragLayer.addChild(g)

    const fade = (up: boolean, left: number): void =>
      this.tweener.to(g, { alpha: up ? 1 : 0 }, {
        duration: up ? 0.22 : 0.38,
        onDone: () => {
          if (up) fade(false, left)
          else if (left > 1) fade(true, left - 1)
          else if (!g.destroyed) g.destroy()
        },
      })
    fade(true, 2)
  }

  update(dt: number): void {
    this.tweener.update(dt)
  }

  get bounds(): Rectangle {
    return new Rectangle(0, 0, this.viewW, this.viewH)
  }
}
