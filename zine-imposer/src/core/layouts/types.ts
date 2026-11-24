// src/core/layouts/types.ts
import type { PageRef } from './saddle'
import type { ImpositionSettings } from '../settings'
import type { SchemaNote } from '../notes'
export type { PageRef }

/** Eine Zelle im Raster einer Bogenseite. row 0 = oberste Zeile. */
export interface Cell {
  col: number
  row: number
  page: PageRef
  rotate: 0 | 180
}

/** Abstände zwischen den Seiten in mm (Endformat zu Endformat): cols[i] liegt zwischen Spalte i und i+1. */
export interface Gaps {
  cols: number[]
  rows: number[]
}

export interface SideLayout {
  cols: number
  rows: number
  cells: Cell[]
  /** Abstände zwischen Spalten und Zeilen (fehlt = keine Abstände) */
  gaps?: Gaps
}

/** Ein Bogen: Vorderseite und (falls vorhanden) Rückseite. */
export interface SheetPlan {
  front: SideLayout
  back: SideLayout | null
  /** Anweisungen aus einem eigenen Schema (Texte, Falz- und Schnittlinien) */
  notes?: { front: SchemaNote[]; back: SchemaNote[] }
}

export type LayoutFn = (sequence: PageRef[], settings: ImpositionSettings) => SheetPlan[]