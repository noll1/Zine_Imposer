// src/renderer/src/lib/thumbstore.ts
// Gemeinsamer Speicher für Vorschaubilder im Hauptfenster. Gerendert wird im unsichtbaren
// Render-Fenster; hier wird nur angefragt, zwischengespeichert und nach Wichtigkeit sortiert.

export type PreviewQuality = 'fast' | 'normal' | 'sharp' | 'detail'
export const QUALITY_PX: Record<PreviewQuality, number> = {
  fast: 260,
  normal: 420,
  sharp: 800,
  detail: 1600
}

export interface Thumb {
  blob: Blob
  url: string // für <img>
}

const MAX_PARALLEL = 2 // Anfragen gleichzeitig an das Render-Fenster
const MAX_CACHED = 400
const FIRST_BATCH = 4 // so viele Seiten gelten als „Vorschau ist da“

/** Fortschritt beim Öffnen eines PDFs, für den Ladebildschirm */
export type LoadProgress =
  | { phase: 'opening' }
  | { phase: 'rendering'; done: number; total: number }
  | { phase: 'ready' }

export class ThumbStore {
  private docId = 0
  private loadToken = 0
  private px = QUALITY_PX.normal
  private cache = new Map<number, Thumb>()
  private inflight = new Set<number>()
  private failed = new Set<number>()
  private wanted: number[] = []
  private listeners = new Set<(index: number) => void>()
  private busyListeners = new Set<(busy: boolean) => void>()
  private wasBusy = false
  private loadListeners = new Set<(p: LoadProgress) => void>()
  private phase: LoadProgress['phase'] | 'idle' = 'idle'
  private firstDone = 0
  private firstTotal = 0

  /** Neues PDF (vom Hauptprozess geöffnet, hier nur seine Nummer): alles verwerfen und neu anfordern. */
  load(id: number) {
    if (id === this.docId) return
    this.loadToken++
    this.docId = 0
    this.clear()
    if (!id) return
    this.docId = id
    this.firstDone = 0
    this.firstTotal = Math.min(FIRST_BATCH, this.wanted.length)
    this.reportFirstBatch()
    this.pump()
  }

  /** Ladefortschritt (Öffnen, erste Seiten) verfolgen; gibt eine Abmelde-Funktion zurück. */
  onLoadProgress(fn: (p: LoadProgress) => void): () => void {
    this.loadListeners.add(fn)
    return () => this.loadListeners.delete(fn)
  }

  private emitLoad(p: LoadProgress) {
    this.phase = p.phase
    for (const fn of this.loadListeners) fn(p)
  }

  private reportFirstBatch() {
    if (this.firstDone >= this.firstTotal) this.emitLoad({ phase: 'ready' })
    else this.emitLoad({ phase: 'rendering', done: this.firstDone, total: this.firstTotal })
  }

  setQuality(q: PreviewQuality) {
    const px = QUALITY_PX[q]
    if (px === this.px) return
    this.px = px
    this.clear()
    this.pump()
  }

  get(index: number): Thumb | undefined {
    return this.cache.get(index)
  }

  /** Seiten, die die aktive Ansicht braucht – wichtigste zuerst. Ersetzt die vorige Liste. */
  want(indices: number[]) {
    this.wanted = [...new Set(indices.filter((i) => i >= 0))]
    if (this.phase === 'rendering') {
      // Die Ansicht hat sich geändert: Ziel neu setzen, Erledigtes zählt weiter
      this.firstTotal = Math.max(this.firstDone, Math.min(FIRST_BATCH, this.wanted.length))
      this.reportFirstBatch()
    }
    this.pump()
  }

  /** Meldet, wenn ein Bild fertig ist (index) oder alle ungültig wurden (-1). */
  subscribe(fn: (index: number) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onBusy(fn: (busy: boolean) => void): () => void {
    this.busyListeners.add(fn)
    fn(this.wasBusy)
    return () => this.busyListeners.delete(fn)
  }

  dispose() {
    this.loadToken++
    this.clear()
    this.listeners.clear()
    this.busyListeners.clear()
    this.loadListeners.clear()
  }

  private clear() {
    for (const t of this.cache.values()) URL.revokeObjectURL(t.url)
    this.cache.clear()
    this.inflight.clear()
    this.failed.clear()
    for (const fn of this.listeners) fn(-1)
    this.setBusy(false)
  }

  private setBusy(busy: boolean) {
    if (busy === this.wasBusy) return
    this.wasBusy = busy
    for (const fn of this.busyListeners) fn(busy)
  }

  private pump() {
    if (!this.docId) return
    for (const index of this.wanted) {
      if (this.inflight.size >= MAX_PARALLEL) break
      if (this.cache.has(index) || this.inflight.has(index) || this.failed.has(index)) continue
      void this.fetch(index)
    }
    this.setBusy(this.inflight.size > 0)
  }

  private async fetch(index: number) {
    const docId = this.docId
    const px = this.px
    this.inflight.add(index)
    let bytes: Uint8Array | null = null
    try {
      bytes = await window.api.thumbsRender(docId, index, px)
    } catch {
      bytes = null
    }
    // Inzwischen anderes PDF oder andere Qualität? Dann verwerfen.
    if (docId !== this.docId || px !== this.px) return
    this.inflight.delete(index)
    if (this.phase === 'rendering') {
      this.firstDone++
      this.reportFirstBatch()
    }
    if (bytes) {
      const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' })
      this.cache.set(index, { blob, url: URL.createObjectURL(blob) })
      this.evict()
      for (const fn of this.listeners) fn(index)
    } else {
      this.failed.add(index)
    }
    this.pump()
  }

  /** Speicher begrenzen: Bilder verwerfen, die gerade keine Ansicht braucht. */
  private evict() {
    if (this.cache.size <= MAX_CACHED) return
    const keep = new Set(this.wanted)
    for (const [index, t] of this.cache) {
      if (this.cache.size <= MAX_CACHED) break
      if (keep.has(index)) continue
      URL.revokeObjectURL(t.url)
      this.cache.delete(index)
    }
  }
}
