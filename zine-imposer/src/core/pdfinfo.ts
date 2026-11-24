// src/core/pdfinfo.ts
import { PDFDocument, ParseSpeeds } from 'pdf-lib'
import type { PdfInfo } from './api'

const toMm = (pt: number) => Math.round(((pt * 25.4) / 72) * 10) / 10

export async function readPdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
  // Läuft im Hintergrund-Thread: so schnell wie möglich lesen, ohne Pausen
  const doc = await PDFDocument.load(bytes, { parseSpeed: ParseSpeeds.Fastest, updateMetadata: false })
  if (doc.getPageCount() === 0) throw new Error('Das PDF enthält keine Seiten')
  const first = doc.getPage(0)
  const { width, height } = first.getSize()

  // Anschnitt erkennen: InDesign schreibt das Endformat als TrimBox ins PDF
  const media = first.getMediaBox()
  const trim = first.getTrimBox()
  const inset = {
    left: toMm(trim.x - media.x),
    right: toMm(media.x + media.width - (trim.x + trim.width)),
    bottom: toMm(trim.y - media.y),
    top: toMm(media.y + media.height - (trim.y + trim.height))
  }
  const valid = Object.values(inset).every((v) => v >= 0 && v < 50)
  const any = Object.values(inset).some((v) => v > 0)

  return {
    pageCount: doc.getPageCount(),
    widthMm: (width * 25.4) / 72,
    heightMm: (height * 25.4) / 72,
    ...(valid && any ? { trimInset: inset } : {})
  }
}
