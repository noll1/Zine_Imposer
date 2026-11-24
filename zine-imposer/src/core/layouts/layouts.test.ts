// src/core/layouts/layouts.test.ts
import { describe, it, expect } from 'vitest'
import { layouts } from './index'
import { buildSequence } from '../sequence'
import type { PageRef } from '../sequence'
import { defaultSettings } from '../settings'

const seq = (n: number): PageRef[] => Array.from({ length: n }, (_, i) => i)
const pages = (cells: { page: PageRef }[]) => cells.map((c) => c.page)

describe('Lagenbindung', () => {
  it('teilt 16 Seiten in zwei Lagen zu je 8 Seiten', () => {
    const s = { ...defaultSettings, binding: 'signatures' as const, signaturePages: 8 }
    const plans = layouts.signatures(seq(16), s)
    expect(plans).toHaveLength(4)
    expect(pages(plans[0].front.cells)).toEqual([7, 0])
    expect(pages(plans[2].front.cells)).toEqual([15, 8])
  })
})

describe('Klebebindung aus Einzelblättern', () => {
  it('8 Seiten: zwei Bögen, nach dem Schneiden ergibt sich die Lesereihenfolge', () => {
    const s = { ...defaultSettings, binding: 'cutstack' as const }
    const plans = layouts.cutstack(seq(8), s)
    expect(plans).toHaveLength(2)
    expect(pages(plans[0].front.cells)).toEqual([0, 4])
    expect(pages(plans[0].back!.cells)).toEqual([5, 1])
    expect(pages(plans[1].front.cells)).toEqual([2, 6])
    expect(pages(plans[1].back!.cells)).toEqual([7, 3])
  })
})

describe('Leporello', () => {
  it('8 Seiten: vier Felder pro Seite des Streifens', () => {
    const s = { ...defaultSettings, binding: 'leporello' as const }
    const plans = layouts.leporello(seq(8), s)
    expect(plans).toHaveLength(1)
    expect(pages(plans[0].front.cells)).toEqual([0, 1, 2, 3])
    expect(pages(plans[0].back!.cells)).toEqual([4, 5, 6, 7])
  })

  it('ungerade Seitenzahl wird mit einer Leerseite aufgefüllt', () => {
    const o = { ...defaultSettings, binding: 'leporello' as const }
    expect(buildSequence(5, o)).toEqual([0, 1, 2, 3, 4, null])
  })
})