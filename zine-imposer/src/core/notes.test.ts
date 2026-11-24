// src/core/notes.test.ts
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  appliesTo,
  fieldX,
  fieldY,
  lineSegments,
  nearestGridLine,
  parseNotes,
  schemaTextPosition,
  snap,
  xToField
} from './notes'
import { parseCustomLayout } from './custom'
import type { GridBox, SheetNote } from './notes'
import { impose } from './impose'
import { defaultSettings, parseSettings, SHEET_PRESETS } from './settings'

const box: GridBox = {
  sheetW: 297,
  sheetH: 210,
  gx: 0.5,
  gy: 0,
  cols: 4,
  rows: 2,
  cellW: 74,
  cellH: 105,
  bleed: { left: 0, right: 0, top: 0, bottom: 0 }
}

describe('Anweisungen auf dem Bogen', () => {
  it('Schnitt im Ein-Blatt-Zine: waagerecht in der Mitte, nur Felder 1–3', () => {
    const cut: SheetNote = { id: 'a', kind: 'cut', target: 'all', axis: 'h', at: 1, span: 'grid', from: 1, to: 3 }
    expect(lineSegments(cut, box)).toEqual([[74.5, 105, 222.5, 105]])
  })

  it('Falz nur im Rand: zwei kurze Linien außerhalb des Rasters', () => {
    const b = { ...box, gy: 20, sheetH: 250 }
    const fold: SheetNote = { id: 'b', kind: 'fold', target: 'all', axis: 'v', at: 2, span: 'margin' }
    expect(lineSegments(fold, b)).toEqual([
      [148.5, 18, 148.5, 10],
      [148.5, 232, 148.5, 240]
    ])
  })

  it('rastet auf die nächste Rasterlinie ein', () => {
    expect(nearestGridLine(box, 150, 40)).toEqual({ axis: 'v', at: 2, distance: 1.5 })
    expect(nearestGridLine(box, 120, 104)).toEqual({ axis: 'h', at: 1, distance: 1 })
  })

  it('Text rastet ein, wenn er nah genug ist', () => {
    expect(snap(147, [148.5, 100], 2).value).toBe(148.5)
    expect(snap(140, [148.5], 2).snapped).toBe(null)
  })

  it('Ziele: alle, nur Vorderseiten, ein bestimmter Bogen', () => {
    const n = (target: SheetNote['target']): SheetNote => ({ id: 'x', kind: 'fold', target, axis: 'v', at: 0, span: 'margin' })
    expect(appliesTo(n('all'), 2, 'back')).toBe(true)
    expect(appliesTo(n('fronts'), 0, 'back')).toBe(false)
    expect(appliesTo(n('sheet:1:back'), 1, 'back')).toBe(true)
    expect(appliesTo(n('sheet:1:back'), 0, 'back')).toBe(false)
  })

  it('lehnt kaputte Anweisungen verständlich ab', () => {
    expect(() => parseNotes([{ kind: 'text', target: 'all', text: 'x', x: 1, y: 1, size: 200, rotate: 0 }])).toThrow('Schriftgröße')
    expect(() => parseNotes([{ kind: 'fold', target: 'irgendwo', axis: 'v', at: 1, span: 'margin' }])).toThrow('Ziel')
  })

  it('Anweisungen landen im Druck-PDF, auch Umlaute; Unbekanntes wird ersetzt', async () => {
    const doc = await PDFDocument.create()
    const f = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 8; i++) doc.addPage([209.76, 297.64]).drawText(String(i + 1), { x: 50, y: 100, size: 60, font: f })
    const settings = parseSettings({
      ...defaultSettings,
      binding: 'onesheet',
      sheet: SHEET_PRESETS.A4,
      notes: [
        { id: 't', kind: 'text', target: 'all', text: 'Erst längs falzen →\nDann schneiden', x: 148.5, y: 5, size: 8, rotate: 0 },
        { id: 'c', kind: 'cut', target: 'all', axis: 'h', at: 1, span: 'grid', from: 1, to: 3 }
      ]
    })
    const out = await impose(await doc.save(), settings)
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync('out', { recursive: true })
    writeFileSync('out/anweisungen.pdf', out)
  })
})

describe('Anweisungen im eigenen Schema', () => {
  it('Text im oberen Rand sitzt mittig im freien Rand über dem Anschnitt', () => {
    const g = { ...box, gy: 20, sheetH: 250, bleed: { left: 0, right: 0, top: 3, bottom: 3 } }
    const p = schemaTextPosition({ id: 't', kind: 'text', text: 'x', zone: 'top', u: 2, v: 0, size: 8, rotate: 0 }, g)
    expect(p).toEqual({ x: 148.5, y: 8.5 })
  })

  it('Schema mit Anweisungen übersteht Prüfung und landet im Druck-PDF', async () => {
    const layout = parseCustomLayout({
      pages: 8,
      sheets: [
        {
          front: [['5^', '4^', '3^', '2^'], ['6', '7', '8', '1']],
          back: null,
          notes: {
            front: [
              { id: 'a', kind: 'text', text: '1. Längs falzen', zone: 'top', u: 2, v: 0, size: 8, rotate: 0 },
              { id: 'b', kind: 'cut', axis: 'h', at: 1, span: 'grid', from: 1, to: 3 }
            ],
            back: []
          }
        }
      ]
    })
    expect(layout.sheets[0].notes?.front).toHaveLength(2)
    const doc = await PDFDocument.create()
    const f = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 8; i++) doc.addPage([209.76, 297.64]).drawText(String(i + 1), { x: 50, y: 100, size: 60, font: f })
    const s = parseSettings({ ...defaultSettings, binding: 'custom', custom: layout, sheet: { width: 297, height: 230 } })
    const out = await impose(await doc.save(), s)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync('out', { recursive: true })
    writeFileSync('out/schema-anweisungen.pdf', out)
  })

  it('kaputte Schema-Anweisung wird mit Fundstelle abgelehnt', () => {
    expect(() =>
      parseCustomLayout({
        pages: 2,
        sheets: [{ front: [['1', '2']], back: null, notes: { front: [{ kind: 'text', text: 'x', zone: 'oben', u: 0, size: 8, rotate: 0 }], back: [] } }]
      })
    ).toThrow('Bogen 1, Vorderseite, Anweisung 1')
  })
})

describe('Anweisungen mit Abständen', () => {
  const g = {
    sheetW: 460,
    sheetH: 320,
    gx: 13.5,
    gy: 10.03,
    cols: 4,
    rows: 2,
    cellW: 106,
    cellH: 146.5,
    bleed: { left: 3, right: 3, top: 3, bottom: 3 },
    colX: [13.5, 119.5, 234.5, 340.5],
    rowY: [10.03, 163.47]
  }

  it('Rasterlinie im Abstand liegt in dessen Mitte', () => {
    expect(fieldX(g, 2)).toBe(230)
    expect(fieldY(g, 1)).toBeCloseTo(160, 1)
  })

  it('Falz über das Raster läuft bis in den Anschnitt', () => {
    const fold: SheetNote = { id: 'f', kind: 'fold', target: 'all', axis: 'h', at: 1, span: 'grid' }
    const [[x1, , x2]] = lineSegments(fold, g)
    expect([x1, x2]).toEqual([10.5, 449.5])
  })

  it('Klick in den Abstand wird zur Rasterlinie', () => {
    expect(xToField(g, 229)).toBe(2)
    expect(xToField(g, 66.5)).toBe(0.5)
  })
})
