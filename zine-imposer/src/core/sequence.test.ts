// src/core/sequence.test.ts
import { describe, it, expect } from 'vitest'
import { buildSequence, missingPages } from './sequence'
import type { ImpositionSettings } from './settings'

type Opts = Pick<ImpositionSettings, 'binding' | 'cover' | 'extraFront' | 'extraBack' | 'exclude'>
const opts = (o: Partial<Opts> = {}): Opts => ({
  binding: 'saddle',
  cover: true,
  extraFront: 0,
  extraBack: 0,
  ...o
})

describe('buildSequence', () => {
  it('mit Titelseite: Reihenfolge bleibt, Auffüllung am Ende', () => {
    expect(buildSequence(5, opts())).toEqual([0, 1, 2, 3, 4, null, null, null])
  })

  it('ohne Titelseite bleibt der Umschlag leer', () => {
    expect(buildSequence(8, opts({ cover: false }))).toEqual([
      null, 0, 1, 2, 3, 4, 5, 6, 7, null, null, null
    ])
  })

  it('Leerseiten vorne kommen hinter die Titelseite', () => {
    expect(buildSequence(4, opts({ extraFront: 1 }))).toEqual([0, null, 1, 2, 3, null, null, null])
  })

  it('Leerseiten hinten werden angehängt', () => {
    expect(buildSequence(4, opts({ extraBack: 2 }))).toEqual([0, 1, 2, 3, null, null, null, null])
  })

  it('Ein-Blatt-Zine wird auf 8 aufgefüllt', () => {
    expect(buildSequence(6, opts({ binding: 'onesheet' }))).toEqual([0, 1, 2, 3, 4, 5, null, null])
  })

  it('Ein-Blatt-Zine mit mehr als 8 Seiten meldet einen Fehler', () => {
    expect(() => buildSequence(9, opts({ binding: 'onesheet' }))).toThrow('genau 8')
  })
})
describe('missingPages', () => {
  it('Ausschießer 24 mit nur 12 Seiten: 12 fehlen', () => {
    expect(missingPages(12, opts({ binding: 'falz24' }))).toEqual({ expected: 24, missing: 12 })
  })

  it('Ausschießer 24 mit 24 Seiten: nichts fehlt', () => {
    expect(missingPages(24, opts({ binding: 'falz24' }))).toBe(null)
  })

  it('absichtliche Leerseiten zählen nicht als fehlend', () => {
    expect(missingPages(22, opts({ binding: 'falz24', extraBack: 2 }))).toBe(null)
    expect(missingPages(23, opts({ binding: 'falz24', cover: false }))).toBe(null)
  })

  it('Rückstich füllt normal auf, ohne Warnung', () => {
    expect(missingPages(5, opts())).toBe(null)
  })
})

describe('Seiten entfernen', () => {
  it('entfernte Seiten fehlen in der Folge, der Rest rückt nach', () => {
    expect(buildSequence(6, opts({ exclude: [2, 3] }))).toEqual([0, 1, 4, 5])
  })

  it('wird Seite 1 entfernt, ist die nächste Seite die Titelseite', () => {
    expect(buildSequence(5, opts({ exclude: [0] }))).toEqual([1, 2, 3, 4])
  })

  it('alle Seiten entfernt: verständlicher Fehler', () => {
    expect(() => buildSequence(2, opts({ exclude: [0, 1] }))).toThrow('Alle Seiten')
  })

  it('Ausschießer 24 mit 26 Seiten, davon 2 doppelte entfernt: passt genau', () => {
    expect(missingPages(26, opts({ binding: 'falz24', exclude: [10, 11] }))).toBe(null)
    expect(buildSequence(26, opts({ binding: 'falz24', exclude: [10, 11] }))).toHaveLength(24)
  })
})
