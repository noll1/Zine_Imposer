// src/core/impose.ts
import { PDFDocument, ParseSpeeds, StandardFonts, cmyk, degrees } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
import { appliesTo, lineSegments, schemaToSheetNotes } from './notes'
import type { GridBox, SchemaNote, TextNote } from './notes'
import type { PDFPage } from 'pdf-lib'
import { layouts } from './layouts'
import type { SideLayout } from './layouts/types'
import { buildSequence } from './sequence'
import { pageBleed, usesDuplexSetting } from './settings'
import type { ImpositionSettings } from './settings'
import {
  edgeBleed,
  gridGeometry,
  keptBleed,
  keptBleedOnPage,
  markPlacement,
  neededSize,
  trimEdges,
  turnSide
} from './geometry'
import type { GridGeometry } from './geometry'

const MM = 72 / 25.4 // Millimeter → PDF-Punkte

/** Fortschritt beim Ausschießen: Phase und, beim Verteilen, wie viele Bogenseiten fertig sind. */
export type ImposeProgress =
  | { phase: 'reading' }
  | { phase: 'placing'; done: number; total: number }
  | { phase: 'saving' }

export async function impose(
  sourceBytes: Uint8Array,
  settings: ImpositionSettings,
  onProgress?: (p: ImposeProgress) => void
): Promise<Uint8Array> {
  onProgress?.({ phase: 'reading' })
  const src = await PDFDocument.load(sourceBytes, { parseSpeed: ParseSpeeds.Fastest })
  const out = await PDFDocument.create()
  const srcPages = src.getPages()

  // Annahme: alle Seiten haben das Format der ersten Seite (inkl. Anschnitt)
  const { width: fullW, height: fullH } = srcPages[0].getSize()
  const { top: bt, bottom: bb, inner: bi, outer: bo } = settings.bleed
  const pw = fullW - (bi + bo) * MM // Endformat
  const ph = fullH - (bt + bb) * MM
  if (pw <= 0 || ph <= 0) throw new Error('Der Anschnitt ist größer als die Seite')
  // Anschnitt einer Quellseite in Punkten (links/rechts hängen bei Doppelseiten von der Seite ab)
  const bleedOf = (index: number) => {
    const b = pageBleed(settings, index)
    return { left: b.left * MM, right: b.right * MM, top: b.top * MM, bottom: b.bottom * MM }
  }
  const sheetW = settings.sheet.width * MM
  const sheetH = settings.sheet.height * MM

  // Endformat einer Seite in mm (für die gemeinsame Geometrie)
  const trimW = pw / MM
  const trimH = ph / MM
  const sheetWmm = settings.sheet.width
  const sheetHmm = settings.sheet.height
  /** mm von oben (wie in der Vorschau) → PDF-Punkte von unten */
  const Y = (mm: number) => sheetH - mm * MM

  const drawMarks = (page: PDFPage, side: SideLayout, g: GridGeometry) => {
    const m = markPlacement(side, settings) // in mm
    const left = g.gx
    const right = g.gx + g.width
    const top = g.gy
    const bottom = g.gy + g.height
    const line = (x1: number, y1: number, x2: number, y2: number) =>
      page.drawLine({
        start: { x: x1 * MM, y: Y(y1) },
        end: { x: x2 * MM, y: Y(y2) },
        thickness: 0.25,
        color: cmyk(0, 0, 0, 1)
      })
    // An jeder Kante des Endformats eine Marke – bei einem Abstand zwischen Seiten also zwei
    const edges = trimEdges(g, trimW, trimH)
    for (const x of edges.xs) {
      if (m.top.on) line(x, top - m.top.start, x, top - m.top.start - m.top.length)
      if (m.bottom.on) line(x, bottom + m.bottom.start, x, bottom + m.bottom.start + m.bottom.length)
    }
    for (const y of edges.ys) {
      if (m.left.on) line(left - m.left.start, y, left - m.left.start - m.left.length, y)
      if (m.right.on) line(right + m.right.start, y, right + m.right.start + m.right.length, y)
    }
  }

  // --- Eigene Anweisungen (Texte, Falz- und Schnittlinien) ---------------------------
  const notes = settings.notes ?? []
  let font: PDFFont | null = null
  const black = cmyk(0, 0, 0, 1)

  /** Nur Zeichen behalten, die die eingebaute Schrift kann (Umlaute und ß gehen). */
  const ARROWS: Record<string, string> = { '→': '->', '←': '<-', '↑': '^', '↓': 'v' }
  const printable = (f: PDFFont, text: string) => {
    const ok = new Set(f.getCharacterSet())
    return [...text]
      .map((ch) => ARROWS[ch] ?? (ok.has(ch.codePointAt(0)!) ? ch : '?'))
      .join('')
  }

  const white = cmyk(0, 0, 0, 0)

  const drawText = (page: PDFPage, f: PDFFont, n: TextNote) => {
    const lines = n.text.split('\n').map((line) => printable(f, line))
    const lh = n.size * 1.2
    // Drehung im Uhrzeigersinn (wie in der Vorschau) = negativer Winkel im PDF
    const t = (-n.rotate * Math.PI) / 180
    const cx = n.x * MM
    const cy = sheetH - n.y * MM
    const at = (dx: number, dy: number) => ({
      x: cx + dx * Math.cos(t) - dy * Math.sin(t),
      y: cy + dx * Math.sin(t) + dy * Math.cos(t)
    })
    const bg = n.bg ?? 'none'
    if (bg !== 'none') {
      // Fläche hinter dem Text: weiß unterbricht Linien darunter, schwarz trägt weiße Schrift
      const pad = 0.6 * MM
      const w = Math.max(...lines.map((l) => f.widthOfTextAtSize(l, n.size))) + 2 * pad
      const h = lines.length * lh + pad
      const corner = at(-w / 2, -h / 2)
      page.drawRectangle({
        ...corner,
        width: w,
        height: h,
        color: bg === 'black' ? black : white,
        rotate: degrees(-n.rotate)
      })
    }
    const ink = bg === 'black' ? white : black
    lines.forEach((line, i) => {
      const w = f.widthOfTextAtSize(line, n.size)
      const dx = -w / 2
      const dy = ((lines.length - 1) / 2 - i) * lh - n.size * 0.35
      page.drawText(line, {
        ...at(dx, dy),
        size: n.size,
        font: f,
        color: ink,
        rotate: degrees(-n.rotate)
      })
    })
  }

  const drawNotes = async (
    page: PDFPage,
    side: SideLayout,
    sheet: number,
    which: 'front' | 'back',
    g: GridGeometry,
    schemaNotes: SchemaNote[]
  ) => {
    const fromSettings = notes.filter((n) => appliesTo(n, sheet, which))
    if (!fromSettings.length && !schemaNotes.length) return
    const box: GridBox = {
      sheetW: sheetWmm,
      sheetH: sheetHmm,
      gx: g.gx,
      gy: g.gy,
      cols: side.cols,
      rows: side.rows,
      cellW: trimW,
      cellH: trimH,
      bleed: edgeBleed(side, settings),
      colX: g.colX,
      rowY: g.rowY
    }
    // Erst die Linien, dann die Texte – so kann ein Text mit weißem Hintergrund eine Linie unterbrechen
    const mine = [...schemaToSheetNotes(schemaNotes, box), ...fromSettings].sort(
      (a, b) => Number(a.kind === 'text') - Number(b.kind === 'text')
    )
    for (const n of mine) {
      if (n.kind === 'text') {
        if (!n.text.trim()) continue
        font ??= await out.embedFont(StandardFonts.Helvetica)
        drawText(page, font, n)
        continue
      }
      for (const [x1, y1, x2, y2] of lineSegments(n, box)) {
        page.drawLine({
          start: { x: x1 * MM, y: sheetH - y1 * MM },
          end: { x: x2 * MM, y: sheetH - y2 * MM },
          thickness: 0.4,
          color: black,
          dashArray: n.kind === 'fold' ? [3 * MM, 2 * MM] : undefined
        })
      }
    }
  }

  const drawSide = async (
    unturned: SideLayout,
    flip: boolean,
    sheet: number,
    which: 'front' | 'back',
    schemaNotes: SchemaNote[] = []
  ) => {
    // Wenden über die lange Kante = ganze Bogenseite um 180° drehen
    const side = flip ? turnSide(unturned) : unturned
    // Das Raster bleibt mittig (damit Vorder- und Rückseite passen), daher zählt die größere Seite doppelt
    const need = neededSize(side, trimW, trimH, markPlacement(side, settings))
    const neededW = need.width
    const neededH = need.height
    if (neededW > settings.sheet.width + 0.1 || neededH > settings.sheet.height + 0.1) {
      throw new Error(
        `Passt nicht auf den Bogen: benötigt ${neededW.toFixed(1)} × ${neededH.toFixed(1)} mm, ` +
          `Bogen ist ${settings.sheet.width} × ${settings.sheet.height} mm`
      )
    }

    const page = out.addPage([sheetW, sheetH])
    // Raster mittig auf dem Bogen, mit Abständen zwischen den Seiten (mm, von oben links)
    const g = gridGeometry(side, trimW, trimH, sheetWmm, sheetHmm)

    for (const cell of side.cells) {
      if (cell.page === null) continue
      const c = cell
      const rot = c.rotate === 180

      // Anschnitt: nach außen ganz, zur Nachbarseite höchstens bis zur Mitte des Abstands
      const kept = keptBleedOnPage(c, keptBleed(c, side, settings)) // mm, in Ausrichtung der Seite
      const k = { left: kept.left * MM, right: kept.right * MM, top: kept.top * MM, bottom: kept.bottom * MM }

      const pb = bleedOf(cell.page)
      const left = pb.left - k.left
      const right = fullW - (pb.right - k.right)
      const bottom = pb.bottom - k.bottom
      const top = fullH - (pb.top - k.top)
      // Seiten ganz ohne Inhalt (kommt in manchen PDFs vor) lassen sich nicht einbetten: bleiben leer
      if (!srcPages[cell.page].node.Contents()) continue
      const embedded = await out.embedPage(srcPages[cell.page], { left, bottom, right, top })

      // Endformat der Seite (ohne Anschnitt) landet genau auf der Zelle
      const cx = g.colX[c.col] * MM
      const cy = Y(g.rowY[c.row] + trimH)
      if (!rot) {
        page.drawPage(embedded, { x: cx - k.left, y: cy - k.bottom })
      } else {
        page.drawPage(embedded, { x: cx + pw + k.left, y: cy + ph + k.bottom, rotate: degrees(180) })
      }
    }

    if (settings.cropMarks.enabled) drawMarks(page, side, g)
    await drawNotes(page, side, sheet, which, g, schemaNotes)
  }

  // Bei Bindungsarten mit festem Ausschießschema wird immer an der kurzen Kante gewendet
  const flipBack = usesDuplexSetting(settings.binding) && settings.duplexFlip === 'long-edge'

  const sequence = buildSequence(src.getPageCount(), settings)
  const plans = layouts[settings.binding](sequence, settings)
  const total = plans.reduce((n, p) => n + (p.back ? 2 : 1), 0)
  let done = 0
  onProgress?.({ phase: 'placing', done, total })
  for (const [sheet, plan] of plans.entries()) {
    await drawSide(plan.front, false, sheet, 'front', plan.notes?.front)
    onProgress?.({ phase: 'placing', done: ++done, total })
    if (plan.back) {
      await drawSide(plan.back, flipBack, sheet, 'back', plan.notes?.back)
      onProgress?.({ phase: 'placing', done: ++done, total })
    }
  }

  onProgress?.({ phase: 'saving' })
  return out.save()
}
