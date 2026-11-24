// src/core/layouts/falz24.test.ts
import { describe, it, expect } from 'vitest'
import { layouts } from './index'
import type { PageRef } from '../sequence'
import { defaultSettings } from '../settings'

const seq = (n: number): PageRef[] => Array.from({ length: n }, (_, i) => i)
const nums = (cells: { page: PageRef }[]) => cells.map((c) => (c.page === null ? null : c.page + 1))
const sorted = (a: (number | null)[]) => [...a].sort((x, y) => (x ?? 0) - (y ?? 0))

describe('Ausschießer 24 Seiten', () => {
  const s = { ...defaultSettings, binding: 'falz24' as const, twoCopies: true }
  const plans = layouts.falz24(seq(24), s)

  it('Reihenfolge 1-2-1-2-3-4 wie in der Anleitung', () => {
    expect(plans).toHaveLength(3)
    expect(nums(plans[0].front.cells)).toEqual([1, 24, 17, 8, 4, 21, 20, 5])
    expect(nums(plans[0].back!.cells)).toEqual([7, 18, 23, 2, 6, 19, 22, 3])
    expect(nums(plans[1].front.cells)).toEqual(nums(plans[0].front.cells))
    expect(nums(plans[2].front.cells)).toEqual([9, 16, 13, 12, 10, 15, 14, 11])
    expect(nums(plans[2].back!.cells)).toEqual([11, 14, 15, 10, 12, 13, 16, 9])
  })

  it('Außenbogen trägt 1–8 und 17–24 je einmal, Innenbogen 9–16 je zweimal', () => {
    const outer = sorted([...nums(plans[0].front.cells), ...nums(plans[0].back!.cells)])
    expect(outer).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 20, 21, 22, 23, 24])
    const inner = sorted([...nums(plans[2].front.cells), ...nums(plans[2].back!.cells)])
    expect(inner).toEqual([9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16])
  })

  it('ohne zwei Exemplare: Außenbogen und Innenbogen je einmal', () => {
    expect(layouts.falz24(seq(24), { ...s, twoCopies: false })).toHaveLength(2)
  })

  it('verlangt genau 24 Seiten', () => {
    expect(() => layouts.falz24(seq(20), s)).toThrow('genau 24')
  })
})