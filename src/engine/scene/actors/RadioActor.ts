import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'

import type { ActorSpec } from '../types'

/**
 * Кассетник на столе.
 *
 * Предмет сцены, а не элемент интерфейса: он стоит на доске рядом с
 * кружкой, живёт по тем же законам параллакса и получает тот же свет от
 * лампы. Кнопки транспорта нарисованы на нём, а не вынесены в HUD —
 * иначе это была бы панель управления поверх картины, и вся затея с
 * «ламповостью» рассыпалась бы.
 *
 * Звука здесь нет и быть не должно. Актор только сообщает наружу, что
 * игрок нажал: `onCommand` подхватит аудио-слой, когда появится.
 */

export type RadioCommand = 'prev' | 'toggle' | 'next'

/** x, y, ширина, высота в долях спрайта. */
type Rect = [number, number, number, number]

interface Button {
  id: RadioCommand
  root: Container
  face: Graphics
  hit: Graphics
  /** 0..1, насколько кнопка утоплена. */
  press: number
  /** Позиция покоя: клавиша проседает от неё, а не от текущей. */
  homeY: number
}

const BODY = 0x2c2620
const BODY_EDGE = 0x6b5b46
const PANEL = 0x141210
const KEY = 0xc9bda4
const KEY_EDGE = 0x8a7d63
const LED_ON = 0xffb45a
const LED_OFF = 0x4a3a28
const REEL = 0x3a3128

export class RadioActor {
  /** Видимая часть — уезжает в стопку слоёв сцены. */
  readonly root = new Container()

  /**
   * Зоны нажатия — отдельным слоем ПОВЕРХ карт.
   *
   * Стол пасьянса перекрывает весь экран своей областью попадания, и
   * кнопка, лежащая под ним в сцене, не получила бы ни одного клика.
   * Поэтому картинка остаётся в сцене, а невидимые зоны живут выше.
   */
  readonly input = new Container()

  /** Дёргается на нажатие. Сюда подключится плеер. */
  onCommand?: (command: RadioCommand) => void

  playing = false

  private readonly contact = new Graphics()
  private readonly body = new Graphics()
  private readonly reels = new Graphics()
  private readonly led = new Graphics()
  private readonly glow = new Graphics()
  private readonly label: Text
  private readonly buttons: Button[] = []
  private readonly art?: Sprite

  private spin = 0
  private baseW = 0
  private baseH = 0

  /**
   * Приглашающее мигание клавиши включения.
   *
   * Тестеры не находили музыку: кассетник читается как декорация. Первые
   * полминуты ПАРТИИ клавиша «пуск» мягко пульсирует светом лампы; любое
   * нажатие на кассетник — сигнал «понял, где музыка» — гасит подсказку
   * навсегда. Отсчёт запускает beginAttract() по кнопке «Играть»: сцена
   * живёт и за титульником, и стартуй таймер с загрузки — он истекал бы,
   * пока игрок ещё смотрит на титул.
   */
  private attract = false
  private attractT = 0
  private discovered = false

  /** Игрок вошёл в игру — пора подсказать, где музыка. */
  beginAttract(): void {
    if (this.discovered) return
    this.attract = true
    this.attractT = 0
  }

  constructor(
    readonly spec: ActorSpec,
    art?: Texture,
  ) {
    // Контактная тень идёт ПЕРЕД корпусом, чтобы он на неё встал.
    //
    // Нарисованная тень в картинку не всегда приезжает: если корпус
    // вырезали с белого фона, она исчезает вместе с ним. Без тени предмет
    // висит в паре пикселей над доской — глаз это замечает раньше, чем
    // успевает понять, что не так.
    this.root.addChild(this.contact)

    if (art) {
      this.art = new Sprite(art)
      this.art.anchor.set(0.5)
      // Приглушение только на картинке. Огонёк и катушки рисуются отдельно
      // и тускнеть не должны: индикатор — источник света, а не крашеная
      // деталь корпуса.
      if (spec.tint !== undefined) this.art.tint = spec.tint
      this.root.addChild(this.art)
    }

    this.root.addChild(this.body, this.reels, this.led)

    this.label = new Text({
      text: '',
      style: { fontFamily: 'ui-monospace, monospace', fontSize: 10, fill: 0x8fae9c },
    })
    this.label.anchor.set(0.5)
    this.root.addChild(this.label)

    // Решение владельца: рисованные катушки и бегущее название трека
    // поверх нарисованного корпуса выглядели чужеродно — окно кассеты
    // остаётся тёмным, о работе говорят индикатор и клавиши. Механика
    // катушек сохранена на случай возврата: это только видимость.
    this.reels.visible = false
    this.label.visible = false

    this.glow.blendMode = 'add'
    this.glow.visible = false

    for (const id of ['prev', 'toggle', 'next'] as RadioCommand[]) {
      const root = new Container()
      const face = new Graphics()
      // Подсветка лежит ПОД значком, но в контейнере клавиши: проседает
      // вместе с ней при нажатии.
      if (id === 'toggle') root.addChild(this.glow)
      root.addChild(face)
      this.root.addChild(root)

      const hit = new Graphics()
      hit.eventMode = 'static'
      hit.cursor = 'pointer'
      hit.alpha = 0
      this.input.addChild(hit)

      const button: Button = { id, root, face, hit, press: 0, homeY: 0 }
      hit.on('pointerdown', () => this.push(button))
      this.buttons.push(button)
    }
  }

  private push(button: Button): void {
    button.press = 1
    if (button.id === 'toggle') this.playing = !this.playing
    this.attract = false
    this.discovered = true
    this.glow.visible = false
    this.onCommand?.(button.id)
  }

  /** Текст на дисплее. Название трека, когда появится плеер. */
  setLabel(text: string): void {
    this.label.text = text
  }

  place(x: number, y: number, scale: number): void {
    this.root.position.set(x, y)
    this.baseW = this.spec.size[0] * scale
    this.baseH = this.spec.size[1] * scale

    const w = this.baseW
    const h = this.baseH

    if (this.art) {
      this.art.width = w
      this.art.height = h
    } else {
      this.drawPlaceholderBody(w, h)
    }

    // Тень: три вложенных эллипса вместо блюра. Размытие потребовало бы
    // отдельного прохода фильтра на каждый кадр ради пятна, которое и так
    // никто не разглядывает.
    this.contact.clear()
    const cy = h * 0.44
    for (const [k, alpha] of [[1.0, 0.10], [0.78, 0.13], [0.55, 0.16]] as const) {
      this.contact
        .ellipse(0, cy, w * 0.42 * k, h * 0.07 * k)
        .fill({ color: 0x0a1210, alpha })
    }

    const win = this.rect(this.layout.window)
    const firstKey = this.rect(this.layout.keys[0])

    // Подпись садится ровно посередине между низом окна и верхом клавиш.
    // Фиксированный отступ от окна попадал на шов между панелями, а на
    // разных корпусах эта полоса разной ширины.
    this.label.style.fontSize = Math.max(7, w * 0.05)
    this.label.position.set(
      win.cx,
      (win.cy + win.h / 2 + (firstKey.cy - firstKey.h / 2)) / 2,
    )

    this.layout.keys.forEach((k, i) => {
      const button = this.buttons[i]
      if (!button) return

      const key = this.rect(k)
      button.root.position.set(key.cx, key.cy)
      button.homeY = key.cy

      button.face.clear()
      if (!this.art) {
        button.face
          .roundRect(-key.w / 2, -key.h / 2, key.w, key.h, key.h * 0.22)
          .fill({ color: KEY })
          .stroke({ color: KEY_EDGE, width: Math.max(1, w * 0.008) })
        drawGlyph(button.face, button.id, key.w, key.h)
      } else {
        // Сами клавиши на картинке уже есть, но без значков транспорта —
        // тестеры не понимали, какая что делает. Значок светлый с тёмной
        // подложкой: читается и на тёмной, и на светлой клавише.
        drawGlyph(button.face, button.id, key.w, key.h, 0x1a1512, 1.18, 0.5)
        drawGlyph(button.face, button.id, key.w, key.h, KEY, 1, 0.85)
      }

      if (button.id === 'toggle') {
        this.glow.clear()
        const gw = key.w * 1.5
        const gh = key.h * 1.7
        for (const [k, a] of [[1.45, 0.09], [1.2, 0.15], [1.0, 0.26]] as const) {
          this.glow
            .roundRect((-gw * k) / 2, (-gh * k) / 2, gw * k, gh * k, gh * k * 0.32)
            .fill({ color: LED_ON, alpha: a })
        }
      }

      // Зона нажатия крупнее самой клавиши: на телефоне палец толще.
      const pad = Math.max(key.w * 0.25, 10)
      button.hit.clear()
      button.hit
        .rect(
          x + key.cx - key.w / 2 - pad,
          y + key.cy - key.h / 2 - pad,
          key.w + pad * 2,
          key.h + pad * 2,
        )
        .fill({ color: 0xffffff })
    })
  }

  /**
   * Раскладка корпуса в долях спрайта: окно кассеты и три клавиши.
   *
   * Значения по умолчанию описывают процедурную заглушку. Когда приедет
   * нарисованный корпус, они переопределяются из манифеста: художник
   * ставит окно и кнопки куда хочет, код их там находит.
   */
  private get layout(): { window: Rect; keys: Rect[] } {
    return {
      window: this.spec.window ?? [0.24, 0.16, 0.52, 0.34],
      keys: this.spec.keys ?? [
        [0.115, 0.62, 0.19, 0.19],
        [0.405, 0.62, 0.19, 0.19],
        [0.695, 0.62, 0.19, 0.19],
      ],
    }
  }

  /** Долевой прямоугольник -> координаты относительно центра спрайта. */
  private rect(r: Rect): { cx: number; cy: number; w: number; h: number } {
    return {
      cx: (r[0] + r[2] / 2 - 0.5) * this.baseW,
      cy: (r[1] + r[3] / 2 - 0.5) * this.baseH,
      w: r[2] * this.baseW,
      h: r[3] * this.baseH,
    }
  }

  private drawPlaceholderBody(w: number, h: number): void {
    const winW = w * 0.52
    const winH = h * 0.34
    const winY = -h * 0.18

    this.body
      .clear()
      .roundRect(-w / 2, -h / 2, w, h, h * 0.12)
      .fill({ color: BODY })
      .stroke({ color: BODY_EDGE, width: Math.max(1, w * 0.01) })
      .roundRect(-winW / 2, winY - winH / 2, winW, winH, winH * 0.14)
      .fill({ color: PANEL })
      .stroke({ color: BODY_EDGE, width: Math.max(1, w * 0.006) })
  }

  update(dt: number, flicker: number): void {
    const w = this.baseW
    const h = this.baseH
    if (w === 0) return

    // Катушки крутятся, только когда играет. Это единственный честный
    // признак работы: индикатор можно не заметить, а движение — нет.
    if (this.playing) this.spin += dt * 2.4

    const win = this.rect(this.layout.window)
    const winY = win.cy

    // Геометрия катушек считается от ВЫСОТЫ окна, а не от ширины.
    //
    // Кассета — предмет с фиксированными пропорциями: две бобины почти
    // впритык, обе почти во всю высоту корпуса. Окно же бывает разное — у
    // фронтального корпуса оно вышло почти во всю ширину. Привязка к
    // ширине разносила бобины по углам и делала их крошечными: получалось
    // не окно кассеты, а витрина с двумя пуговицами.
    const r = win.h * 0.30
    const dx = win.h * 0.42

    // Сначала ВСЕ заливки, потом ВСЕ линии.
    //
    // fill() забирает все фигуры, накопленные с прошлой заливки, включая
    // незакрытые пути от moveTo/lineTo. Круг-спицы-круг-спицы означал бы,
    // что спицы первой катушки уходят в заливку второй и исчезают.
    if (this.reels.visible) {
      this.reels.clear()
      for (const side of [-1, 1]) {
        this.reels.circle(win.cx + side * dx, winY, r)
      }
      this.reels.fill({ color: REEL })

      for (const side of [-1, 1]) {
        const cx = win.cx + side * dx
        for (let i = 0; i < 3; i++) {
          const a = this.spin * side + (i * Math.PI * 2) / 3
          this.reels
            .moveTo(cx, winY)
            .lineTo(cx + Math.cos(a) * r * 0.82, winY + Math.sin(a) * r * 0.82)
        }
      }
      this.reels.stroke({ color: KEY_EDGE, width: Math.max(1, w * 0.012) })
    }

    // Индикатор дышит вместе с лампой: он питается от того же огня, что и
    // вся сцена. Ровный светодиод выдал бы электричество там, где его нет.
    //
    // Стоит ВНУТРИ окна, у правого края. Отступ от края взят от высоты
    // окна: доля от ширины на широком корпусе выносила огонёк за габарит,
    // и он висел в воздухе рядом с кружкой.
    const lit = this.playing ? 0.55 + 0.45 * flicker : 0.18
    this.led
      .clear()
      .circle(win.cx + win.w / 2 - win.h * 0.35, winY, Math.max(1.5, w * 0.018))
      .fill({ color: this.playing ? LED_ON : LED_OFF, alpha: lit })

    // Приглашающее мигание живёт от того же дыхания, что и вся сцена:
    // ровный строб выдал бы «интерфейс» там, где стоит предмет.
    if (this.attract) {
      this.attractT += dt
      if (this.attractT > 30 || this.playing) {
        this.attract = false
        this.glow.visible = false
      } else {
        const ramp = Math.min(1, this.attractT / 1.5)
        this.glow.visible = true
        this.glow.alpha =
          ramp *
          (0.3 + 0.5 * (0.5 + 0.5 * Math.sin(this.attractT * 4.2))) *
          (0.85 + 0.15 * flicker)
      }
    }

    for (const button of this.buttons) {
      if (button.press > 0) button.press = Math.max(0, button.press - dt * 6)
      button.root.y = button.homeY + button.press * h * 0.02
      button.face.alpha = 1 - button.press * 0.25
    }
  }
}

/** Значки транспорта. Треугольники рисуются, а не набираются шрифтом:
 *  юникодные ▶◀ разъезжаются по метрикам между платформами.
 *  `scale`/`alpha` нужны нарисованному корпусу: тёмная подложка чуть
 *  крупнее светлого значка даёт контур, видимый на любой клавише. */
function drawGlyph(
  g: Graphics,
  id: RadioCommand,
  w: number,
  h: number,
  color = 0x2c2620,
  scale = 1,
  alpha = 1,
): void {
  const s = Math.min(w, h) * 0.3 * scale
  const ink = color

  if (id === 'toggle') {
    g.poly([-s * 0.5, -s, s * 0.7, 0, -s * 0.5, s]).fill({ color: ink, alpha })
    return
  }

  const dir = id === 'prev' ? -1 : 1
  for (const offset of [-s * 0.55, s * 0.45]) {
    g.poly([
      offset + dir * s * 0.5, 0,
      offset - dir * s * 0.4, -s * 0.8,
      offset - dir * s * 0.4, s * 0.8,
    ]).fill({ color: ink, alpha })
  }
  g.rect(dir * s * 1.05 - (dir > 0 ? 0 : s * 0.18), -s * 0.8, s * 0.18, s * 1.6)
    .fill({ color: ink, alpha })
}
