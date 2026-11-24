// src/core/settings.ts
import { parseCustomLayout } from './custom'
import type { CustomLayout } from './custom'
import { parseNotes } from './notes'
import type { SheetNote } from './notes'

export const BINDINGS = [
  'saddle',
  'signatures',
  'onesheet',
  'cutstack',
  'leporello',
  'falz24',
  'custom'
] as const
export type Binding = (typeof BINDINGS)[number]
export type DuplexFlip = 'short-edge' | 'long-edge'

export const MARK_SIDES = ['top', 'bottom', 'left', 'right'] as const
export type MarkSide = (typeof MARK_SIDES)[number]
export interface MarkSideSettings {
  enabled: boolean
  length: number // mm
  offset: number // Abstand zum Endformat in mm
}

/** Anschnitt im Quell-PDF je Seite, in mm (wie unter „Dokument einrichten“ in InDesign). */
export interface Bleed {
  top: number
  bottom: number
  inner: number // bei Einzelseiten: links
  outer: number // bei Einzelseiten: rechts
}
/** Doppelseiten: innen/außen wechseln zwischen linken und rechten Seiten. Einzelseiten: immer links/rechts. */
export type BleedLayout = 'facing' | 'single'

export interface ImpositionSettings {
  version: 1
  name: string
  binding: Binding
  signaturePages: number // Seiten pro Lage (nur Lagenbindung), Vielfaches von 4
  twoCopies: boolean // nur "Ausschießer 24": Außenbogen doppelt, ergibt zwei Hefte
  custom?: CustomLayout // nur Bindung "custom": eigenes Ausschießschema
  /** Eigene Anweisungen auf dem Bogen: Texte, Falz- und Schnittlinien (gehören zur Vorlage) */
  notes?: SheetNote[]
  /** Entfernte Seiten der aktuellen Datei (0-basiert). Gehört zum Dokument, nicht zur Vorlage. */
  exclude?: number[]
  sheet: { width: number; height: number } // Bogenformat in mm (Querformat)
  duplexFlip: DuplexFlip
  bleed: Bleed // Anschnitt im Quell-PDF in mm, je Seite
  bleedLayout: BleedLayout
  cover: boolean // Titelseite vorhanden: Seite 1 ist der Umschlag
  extraFront: number // zusätzliche Leerseiten vor der ersten Inhaltsseite
  extraBack: number // zusätzliche Leerseiten nach der letzten Seite
  /** Schnitt- und Falzmarken, je Bogenseite (oben/unten/links/rechts) einzeln einstellbar */
  cropMarks: {
    enabled: boolean
    /** Abstand gemessen ab dem Anschnitt (Marken wandern mit) oder ab dem Endformat */
    from: 'bleed' | 'trim'
    sides: Record<MarkSide, MarkSideSettings>
  }
}

/** Bindungsarten mit fest vorgegebenem Wenden (kurze Kante) oder ohne Rückseite. */
const FIXED_DUPLEX: Binding[] = ['onesheet', 'falz24', 'custom']
export const usesDuplexSetting = (b: Binding) => !FIXED_DUPLEX.includes(b)

/** Ist diese Quellseite (0-basiert) eine rechte Seite? Seite 1 ist rechts, wenn es eine Titelseite gibt. */
export const isRightPage = (cover: boolean, srcIndex: number) =>
  cover ? srcIndex % 2 === 0 : srcIndex % 2 === 1

/** Anschnitt einer bestimmten Quellseite als links/rechts/oben/unten in mm. */
export function pageBleed(
  s: Pick<ImpositionSettings, 'bleed' | 'bleedLayout' | 'cover'>,
  srcIndex: number
): { left: number; right: number; top: number; bottom: number } {
  const { top, bottom, inner, outer } = s.bleed
  const right = s.bleedLayout === 'single' || isRightPage(s.cover, srcIndex)
  return right
    ? { left: inner, right: outer, top, bottom }
    : { left: outer, right: inner, top, bottom }
}

export const maxBleed = (b: Bleed) => Math.max(b.top, b.bottom, b.inner, b.outer)

/** Gängige Bogenformate in mm, jeweils im Querformat. */
export const SHEET_PRESETS = {
  A4: { width: 297, height: 210 },
  A3: { width: 420, height: 297 },
  SRA3: { width: 450, height: 320 },
  Letter: { width: 279.4, height: 215.9 },
  Tabloid: { width: 431.8, height: 279.4 }
}

const markSide = (enabled = true): MarkSideSettings => ({ enabled, length: 5, offset: 3 })

export const defaultSettings: ImpositionSettings = {
  version: 1,
  name: 'Standard',
  binding: 'saddle',
  signaturePages: 16,
  twoCopies: false,
  sheet: SHEET_PRESETS.A4,
  duplexFlip: 'short-edge',
  bleed: { top: 0, bottom: 0, inner: 0, outer: 0 },
  bleedLayout: 'facing',
  cover: true,
  extraFront: 0,
  extraBack: 0,
  cropMarks: {
    enabled: false,
    from: 'bleed',
    sides: { top: markSide(), bottom: markSide(), left: markSide(), right: markSide() }
  }
}

/** Mitgelieferte Vorlagen: erscheinen in der Vorlagenliste und lassen sich nicht löschen. */
export const BUILTIN_TEMPLATES: ImpositionSettings[] = [
  {
    ...defaultSettings,
    name: 'Ausschießer 24 Seiten (Falzbogen, 460 × 320)',
    binding: 'falz24',
    sheet: { width: 460, height: 320 }, // wie in der Kursvorlage
    bleed: { top: 3, bottom: 3, inner: 0, outer: 3 }, // wie in der Anleitung: 3–3–0–3 mm
    twoCopies: true,
    cropMarks: {
      enabled: true,
      from: 'bleed',
      sides: {
        top: { enabled: true, length: 4, offset: 1 },
        bottom: { enabled: true, length: 4, offset: 1 },
        left: { enabled: true, length: 4, offset: 1 },
        right: { enabled: true, length: 4, offset: 1 }
      }
    }
  }
]

const positive = (n: unknown): n is number => typeof n === 'number' && n > 0
const nonNegative = (n: unknown): n is number => typeof n === 'number' && n >= 0
const validCount = (n: unknown) =>
  n === undefined || (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 64)
const validSignature = (n: unknown) =>
  n === undefined ||
  (Number.isInteger(n) && (n as number) >= 4 && (n as number) <= 64 && (n as number) % 4 === 0)

/** Anschnitt lesen. Ältere Vorlagen (eine Zahl für rundum) werden übernommen. */
function parseBleed(raw: unknown): Bleed {
  if (typeof raw === 'number') {
    if (raw < 0) throw new Error('Ungültiger Anschnitt')
    return { top: raw, bottom: raw, inner: raw, outer: raw }
  }
  const b = raw as Partial<Bleed> | null
  if (!b || ![b.top, b.bottom, b.inner, b.outer].every(nonNegative)) {
    throw new Error('Ungültiger Anschnitt (je Seite 0 mm oder mehr)')
  }
  return { top: b.top!, bottom: b.bottom!, inner: b.inner!, outer: b.outer! }
}

/** Marken aus einer Vorlage lesen. Ältere Vorlagen (eine Länge/ein Abstand für alles) werden übernommen. */
function parseMarks(raw: unknown): ImpositionSettings['cropMarks'] {
  const m = raw as {
    enabled?: unknown
    from?: unknown
    length?: unknown
    offset?: unknown
    sides?: Partial<Record<MarkSide, Partial<MarkSideSettings>>>
  } | null
  if (!m || typeof m.enabled !== 'boolean') throw new Error('Ungültige Schnittmarken-Einstellung')
  const fallbackLength = positive(m.length) ? m.length : 5
  const fallbackOffset = nonNegative(m.offset) ? m.offset : 3
  const sides = {} as Record<MarkSide, MarkSideSettings>
  for (const side of MARK_SIDES) {
    const s = m.sides?.[side] ?? {}
    const enabled = s.enabled ?? true
    const length = s.length ?? fallbackLength
    const offset = s.offset ?? fallbackOffset
    if (typeof enabled !== 'boolean' || !positive(length) || !nonNegative(offset)) {
      throw new Error('Ungültige Schnittmarken-Einstellung')
    }
    sides[side] = { enabled, length, offset }
  }
  if (m.from !== undefined && m.from !== 'bleed' && m.from !== 'trim') {
    throw new Error('Ungültige Schnittmarken-Einstellung')
  }
  // Ältere Vorlagen kennen die Einstellung nicht: dort zählte der Abstand ab dem Endformat
  return { enabled: m.enabled, from: (m.from as 'bleed' | 'trim' | undefined) ?? 'trim', sides }
}

/** Prüft eine geladene Vorlage (z. B. aus JSON), bevor sie benutzt wird. Ältere Vorlagen bekommen Standardwerte. */
export function parseSettings(raw: unknown): ImpositionSettings {
  const s = raw as Partial<ImpositionSettings> | null
  if (!s || s.version !== 1) throw new Error('Unbekannte Vorlagen-Version')
  if (!BINDINGS.includes(s.binding as Binding)) throw new Error('Unbekannte Bindungsart')
  if (!positive(s.sheet?.width) || !positive(s.sheet?.height)) {
    throw new Error('Ungültiges Bogenformat')
  }
  if (s.duplexFlip !== 'short-edge' && s.duplexFlip !== 'long-edge') {
    throw new Error('Ungültige Duplex-Einstellung')
  }
  if (s.bleedLayout !== undefined && s.bleedLayout !== 'facing' && s.bleedLayout !== 'single') {
    throw new Error('Ungültige Anschnitt-Einstellung')
  }
  if (s.cover !== undefined && typeof s.cover !== 'boolean') {
    throw new Error('Ungültige Titelseiten-Einstellung')
  }
  if (s.twoCopies !== undefined && typeof s.twoCopies !== 'boolean') {
    throw new Error('Ungültige Einstellung „Zwei Exemplare“')
  }
  if (!validCount(s.extraFront) || !validCount(s.extraBack)) {
    throw new Error('Ungültige Anzahl Leerseiten (0 bis 64)')
  }
  if (!validSignature(s.signaturePages)) {
    throw new Error('Seiten pro Lage müssen ein Vielfaches von 4 sein (4 bis 64)')
  }
  if (
    s.exclude !== undefined &&
    (!Array.isArray(s.exclude) ||
      s.exclude.length > 10000 ||
      !s.exclude.every((n) => Number.isInteger(n) && n >= 0))
  ) {
    throw new Error('Ungültige Liste entfernter Seiten')
  }
  const custom =
    s.custom !== undefined || s.binding === 'custom' ? parseCustomLayout(s.custom) : undefined
  return {
    ...(s as ImpositionSettings),
    ...(custom ? { custom } : {}),
    bleed: parseBleed(s.bleed),
    ...(s.notes !== undefined ? { notes: parseNotes(s.notes) } : {}),
    bleedLayout: s.bleedLayout ?? 'facing',
    cropMarks: parseMarks(s.cropMarks),
    signaturePages: s.signaturePages ?? 16,
    twoCopies: s.twoCopies ?? false,
    cover: s.cover ?? true,
    extraFront: s.extraFront ?? 0,
    extraBack: s.extraBack ?? 0
  }
}
