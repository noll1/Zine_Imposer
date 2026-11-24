<script lang="ts">
  // Druckbogen-Vorschau: so liegen die Seiten auf den Bögen (wie im erzeugten Druck-PDF).
  import { flushSync } from 'svelte'
  import type { PreviewQuality, ThumbStore } from './lib/thumbstore'
  import { visible } from './lib/visible'
  import PageImage from './PageImage.svelte'
  import { layouts } from '../../core/layouts'
  import type { SheetPlan, SideLayout } from '../../core/layouts/types'
  import { pageBleed, usesDuplexSetting } from '../../core/settings'
  import {
    gridGeometry,
    keptBleed,
    keptBleedOnPage,
    markPlacement,
    neededSize,
    trimEdges,
    turnSide
  } from '../../core/geometry'
  import type { ImpositionSettings } from '../../core/settings'
  import type { PageRef } from '../../core/sequence'
  import type { PdfInfo } from '../../core/api'
  import { edgeBleed } from '../../core/geometry'
  import { appliesTo, lineSegments, schemaToSheetNotes } from '../../core/notes'
  import type { GridBox, SchemaNote, SheetNote } from '../../core/notes'

  export let store: ThumbStore
  export let info: PdfInfo
  export let sequence: PageRef[] = []
  export let settings: ImpositionSettings
  export let quality: PreviewQuality = 'normal'
  export let onQuality: (q: PreviewQuality) => void = () => {}

  // --- Zoom ------------------------------------------------------------------
  // 1 = Bogen passt in die Breite. Zoomen mit Knöpfen oder Trackpad (Zusammenziehen bzw.
  // Ctrl + Mausrad), verschieben durch Ziehen mit der Maus.
  const ZOOM_MIN = 0.5
  const ZOOM_MAX = 8
  let zoom = 1
  let scroller: HTMLDivElement
  let viewW = 0 // Breite der ganzen Ansicht – unabhängig davon, ob Scrollbalken zu sehen sind
  $: fitW = Math.max(200, Math.min(620, viewW - 48))
  $: sheetPx = Math.round(fitW * zoom)

  /**
   * Zoomen, ohne dass etwas wegspringt: Der Punkt unter dem Mauszeiger (oder die Mitte) wird
   * auf dem Bogen darunter festgehalten und nach dem Zoomen wieder genau dorthin geschoben.
   */
  function setZoom(next: number, anchor?: { x: number; y: number }) {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    if (Math.abs(z - zoom) < 0.001 || !scroller) return
    const view = scroller.getBoundingClientRect()
    const a = anchor ?? { x: scroller.clientWidth / 2, y: scroller.clientHeight / 2 }
    const sx = view.left + a.x // Bildschirmpunkt, der stehen bleiben soll
    const sy = view.top + a.y

    // Bogen unter (oder am nächsten an) diesem Punkt und die Stelle darauf, in Anteilen
    const sheets = [...scroller.querySelectorAll<HTMLElement>('.sheet')]
    let el: HTMLElement | null = null
    let best = Infinity
    for (const sheet of sheets) {
      const r = sheet.getBoundingClientRect()
      const d = sy < r.top ? r.top - sy : sy > r.bottom ? sy - r.bottom : 0
      if (d < best) {
        best = d
        el = sheet
      }
    }
    const before = el?.getBoundingClientRect()
    const fx = before ? (sx - before.left) / before.width : 0.5
    const fy = before ? (sy - before.top) / before.height : 0.5

    flushSync(() => (zoom = z)) // Größe sofort anwenden, damit sich nichts überschneidet

    if (el && before) {
      const after = el.getBoundingClientRect()
      scroller.scrollLeft += after.left + fx * after.width - sx
      scroller.scrollTop += after.top + fy * after.height - sy
    }
  }

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return // normales Scrollen bleibt Scrollen
    e.preventDefault()
    const rect = scroller.getBoundingClientRect()
    setZoom(zoom * Math.exp(-e.deltaY * 0.01), { x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  // Verschieben durch Ziehen, sobald gezoomt ist
  let drag: { x: number; y: number; left: number; top: number } | null = null
  function onPointerDown(e: PointerEvent) {
    if (zoom <= 1 || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop }
    scroller.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag) return
    scroller.scrollLeft = drag.left - (e.clientX - drag.x)
    scroller.scrollTop = drag.top - (e.clientY - drag.y)
  }
  function onPointerUp() {
    drag = null
  }

  interface ShownSide {
    label: string
    side: SideLayout
    sheet: number
    which: 'front' | 'back'
    schemaNotes: SchemaNote[] // Anweisungen aus dem Schema-Editor
  }

  $: result = plan(sequence, settings)
  function plan(seq: PageRef[], s: ImpositionSettings): { sides: ShownSide[]; error: string } {
    if (!seq.length) return { sides: [], error: '' }
    let plans: SheetPlan[]
    try {
      plans = layouts[s.binding](seq, s)
    } catch (e) {
      return { sides: [], error: e instanceof Error ? e.message : String(e) }
    }
    const flip = usesDuplexSetting(s.binding) && s.duplexFlip === 'long-edge'
    const sides: ShownSide[] = []
    plans.forEach((p, i) => {
      sides.push({
        label: `Bogen ${i + 1} · Vorderseite`,
        side: p.front,
        sheet: i,
        which: 'front',
        schemaNotes: p.notes?.front ?? []
      })
      if (p.back) {
        sides.push({
          label: `Bogen ${i + 1} · Rückseite`,
          side: flip ? turnSide(p.back) : p.back,
          sheet: i,
          which: 'back',
          schemaNotes: p.notes?.back ?? []
        })
      }
    })
    return { sides, error: '' }
  }

  // Maße in mm
  $: W = settings.sheet.width
  $: H = settings.sheet.height
  $: pw = info.widthMm - settings.bleed.inner - settings.bleed.outer
  $: ph = info.heightMm - settings.bleed.top - settings.bleed.bottom

  /** Alles, was eine Bogenseite zum Zeichnen braucht – mit derselben Geometrie wie das Druck-PDF. */
  function geometry(side: SideLayout, s: ImpositionSettings, trimW: number, trimH: number) {
    // Dieselbe Geometrie wie im Druck-PDF: Raster mittig, mit Abständen zwischen den Seiten
    const g = gridGeometry(side, trimW, trimH, W, H)
    const marks = markPlacement(side, s)
    const need = neededSize(side, trimW, trimH, marks)
    const fits = need.width <= W + 0.1 && need.height <= H + 0.1

    // Seiten mit dem Anschnitt, der im Druck-PDF stehen bleibt
    const cells = side.cells.map((c) => {
      const pb = c.page === null ? { left: 0, right: 0, top: 0, bottom: 0 } : pageBleed(s, c.page)
      const e = keptBleed(c, side, s) // Ausrichtung des Bogens
      const ext = keptBleedOnPage(c, e) // Ausrichtung der Seite (für das Bild)
      const x = g.colX[c.col]
      const y = g.rowY[c.row]
      return {
        c,
        pb,
        ext,
        box: { x: x - e.left, y: y - e.top, w: trimW + e.left + e.right, h: trimH + e.top + e.bottom },
        trim: { x, y, w: trimW, h: trimH }
      }
    })

    // Marken als Linien (x1, y1, x2, y2), y von oben gezählt – an jeder Schnittkante
    const lines: number[][] = []
    if (s.cropMarks.enabled) {
      const top = g.gy
      const bottom = g.gy + g.height
      const left = g.gx
      const right = g.gx + g.width
      const edges = trimEdges(g, trimW, trimH)
      const t = marks.top
      const b = marks.bottom
      const l = marks.left
      const r = marks.right
      for (const x of edges.xs) {
        if (t.on) lines.push([x, top - t.start, x, top - t.start - t.length])
        if (b.on) lines.push([x, bottom + b.start, x, bottom + b.start + b.length])
      }
      for (const y of edges.ys) {
        if (l.on) lines.push([left - l.start, y, left - l.start - l.length, y])
        if (r.on) lines.push([right + r.start, y, right + r.start + r.length, y])
      }
    }
    const box: GridBox = {
      sheetW: W,
      sheetH: H,
      gx: g.gx,
      gy: g.gy,
      cols: side.cols,
      rows: side.rows,
      cellW: trimW,
      cellH: trimH,
      bleed: edgeBleed(side, s),
      colX: g.colX,
      rowY: g.rowY
    }
    return { cells, lines, fits, needW: need.width, needH: need.height, box }
  }

  const pct = (v: number, of: number) => `${(v / of) * 100}%`

  /** Anweisungen einer Bogenseite (aus dem Schema und ggf. ältere aus der Vorlage), in mm */
  function notesFor(sd: ShownSide, box: GridBox, s: ImpositionSettings): SheetNote[] {
    const fromSettings = (s.notes ?? []).filter((n) => appliesTo(n, sd.sheet, sd.which))
    return [...schemaToSheetNotes(sd.schemaNotes, box), ...fromSettings]
  }
  $: mmPerPx = W / Math.max(1, sheetPx)
  const fontPx = (pt: number) => (pt * 25.4) / 72 / mmPerPx

  // Nur die sichtbaren Bogenseiten anfordern
  let shown = new Set<number>()
  function setVisible(i: number, isVisible: boolean) {
    if (isVisible) shown.add(i)
    else shown.delete(i)
    shown = shown
  }
  $: requestVisible(shown, result.sides)
  function requestVisible(idx: Set<number>, sides: ShownSide[]) {
    const order = idx.size ? [...idx].sort((a, b) => a - b) : [0, 1]
    const pages: number[] = []
    for (const i of order) {
      for (const c of sides[i]?.side.cells ?? []) if (c.page !== null) pages.push(c.page)
    }
    store.want(pages)
  }
</script>

<div class="sheet-view" bind:clientWidth={viewW}>
<div class="zoombar">
  <button on:click={() => setZoom(zoom / 1.25)} disabled={zoom <= ZOOM_MIN} aria-label="Verkleinern">−</button>
  <button class="pct" on:click={() => setZoom(1)} title="Auf Breite einpassen">{Math.round(zoom * 100)} %</button>
  <button on:click={() => setZoom(zoom * 1.25)} disabled={zoom >= ZOOM_MAX} aria-label="Vergrößern">+</button>
  <button on:click={() => setZoom(1)} disabled={zoom === 1}>Einpassen</button>
  {#if zoom > 1.6 && (quality === 'fast' || quality === 'normal')}
    <span class="zoomhint">
      Für Details schärfer rendern:
      <button class="link" on:click={() => onQuality('sharp')}>Scharf</button>
    </span>
  {:else if zoom > 3 && quality === 'sharp'}
    <span class="zoomhint">
      Noch feiner:
      <button class="link" on:click={() => onQuality('detail')}>Detail</button>
    </span>
  {/if}
  <span class="tip">Zoomen: Trackpad zusammenziehen oder Ctrl + Mausrad</span>
</div>
<div
  class="sheets"
  class:zoomed={zoom > 1}
  class:dragging={!!drag}
  bind:this={scroller}
  on:wheel|nonpassive={onWheel}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerUp}
  role="presentation"
>
<div class="content">
  {#if result.error}
    <p class="error">{result.error}</p>
  {/if}
  {#each result.sides as s, i (i)}
    {@const g = geometry(s.side, settings, pw, ph)}
    {@const sideNotes = notesFor(s, g.box, settings)}
    <section use:visible={(v) => setVisible(i, v)} style="width: {sheetPx}px">
      <h3>
        {s.label}
        <span>{W} × {H} mm</span>
      </h3>
      <div class="sheet" class:overflow={!g.fits} style="aspect-ratio: {W} / {H}">
        {#each g.cells as cell}
          <div
            class="cell"
            style="left:{pct(cell.box.x, W)};top:{pct(cell.box.y, H)};width:{pct(cell.box.w, W)};height:{pct(cell.box.h, H)}"
          >
            <PageImage
              {store}
              page={cell.c.page}
              fullW={info.widthMm}
              fullH={info.heightMm}
              bleed={cell.pb}
              extend={cell.ext}
              rotate={cell.c.rotate}
            />
          </div>
        {/each}
        {#each g.cells as cell}
          <!-- Endformat-Linie und Seitenzahl über dem Bild -->
          <div
            class="trim"
            style="left:{pct(cell.trim.x, W)};top:{pct(cell.trim.y, H)};width:{pct(cell.trim.w, W)};height:{pct(cell.trim.h, H)}"
          >
            <span class="num" class:rot={cell.c.rotate === 180}>
              {cell.c.page === null ? '' : cell.c.page + 1}
            </span>
          </div>
        {/each}
        <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
          {#each g.lines as [x1, y1, x2, y2]}
            <line {x1} {y1} {x2} {y2} />
          {/each}
          {#each sideNotes as n (n.id)}
            {#if n.kind !== 'text'}
              {#each lineSegments(n, g.box) as [x1, y1, x2, y2]}
                <line class="note-line {n.kind}" {x1} {y1} {x2} {y2} />
              {/each}
            {/if}
          {/each}
        </svg>
        {#each sideNotes as n (n.id)}
          {#if n.kind === 'text'}
            <div
              class="note-text bg-{n.bg ?? 'none'}"
              style="left:{pct(n.x, W)};top:{pct(n.y, H)};font-size:{fontPx(n.size)}px;transform:translate(-50%, -50%) rotate({n.rotate}deg)"
            >
              {n.text}
            </div>
          {/if}
        {/each}
      </div>
      {#if !g.fits}
        <p class="error">
          Passt nicht auf den Bogen: benötigt {g.needW.toFixed(1)} × {g.needH.toFixed(1)} mm
        </p>
      {/if}
    </section>
  {/each}
  {#if result.sides.length}
    <p class="note">
      Gestrichelt: Endformat. Der Anschnitt ist dort zu sehen, wo er im Druck-PDF stehen bleibt.
    </p>
  {/if}
</div>
</div>
</div>

<style>
  .sheet-view {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden; /* gezoomter Inhalt scrollt nur innen, die Ansicht bleibt so breit wie sie ist */
    display: flex;
    flex-direction: column;
  }
  .zoombar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  .zoombar button {
    font: inherit;
    min-width: 28px;
    padding: 3px 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: inherit;
    cursor: pointer;
  }
  .zoombar button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .zoombar .pct {
    min-width: 58px;
    font-variant-numeric: tabular-nums;
  }
  .zoombar .link {
    border: 0;
    background: none;
    color: var(--accent);
    padding: 0 2px;
    min-width: 0;
  }
  .zoomhint {
    color: var(--muted);
  }
  .tip {
    margin-left: auto;
    color: var(--muted);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .zoombar {
    min-width: 0;
  }
  .sheets {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    overflow-anchor: none; /* der Browser soll beim Zoomen nicht selbst nachkorrigieren */
    background: color-mix(in srgb, var(--text) 6%, var(--panel));
  }
  .sheets.zoomed {
    cursor: grab;
  }
  .sheets.dragging {
    cursor: grabbing;
    user-select: none;
  }
  /* Breiter als das Fenster darf der Inhalt werden, bleibt aber mittig, solange er schmaler ist */
  .content {
    width: max-content;
    min-width: 100%;
    box-sizing: border-box;
    padding: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
  }
  section {
    flex: none;
  }
  h3 {
    display: flex;
    justify-content: space-between;
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
  }
  h3 span {
    color: var(--muted);
    font-weight: 400;
  }
  .sheet {
    position: relative;
    width: 100%;
    background: #fff;
    box-shadow: 0 1px 4px rgb(0 0 0 / 25%);
    overflow: hidden;
  }
  .sheet.overflow {
    outline: 2px solid var(--danger);
  }
  .cell {
    position: absolute;
  }
  .trim {
    position: absolute;
    outline: 0.5px dashed rgb(0 0 0 / 30%);
    pointer-events: none;
  }
  .num {
    position: absolute;
    right: 3px;
    bottom: 2px;
    padding: 0 4px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    background: rgb(0 0 0 / 55%);
  }
  .num.rot {
    right: auto;
    bottom: auto;
    left: 3px;
    top: 2px;
    transform: rotate(180deg);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  line {
    stroke: #000;
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .note-line {
    stroke: #000;
    stroke-width: 1.2px;
    vector-effect: non-scaling-stroke;
  }
  .note-line.fold {
    stroke-dasharray: 6 4;
  }
  .note-text {
    position: absolute;
    z-index: 2;
    padding: 0 0.15em;
    font-family: Helvetica, Arial, sans-serif;
    line-height: 1.2;
    color: #000;
    white-space: pre;
    text-align: center;
    pointer-events: none;
  }
  .note-text.bg-paper {
    background: #fff;
  }
  .note-text.bg-black {
    background: #000;
    color: #fff;
  }
  .error {
    margin: 6px 0 0;
    color: var(--danger);
  }
  .note {
    margin: 0;
    max-width: 620px;
    color: var(--muted);
    font-size: 12px;
  }
</style>
