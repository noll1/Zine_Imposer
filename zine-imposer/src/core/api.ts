// src/core/api.ts
import type { ImpositionSettings } from './settings'
import type { ImposeProgress } from './impose'

/** Fortschritt von „Druckbogen erstellen“, vom Hauptprozess an das Fenster gemeldet */
export type ImposeEvent = ImposeProgress | { phase: 'dialog' } | { phase: 'writing' }

export interface PdfInfo {
  pageCount: number
  widthMm: number
  heightMm: number
  /** Anschnitt der ersten Seite laut TrimBox in mm (nur wenn das PDF ihn angibt) */
  trimInset?: { left: number; right: number; top: number; bottom: number }
}

export type PdfOpenResult = { ok: true; info: PdfInfo; docId: number } | { ok: false; error: string }
export type ImposeResult =
  | { ok: true; canceled: boolean; path?: string }
  | { ok: false; error: string }
export type SimpleResult = { ok: true } | { ok: false; error: string }

export interface Api {
  /** Dateipfad einer gezogenen oder ausgewählten Datei */
  pathForFile(file: File): string
  /** PDF öffnen (nur der Pfad wandert, gelesen wird im Hintergrund) */
  pdfOpen(path: string): Promise<PdfOpenResult>
  /** Speicherort erfragen, dann das aktuelle PDF ausschießen und dorthin schreiben */
  imposeSave(settings: ImpositionSettings, suggestedName: string): Promise<ImposeResult>
  listTemplates(): Promise<ImpositionSettings[]>
  saveTemplate(settings: ImpositionSettings): Promise<SimpleResult>
  deleteTemplate(name: string): Promise<SimpleResult>
  /** Vorlage als Datei speichern (Dateidialog) */
  exportTemplate(settings: ImpositionSettings): Promise<ImposeResult>
  /** Vorlagen-Dateien auswählen (Dateidialog) und übernehmen */
  importTemplatesDialog(): Promise<ImportResult>
  /** Eine per Drag-and-Drop gelieferte Vorlagen-Datei übernehmen */
  importTemplateText(text: string, fileName: string): Promise<ImportResult>

  // Vorschaubilder (Hauptfenster): einzelne Seiten des geöffneten PDFs als JPEG anfordern
  thumbsRender(docId: number, index: number, px: number): Promise<Uint8Array | null>

  // Vorschaubilder (unsichtbares Render-Fenster)
  thumbsReady(): void
  onThumbsLoad(cb: (docId: number, bytes: Uint8Array | null) => void): void
  onThumbsRender(cb: (reqId: number, docId: number, index: number, px: number) => void): void
  thumbsDone(reqId: number, bytes: Uint8Array | null): void

  /** Fortschritt von „Druckbogen erstellen“ verfolgen; gibt eine Abmelde-Funktion zurück */
  onImposeProgress(cb: (e: ImposeEvent) => void): () => void
}

export interface ImportResult {
  imported: string[] // Namen der übernommenen Vorlagen
  errors: { file: string; error: string }[]
}