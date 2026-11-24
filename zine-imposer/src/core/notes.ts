// src/core/notes.ts
// Eigene Anweisungen auf dem Druckbogen: Texte sowie Falz- und Schnittlinien.
// Sie gehören zur Vorlage und werden ins Druck-PDF gezeichnet. Maße in mm, Ursprung oben links,
// so wie die Bogenseite im fertigen Druck-PDF liegt (Rückseiten also schon gewendet).

/** Für welche Bogenseiten eine Anweisung gilt: alle, alle Vorder-/Rückseiten oder eine bestimmte. */
export type NoteTarget = 'all' | 'fronts' | 'backs' | `sheet:${number}:${'front' | 'back'}`

/** Hintergrund eines Textes: keiner, weiß (unterbricht Linien darunter) oder schwarz mit weißer Schrift */
export type TextBg = 'none' | 'paper' | 'black'

export interface TextNote {
  id: string
  kind: 'text'
  target: NoteTarget
  text: string
  x: number // Mitte des Textes
  y: number
  size: number // pt
  rotate: 0 | 90 | 180 | 270 // im Uhrzeigersinn
  bg?: TextBg
}

const BGS: TextBg[] = ['none', 'paper', 'black']
const bgOf = (v: unknown): TextBg => (BGS.includes(v as TextBg) ? (v as TextBg) : 'none')

export interface LineNote {
  id: string
  kind: 'fold' | 'cut' // Falz gestrichelt, Schnitt durchgezogen
  target: NoteTarget
  axis: 'v' | 'h' // senkrecht (zwischen Spalten) oder waagerecht (zwischen Zeilen)
  at: number // Rasterlinie: 0 … Spalten bzw. 0 … Zeilen
  span: 'margin' | 'grid' | 'sheet' // nur im Rand, über das Raster, über den ganzen Bogen
  from?: number // nur bei 'grid': Abschnitt in Feldern (z. B. 1 bis 3), sonst das ganze Raster
  to?: number
}

export type SheetNote = TextNote | LineNote

const TARGET = /^(all|fronts|backs|sheet:\d{1,4}:(front|back))$/
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Anweisungen aus einer Vorlage prüfen; Unbrauchbares wird mit verständlichem Fehler abgelehnt. */
export function parseNotes(raw: unknown): SheetNote[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 300) throw new Error('Ungültige Anweisungen auf dem Bogen')
  return raw.map((n, i): SheetNote => {
    const where = `Anweisung ${i + 1}`
    if (!n || typeof n !== 'object') throw new Error(`${where}: ungültig`)
    const id = typeof n.id === 'string' && n.id ? n.id.slice(0, 64) : `n${i}`
    if (typeof n.target !== 'string' || !TARGET.test(n.target)) {
      throw new Error(`${where}: unbekanntes Ziel`)
    }
    if (n.kind === 'text') {
      if (typeof n.text !== 'string' || n.text.length > 600) throw new Error(`${where}: Text fehlt`)
      if (!finite(n.x) || !finite(n.y)) throw new Error(`${where}: Position fehlt`)
      if (!finite(n.size) || n.size < 3 || n.size > 72) throw new Error(`${where}: Schriftgröße 3–72 pt`)
      if (![0, 90, 180, 270].includes(n.rotate)) throw new Error(`${where}: Drehung 0/90/180/270`)
      return {
        id,
        kind: 'text',
        target: n.target,
        text: n.text,
        x: n.x,
        y: n.y,
        size: n.size,
        rotate: n.rotate,
        bg: bgOf(n.bg)
      }
    }
    if (n.kind === 'fold' || n.kind === 'cut') {
      if (n.axis !== 'v' && n.axis !== 'h') throw new Error(`${where}: Richtung fehlt`)
      if (!Number.isInteger(n.at) || n.at < 0 || n.at > 64) throw new Error(`${where}: Rasterlinie fehlt`)
      if (!['margin', 'grid', 'sheet'].includes(n.span)) throw new Error(`${where}: Länge fehlt`)
      const line: LineNote = { id, kind: n.kind, target: n.target, axis: n.axis, at: n.at, span: n.span }
      if (n.span === 'grid' && Number.isInteger(n.from) && Number.isInteger(n.to) && n.to > n.from) {
        line.from = n.from
        line.to = n.to
      }
      return line
    }
    throw new Error(`${where}: unbekannte Art`)
  })
}

/** Gilt die Anweisung für diese Bogenseite? (sheet = Nummer des Bogens ab 0) */
export function appliesTo(n: SheetNote, sheet: number, side: 'front' | 'back'): boolean {
  if (n.target === 'all') return true
  if (n.target === 'fronts') return side === 'front'
  if (n.target === 'backs') return side === 'back'
  return n.target === `sheet:${sheet}:${side}`
}

export interface GridBox {
  sheetW: number
  sheetH: number
  gx: number // linke Rasterkante (Endformat)
  gy: number // obere Rasterkante (Endformat)
  cols: number
  rows: number
  cellW: number // Endformat einer Seite
  cellH: number
  bleed: { left: number; right: number; top: number; bottom: number } // Anschnitt an den Außenkanten
  colX?: number[] // linke Kante jeder Spalte (mit Abständen); fehlt = ohne Abstände
  rowY?: number[] // obere Kante jeder Zeile
}

const MARGIN_GAP = 2 // Abstand der Randlinien zum Anschnitt
const MARGIN_LEN = 8 // Länge der Randlinien

// --- Positionen im Raster (berücksichtigen Abstände zwischen den Seiten) -----------

const colLeft = (g: GridBox, k: number) => g.colX?.[k] ?? g.gx + k * g.cellW
const rowTop = (g: GridBox, k: number) => g.rowY?.[k] ?? g.gy + k * g.cellH
export const gridRight = (g: GridBox) => colLeft(g, g.cols - 1) + g.cellW
export const gridBottom = (g: GridBox) => rowTop(g, g.rows - 1) + g.cellH

/** Rasterlinie k als x in mm: Außenkanten oder die Mitte des Abstands zwischen zwei Spalten. */
export function boundaryX(g: GridBox, k: number): number {
  if (k <= 0) return colLeft(g, 0)
  if (k >= g.cols) return gridRight(g)
  return (colLeft(g, k - 1) + g.cellW + colLeft(g, k)) / 2
}
export function boundaryY(g: GridBox, k: number): number {
  if (k <= 0) return rowTop(g, 0)
  if (k >= g.rows) return gridBottom(g)
  return (rowTop(g, k - 1) + g.cellH + rowTop(g, k)) / 2
}

/** Feldkoordinate u (z. B. 1,5 = Mitte der zweiten Spalte, 2 = Rasterlinie 2) → x in mm. */
export function fieldX(g: GridBox, u: number): number {
  if (Number.isInteger(u)) return boundaryX(g, u)
  if (u < 0) return colLeft(g, 0) + u * g.cellW
  if (u > g.cols) return gridRight(g) + (u - g.cols) * g.cellW
  const k = Math.floor(u)
  return colLeft(g, k) + (u - k) * g.cellW
}
export function fieldY(g: GridBox, v: number): number {
  if (Number.isInteger(v)) return boundaryY(g, v)
  if (v < 0) return rowTop(g, 0) + v * g.cellH
  if (v > g.rows) return gridBottom(g) + (v - g.rows) * g.cellH
  const k = Math.floor(v)
  return rowTop(g, k) + (v - k) * g.cellH
}

/** Umkehrung: x in mm → Feldkoordinate (in einem Abstand = die Rasterlinie dort). */
export function xToField(g: GridBox, x: number): number {
  for (let k = 0; k < g.cols; k++) {
    const l = colLeft(g, k)
    if (x < l) return k === 0 ? (x - l) / g.cellW : k
    if (x <= l + g.cellW) return k + (x - l) / g.cellW
  }
  return g.cols + (x - gridRight(g)) / g.cellW
}
export function yToField(g: GridBox, y: number): number {
  for (let k = 0; k < g.rows; k++) {
    const t = rowTop(g, k)
    if (y < t) return k === 0 ? (y - t) / g.cellH : k
    if (y <= t + g.cellH) return k + (y - t) / g.cellH
  }
  return g.rows + (y - gridBottom(g)) / g.cellH
}

/** Linienabschnitte [x1, y1, x2, y2] einer Falz- oder Schnittlinie auf einer Bogenseite. */
export function lineSegments(n: LineNote, g: GridBox): number[][] {
  const left = colLeft(g, 0)
  const right = gridRight(g)
  const top = rowTop(g, 0)
  const bottom = gridBottom(g)
  if (n.axis === 'v') {
    if (n.at > g.cols) return []
    const x = boundaryX(g, n.at)
    if (n.span === 'sheet') return [[x, 0, x, g.sheetH]]
    if (n.span === 'grid') {
      const a = n.from !== undefined ? Math.min(n.from, g.rows) : 0
      const b = n.to !== undefined ? Math.min(n.to, g.rows) : g.rows
      if (b <= a) return []
      // reicht die Linie bis an den Rand des Rasters, läuft sie durch den Anschnitt
      const y1 = a === 0 ? top - g.bleed.top : rowTop(g, a)
      const y2 = b === g.rows ? bottom + g.bleed.bottom : rowTop(g, b - 1) + g.cellH
      return [[x, y1, x, y2]]
    }
    const t0 = top - g.bleed.top - MARGIN_GAP
    const b0 = bottom + g.bleed.bottom + MARGIN_GAP
    return [
      [x, t0, x, Math.max(0, t0 - MARGIN_LEN)],
      [x, b0, x, Math.min(g.sheetH, b0 + MARGIN_LEN)]
    ].filter((s) => s[1] !== s[3])
  }
  if (n.at > g.rows) return []
  const y = boundaryY(g, n.at)
  if (n.span === 'sheet') return [[0, y, g.sheetW, y]]
  if (n.span === 'grid') {
    const a = n.from !== undefined ? Math.min(n.from, g.cols) : 0
    const b = n.to !== undefined ? Math.min(n.to, g.cols) : g.cols
    if (b <= a) return []
    const x1 = a === 0 ? left - g.bleed.left : colLeft(g, a)
    const x2 = b === g.cols ? right + g.bleed.right : colLeft(g, b - 1) + g.cellW
    return [[x1, y, x2, y]]
  }
  const l0 = left - g.bleed.left - MARGIN_GAP
  const r0 = right + g.bleed.right + MARGIN_GAP
  return [
    [l0, y, Math.max(0, l0 - MARGIN_LEN), y],
    [r0, y, Math.min(g.sheetW, r0 + MARGIN_LEN), y]
  ].filter((s) => s[0] !== s[2])
}

/** Nächste Rasterlinie zu einem Punkt: Richtung, Nummer und Abstand in mm. */
export function nearestGridLine(g: GridBox, x: number, y: number) {
  let kv = 0
  let kh = 0
  for (let k = 0; k <= g.cols; k++) {
    if (Math.abs(x - boundaryX(g, k)) < Math.abs(x - boundaryX(g, kv))) kv = k
  }
  for (let k = 0; k <= g.rows; k++) {
    if (Math.abs(y - boundaryY(g, k)) < Math.abs(y - boundaryY(g, kh))) kh = k
  }
  const dv = Math.abs(x - boundaryX(g, kv))
  const dh = Math.abs(y - boundaryY(g, kh))
  return dv <= dh ? { axis: 'v' as const, at: kv, distance: dv } : { axis: 'h' as const, at: kh, distance: dh }
}

/** Einrastpunkte für Texte: Bogenmitte, Rasterlinien, Seitenmitten und die Mitten der Ränder. */
export function textSnapTargets(g: GridBox) {
  const xs = [g.sheetW / 2, colLeft(g, 0) / 2, (g.sheetW + gridRight(g)) / 2]
  for (let k = 0; k <= g.cols; k++) xs.push(boundaryX(g, k))
  for (let k = 0; k < g.cols; k++) xs.push(colLeft(g, k) + g.cellW / 2)
  const ys = [g.sheetH / 2, rowTop(g, 0) / 2, (g.sheetH + gridBottom(g)) / 2]
  for (let k = 0; k <= g.rows; k++) ys.push(boundaryY(g, k))
  for (let k = 0; k < g.rows; k++) ys.push(rowTop(g, k) + g.cellH / 2)
  return { xs, ys }
}

/** Wert auf das nächste Ziel einrasten, wenn es nah genug ist. */
export function snap(value: number, targets: number[], threshold: number): { value: number; snapped: number | null } {
  let best: number | null = null
  for (const t of targets) {
    if (Math.abs(t - value) <= threshold && (best === null || Math.abs(t - value) < Math.abs(best - value))) best = t
  }
  return best === null ? { value, snapped: null } : { value: best, snapped: best }
}

// --- Anweisungen im Schema (rasterbezogen, unabhängig von Bogen- und Seitenformat) --------------
// Positionen zählen in Feldern: u = waagerecht (0 = linke Rasterkante, Spaltenzahl = rechte),
// v = senkrecht. Texte im Rand haben eine Zone; dort sitzen sie mittig im freien Rand.

export type TextZone = 'grid' | 'top' | 'bottom' | 'left' | 'right'

export interface SchemaText {
  id: string
  kind: 'text'
  text: string
  zone: TextZone
  u: number // entlang der Kante (oben/unten/im Raster: waagerecht; links/rechts: senkrecht)
  v: number // nur im Raster: senkrecht
  size: number // pt
  rotate: 0 | 90 | 180 | 270
  bg?: TextBg
}

export type SchemaLine = Omit<LineNote, 'target'>
export type SchemaNote = SchemaText | SchemaLine

/** Anweisungen einer Bogenseite im Schema prüfen. */
export function parseSchemaNotes(raw: unknown, where: string): SchemaNote[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.length > 100) throw new Error(`${where}: ungültige Anweisungen`)
  return raw.map((n, i): SchemaNote => {
    const at = `${where}, Anweisung ${i + 1}`
    if (!n || typeof n !== 'object') throw new Error(`${at}: ungültig`)
    const id = typeof n.id === 'string' && n.id ? n.id.slice(0, 64) : `s${i}`
    if (n.kind === 'text') {
      if (typeof n.text !== 'string' || n.text.length > 600) throw new Error(`${at}: Text fehlt`)
      if (!['grid', 'top', 'bottom', 'left', 'right'].includes(n.zone)) throw new Error(`${at}: Lage fehlt`)
      if (!finite(n.u) || (n.zone === 'grid' && !finite(n.v))) throw new Error(`${at}: Position fehlt`)
      if (!finite(n.size) || n.size < 3 || n.size > 72) throw new Error(`${at}: Schriftgröße 3–72 pt`)
      if (![0, 90, 180, 270].includes(n.rotate)) throw new Error(`${at}: Drehung 0/90/180/270`)
      return {
        id,
        kind: 'text',
        text: n.text,
        zone: n.zone,
        u: n.u,
        v: finite(n.v) ? n.v : 0,
        size: n.size,
        rotate: n.rotate,
        bg: bgOf(n.bg)
      }
    }
    const line = parseNotes([{ ...n, id, target: 'all' }])[0] as LineNote
    const { target: _t, ...rest } = line
    return rest
  })
}

/** Position eines Schema-Textes in mm auf dem Bogen. */
export function schemaTextPosition(n: SchemaText, g: GridBox): { x: number; y: number } {
  const top = rowTop(g, 0)
  const left = colLeft(g, 0)
  switch (n.zone) {
    case 'top':
      return { x: fieldX(g, n.u), y: Math.max(0, (top - g.bleed.top) / 2) }
    case 'bottom':
      return { x: fieldX(g, n.u), y: (g.sheetH + gridBottom(g) + g.bleed.bottom) / 2 }
    case 'left':
      return { x: Math.max(0, (left - g.bleed.left) / 2), y: fieldY(g, n.u) }
    case 'right':
      return { x: (g.sheetW + gridRight(g) + g.bleed.right) / 2, y: fieldY(g, n.u) }
    default:
      return { x: fieldX(g, n.u), y: fieldY(g, n.v) }
  }
}

/** Schema-Anweisungen in Bogen-Anweisungen (mm) umrechnen – für Druck-PDF und Vorschau. */
export function schemaToSheetNotes(notes: SchemaNote[], g: GridBox): SheetNote[] {
  return notes.map((n): SheetNote => {
    if (n.kind === 'text') {
      const p = schemaTextPosition(n, g)
      return {
        id: n.id,
        kind: 'text',
        target: 'all',
        text: n.text,
        x: p.x,
        y: p.y,
        size: n.size,
        rotate: n.rotate,
        bg: n.bg ?? 'none'
      }
    }
    return { ...n, target: 'all' }
  })
}
