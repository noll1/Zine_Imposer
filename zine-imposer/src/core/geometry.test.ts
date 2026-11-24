// src/core/geometry.test.ts
import { describe, it, expect } from 'vitest'
import { edgeBleed, gridGeometry, keptBleed, markPlacement, trimEdges, turnSide } from './geometry'
import { layouts } from './layouts'
import { buildSequence } from './sequence'
import { defaultSettings, parseSettings } from './settings'

const falz = {
  ...defaultSettings,
  binding: 'falz24' as const,
  twoCopies: true,
  bleed: { top: 3, bottom: 3, inner: 0, outer: 3 },
  cropMarks: { ...defaultSettings.cropMarks, enabled: true }
}
const outerFront = () => layouts.falz24(buildSequence(24, falz), falz)[0].front

describe('Anschnitt an den Außenkanten', () => {
  it('Ausschießer 24 (3–3–0–3): außen rundum 3 mm', () => {
    expect(edgeBleed(outerFront(), falz)).toEqual({ left: 3, right: 3, top: 3, bottom: 3 })
  })

  it('Rückstich mit 3–3–0–3: links und rechts nur der Außen-Anschnitt', () => {
    const s = { ...defaultSettings, bleed: { top: 2, bottom: 4, inner: 0, outer: 3 } }
    const side = layouts.saddle(buildSequence(8, s), s)[0].front
    expect(edgeBleed(side, s)).toEqual({ left: 3, right: 3, top: 2, bottom: 4 })
  })
})

describe('Schnittmarken wandern mit dem Anschnitt', () => {
  it('Abstand ab Anschnitt: 3 mm Anschnitt + 3 mm Abstand = 6 mm', () => {
    expect(markPlacement(outerFront(), falz).top.start).toBe(6)
  })

  it('mehr Anschnitt schiebt die Marken weiter nach außen', () => {
    const more = { ...falz, bleed: { top: 5, bottom: 5, inner: 0, outer: 5 } }
    expect(markPlacement(outerFront(), more).left.start).toBe(8)
  })

  it('Abstand ab Endformat: nie innerhalb des Anschnitts', () => {
    const trim = { ...falz, cropMarks: { ...falz.cropMarks, from: 'trim' as const } }
    expect(markPlacement(outerFront(), trim).top.start).toBe(3)
    const more = { ...trim, bleed: { top: 5, bottom: 5, inner: 0, outer: 5 } }
    expect(markPlacement(outerFront(), more).top.start).toBe(5)
  })

  it('alte Vorlagen behalten ihr bisheriges Verhalten (ab Endformat)', () => {
    const old = { ...defaultSettings, cropMarks: { enabled: true, length: 5, offset: 3 } }
    expect(parseSettings(JSON.parse(JSON.stringify(old))).cropMarks.from).toBe('trim')
  })
})

describe('Abstände zwischen den Seiten (Stege)', () => {
  const side = { cols: 4, rows: 2, cells: [], gaps: { cols: [0, 9, 0], rows: [6.94] } }

  it('Ausschießer 24 wie in der Kursvorlage: Raster mittig auf 460 × 320', () => {
    const g = gridGeometry(side, 106, 146.5, 460, 320)
    expect(g.colX).toEqual([13.5, 119.5, 234.5, 340.5])
    expect(g.rowY[0]).toBeCloseTo(10.03, 2)
    expect(g.rowY[1]).toBeCloseTo(163.47, 2)
  })

  it('Anschnitt ragt in den Abstand, höchstens bis zur Mitte', () => {
    const s = { ...defaultSettings, bleed: { top: 3, bottom: 3, inner: 0, outer: 3 } }
    // Seite 24 (linke Seite) oben in Spalte 2, auf dem Kopf: außen zeigt zur Mitte
    const kept = keptBleed({ col: 1, row: 0, page: 23, rotate: 180 }, side, s)
    expect(kept).toEqual({ left: 0, right: 3, top: 3, bottom: 3 })
    // engerer Abstand: nur bis zur Mitte
    const tight = { ...side, gaps: { cols: [0, 2, 0], rows: [1] } }
    expect(keptBleed({ col: 1, row: 0, page: 23, rotate: 180 }, tight, s)).toEqual({ left: 0, right: 1, top: 3, bottom: 0.5 })
  })

  it('Marken an jeder Schnittkante: bei Abstand zwei, ohne Abstand eine', () => {
    const g = gridGeometry(side, 106, 146.5, 460, 320)
    expect(trimEdges(g, 106, 146.5).xs).toEqual([13.5, 119.5, 225.5, 234.5, 340.5, 446.5])
  })

  it('Wenden an der langen Kante dreht die Abstände mit', () => {
    expect(turnSide({ ...side, gaps: { cols: [1, 2, 3], rows: [4] } }).gaps).toEqual({ cols: [3, 2, 1], rows: [4] })
  })
})
