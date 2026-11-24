// src/renderer/src/lib/loading.ts
/** Zustand des Ladebildschirms */
export interface LoadingState {
  title: string
  subtitle?: string
  steps: string[] // Schritte in Reihenfolge
  current: number // aktiver Schritt; = steps.length heißt fertig
  fraction?: number | null // echter Fortschritt des aktiven Schritts (0–1), falls bekannt
}
