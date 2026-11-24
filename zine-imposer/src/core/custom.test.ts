// src/core/custom.test.ts
import { describe, it, expect } from 'vitest'
import {
  backFromFront,
  describeCustom,
  falz24Layout,
  fitGaps,
  pageCoverage,
  parseCustomLayout,
  resizeGrid
} from './custom'
import { customPlan } from './layouts'
import { buildSequence } from './sequence'
import { defaultSettings, parseSettings } from './settings'

const zine8 = {
  name: 'Mini-Zine',
  pages: 8,
  sheets: [{ front: [['5^', '4^', '3^', '2^'], ['6', '7', '8', '1']], back: null }]
}

describe('Eigene Schemata', () => {
  it('liest ein gültiges Schema und beschreibt es', () => {
    const l = parseCustomLayout(zine8)
    expect(describeCustom(l)).toBe('8 Seiten, 1 Bogen, Raster 4 × 2')
  })

  it('Ausschießer 24 als Daten ist gültig', () => {
    expect(describeCustom(parseCustomLayout(falz24Layout(true)))).toBe(
      '24 Seiten, 3 Bögen, Raster 4 × 2'
    )
  })

  it('meldet fehlende Seiten', () => {
    const broken = { ...zine8, sheets: [{ front: [['5^', '4^', '-', '2^'], ['6', '7', '8', '1']], back: null }] }
    expect(() => parseCustomLayout(broken)).toThrow('Seite 3 kommt auf keinem Bogen vor')
  })

  it('meldet unverständliche Felder mit Fundstelle', () => {
    const broken = { ...zine8, sheets: [{ front: [['5^', 'vier', '3^', '2^'], ['6', '7', '8', '1']], back: null }] }
    expect(() => parseCustomLayout(broken)).toThrow('Bogen 1, Vorderseite, Zeile 1, Feld 2')
  })

  it('meldet ungleich lange Zeilen', () => {
    const broken = { ...zine8, sheets: [{ front: [['5^', '4^', '3^', '2^'], ['6', '7', '8']], back: null }] }
    expect(() => parseCustomLayout(broken)).toThrow('Zeile 2')
  })

  it('übersetzt Felder, Drehung und Kopien in Bogenpläne', () => {
    const l = parseCustomLayout({ ...zine8, sheets: [{ ...zine8.sheets[0], copies: 2 }] })
    const seq = buildSequence(8, { ...defaultSettings, binding: 'custom', custom: l })
    const plans = customPlan(l, seq)
    expect(plans).toHaveLength(2)
    expect(plans[0].front.cells[0]).toEqual({ col: 0, row: 0, page: 4, rotate: 180 })
    expect(plans[0].front.cells[7]).toEqual({ col: 3, row: 1, page: 0, rotate: 0 })
  })

  it('Vorlage mit eigenem Schema übersteht einen JSON-Durchlauf', () => {
    const t = { ...defaultSettings, name: 'Kurs', binding: 'custom', custom: zine8 }
    const parsed = parseSettings(JSON.parse(JSON.stringify(t)))
    expect(parsed.custom?.pages).toBe(8)
  })

  it('Bindung „custom“ ohne Schema wird abgelehnt', () => {
    expect(() => parseSettings({ ...defaultSettings, binding: 'custom' })).toThrow('Schema fehlt')
  })

  it('alte Vorlagen mit einer Zahl als Anschnitt werden übernommen', () => {
    const parsed = parseSettings({ ...defaultSettings, bleed: 3 })
    expect(parsed.bleed).toEqual({ top: 3, bottom: 3, inner: 3, outer: 3 })
    expect(parsed.bleedLayout).toBe('facing')
  })
})

describe('Hilfen für den Schema-Editor', () => {
  it('berechnet die Rückseiten des Ausschießers 24 aus den Vorderseiten', () => {
    const l = falz24Layout(false)
    for (const sheet of l.sheets) {
      expect(backFromFront(sheet.front, 24)).toEqual(sheet.back)
    }
  })

  it('Rückseite beim Rückstich: 8 | 1 → 2 | 7', () => {
    expect(backFromFront([['8', '1']], 8)).toEqual([['2', '7']])
  })

  it('Raster vergrößern behält Felder', () => {
    expect(resizeGrid([['1', '2']], 3, 2)).toEqual([
      ['1', '2', '-'],
      ['-', '-', '-']
    ])
  })

  it('zählt, wie oft jede Seite vorkommt', () => {
    const counts = pageCoverage(falz24Layout(true))
    expect(counts[1]).toBe(2) // Außenbogen doppelt
    expect(counts[9]).toBe(2) // Innenbogen trägt jede Seite zweimal
  })
})

describe('Abstände im eigenen Schema', () => {
  it('bleiben beim Speichern und Laden erhalten, die Rückseite spiegelt sie', () => {
    const l = parseCustomLayout(JSON.parse(JSON.stringify(falz24Layout(true))))
    expect(l.sheets[0].gaps).toEqual({ cols: [0, 9, 0], rows: [6.94] })
    const plans = customPlan(l, buildSequence(24, { ...defaultSettings, binding: 'custom', custom: l }))
    expect(plans[0].front.gaps).toEqual({ cols: [0, 9, 0], rows: [6.94] })
  })

  it('falsche Anzahl wird angepasst, Unsinn wird 0', () => {
    expect(fitGaps({ cols: [5], rows: ['x'] }, 4, 2)).toEqual({ cols: [5, 0, 0], rows: [0] })
  })
})
