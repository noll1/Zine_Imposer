// src/core/impose.test.ts
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { impose } from './impose'
import { defaultSettings, parseSettings, SHEET_PRESETS } from './settings'

const mm = (v: number) => (v * 72) / 25.4

async function makeNumberedPdf(
  pageCount: number,
  opts: { sizeMm?: [number, number]; bleedMm?: number } = {}
): Promise<Uint8Array> {
  const [wMm, hMm] = opts.sizeMm ?? [148, 210] // A5 hochkant (Endformat)
  const bleed = opts.bleedMm ?? 0
  const w = mm(wMm + 2 * bleed)
  const h = mm(hMm + 2 * bleed)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([w, h])
    if (bleed > 0) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: w,
        height: h,
        color: i % 2 === 0 ? rgb(0.85, 0.85, 0.85) : rgb(0.8, 0.9, 1)
      })
      page.drawRectangle({
        x: mm(bleed),
        y: mm(bleed),
        width: mm(wMm),
        height: mm(hMm),
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5
      })
    }
    page.drawText(String(i + 1), {
      x: w * 0.3,
      y: h * 0.4,
      size: Math.min(w, h) * 0.6,
      font
    })
  }
  return doc.save()
}

const save = (name: string, bytes: Uint8Array) => {
  mkdirSync('out', { recursive: true })
  writeFileSync(`out/${name}.pdf`, bytes)
}

describe('impose: Rückstichheftung', () => {
  it('A5 auf A4, ohne Marken', async () => {
    const result = await impose(await makeNumberedPdf(8), defaultSettings)
    expect((await PDFDocument.load(result)).getPageCount()).toBe(4)
    save('a5-auf-a4', result)
  })

  it('A5 auf A3, mit Schnitt- und Falzmarken', async () => {
    const settings = {
      ...defaultSettings,
      sheet: SHEET_PRESETS.A3,
      cropMarks: { ...defaultSettings.cropMarks, enabled: true }
    }
    save('a5-auf-a3-marken', await impose(await makeNumberedPdf(8), settings))
  })

  it('A5 mit 3 mm Beschnitt auf A3', async () => {
    const settings = {
      ...defaultSettings,
      sheet: SHEET_PRESETS.A3,
      bleed: { top: 3, bottom: 3, inner: 3, outer: 3 },
      cropMarks: { ...defaultSettings.cropMarks, enabled: true }
    }
    save('a5-beschnitt-a3', await impose(await makeNumberedPdf(8, { bleedMm: 3 }), settings))
  })

  it('Wenden an der langen Kante dreht die Rückseiten', async () => {
    const settings = { ...defaultSettings, duplexFlip: 'long-edge' as const }
    save('a5-auf-a4-lange-kante', await impose(await makeNumberedPdf(8), settings))
  })

  it('meldet verständlich, wenn Marken nicht auf den Bogen passen', async () => {
    const settings = {
      ...defaultSettings,
      cropMarks: { ...defaultSettings.cropMarks, enabled: true }
    }
    await expect(impose(await makeNumberedPdf(8), settings)).rejects.toThrow(
      'Passt nicht auf den Bogen'
    )
  })
})

describe('impose: Ein-Blatt-Zine', () => {
  const settings = { ...defaultSettings, binding: 'onesheet' as const }
  const a7 = { sizeMm: [74, 105] as [number, number] }

  it('8 Seiten A7 auf einem A4-Blatt', async () => {
    const result = await impose(await makeNumberedPdf(8, a7), settings)
    expect((await PDFDocument.load(result)).getPageCount()).toBe(1)
    save('zine-ein-blatt', result)
  })

  it('8 Seiten A7 auf A3 mit Marken', async () => {
    const withMarks = {
      ...settings,
      sheet: SHEET_PRESETS.A3,
      cropMarks: { ...defaultSettings.cropMarks, enabled: true }
    }
    save('zine-ein-blatt-marken', await impose(await makeNumberedPdf(8, a7), withMarks))
  })

  it('lehnt mehr als 8 Seiten ab', async () => {
    await expect(impose(await makeNumberedPdf(9, a7), settings)).rejects.toThrow('genau 8')
  })
})

describe('parseSettings', () => {
  it('akzeptiert die Standardvorlage nach einem JSON-Durchlauf', () => {
    const roundTrip = JSON.parse(JSON.stringify(defaultSettings))
    expect(parseSettings(roundTrip)).toEqual(defaultSettings)
  })
  
  it('lehnt kaputte Vorlagen ab', () => {
    expect(() => parseSettings({ version: 1, binding: 'saddle' })).toThrow()
  })
})      
describe('Schnittmarken je Seite', () => {
  it('nur oben und unten: passt auf A4, weil links/rechts keine Marken Platz brauchen', async () => {
    const settings = {
      ...defaultSettings,
      binding: 'saddle' as const,
      sheet: { width: 297, height: 240 },
      cropMarks: {
        ...defaultSettings.cropMarks,
        enabled: true,
        sides: {
          ...defaultSettings.cropMarks.sides,
          left: { ...defaultSettings.cropMarks.sides.left, enabled: false },
          right: { ...defaultSettings.cropMarks.sides.right, enabled: false }
        }
      }
    }
    save('marken-nur-oben-unten', await impose(await makeNumberedPdf(8), settings))
  })
})

describe('parseSettings: alte Vorlagen', () => {
  it('übernimmt eine gemeinsame Länge und einen Abstand für alle vier Seiten', () => {
    const old = {
      ...defaultSettings,
      cropMarks: { enabled: true, length: 7, offset: 2 }
    }
    const parsed = parseSettings(JSON.parse(JSON.stringify(old)))
    expect(parsed.cropMarks.sides.left).toEqual({ enabled: true, length: 7, offset: 2 })
    expect(parsed.cropMarks.sides.top).toEqual({ enabled: true, length: 7, offset: 2 })
  })
})

/**
 * Wie ein InDesign-Export mit Doppelseiten und Anschnitt 3–3–0–3 mm:
 * rechte Seiten (1, 3, 5 …) haben den Anschnitt rechts, linke Seiten links; innen keiner.
 * Endformat weiß mit Seitenzahl, Anschnitt rot.
 */
async function makeFacingPdf(pageCount: number, trim: [number, number], bleed = 3) {
  const [tw, th] = trim
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([mm(tw + bleed), mm(th + 2 * bleed)])
    const right = i % 2 === 0
    page.drawRectangle({ x: 0, y: 0, width: mm(tw + bleed), height: mm(th + 2 * bleed), color: rgb(1, 0, 0) })
    const tx = right ? 0 : mm(bleed)
    page.drawRectangle({ x: tx, y: mm(bleed), width: mm(tw), height: mm(th), color: rgb(1, 1, 1) })
    page.drawText(String(i + 1), { x: tx + mm(tw) * 0.3, y: mm(th) * 0.4, size: mm(tw) * 0.5, font })
  }
  return doc.save()
}

describe('Anschnitt je Seite (3–3–0–3, Doppelseiten)', () => {
  const falz = {
    ...defaultSettings,
    binding: 'falz24' as const,
    sheet: SHEET_PRESETS.SRA3,
    bleed: { top: 3, bottom: 3, inner: 0, outer: 3 },
    twoCopies: true
  }

  it('Ausschießer 24: Endformat 106 × 146,5 mm, sechs Bogenseiten', async () => {
    const result = await impose(await makeFacingPdf(24, [106, 146.5]), falz)
    expect((await PDFDocument.load(result)).getPageCount()).toBe(6)
    save('falz24-anschnitt-3-3-0-3', result)
  })

  it('Rückstich A5 mit 3–3–0–3', async () => {
    const settings = {
      ...defaultSettings,
      sheet: SHEET_PRESETS.A3,
      bleed: { top: 3, bottom: 3, inner: 0, outer: 3 }
    }
    save('a5-anschnitt-3-3-0-3', await impose(await makeFacingPdf(8, [148, 210]), settings))
  })
})

describe('Sonderfälle', () => {
  it('Seiten ohne Inhalt werden als Leerseiten behandelt, mit Fortschritt', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 12; i++) doc.addPage([419.53, 595.28])
    const events: string[] = []
    const result = await impose(await doc.save(), defaultSettings, (p) =>
      events.push(p.phase === 'placing' ? `${p.done}/${p.total}` : p.phase)
    )
    expect((await PDFDocument.load(result)).getPageCount()).toBe(6)
    expect(events).toEqual(['reading', '0/6', '1/6', '2/6', '3/6', '4/6', '5/6', '6/6', 'saving'])
  })
})
