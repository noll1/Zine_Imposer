// src/core/layouts/saddle.ts
import type { PageRef } from '../sequence'
export type { PageRef }

export interface SheetSide {
  left: PageRef
  right: PageRef
}

export interface Sheet {
  front: SheetSide
  back: SheetSide
}

/** Rückstichheftung für eine fertige Seitenfolge (Länge = Vielfaches von 4, null = Leerseite). */
export function saddleStitchSeq(seq: PageRef[]): Sheet[] {
  const total = seq.length
  if (total < 4 || total % 4 !== 0) {
    throw new Error('Die Seitenzahl muss ein Vielfaches von 4 sein')
  }
  const sheets: Sheet[] = []
  for (let i = 0; i < total / 4; i++) {
    sheets.push({
      front: { left: seq[total - 1 - 2 * i], right: seq[2 * i] },
      back: { left: seq[2 * i + 1], right: seq[total - 2 - 2 * i] }
    })
  }
  return sheets
}

/** Wie bisher: Seitenzahl wird am Ende mit Leerseiten aufgefüllt. */
export function saddleStitch(pageCount: number): Sheet[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('pageCount muss eine positive ganze Zahl sein')
  }
  const total = Math.ceil(pageCount / 4) * 4
  return saddleStitchSeq(
    Array.from({ length: total }, (_, i): PageRef => (i < pageCount ? i : null))
  )
}