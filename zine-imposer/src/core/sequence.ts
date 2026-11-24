// src/core/sequence.ts
import type { Binding, ImpositionSettings } from './settings'

export type PageRef = number | null // 0-basierter Seitenindex im Quell-PDF, null = Leerseite

type SequenceOptions = Pick<ImpositionSettings, 'binding' | 'cover' | 'extraFront' | 'extraBack'> &
  Partial<Pick<ImpositionSettings, 'custom' | 'exclude'>>

/** Seiten der Datei, die im Heft vorkommen (ohne entfernte Seiten), 0-basiert. */
export function keptPages(pageCount: number, exclude: number[] = []): number[] {
  const removed = new Set(exclude)
  return Array.from({ length: pageCount }, (_, i) => i).filter((i) => !removed.has(i))
}

/** Auf wie viele Seiten die Folge aufgefüllt wird. */
function targetLength(length: number, binding: Binding, customPages?: number): number {
  switch (binding) {
    case 'custom':
      if (!customPages) throw new Error('Für „Eigenes Schema“ fehlt das Schema in der Vorlage')
      return customPages
    case 'onesheet':
      return 8
    case 'falz24':
      return 24
    case 'leporello':
      return Math.max(2, Math.ceil(length / 2) * 2)
    default:
      return Math.max(4, Math.ceil(length / 4) * 4)
  }
}

/** Seitenfolge des fertigen Hefts in Lesereihenfolge, aufgefüllt auf die nötige Seitenzahl. */
export function buildSequence(pageCount: number, o: SequenceOptions): PageRef[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('pageCount muss eine positive ganze Zahl sein')
  }
  const blanks = (n: number): PageRef[] => Array.from({ length: n }, () => null)
  const pages: PageRef[] = keptPages(pageCount, o.exclude)
  if (pages.length === 0) throw new Error('Alle Seiten wurden entfernt')

  const seq: PageRef[] = []
  let content = pages
  if (o.cover) {
    seq.push(pages[0]) // erste (nicht entfernte) Seite der Datei ist die Titelseite
    content = pages.slice(1)
  } else {
    seq.push(null) // Umschlag bleibt leer, die Datei beginnt mit einer Doppelseite
  }
  seq.push(...blanks(o.extraFront), ...content, ...blanks(o.extraBack))

  const target = targetLength(seq.length, o.binding, o.custom?.pages)
  if (seq.length > target) {
    throw new Error(
      `Diese Bindungsart hat genau ${target} Seiten, hier ergeben sich ${seq.length} (inkl. Leerseiten)`
    )
  }
  while (seq.length < target) seq.push(null)
  return seq
}
/** Bindungsarten mit fester Seitenzahl: Fehlende Seiten sind dort meist ein Versehen. */
const FIXED_COUNT: Binding[] = ['onesheet', 'falz24', 'custom']

/**
 * Prüft, ob bei einem festen Schema Seiten fehlen, die die App mit Leerseiten auffüllen müsste.
 * Absichtlich eingestellte Leerseiten (vorne/hinten, fehlende Titelseite) zählen nicht mit.
 * Gibt null zurück, wenn alles passt.
 */
export function missingPages(
  pageCount: number,
  o: SequenceOptions
): { expected: number; missing: number } | null {
  if (!FIXED_COUNT.includes(o.binding)) return null
  let seq: PageRef[]
  try {
    seq = buildSequence(pageCount, o)
  } catch {
    return null // zu viele Seiten: dafür gibt es schon eine Fehlermeldung
  }
  const present = keptPages(pageCount, o.exclude).length
  const deliberate = o.extraFront + o.extraBack + (o.cover ? 0 : 1)
  const missing = seq.length - present - deliberate
  return missing > 0 ? { expected: present + missing, missing } : null
}
