import { Graphics, GraphicsPath, Matrix } from 'pixi.js'

import type { Suit } from '../../core/types'

/**
 * Формы мастей вектором.
 *
 * Пути заданы в квадрате 100×100 с началом в левом верхнем углу — так их
 * можно править в любом SVG-редакторе и вставлять сюда как есть.
 * Растеризуются один раз при сборке атласа, в кадре не участвуют.
 */
const PATHS: Record<Exclude<Suit, 'C'>, string> = {
  S:
    'M50 5 C50 5 15 35 15 57 C15 70 25 79 36 79 C41 79 46 77 49 72 ' +
    'C47 83 42 90 34 95 L66 95 C58 90 53 83 51 72 C54 77 59 79 64 79 ' +
    'C75 79 85 70 85 57 C85 35 50 5 50 5 Z',
  H:
    'M50 93 C50 93 9 62 9 35 C9 19 21 9 33 9 C41 9 47 14 50 21 ' +
    'C53 14 59 9 67 9 C79 9 91 19 91 35 C91 62 50 93 50 93 Z',
  D: 'M50 4 L88 50 L50 96 L12 50 Z',
}

/** У трефы три круга и ножка — кругами точнее, чем аппроксимацией безье. */
const CLUB_STEM = 'M42 62 C43 74 41 86 33 95 L67 95 C59 86 57 74 58 62 Z'
const CLUB_R = 21

/** Разбор SVG стоит недёшево, а путей всего четыре — держим готовыми. */
const parsed = new Map<string, GraphicsPath>()

function pathOf(svg: string): GraphicsPath {
  let p = parsed.get(svg)
  if (!p) {
    p = new GraphicsPath(svg)
    parsed.set(svg, p)
  }
  return p
}

/**
 * Матрица «вписать квадрат 100×100 в круг радиуса size/2 с центром (cx, cy)».
 * Методы Matrix здесь до-множают справа, поэтому порядок читается сверху
 * вниз как последовательность операций над точкой.
 */
function placement(cx: number, cy: number, size: number, flip: boolean): Matrix {
  const m = new Matrix()
  m.translate(-50, -50)
  m.scale(size / 100, size / 100)
  if (flip) m.rotate(Math.PI)
  m.translate(cx, cy)
  return m
}

/**
 * Нарисовать масть в `g`, вписанную в квадрат `size` с центром в (cx, cy).
 * `flip` разворачивает знак на 180° — младшая половина карты по традиции
 * рисуется перевёрнутой.
 *
 * Матрица навешивается на каждый примитив по отдельности и ровно один раз.
 * Вложенность (`addPath` пути, который сам состоит из `addPath`) здесь не
 * работает: внешняя трансформация до внутренних инструкций не доходит, и
 * фигура выпадает в исходном масштабе 0..100.
 *
 * Заливка вызывается здесь же: три круга и ножка трефы должны залиться
 * одной операцией, иначе на стыках проступят швы полупрозрачных краёв.
 */
export function drawSuit(
  g: Graphics,
  suit: Suit,
  cx: number,
  cy: number,
  size: number,
  color: number,
  flip = false,
): void {
  const m = placement(cx, cy, size, flip)
  const out = new GraphicsPath()

  if (suit === 'C') {
    out.circle(50, 26, CLUB_R, m)
    out.circle(24, 55, CLUB_R, m)
    out.circle(76, 55, CLUB_R, m)
    out.addPath(pathOf(CLUB_STEM), m)
  } else {
    out.addPath(pathOf(PATHS[suit]), m)
  }

  g.path(out)
  g.fill({ color })
}
