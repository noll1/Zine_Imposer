// src/main/pdfclient.ts
// Hauptprozess-Seite des PDF-Hintergrund-Threads.
import type { Worker } from 'node:worker_threads'
import createPdfWorker from './pdfworker?nodeWorker'
import type { PdfInfo } from '../core/api'
import type { WorkerProgress, WorkerReply, WorkerRequest } from './worker-protocol'

interface Pending {
  resolve: (info?: PdfInfo) => void
  reject: (err: Error) => void
  onProgress?: (p: WorkerProgress) => void
}

let worker: Worker | null = null
let counter = 0
const pending = new Map<number, Pending>()

function failAll(err: Error) {
  for (const p of pending.values()) p.reject(err)
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  const w = createPdfWorker({})
  w.on('message', (msg: WorkerReply) => {
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.type === 'progress') p.onProgress?.(msg.progress)
    else {
      pending.delete(msg.id)
      if (msg.type === 'done') p.resolve(msg.info)
      else p.reject(new Error(msg.error))
    }
  })
  w.on('error', (err) => failAll(err instanceof Error ? err : new Error(String(err))))
  w.on('exit', () => {
    failAll(new Error('Die Verarbeitung im Hintergrund wurde unerwartet beendet.'))
    worker = null
  })
  worker = w
  return w
}

type NewRequest = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

function request(req: NewRequest, onProgress?: (p: WorkerProgress) => void) {
  const id = ++counter
  return new Promise<PdfInfo | undefined>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ ...req, id } as WorkerRequest)
  })
}

/** PDF lesen und prüfen (Seitenzahl, Format, Anschnitt laut PDF). */
export async function pdfInfo(path: string): Promise<PdfInfo> {
  const info = await request({ type: 'info', path })
  if (!info) throw new Error('Die Datei konnte nicht als PDF gelesen werden.')
  return info
}

/** Ausschießen und direkt in die Zieldatei schreiben. */
export async function imposeToFile(
  path: string,
  settings: unknown,
  target: string,
  onProgress: (p: WorkerProgress) => void
): Promise<void> {
  await request({ type: 'impose', path, settings, target }, onProgress)
}

export function stopPdfWorker() {
  void worker?.terminate()
  worker = null
}
