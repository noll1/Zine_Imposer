// src/main/pdfworker.ts
// Hintergrund-Thread: liest PDFs, prüft sie und schießt sie aus. So bleiben Hauptprozess und
// Fenster frei, auch wenn eine große Datei mehrere Sekunden braucht.
import { parentPort } from 'node:worker_threads'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { impose } from '../core/impose'
import { readPdfInfo } from '../core/pdfinfo'
import { parseSettings } from '../core/settings'
import type { WorkerReply, WorkerRequest } from './worker-protocol'

const port = parentPort
if (!port) throw new Error('pdfworker muss als Worker-Thread laufen')

// Die zuletzt gelesene Datei bleibt im Speicher, damit „Druckbogen erstellen“ sie nicht neu liest
let cache: { path: string; mtimeMs: number; size: number; bytes: Uint8Array } | null = null

async function load(path: string): Promise<Uint8Array> {
  const s = await stat(path)
  if (cache && cache.path === path && cache.mtimeMs === s.mtimeMs && cache.size === s.size) {
    return cache.bytes
  }
  cache = null
  const bytes = new Uint8Array(await readFile(path))
  cache = { path, mtimeMs: s.mtimeMs, size: s.size, bytes }
  return bytes
}

const reply = (msg: WorkerReply) => port.postMessage(msg)

async function handle(req: WorkerRequest) {
  try {
    if (req.type === 'info') {
      let bytes: Uint8Array
      try {
        bytes = await load(req.path)
      } catch {
        throw new Error('Die Datei konnte nicht geöffnet werden.')
      }
      try {
        reply({ id: req.id, type: 'done', info: await readPdfInfo(bytes) })
      } catch {
        throw new Error('Die Datei konnte nicht als PDF gelesen werden.')
      }
    } else {
      const settings = parseSettings(req.settings)
      const bytes = await load(req.path)
      const result = await impose(bytes, settings, (progress) =>
        reply({ id: req.id, type: 'progress', progress })
      )
      reply({ id: req.id, type: 'progress', progress: { phase: 'writing' } })
      await writeFile(req.target, result)
      reply({ id: req.id, type: 'done' })
    }
  } catch (err) {
    reply({ id: req.id, type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}

// Aufträge nacheinander abarbeiten
let chain: Promise<void> = Promise.resolve()
port.on('message', (req: WorkerRequest) => {
  chain = chain.then(() => handle(req))
})
