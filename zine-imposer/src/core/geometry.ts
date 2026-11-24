// src/core/geometry.ts
// Gemeinsame Geometrie für das Druck-PDF (impose.ts) und die Druckbogen-Vorschau:
// Lage der Seiten (mit Abständen), Wenden, sichtbarer Anschnitt je Seite, Schnittmarken. Alle Maße in mm.
import type { Cell, Gaps, SideLayout } from './layouts/types'
import { MARK_SIDES, pageBleed } from './settings'
import type { ImpositionSettings, MarkSide } from './settings'

export type Edges<T> = { left: T; right: T; top: T; bottom: T }

/** Abstände einer Bogenseite, auf die richtige Anzahl gebracht (fehlende = 0). */
export function sideGaps(side: Pick<SideLayout, 'cols' | 'rows' | 'gaps'>): Gaps {
  const fit = (list: number[] | undefined, n: number) =>
    Array.from({ length: Math.max(0, n) }, (_, i) => Math.max(0, Number(list?.[i]) || 0))
  return { cols: fit(side.gaps?.cols, side.cols - 1), rows: fit(side.gaps?.rows, side.rows - 1) }
}

/** Wenden über die lange Kante: ganze Bogenseite um 180° drehen (Abstände drehen mit). */
export function turnSide(side: SideLayout): SideLayout {
  const g = sideGaps(side)
  return {
    ...side,
    gaps: { cols: [...g.cols].reverse(), rows: [...g.rows].reverse() },
    cells: side.cells.map((c) => ({
      ...c,
      col: side.cols - 1 - c.col,
      row: side.rows - 1 - c.row,
      rotate: ((c.rotate + 180) % 360) as 0 | 180
    }))
  }
}

export interface GridGeometry {
  gx: number // linke Kante des Endformats der ersten Spalte (vom linken Bogenrand)
  gy: number // obere Kante des Endformats der ersten Zeile (vom oberen Bogenrand)
  width: number // Raster gesamt, Endformat zu Endformat
  height: number
  colX: number[] // linke Kante jeder Spalte
  rowY: number[] // obere Kante jeder Zeile
  gaps: Gaps
}

/** Lage aller Seiten auf dem Bogen: Raster mittig, mit Abständen zwischen Spalten und Zeilen. */
export function gridGeometry(
  side: Pick<SideLayout, 'cols' | 'rows' | 'gaps'>,
  trimW: number,
  trimH: number,
  sheetW: number,
  sheetH: number
): GridGeometry {
  const gaps = sideGaps(side)
  const width = side.cols * trimW + gaps.cols.reduce((a, b) => a + b, 0)
  const height = side.rows * trimH + gaps.rows.reduce((a, b) => a + b, 0)
  const gx = (sheetW - width) / 2
  const gy = (sheetH - height) / 2
  const colX: number[] = []
  for (let k = 0, x = gx; k < side.cols; k++) {
    colX.push(x)
    x += trimW + (gaps.cols[k] ?? 0)
  }
  const rowY: number[] = []
  for (let k = 0, y = gy; k < side.rows; k++) {
    rowY.push(y)
    y += trimH + (gaps.rows[k] ?? 0)
  }
  return { gx, gy, width, height, colX, rowY, gaps }
}

/** Anschnitt einer Seite in Ausrichtung des Bogens (bei gedrehten Seiten vertauscht). */
export function sheetBleed(
  c: Cell,
  settings: Pick<ImpositionSettings, 'bleed' | 'bleedLayout' | 'cover'>
): Edges<number> {
  if (c.page === null) return { left: 0, right: 0, top: 0, bottom: 0 }
  const b = pageBleed(settings, c.page)
  return c.rotate === 180 ? { left: b.right, right: b.left, top: b.bottom, bottom: b.top } : b
}

/**
 * Wie viel Anschnitt einer Seite auf dem Bogen stehen bleibt – in Ausrichtung des Bogens.
 * Nach außen bleibt der ganze Anschnitt. Zu einer Nachbarseite hin höchstens bis zur Mitte
 * des Abstands dazwischen (ohne Abstand also gar nicht).
 */
export function keptBleed(
  c: Cell,
  side: Pick<SideLayout, 'cols' | 'rows' | 'gaps'>,
  settings: Pick<ImpositionSettings, 'bleed' | 'bleedLayout' | 'cover'>
): Edges<number> {
  const b = sheetBleed(c, settings)
  const g = sideGaps(side)
  const allow = {
    left: c.col === 0 ? Infinity : g.cols[c.col - 1] / 2,
    right: c.col === side.cols - 1 ? Infinity : g.cols[c.col] / 2,
    top: c.row === 0 ? Infinity : g.rows[c.row - 1] / 2,
    bottom: c.row === side.rows - 1 ? Infinity : g.rows[c.row] / 2
  }
  return {
    left: Math.min(b.left, allow.left),
    right: Math.min(b.right, allow.right),
    top: Math.min(b.top, allow.top),
    bottom: Math.min(b.bottom, allow.bottom)
  }
}

/** Dasselbe in Ausrichtung der Seite selbst (für das Zuschneiden der Quellseite). */
export function keptBleedOnPage(c: Cell, kept: Edges<number>): Edges<number> {
  return c.rotate === 180
    ? { left: kept.right, right: kept.left, top: kept.bottom, bottom: kept.top }
    : kept
}

/** Wie weit der Anschnitt an jeder Außenkante des Rasters über das Endformat hinausragt. */
export function edgeBleed(
  side: SideLayout,
  settings: Pick<ImpositionSettings, 'bleed' | 'bleedLayout' | 'cover'>
): Edges<number> {
  const e = { left: 0, right: 0, top: 0, bottom: 0 }
  for (const c of side.cells) {
    const b = sheetBleed(c, settings)
    if (c.row === 0) e.top = Math.max(e.top, b.top)
    if (c.row === side.rows - 1) e.bottom = Math.max(e.bottom, b.bottom)
    if (c.col === 0) e.left = Math.max(e.left, b.left)
    if (c.col === side.cols - 1) e.right = Math.max(e.right, b.right)
  }
  return e
}

export interface MarkPlacement {
  on: boolean
  start: number // Abstand vom Endformat bis zum Anfang der Marke
  length: number
  reach: number // wie weit die Marke insgesamt über das Endformat hinausragt (0 = keine)
}

/**
 * Lage der Marken je Bogenseite. Der Abstand zählt je nach Einstellung ab dem Anschnitt
 * (Marken wandern mit dem Anschnitt mit) oder ab dem Endformat (dann nie innerhalb des Anschnitts).
 */
export function markPlacement(
  side: SideLayout,
  settings: Pick<ImpositionSettings, 'bleed' | 'bleedLayout' | 'cover' | 'cropMarks'>
): Record<MarkSide, MarkPlacement> {
  const edge = edgeBleed(side, settings)
  const out = {} as Record<MarkSide, MarkPlacement>
  for (const s of MARK_SIDES) {
    const m = settings.cropMarks.sides[s]
    const on = settings.cropMarks.enabled && m.enabled
    const start =
      settings.cropMarks.from === 'trim' ? Math.max(m.offset, edge[s]) : edge[s] + m.offset
    out[s] = { on, start, length: m.length, reach: on ? start + m.length : 0 }
  }
  return out
}

/**
 * Alle Schnitt- und Falzkanten des Rasters: jede Kante des Endformats, ohne Doppelte.
 * Bei einem Abstand zwischen zwei Seiten sind das zwei Kanten, ohne Abstand eine gemeinsame.
 */
export function trimEdges(g: GridGeometry, trimW: number, trimH: number) {
  const uniq = (values: number[]) =>
    values
      .sort((a, b) => a - b)
      .filter((v, i, all) => i === 0 || Math.abs(v - all[i - 1]) > 0.01)
  return {
    xs: uniq(g.colX.flatMap((x) => [x, x + trimW])),
    ys: uniq(g.rowY.flatMap((y) => [y, y + trimH]))
  }
}

/** Platz, den eine Bogenseite braucht (Raster mittig, damit Vorder- und Rückseite passen). */
export function neededSize(
  side: SideLayout,
  trimW: number,
  trimH: number,
  marks: Record<MarkSide, MarkPlacement>
) {
  const g = sideGaps(side)
  const sum = (l: number[]) => l.reduce((a, b) => a + b, 0)
  return {
    width: side.cols * trimW + sum(g.cols) + 2 * Math.max(marks.left.reach, marks.right.reach),
    height: side.rows * trimH + sum(g.rows) + 2 * Math.max(marks.top.reach, marks.bottom.reach)
  }
}
