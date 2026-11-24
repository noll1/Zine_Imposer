// src/core/layouts/index.ts
import type { Binding } from '../settings'
import type { PageRef } from '../sequence'
import { saddleStitchSeq } from './saddle'
import { falz24Layout, parseCell } from '../custom'
import type { CustomLayout } from '../custom'
import type { Cell, LayoutFn, SheetPlan, SideLayout } from './types'

/** Eine Zeile Seiten nebeneinander (von links nach rechts). */
const rowOf = (pages: PageRef[]): SideLayout => ({
  cols: pages.length,
  rows: 1,
  cells: pages.map((page, col): Cell => ({ col, row: 0, page, rotate: 0 }))
})

/** Rückstichheftung: ineinandergesteckte Bögen, in der Mitte gefalzt. */
const saddlePlan: LayoutFn = (sequence) =>
  saddleStitchSeq(sequence).map(
    (s): SheetPlan => ({
      front: rowOf([s.front.left, s.front.right]),
      back: rowOf([s.back.left, s.back.right])
    })
  )

/** Lagenbindung: Die Folge wird in Lagen geteilt, jede Lage ist ein kleines Rückstichheft. */
const signaturesPlan: LayoutFn = (sequence, settings) => {
  const size = settings.signaturePages
  const plans: SheetPlan[] = []
  for (let start = 0; start < sequence.length; start += size) {
    plans.push(...saddlePlan(sequence.slice(start, start + size), settings))
  }
  return plans
}

/** 8-Seiten-Zine aus einem Blatt: oben (auf dem Kopf) 5 4 3 2, unten 6 7 8 1. */
const oneSheetPlan: LayoutFn = (sequence) => {
  if (sequence.length !== 8) {
    throw new Error(`Ein-Blatt-Zine hat genau 8 Seiten, hier sind es ${sequence.length}`)
  }
  const ref = (n: number) => sequence[n - 1] // n ist 1-basiert, null = Leerseite
  const top = [5, 4, 3, 2].map((n, col): Cell => ({ col, row: 0, page: ref(n), rotate: 180 }))
  const bottom = [6, 7, 8, 1].map((n, col): Cell => ({ col, row: 1, page: ref(n), rotate: 0 }))
  return [{ front: { cols: 4, rows: 2, cells: [...top, ...bottom] }, back: null }]
}

/**
 * Einzelblätter zum Schneiden und Stapeln: zwei Blätter pro Bogen, beidseitig.
 * Nach dem Schneiden in der Mitte liegt links Blatt 1..n/2 und rechts der Rest.
 */
const cutStackPlan: LayoutFn = (sequence) => {
  if (sequence.length < 4 || sequence.length % 4 !== 0) {
    throw new Error('Die Seitenzahl muss ein Vielfaches von 4 sein')
  }
  const sheets = sequence.length / 4
  const plans: SheetPlan[] = []
  for (let s = 0; s < sheets; s++) {
    const left = s // linkes Blatt im Stapel
    const right = s + sheets // rechtes Blatt (zweite Stapelhälfte)
    plans.push({
      front: rowOf([sequence[2 * left], sequence[2 * right]]),
      back: rowOf([sequence[2 * right + 1], sequence[2 * left + 1]])
    })
  }
  return plans
}

/** Leporello: ein Streifen. Vorderseite = erste Hälfte der Seiten, Rückseite = zweite Hälfte. */
const leporelloPlan: LayoutFn = (sequence) => {
  if (sequence.length < 2 || sequence.length % 2 !== 0) {
    throw new Error('Die Seitenzahl muss gerade sein')
  }
  const half = sequence.length / 2
  return [{ front: rowOf(sequence.slice(0, half)), back: rowOf(sequence.slice(half)) }]
}

/** Ein Schema aus Daten (siehe custom.ts) in Bogenpläne übersetzen. */
export function customPlan(layout: CustomLayout, sequence: PageRef[]): SheetPlan[] {
  if (sequence.length !== layout.pages) {
    throw new Error(`Das Schema hat genau ${layout.pages} Seiten, hier sind es ${sequence.length}`)
  }
  const side = (rows: string[][]): SideLayout => ({
    cols: rows[0].length,
    rows: rows.length,
    cells: rows.flatMap((row, r) =>
      row.map((raw, col): Cell => {
        const c = parseCell(raw)
        if (c === 'invalid') throw new Error(`Ungültiges Feld im Schema: „${raw}“`)
        return { col, row: r, page: c.page === null ? null : sequence[c.page - 1], rotate: c.rotate }
      })
    )
  })
  const plans: SheetPlan[] = []
  for (const sheet of layout.sheets) {
    const plan: SheetPlan = { front: side(sheet.front), back: sheet.back ? side(sheet.back) : null }
    if (sheet.gaps) {
      // Rückseite: an der kurzen Kante gewendet, also Spalten-Abstände gespiegelt
      plan.front.gaps = { cols: [...sheet.gaps.cols], rows: [...sheet.gaps.rows] }
      if (plan.back) plan.back.gaps = { cols: [...sheet.gaps.cols].reverse(), rows: [...sheet.gaps.rows] }
    }
    if (sheet.notes) plan.notes = { front: sheet.notes.front ?? [], back: sheet.notes.back ?? [] }
    for (let i = 0; i < (sheet.copies ?? 1); i++) plans.push(plan)
  }
  return plans
}

/** Ausschießer 24 Seiten (nach der Kursanleitung), als Daten notiert in custom.ts. */
const falz24Plan: LayoutFn = (sequence, settings) =>
  customPlan(falz24Layout(settings.twoCopies), sequence)

/** Eigenes Schema aus der Vorlage. */
const customLayoutPlan: LayoutFn = (sequence, settings) => {
  if (!settings.custom) throw new Error('Für „Eigenes Schema“ fehlt das Schema in der Vorlage')
  return customPlan(settings.custom, sequence)
}

export const layouts: Record<Binding, LayoutFn> = {
  saddle: saddlePlan,
  signatures: signaturesPlan,
  onesheet: oneSheetPlan,
  cutstack: cutStackPlan,
  leporello: leporelloPlan,
  falz24: falz24Plan,
  custom: customLayoutPlan
}