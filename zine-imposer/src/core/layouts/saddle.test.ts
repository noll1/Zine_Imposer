// src/core/layouts/saddle.test.ts
import { describe, it, expect } from 'vitest'
import { saddleStitch } from './saddle'

describe('saddleStitch', () => {
  it('8 Seiten: 2 Bögen in der richtigen Reihenfolge', () => {
    // 1-basiert gelesen: 8|1 und 2|7 auf Bogen 1, 6|3 und 4|5 auf Bogen 2
    expect(saddleStitch(8)).toEqual([
      { front: { left: 7, right: 0 }, back: { left: 1, right: 6 } },
      { front: { left: 5, right: 2 }, back: { left: 3, right: 4 } }
    ])
  })

  it('5 Seiten werden mit Leerseiten auf 8 aufgefüllt', () => {
    const sheets = saddleStitch(5)
    expect(sheets).toHaveLength(2)
    expect(sheets[0].front).toEqual({ left: null, right: 0 })
  })
})