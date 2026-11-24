// src/core/custom.ts
// Eigene Ausschießschemata als Daten. Gedacht zum Teilen als Vorlage (z. B. von Lehrenden für einen Kurs).
//
// Schreibweise eines Feldes:  "17"  = Seite 17   ·   "17^" = Seite 17 auf dem Kopf (180°)   ·   "-" = leer
// Jede Bogenseite ist eine Liste von Zeilen (oben nach unten), jede Zeile eine Liste von Feldern (links nach rechts).
// Die Rückseite wird so notiert, wie sie im fertigen Druck-PDF erscheint (Wenden an der kurzen Kante).
import { parseSchemaNotes } from './notes'
import type { SchemaNote } from './notes'

export interface CustomSheet {
  front: string[][]
  back: string[][] | null
  copies?: number // so oft wird dieser Bogen hintereinander ausgegeben (Standard 1)
  /** Anweisungen je Bogenseite: Texte, Falz- und Schnittlinien (rasterbezogen) */
  notes?: { front: SchemaNote[]; back: SchemaNote[] }
  /**
   * Abstände zwischen den Seiten in mm, Endformat zu Endformat, so wie sie auf der Vorderseite liegen:
   * cols[i] zwischen Spalte i und i+1, rows[i] zwischen Zeile i und i+1. Die Rückseite spiegelt sie.
   */
  gaps?: { cols: number[]; rows: number[] }
}

const MAX_GAP = 200

/** Abstände auf die Größe des Rasters bringen (fehlende = 0, zu viele weg). */
export function fitGaps(
  gaps: { cols?: unknown; rows?: unknown } | undefined,
  cols: number,
  rows: number
): { cols: number[]; rows: number[] } {
  const fit = (list: unknown, n: number) =>
    Array.from({ length: Math.max(0, n) }, (_, i) => {
      const v = Array.isArray(list) ? Number(list[i]) : 0
      return Number.isFinite(v) ? Math.min(MAX_GAP, Math.max(0, Math.round(v * 100) / 100)) : 0
    })
  return { cols: fit(gaps?.cols, cols - 1), rows: fit(gaps?.rows, rows - 1) }
}

const hasGaps = (g: { cols: number[]; rows: number[] }) => [...g.cols, ...g.rows].some((v) => v > 0)

export interface CustomLayout {
  name?: string
  pages: number // genaue Seitenzahl des Hefts (inkl. Leerseiten)
  sheets: CustomSheet[]
}

export interface ParsedCell {
  page: number | null // 1-basiert, null = leer
  rotate: 0 | 180
}

const MAX_PAGES = 512
const MAX_GRID = 16
const MAX_COPIES = 20

/** "17" → Seite 17, "17^" → Seite 17 gedreht, "-" oder "" → leer. */
export function parseCell(raw: unknown): ParsedCell | 'invalid' {
  if (raw === null || raw === undefined) return { page: null, rotate: 0 }
  const text = String(raw).trim()
  if (text === '' || text === '-') return { page: null, rotate: 0 }
  const m = /^(\d+)\s*(\^)?$/.exec(text)
  if (!m) return 'invalid'
  return { page: Number(m[1]), rotate: m[2] ? 180 : 0 }
}

/** Prüft ein Schema und liefert verständliche Fehler mit Fundstelle. */
export function parseCustomLayout(raw: unknown): CustomLayout {
  const l = raw as Partial<CustomLayout> | null
  if (!l || typeof l !== 'object') throw new Error('Eigenes Schema fehlt')
  const pages = l.pages
  if (!Number.isInteger(pages) || (pages as number) < 1 || (pages as number) > MAX_PAGES) {
    throw new Error(`Eigenes Schema: „pages“ muss eine ganze Zahl von 1 bis ${MAX_PAGES} sein`)
  }
  if (!Array.isArray(l.sheets) || l.sheets.length === 0) {
    throw new Error('Eigenes Schema: „sheets“ braucht mindestens einen Bogen')
  }

  const seen = new Set<number>()
  const sheets: CustomSheet[] = l.sheets.map((sheet, si) => {
    const where = `Bogen ${si + 1}`
    if (!sheet || typeof sheet !== 'object') throw new Error(`${where}: ungültig`)
    const copies = sheet.copies ?? 1
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
      throw new Error(`${where}: „copies“ muss zwischen 1 und ${MAX_COPIES} liegen`)
    }
    const side = (rows: unknown, label: string): string[][] => {
      if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_GRID) {
        throw new Error(`${where}, ${label}: braucht 1 bis ${MAX_GRID} Zeilen`)
      }
      const cols = Array.isArray(rows[0]) ? rows[0].length : 0
      if (cols === 0 || cols > MAX_GRID) {
        throw new Error(`${where}, ${label}: braucht 1 bis ${MAX_GRID} Felder pro Zeile`)
      }
      return rows.map((row, ri) => {
        if (!Array.isArray(row) || row.length !== cols) {
          throw new Error(`${where}, ${label}, Zeile ${ri + 1}: alle Zeilen brauchen ${cols} Felder`)
        }
        return row.map((cell, ci) => {
          const c = parseCell(cell)
          const at = `${where}, ${label}, Zeile ${ri + 1}, Feld ${ci + 1}`
          if (c === 'invalid') throw new Error(`${at}: „${cell}“ verstehe ich nicht (Beispiele: 7, 7^, -)`)
          if (c.page !== null) {
            if (c.page < 1 || c.page > (pages as number)) {
              throw new Error(`${at}: Seite ${c.page} gibt es nicht (Heft hat ${pages} Seiten)`)
            }
            seen.add(c.page)
          }
          return c.page === null ? '-' : `${c.page}${c.rotate === 180 ? '^' : ''}`
        })
      })
    }
    const front = side(sheet.front, 'Vorderseite')
    let back: string[][] | null = null
    if (sheet.back !== null && sheet.back !== undefined) {
      back = side(sheet.back, 'Rückseite')
      if (back.length !== front.length || back[0].length !== front[0].length) {
        throw new Error(`${where}: Vorder- und Rückseite brauchen dasselbe Raster`)
      }
    }
    const notes = sheet.notes
      ? {
          front: parseSchemaNotes(sheet.notes.front, `${where}, Vorderseite`),
          back: parseSchemaNotes(sheet.notes.back, `${where}, Rückseite`)
        }
      : undefined
    if (sheet.gaps !== undefined && (typeof sheet.gaps !== 'object' || sheet.gaps === null)) {
      throw new Error(`${where}: ungültige Abstände`)
    }
    const gaps = fitGaps(sheet.gaps, front[0].length, front.length)
    return {
      front,
      back,
      copies,
      ...(notes && (notes.front.length || notes.back.length) ? { notes } : {}),
      ...(hasGaps(gaps) ? { gaps } : {})
    }
  })

  const missing: number[] = []
  for (let p = 1; p <= (pages as number); p++) if (!seen.has(p)) missing.push(p)
  if (missing.length) {
    const list = missing.slice(0, 8).join(', ') + (missing.length > 8 ? ' …' : '')
    throw new Error(`Eigenes Schema: Seite ${list} kommt auf keinem Bogen vor`)
  }

  const name = typeof l.name === 'string' && l.name.trim() ? l.name.trim() : undefined
  return { ...(name ? { name } : {}), pages: pages as number, sheets }
}

/** Kurzbeschreibung für die Oberfläche. */
export function describeCustom(l: CustomLayout): string {
  const printed = l.sheets.reduce((n, s) => n + (s.copies ?? 1), 0)
  const grids = [...new Set(l.sheets.map((s) => `${s.front[0].length} × ${s.front.length}`))]
  return `${l.pages} Seiten, ${printed} ${printed === 1 ? 'Bogen' : 'Bögen'}, Raster ${grids.join(' / ')}`
}

/**
 * Der Ausschießer aus der Kursvorlage („02 Ausschießer26_format_neu“), als Daten notiert:
 * Bogen 460 × 320 mm, Seiten 106 × 146,5 mm, in der Mitte 9 mm Abstand (Falz), zwischen den
 * Reihen 6,94 mm (Falz bzw. Schnitt), dazu die Hinweise aus der Vorlage.
 */
export function falz24Layout(twoCopies: boolean): CustomLayout {
  const gaps = { cols: [0, 9, 0], rows: [6.94] }
  const oben: SchemaNote = {
    id: 'oben',
    kind: 'text',
    text: '^\n|\n|\n|\no\nb\ne\nn',
    zone: 'grid',
    u: 2,
    v: 0.06,
    size: 5.5,
    rotate: 0,
    bg: 'black'
  }
  const foldMiddle: SchemaNote = { id: 'falz-mitte', kind: 'fold', axis: 'v', at: 2, span: 'grid' }
  const foldRows: SchemaNote = { id: 'falz-reihen', kind: 'fold', axis: 'h', at: 1, span: 'grid' }
  const cutRows: SchemaNote = { id: 'schnitt-reihen', kind: 'cut', axis: 'h', at: 1, span: 'grid' }
  const hint = (id: string, text: string, rotate: 0 | 90, u: number, v: number): SchemaNote => ({
    id,
    kind: 'text',
    text,
    zone: 'grid',
    u,
    v,
    size: 5.5,
    rotate,
    bg: 'paper'
  })
  const FALZ = 'Falzlinien – vor dem Falzen leicht anritzen'
  const SCHNITT = 'Schnittlinie – vor dem Falzen durchschneiden'
  return {
    name: 'Ausschießer 24 Seiten (Falzbogen 16 + 8)',
    pages: 24,
    sheets: [
      {
        copies: twoCopies ? 2 : 1,
        gaps,
        front: [
          ['1^', '24^', '17^', '8^'],
          ['4', '21', '20', '5']
        ],
        back: [
          ['7^', '18^', '23^', '2^'],
          ['6', '19', '22', '3']
        ],
        notes: {
          front: [foldRows, foldMiddle, hint('hinweis', FALZ, 0, 1.5, 1), oben],
          back: [foldRows, foldMiddle, hint('hinweis', FALZ, 90, 2, 0.64), oben]
        }
      },
      {
        gaps,
        front: [
          ['9^', '16^', '13^', '12^'],
          ['10', '15', '14', '11']
        ],
        back: [
          ['11^', '14^', '15^', '10^'],
          ['12', '13', '16', '9']
        ],
        notes: {
          front: [cutRows, foldMiddle, hint('hinweis', SCHNITT, 0, 1.5, 1), oben],
          back: [cutRows, foldMiddle, hint('hinweis', SCHNITT, 0, 1.5, 1), oben]
        }
      }
    ]
  }
}

// --- Hilfen für den Schema-Editor ------------------------------------------

/** Feld in der Schreibweise des Schemas. */
export const formatCell = (c: ParsedCell) =>
  c.page === null ? '-' : `${c.page}${c.rotate === 180 ? '^' : ''}`

/** Leeres Raster (cols Felder breit, rows Zeilen hoch). */
export const emptyGrid = (cols: number, rows: number): string[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => '-'))

/** Raster vergrößern oder verkleinern, vorhandene Felder bleiben, neue sind leer. */
export function resizeGrid(grid: string[][], cols: number, rows: number): string[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => grid[r]?.[c] ?? '-')
  )
}

/**
 * Rückseite aus der Vorderseite berechnen („Blattpartner“):
 * Hinter Seite p liegt auf demselben Blatt Seite p+1 (ungerade p) bzw. p-1 (gerade p).
 * Beim Wenden an der kurzen Kante wird jede Zeile gespiegelt, die Drehung bleibt.
 */
export function backFromFront(front: string[][], pages: number): string[][] {
  return front.map((row) =>
    [...row].reverse().map((raw) => {
      const c = parseCell(raw)
      if (c === 'invalid' || c.page === null) return '-'
      const partner = c.page % 2 === 1 ? c.page + 1 : c.page - 1
      if (partner < 1 || partner > pages) return '-'
      return formatCell({ page: partner, rotate: c.rotate })
    })
  )
}

/** Wie oft jede Seite (1 … pages) im Schema vorkommt, Kopien mitgezählt. */
export function pageCoverage(l: Pick<CustomLayout, 'pages' | 'sheets'>): number[] {
  const counts = Array.from({ length: l.pages + 1 }, () => 0)
  for (const sheet of l.sheets) {
    for (const grid of [sheet.front, sheet.back ?? []]) {
      for (const row of grid) {
        for (const raw of row) {
          const c = parseCell(raw)
          if (c !== 'invalid' && c.page !== null && c.page <= l.pages) {
            counts[c.page] += sheet.copies ?? 1
          }
        }
      }
    }
  }
  return counts
}
