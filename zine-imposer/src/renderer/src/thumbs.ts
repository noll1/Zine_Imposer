// src/renderer/src/thumbs.ts
// Läuft im unsichtbaren Render-Fenster: rendert PDF-Seiten mit pdf.js zu kleinen JPEG-Bildern.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface Job {
  reqId: number
  docId: number
  index: number
  px: number
}

let docId = 0
let loading: Promise<pdfjs.PDFDocumentProxy | null> = Promise.resolve(null)
const queue: Job[] = []
let running = false

window.api.onThumbsLoad((id, bytes) => {
  docId = id
  // Aufträge für das alte PDF verwerfen
  for (const job of queue.splice(0)) window.api.thumbsDone(job.reqId, null)
  const previous = loading
  loading = bytes
    ? pdfjs
        .getDocument({ data: bytes })
        .promise.catch(() => null)
    : Promise.resolve(null)
  void previous.then((old) => old?.loadingTask.destroy())
})

window.api.onThumbsRender((reqId, id, index, px) => {
  queue.push({ reqId, docId: id, index, px })
  void run()
})

async function run() {
  if (running) return
  running = true
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      let bytes: Uint8Array | null = null
      try {
        if (job.docId === docId) {
          const doc = await loading
          if (doc && job.docId === docId) bytes = await render(doc, job.index, job.px)
        }
      } catch {
        bytes = null
      }
      window.api.thumbsDone(job.reqId, bytes)
    }
  } finally {
    running = false
  }
}

async function render(doc: pdfjs.PDFDocumentProxy, index: number, px: number) {
  if (index < 0 || index >= doc.numPages) return null
  const page = await doc.getPage(index + 1)
  try {
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: px / Math.max(base.width, base.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { alpha: false })!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({
      canvasContext: ctx,
      canvas,
      viewport,
      intent: 'display',
      annotationMode: pdfjs.AnnotationMode.DISABLE
    }).promise
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  } finally {
    page.cleanup() // Bilddaten der Seite wieder freigeben
  }
}

window.api.thumbsReady()
