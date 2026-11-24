<script lang="ts">
  import {
    backFromFront,
    describeCustom,
    emptyGrid,
    fitGaps,
    pageCoverage,
    parseCustomLayout,
    resizeGrid
  } from '../../core/custom'
  import type { CustomLayout } from '../../core/custom'
  import type { GridBox, SchemaLine, SchemaNote, SchemaText, TextBg, TextZone } from '../../core/notes'
  import { boundaryX, boundaryY, fieldX, fieldY, xToField, yToField } from '../../core/notes'

  /** Schema, mit dem der Editor startet (null = neues, leeres Schema) */
  export let initial: CustomLayout | null = null
  /** Seitenverhältnis Breite/Höhe des Endformats, nur für die Darstellung der Felder */
  export let pageRatio = 0.707
  /** Breite des Endformats in mm – damit Textgrößen im Editor ungefähr stimmen */
  export let pageWidthMm = 105
  export let onApply: (layout: CustomLayout) => void
  export let onCancel: () => void

  type Side = 'front' | 'back'
  interface DraftSheet {
    front: string[][]
    back: string[][] | null
    copies: number
    notes: { front: SchemaNote[]; back: SchemaNote[] }
    gaps: { cols: number[]; rows: number[] } // mm, Endformat zu Endformat, wie auf der Vorderseite
  }
  interface Draft {
    name: string
    pages: number
    sheets: DraftSheet[]
  }

  const MAX = 16
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
  const clampInt = (v: unknown, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.floor(Number(v)) || min))

  let draft: Draft = initial
    ? {
        name: initial.name ?? '',
        pages: initial.pages,
        sheets: clone(initial.sheets).map((s) => ({
          front: s.front,
          back: s.back,
          copies: s.copies ?? 1,
          notes: { front: s.notes?.front ?? [], back: s.notes?.back ?? [] },
          gaps: fitGaps(s.gaps, s.front[0].length, s.front.length)
        }))
      }
    : {
        name: '',
        pages: 8,
        sheets: [
          {
            front: emptyGrid(4, 2),
            back: null,
            copies: 1,
            notes: { front: [], back: [] },
            gaps: fitGaps(undefined, 4, 2)
          }
        ]
      }
  let active = 0

  $: current = draft.sheets[Math.min(active, draft.sheets.length - 1)]
  $: cols = current.front[0].length
  $: rows = current.front.length
  $: sides = (current.back ? ['front', 'back'] : ['front']) as Side[]
  const rowsOf = (s: DraftSheet, side: Side) => (side === 'front' ? s.front : (s.back ?? []))
  $: check = validate(draft)
  $: pages = clampInt(draft.pages, 1, 512)
  $: counts = pageCoverage({ pages, sheets: draft.sheets })

  function toLayout(d: Draft): unknown {
    const name = d.name.trim()
    return {
      ...(name ? { name } : {}),
      pages: Number(d.pages),
      sheets: d.sheets.map((s) => ({
        front: s.front,
        back: s.back,
        copies: Number(s.copies) || 1,
        gaps: s.gaps,
        ...(s.notes.front.length || (s.back && s.notes.back.length)
          ? { notes: { front: s.notes.front, back: s.back ? s.notes.back : [] } }
          : {})
      }))
    }
  }

  function validate(d: Draft): { ok: true; text: string; layout: CustomLayout } | { ok: false; text: string } {
    try {
      const layout = parseCustomLayout(toLayout(d))
      return { ok: true, text: describeCustom(layout), layout }
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : String(e) }
    }
  }

  // --- Felder ----------------------------------------------------------------

  const isRot = (raw: string) => raw.endsWith('^')
  const shown = (raw: string) => (raw === '-' ? '' : raw.replace('^', ''))
  const isEmpty = (raw: string) => raw === '-'
  const isBad = (raw: string) => raw !== '-' && !/^\d+\^?$/.test(raw)
  const outOfRange = (raw: string, max: number) => {
    const n = parseInt(raw, 10)
    return !Number.isNaN(n) && (n < 1 || n > max)
  }

  /** Der gerade bearbeitete Bogen (immer frisch aus draft, damit Änderungen ankommen). */
  const sheetNow = () => draft.sheets[Math.min(active, draft.sheets.length - 1)]

  function grid(side: Side): string[][] {
    const s = sheetNow()
    return side === 'front' ? s.front : (s.back ?? [])
  }

  function setRaw(side: Side, r: number, c: number, raw: string) {
    const g = grid(side)
    g[r][c] = raw
    draft = draft
  }

  function onCellInput(side: Side, r: number, c: number, e: Event) {
    const text = (e.currentTarget as HTMLInputElement).value.trim()
    const wasRot = isRot(grid(side)[r][c])
    if (text === '' || text === '-') return setRaw(side, r, c, '-')
    const m = /^(\d+)\s*(\^)?$/.exec(text)
    if (!m) return setRaw(side, r, c, text) // bleibt sichtbar falsch, bis es korrigiert ist
    setRaw(side, r, c, `${Number(m[1])}${m[2] || wasRot ? '^' : ''}`)
  }

  function toggleCell(side: Side, r: number, c: number) {
    const raw = grid(side)[r][c]
    if (isEmpty(raw) || isBad(raw)) return
    setRaw(side, r, c, isRot(raw) ? raw.slice(0, -1) : `${raw}^`)
  }

  /** Ganze Zeile drehen: sind alle gedreht, werden alle zurückgedreht, sonst alle gedreht. */
  function toggleRow(side: Side, r: number) {
    const row = grid(side)[r]
    const filled = row.filter((raw) => !isEmpty(raw) && !isBad(raw))
    const allRot = filled.length > 0 && filled.every(isRot)
    grid(side)[r] = row.map((raw) =>
      isEmpty(raw) || isBad(raw) ? raw : allRot ? raw.replace('^', '') : raw.endsWith('^') ? raw : `${raw}^`
    )
    draft = draft
  }

  // --- Bögen und Raster --------------------------------------------------------

  function setSize(newCols: unknown, newRows: unknown) {
    const c = clampInt(newCols, 1, MAX)
    const r = clampInt(newRows, 1, MAX)
    const s = sheetNow()
    s.front = resizeGrid(s.front, c, r)
    if (s.back) s.back = resizeGrid(s.back, c, r)
    s.gaps = fitGaps(s.gaps, c, r)
    draft = draft
  }

  function setBack(on: boolean) {
    const s = sheetNow()
    s.back = on ? emptyGrid(cols, rows) : null
    if (!on) s.notes.back = []
    draft = draft
  }

  function computeBack() {
    const s = sheetNow()
    const hasContent = s.back?.some((row) => row.some((raw) => !isEmpty(raw)))
    if (hasContent && !confirm('Die Rückseite dieses Bogens wird überschrieben. Fortfahren?')) return
    s.back = backFromFront(s.front, pages)
    draft = draft
  }

  function addSheet() {
    const back = sheetNow().back ? emptyGrid(cols, rows) : null
    draft.sheets = [
      ...draft.sheets,
      {
        front: emptyGrid(cols, rows),
        back,
        copies: 1,
        notes: { front: [], back: [] },
        gaps: clone(sheetNow().gaps) // gleiche Abstände wie der aktuelle Bogen
      }
    ]
    active = draft.sheets.length - 1
  }

  function duplicateSheet() {
    const copy = clone(sheetNow())
    draft.sheets = [...draft.sheets.slice(0, active + 1), copy, ...draft.sheets.slice(active + 1)]
    active += 1
  }

  function removeSheet() {
    if (draft.sheets.length < 2 || !confirm(`Bogen ${active + 1} löschen?`)) return
    draft.sheets = draft.sheets.filter((_, i) => i !== active)
    active = Math.max(0, active - 1)
  }

  // --- Abstände zwischen den Seiten (Stege) ------------------------------------------

  function setGap(axis: 'cols' | 'rows', i: number, value: string) {
    const s = sheetNow()
    const v = Math.min(200, Math.max(0, Number(value.replace(',', '.')) || 0))
    s.gaps[axis][i] = Math.round(v * 100) / 100
    draft = draft
  }
  function gapsToAll() {
    const g = clone(sheetNow().gaps)
    for (const s of draft.sheets) if (s.front[0].length === cols && s.front.length === rows) s.gaps = clone(g)
    draft = draft
  }
  const fmtMm = (v: number) => String(v).replace('.', ',')

  /**
   * Raster einer Bogenseite in mm (oben links = 0, 0): Seitenformat aus dem PDF, Abstände
   * aus dem Bogen. Die Rückseite ist an der kurzen Kante gewendet, ihre Spalten-Abstände gespiegelt.
   */
  $: cellW = Math.max(1, pageWidthMm)
  $: cellH = cellW / Math.max(0.05, pageRatio)
  function editorBox(s: DraftSheet, side: Side, cw: number, ch: number): GridBox & { totalW: number; totalH: number } {
    const nc = s.front[0].length
    const nr = s.front.length
    const g = fitGaps(s.gaps, nc, nr)
    const colGaps = side === 'back' ? [...g.cols].reverse() : g.cols
    const colX: number[] = []
    for (let k = 0, x = 0; k < nc; k++) {
      colX.push(x)
      x += cw + (colGaps[k] ?? 0)
    }
    const rowY: number[] = []
    for (let k = 0, y = 0; k < nr; k++) {
      rowY.push(y)
      y += ch + (g.rows[k] ?? 0)
    }
    const totalW = colX[nc - 1] + cw
    const totalH = rowY[nr - 1] + ch
    return {
      sheetW: totalW,
      sheetH: totalH,
      gx: 0,
      gy: 0,
      cols: nc,
      rows: nr,
      cellW: cw,
      cellH: ch,
      bleed: { left: 0, right: 0, top: 0, bottom: 0 },
      colX,
      rowY,
      totalW,
      totalH
    }
  }
  $: boxes = {
    front: editorBox(current, 'front', cellW, cellH),
    back: editorBox(current, 'back', cellW, cellH)
  }
  /** CSS-Spuren: Seiten und Abstände im richtigen Verhältnis */
  function tracks(sizes: number[], gaps: number[]): string {
    // minmax(0, …): Inhalte (Eingabefelder) dürfen die Spuren nicht aufdrücken
    const t = (v: number) => `minmax(0, ${Math.max(0, v)}fr)`
    return sizes.flatMap((v, i) => (i < gaps.length ? [t(v), t(gaps[i])] : [t(v)])).join(' ')
  }
  const gapsOf = (b: GridBox, axis: 'cols' | 'rows') =>
    axis === 'cols'
      ? (b.colX ?? []).slice(1).map((x, i) => x - (b.colX![i] + b.cellW))
      : (b.rowY ?? []).slice(1).map((y, i) => y - (b.rowY![i] + b.cellH))

  function apply() {
    if (check.ok) onApply(check.layout)
  }

  // --- Anweisungen: Texte, Falz- und Schnittlinien ----------------------------------
  // Rechtsklick (oder „+ Anweisung“ und Klick) auf eine Bogenseite öffnet ein Menü.
  // Linien rasten auf Rasterlinien ein, Texte auf halbe Felder und die Mitte der Ränder.

  const PAD = 34 // Randzone um das Raster (px) – dort landen Texte für den Bogenrand
  const TURN = 26 // Spalte mit den Zeilen-Drehknöpfen links vom Raster (px)

  const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const notesOf = (s: DraftSheet, side: Side) => (side === 'front' ? s.notes.front : s.notes.back)

  let selected: { side: Side; id: string } | null = null
  $: selNote = selected ? notesOf(current, selected.side).find((n) => n.id === selected?.id) ?? null : null

  function setNotes(side: Side, list: SchemaNote[]) {
    const s = sheetNow()
    if (side === 'front') s.notes.front = list
    else s.notes.back = list
    draft = draft
  }
  function patch(side: Side, id: string, p: Partial<SchemaText> | Partial<SchemaLine>) {
    setNotes(side, notesOf(sheetNow(), side).map((n) => (n.id === id ? ({ ...n, ...p } as SchemaNote) : n)))
  }
  function removeNote(side: Side, id: string) {
    setNotes(side, notesOf(sheetNow(), side).filter((n) => n.id !== id))
    if (selected?.id === id) selected = null
  }

  /** Bildschirmpunkt → Rasterkoordinaten (Felder) der Bogenseite */
  /** Bildschirmpunkt → Feldkoordinaten (Abstände zählen als Rasterlinie) */
  function toGrid(overlay: Element, clientX: number, clientY: number, side: Side) {
    const r = overlay.getBoundingClientRect()
    const b = boxes[side]
    const x = ((clientX - r.left) / r.width) * b.totalW
    const y = ((clientY - r.top) / r.height) * b.totalH
    return { u: xToField(b, x), v: yToField(b, y) }
  }
  function zoneOf(u: number, v: number): TextZone {
    if (v < 0) return 'top'
    if (v > rows) return 'bottom'
    if (u < 0) return 'left'
    if (u > cols) return 'right'
    return 'grid'
  }
  const snapHalf = (x: number, max: number) => {
    const r = Math.round(x * 2) / 2
    return Math.min(max, Math.max(0, Math.abs(r - x) < 0.15 ? r : x))
  }

  // Menü
  let menu: { x: number; y: number; side: Side; u: number; v: number; noteId?: string } | null = null
  let menuOpenedAt = 0
  let placing: Side | null = null

  function openAt(target: Element, side: Side, clientX: number, clientY: number) {
    const overlay = target.closest('.board')?.querySelector('.overlay')
    if (!overlay) return
    const { u, v } = toGrid(overlay, clientX, clientY, side)
    const noteId = target.closest<HTMLElement>('[data-note]')?.dataset.note
    menu = {
      x: Math.min(clientX, window.innerWidth - 240),
      y: Math.min(clientY, window.innerHeight - 190),
      side,
      u,
      v,
      noteId
    }
    menuOpenedAt = performance.now()
    if (noteId) selected = { side, id: noteId }
  }
  function onBoardContext(e: MouseEvent, side: Side) {
    e.preventDefault()
    openAt(e.target as Element, side, e.clientX, e.clientY)
  }
  function onBoardDown(e: PointerEvent, side: Side) {
    if (placing === side && e.button === 0) {
      e.preventDefault()
      openAt(e.target as Element, side, e.clientX, e.clientY)
      placing = null
    }
  }
  function onWindowDown(e: PointerEvent) {
    if (performance.now() - menuOpenedAt < 80) return
    const t = e.target as Element
    if (menu && !t.closest('.menu')) menu = null
    // Klick neben das Bearbeiten-Feld schließt es (Änderungen sind schon übernommen)
    if (selected && !t.closest('.inspector, .ntext, .nline, .menu')) selected = null
  }
  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  /** Nächste Rasterlinie zum Klickpunkt */
  /** Nächste Rasterlinie in einer Richtung (in mm gemessen, Abstände eingerechnet) */
  function nearestBoundary(b: GridBox, axis: 'v' | 'h', mm: number) {
    const n = axis === 'v' ? b.cols : b.rows
    const pos = (k: number) => (axis === 'v' ? boundaryX(b, k) : boundaryY(b, k))
    let best = 0
    for (let k = 0; k <= n; k++) if (Math.abs(mm - pos(k)) < Math.abs(mm - pos(best))) best = k
    return { at: best, distance: Math.abs(mm - pos(best)) }
  }
  function nearestLine(side: Side, u: number, v: number): { axis: 'v' | 'h'; at: number } {
    const b = boxes[side]
    const nv = nearestBoundary(b, 'v', fieldX(b, u))
    const nh = nearestBoundary(b, 'h', fieldY(b, v))
    return nv.distance <= nh.distance ? { axis: 'v', at: nv.at } : { axis: 'h', at: nh.at }
  }
  $: menuLine = menu ? nearestLine(menu.side, menu.u, menu.v) : null
  const lineLabel = (l: { axis: 'v' | 'h'; at: number }) =>
    l.axis === 'v' ? `senkrecht, Linie ${l.at}` : `waagerecht, Linie ${l.at}`

  function addText() {
    if (!menu) return
    const zone = zoneOf(menu.u, menu.v)
    const along = zone === 'left' || zone === 'right' ? menu.v : menu.u
    const note: SchemaText = {
      id: newId(),
      kind: 'text',
      text: 'Anweisung',
      zone,
      u: snapHalf(along, zone === 'left' || zone === 'right' ? rows : cols),
      v: zone === 'grid' ? snapHalf(menu.v, rows) : 0,
      size: 9,
      rotate: zone === 'left' ? 270 : zone === 'right' ? 90 : 0
    }
    setNotes(menu.side, [...notesOf(sheetNow(), menu.side), note])
    selected = { side: menu.side, id: note.id }
    menu = null
  }
  function addLine(kind: 'fold' | 'cut') {
    if (!menu || !menuLine) return
    const note: SchemaLine = {
      id: newId(),
      kind,
      axis: menuLine.axis,
      at: menuLine.at,
      span: kind === 'fold' ? 'margin' : 'grid'
    }
    setNotes(menu.side, [...notesOf(sheetNow(), menu.side), note])
    selected = { side: menu.side, id: note.id }
    menu = null
  }

  // Ziehen (lokal mitlaufen, beim Loslassen übernehmen)
  let moving: { side: Side; id: string; overlay: Element; preview: SchemaNote; moved: boolean } | null = null

  function startMove(e: PointerEvent, side: Side, n: SchemaNote) {
    if (e.button !== 0 || placing) return
    e.stopPropagation()
    const overlay = (e.currentTarget as Element).closest('.overlay')
    if (!overlay) return
    selected = { side, id: n.id }
    menu = null
    moving = { side, id: n.id, overlay, preview: n, moved: false }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  function onMove(e: PointerEvent) {
    if (!moving) return
    const { u, v } = toGrid(moving.overlay, e.clientX, e.clientY, moving.side)
    const n = moving.preview
    let next: SchemaNote
    if (n.kind === 'text') {
      const zone = zoneOf(u, v)
      const sideways = zone === 'left' || zone === 'right'
      next = {
        ...n,
        zone,
        u: snapHalf(sideways ? v : u, sideways ? rows : cols),
        v: zone === 'grid' ? snapHalf(v, rows) : 0
      }
    } else {
      const b = boxes[moving.side]
      const at = nearestBoundary(b, n.axis, n.axis === 'v' ? fieldX(b, u) : fieldY(b, v)).at
      next = { ...n, at }
    }
    moving = { ...moving, preview: next, moved: true }
  }
  function endMove() {
    if (!moving) return
    const m = moving
    moving = null
    if (m.moved) patch(m.side, m.id, m.preview)
  }
  const live = (side: Side, n: SchemaNote) =>
    moving && moving.side === side && moving.id === n.id ? moving.preview : n

  // Darstellung im Editor: Positionen in % der Rasterfläche, Ränder in px
  let overlayW = 0
  $: pxPerMm = overlayW / Math.max(1, boxes.front.totalW)
  const fontPx = (pt: number) => Math.max(7, ((pt * 25.4) / 72) * pxPerMm)
  const pctX = (b: { totalW: number }, mm: number) => `${(mm / b.totalW) * 100}%`
  const pctY = (b: { totalH: number }, mm: number) => `${(mm / b.totalH) * 100}%`

  function textStyle(n: SchemaText, side: Side): string {
    const b = boxes[side]
    let left = pctX(b, fieldX(b, n.u))
    let top = pctY(b, fieldY(b, n.v))
    if (n.zone === 'top') top = `${-PAD / 2}px`
    if (n.zone === 'bottom') top = `calc(100% + ${PAD / 2}px)`
    if (n.zone === 'left') {
      left = `${-(TURN + PAD / 2)}px`
      top = pctY(b, fieldY(b, n.u))
    }
    if (n.zone === 'right') {
      left = `calc(100% + ${PAD / 2}px)`
      top = pctY(b, fieldY(b, n.u))
    }
    return `left:${left};top:${top};font-size:${fontPx(n.size)}px;transform:translate(-50%,-50%) rotate(${n.rotate}deg)`
  }

  /** Linie als Liste von Rechtecken (Stil-Strings) über der Rasterfläche */
  function lineStyles(n: SchemaLine, side: Side): string[] {
    const bx = boxes[side]
    if (n.axis === 'v') {
      const x = `left:${pctX(bx, boundaryX(bx, n.at))}`
      if (n.span === 'sheet') return [`${x};top:${-PAD}px;bottom:${-PAD}px`]
      if (n.span === 'grid') {
        const a = n.from ?? 0
        const b = n.to ?? bx.rows
        const y1 = a === 0 ? 0 : bx.rowY![a]
        const y2 = b >= bx.rows ? bx.totalH : bx.rowY![b - 1] + bx.cellH
        return [`${x};top:${pctY(bx, y1)};height:${pctY(bx, y2 - y1)}`]
      }
      return [`${x};top:${-PAD + 4}px;height:${PAD - 8}px`, `${x};top:calc(100% + 4px);height:${PAD - 8}px`]
    }
    const y = `top:${pctY(bx, boundaryY(bx, n.at))}`
    if (n.span === 'sheet') return [`${y};left:${-(PAD + TURN)}px;right:${-PAD}px`]
    if (n.span === 'grid') {
      const a = n.from ?? 0
      const b = n.to ?? bx.cols
      const x1 = a === 0 ? 0 : bx.colX![a]
      const x2 = b >= bx.cols ? bx.totalW : bx.colX![b - 1] + bx.cellW
      return [`${y};left:${pctX(bx, x1)};width:${pctX(bx, x2 - x1)}`]
    }
    return [
      `${y};left:${-(PAD + TURN) + 4}px;width:${PAD - 8}px`,
      `${y};left:calc(100% + 4px);width:${PAD - 8}px`
    ]
  }

  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    if (e.key === 'Escape') {
      if (menu || placing || selected) {
        menu = null
        placing = null
        selected = null
        return
      }
      onCancel()
    }
    if (!typing && selected && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault()
      removeNote(selected.side, selected.id)
    }
  }
</script>

<svelte:window
  on:keydown={onKey}
  on:pointerdown={onWindowDown}
  on:pointermove={onMove}
  on:pointerup={endMove}
  on:pointercancel={endMove}
/>

<div class="backdrop">
  <div class="editor" role="dialog" aria-modal="true" aria-label="Schema-Editor">
    <header>
      <h1>Schema-Editor</h1>
      <label class="field grow">
        <span>Name des Schemas</span>
        <input type="text" bind:value={draft.name} placeholder="z. B. Kurs-Zine 16 Seiten" />
      </label>
      <label class="field small">
        <span>Seiten im Heft</span>
        <input type="number" min="1" max="512" step="1" bind:value={draft.pages} />
      </label>
    </header>

    <nav class="sheets">
      {#each draft.sheets as s, i}
        <button class:active={i === active} on:click={() => (active = i)}>
          Bogen {i + 1}{s.copies > 1 ? ` ×${s.copies}` : ''}
        </button>
      {/each}
      <button class="ghost" on:click={addSheet}>+ Bogen</button>
      <span class="spacer"></span>
      <button class="ghost" on:click={duplicateSheet}>Duplizieren</button>
      <button class="ghost danger" on:click={removeSheet} disabled={draft.sheets.length < 2}>
        Löschen
      </button>
    </nav>

    <div class="sheet-settings">
      <label class="field small">
        <span>Spalten</span>
        <input type="number" min="1" max={MAX} value={cols} on:change={(e) => setSize(e.currentTarget.value, rows)} />
      </label>
      <label class="field small">
        <span>Zeilen</span>
        <input type="number" min="1" max={MAX} value={rows} on:change={(e) => setSize(cols, e.currentTarget.value)} />
      </label>
      <label class="field small">
        <span>Kopien</span>
        <input
          type="number"
          min="1"
          max="20"
          value={current.copies}
          on:change={(e) => {
            sheetNow().copies = clampInt(e.currentTarget.value, 1, 20)
            draft = draft
          }}
        />
      </label>
      <label class="check">
        <input type="checkbox" checked={!!current.back} on:change={(e) => setBack(e.currentTarget.checked)} />
        Rückseite bedrucken
      </label>
    </div>

    <div class="gaps-settings">
      <span class="gl">Abstände zwischen den Seiten (mm, Endformat zu Endformat)</span>
      {#if cols > 1}
        <span class="gg">
          Spalten
          {#each current.gaps.cols as g, i}
            <label title="Zwischen Spalte {i + 1} und {i + 2} (Vorderseite)">
              <small>{i + 1}|{i + 2}</small>
              <input type="text" inputmode="decimal" value={fmtMm(g)} on:change={(e) => setGap('cols', i, e.currentTarget.value)} />
            </label>
          {/each}
        </span>
      {/if}
      {#if rows > 1}
        <span class="gg">
          Zeilen
          {#each current.gaps.rows as g, i}
            <label title="Zwischen Zeile {i + 1} und {i + 2}">
              <small>{i + 1}|{i + 2}</small>
              <input type="text" inputmode="decimal" value={fmtMm(g)} on:change={(e) => setGap('rows', i, e.currentTarget.value)} />
            </label>
          {/each}
        </span>
      {/if}
      {#if draft.sheets.length > 1}
        <button class="ghost" on:click={gapsToAll}>Für alle Bögen übernehmen</button>
      {/if}
      <span class="hint">Anschnitt ragt in den Abstand, höchstens bis zur Mitte. Die Rückseite spiegelt die Spalten.</span>
    </div>

    <div class="sides">
      {#each sides as side}
        {@const bx = boxes[side]}
        <section class="side">
          <div class="side-head">
            <h2>{side === 'front' ? 'Vorderseite' : 'Rückseite'}</h2>
            <span class="head-actions">
              <button
                class="ghost"
                class:active={placing === side}
                on:click={() => (placing = placing === side ? null : side)}
                title="Danach auf die Bogenseite klicken – oder direkt mit Rechtsklick"
              >
                {placing === side ? 'Auf die Stelle klicken …' : '+ Anweisung'}
              </button>
              {#if side === 'back'}
                <button class="ghost" on:click={computeBack}>Aus Vorderseite berechnen</button>
              {/if}
            </span>
          </div>
          <div
            class="board"
            class:placing={placing === side}
            style="--pad: {PAD}px; --turn: {TURN}px"
            role="presentation"
            on:contextmenu={(e) => onBoardContext(e, side)}
            on:pointerdown={(e) => onBoardDown(e, side)}
          >
            <div class="gridwrap">
              <div
                class="grid"
                style="grid-template-columns: {tracks(Array(bx.cols).fill(bx.cellW), gapsOf(bx, 'cols'))};
                  grid-template-rows: {tracks(Array(bx.rows).fill(bx.cellH), gapsOf(bx, 'rows'))};
                  aspect-ratio: {bx.totalW} / {bx.totalH}"
              >
                {#each gapsOf(bx, 'cols') as gap, i}
                  {#if gap > 0}
                    <div class="gap v" style="grid-column: {2 * i + 2}; grid-row: 1 / -1" title="{fmtMm(gap)} mm">
                      <span>{fmtMm(gap)}</span>
                    </div>
                  {/if}
                {/each}
                {#each gapsOf(bx, 'rows') as gap, i}
                  {#if gap > 0}
                    <div class="gap h" style="grid-row: {2 * i + 2}; grid-column: 1 / -1" title="{fmtMm(gap)} mm">
                      <span>{fmtMm(gap)}</span>
                    </div>
                  {/if}
                {/each}
                {#each rowsOf(current, side) as row, r}
                  {#each row as raw, c}
                    <div
                      class="cell"
                      style="grid-column: {2 * c + 1}; grid-row: {2 * r + 1}"
                      class:rot={isRot(raw)}
                      class:empty={isEmpty(raw)}
                      class:bad={isBad(raw) || outOfRange(raw, pages)}
                    >
                      <input
                        value={shown(raw)}
                        inputmode="numeric"
                        aria-label="{side === 'front' ? 'Vorderseite' : 'Rückseite'} Zeile {r + 1} Feld {c + 1}"
                        placeholder="–"
                        on:input={(e) => onCellInput(side, r, c, e)}
                      />
                      <button
                        class="turn"
                        title="Auf den Kopf stellen"
                        disabled={isEmpty(raw) || isBad(raw)}
                        on:click={() => toggleCell(side, r, c)}>↻</button
                      >
                    </div>
                  {/each}
                {/each}
              </div>
              {#each rowsOf(current, side) as _row, r}
                <button
                  class="row-turn"
                  style="top: {pctY(bx, bx.rowY?.[r] ?? 0)}; height: {pctY(bx, bx.cellH)}"
                  title="Ganze Zeile auf den Kopf stellen"
                  on:click={() => toggleRow(side, r)}>↻</button
                >
              {/each}
              <!-- Anweisungen über dem Raster -->
              <div class="overlay" bind:clientWidth={overlayW}>
                {#each notesOf(current, side) as raw (raw.id)}
                  {@const n = live(side, raw)}
                  {#if n.kind === 'text'}
                    <div
                      class="ntext bg-{n.bg ?? 'none'}"
                      class:selected={selected?.id === n.id}
                      style={textStyle(n, side)}
                      data-note={n.id}
                      role="button"
                      tabindex="0"
                      on:pointerdown={(e) => startMove(e, side, raw)}
                      on:keydown={(e) => e.key === 'Enter' && (selected = { side, id: n.id })}
                    >
                      {n.text || ' '}
                    </div>
                  {:else}
                    {#each lineStyles(n, side) as st}
                      <div
                        class="nline {n.kind} {n.axis}"
                        class:selected={selected?.id === n.id}
                        style={st}
                        data-note={n.id}
                        role="presentation"
                        on:pointerdown={(e) => startMove(e, side, raw)}
                      ></div>
                    {/each}
                  {/if}
                {/each}
              </div>
            </div>
          </div>
          {#if side === 'back'}
            <p class="hint">So, wie die Rückseite im Druck-PDF steht (Wenden an der kurzen Kante).</p>
          {/if}
        </section>
      {/each}
    </div>

    <section class="coverage">
      <h2>Seiten im Schema</h2>
      <div class="chips">
        {#each counts.slice(1) as n, i}
          <span class="chip" class:missing={n === 0} class:multi={n > 1} title="{n}× auf den Bögen">
            {i + 1}{n > 1 ? ` ×${n}` : ''}
          </span>
        {/each}
      </div>
    </section>

    {#if selNote && selected}
      {@const n = selNote}
      {@const sd = selected.side}
      <aside class="inspector" aria-label="Anweisung bearbeiten">
        <header>
          <strong>{n.kind === 'text' ? 'Text' : n.kind === 'fold' ? 'Falzlinie' : 'Schnittlinie'}</strong>
          <span class="where">{sd === 'front' ? 'Vorderseite' : 'Rückseite'}</span>
          <button class="close" on:click={() => (selected = null)} aria-label="Schließen">×</button>
        </header>
        {#if n.kind === 'text'}
          <label>
            <span>Text</span>
            <textarea rows="3" value={n.text} on:input={(e) => patch(sd, n.id, { text: e.currentTarget.value })}></textarea>
          </label>
          <div class="two">
            <label>
              <span>Größe (pt)</span>
              <input
                type="number"
                min="3"
                max="72"
                step="0.5"
                value={n.size}
                on:change={(e) => patch(sd, n.id, { size: Math.min(72, Math.max(3, Number(e.currentTarget.value) || 9)) })}
              />
            </label>
            <label>
              <span>Drehung</span>
              <select value={n.rotate} on:change={(e) => patch(sd, n.id, { rotate: Number(e.currentTarget.value) as 0 | 90 | 180 | 270 })}>
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </label>
          </div>
          <label>
            <span>Hintergrund</span>
            <select value={n.bg ?? 'none'} on:change={(e) => patch(sd, n.id, { bg: e.currentTarget.value as TextBg })}>
              <option value="none">Keiner</option>
              <option value="paper">Weiß (unterbricht Linien)</option>
              <option value="black">Schwarz, Schrift weiß</option>
            </select>
          </label>
          <p class="hint">
            {n.zone === 'grid' ? 'Liegt auf den Seiten.' : 'Liegt im Bogenrand – im Druck mittig im freien Rand.'}
            Zum Verschieben ziehen.
          </p>
        {:else}
          <label>
            <span>Art</span>
            <select value={n.kind} on:change={(e) => patch(sd, n.id, { kind: e.currentTarget.value as 'fold' | 'cut' })}>
              <option value="fold">Falzlinie (gestrichelt)</option>
              <option value="cut">Schnittlinie (durchgezogen)</option>
            </select>
          </label>
          <label>
            <span>Länge</span>
            <select
              value={n.span}
              on:change={(e) => patch(sd, n.id, { span: e.currentTarget.value as SchemaLine['span'], from: undefined, to: undefined })}
            >
              <option value="margin">Nur im Rand</option>
              <option value="grid">Über die Seiten</option>
              <option value="sheet">Über den ganzen Bogen</option>
            </select>
          </label>
          {#if n.span === 'grid'}
            {@const max = n.axis === 'v' ? rows : cols}
            <div class="two">
              <label>
                <span>{n.axis === 'v' ? 'Von Zeile' : 'Von Spalte'}</span>
                <input
                  type="number"
                  min="1"
                  {max}
                  value={(n.from ?? 0) + 1}
                  on:change={(e) =>
                    patch(sd, n.id, { from: Math.min(max - 1, Math.max(0, Number(e.currentTarget.value) - 1)), to: n.to ?? max })}
                />
              </label>
              <label>
                <span>{n.axis === 'v' ? 'Bis Zeile' : 'Bis Spalte'}</span>
                <input
                  type="number"
                  min="1"
                  {max}
                  value={n.to ?? max}
                  on:change={(e) => patch(sd, n.id, { to: Math.min(max, Math.max(1, Number(e.currentTarget.value))), from: n.from ?? 0 })}
                />
              </label>
            </div>
          {/if}
          <p class="hint">Zum Verschieben ziehen – rastet auf den Rasterlinien ein.</p>
        {/if}
        <p class="saved">Änderungen werden sofort übernommen.</p>
        <div class="actions">
          <button class="delete" on:click={() => removeNote(sd, n.id)}>Löschen</button>
          <button class="done" on:click={() => (selected = null)}>✓ Fertig</button>
        </div>
      </aside>
    {/if}

    <footer>
      <p class="status" class:ok={check.ok}>{check.ok ? `Gültig: ${check.text}` : check.text}</p>
      <button on:click={onCancel}>Abbrechen</button>
      <button class="primary" disabled={!check.ok} on:click={apply}>Übernehmen</button>
    </footer>
  </div>
</div>

{#if menu}
  {@const m = menu}
  <div
    class="menu"
    use:portal
    style="left:{m.x}px;top:{m.y}px"
    role="menu"
    tabindex="-1"
  >
    {#if m.noteId}
      <button role="menuitem" class="danger" on:click={() => { if (m.noteId) removeNote(m.side, m.noteId); menu = null }}>
        Anweisung löschen
      </button>
      <hr />
    {/if}
    <button role="menuitem" on:click={addText}>
      Text hier einfügen
      <span>{zoneOf(m.u, m.v) === 'grid' ? 'auf den Seiten' : 'im Bogenrand'}</span>
    </button>
    {#if menuLine}
      <button role="menuitem" on:click={() => addLine('fold')}>
        Falzlinie einrasten <span>{lineLabel(menuLine)}</span>
      </button>
      <button role="menuitem" on:click={() => addLine('cut')}>
        Schnittlinie einrasten <span>{lineLabel(menuLine)}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: color-mix(in srgb, #000 35%, transparent);
    display: flex;
    padding: 20px;
  }
  .editor {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    padding: 18px;
    border-radius: 14px;
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 12px 40px rgb(0 0 0 / 25%);
  }
  header,
  .sheet-settings {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  h1 {
    margin: 0 12px 6px 0;
    font-size: 17px;
  }
  h2 {
    margin: 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field span {
    color: var(--muted);
    font-size: 12px;
  }
  .grow {
    flex: 1;
    min-width: 200px;
  }
  .small input {
    width: 90px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-bottom: 8px;
  }
  input[type='text'],
  input[type='number'] {
    padding: 7px 9px;
    font: inherit;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .sheets {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
    border-bottom: 1px solid var(--line);
    padding-bottom: 10px;
  }
  .spacer {
    flex: 1;
  }
  button {
    font: inherit;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  button.ghost {
    background: transparent;
  }
  button.danger {
    color: var(--danger);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .sides {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    gap: 24px;
    align-items: flex-start;
  }
  .side {
    flex: 1;
    min-width: 260px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .side-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 32px;
  }
  .side-head .head-actions {
    display: flex;
    gap: 6px;
  }
  .board {
    position: relative;
    padding: var(--pad) var(--pad) var(--pad) calc(var(--pad) + var(--turn));
    border-radius: 8px;
    /* Randzone: hier landen Texte für den Bogenrand */
    background: repeating-linear-gradient(
      45deg,
      transparent 0 8px,
      color-mix(in srgb, var(--text) 4%, transparent) 8px 9px
    );
    border: 1px dashed var(--line);
  }
  .board.placing,
  .board.placing * {
    cursor: crosshair !important;
  }
  .gridwrap {
    position: relative;
  }
  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .ntext {
    position: absolute;
    z-index: 3;
    padding: 1px 3px;
    font-family: Helvetica, Arial, sans-serif;
    line-height: 1.2;
    white-space: pre;
    text-align: center;
    color: var(--text);
    background: color-mix(in srgb, var(--panel) 80%, transparent);
    border-radius: 3px;
    cursor: move;
    pointer-events: auto;
    user-select: none;
  }
  .ntext.bg-paper {
    background: #fff;
    color: #000;
    box-shadow: 0 0 0 1px var(--line);
  }
  .ntext.bg-black {
    background: #000;
    color: #fff;
  }
  .ntext.selected {
    outline: 1.5px solid var(--accent);
  }
  .nline {
    position: absolute;
    z-index: 2;
    pointer-events: auto;
  }
  /* sichtbare Linie + breiter Greifbereich */
  .nline.v {
    width: 10px;
    margin-left: -5px;
    cursor: ew-resize;
    background: linear-gradient(90deg, transparent 4px, currentColor 4px 6px, transparent 6px);
  }
  .nline.h {
    height: 10px;
    margin-top: -5px;
    cursor: ns-resize;
    background: linear-gradient(180deg, transparent 4px, currentColor 4px 6px, transparent 6px);
  }
  .nline.cut {
    color: var(--danger);
  }
  .nline.fold {
    color: var(--accent);
  }
  .nline.fold.v {
    background: repeating-linear-gradient(180deg, currentColor 0 6px, transparent 6px 10px);
    background-size: 2px 100%;
    background-repeat: no-repeat;
    background-position: center;
  }
  .nline.fold.h {
    background: repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 10px);
    background-size: 100% 2px;
    background-repeat: no-repeat;
    background-position: center;
  }
  .nline.selected {
    filter: drop-shadow(0 0 2px var(--accent));
  }
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 220px;
    padding: 4px;
    border-radius: 9px;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
    display: flex;
    flex-direction: column;
  }
  .menu button {
    font: inherit;
    font-size: 12px;
    text-align: left;
    padding: 6px 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
  }
  .menu button span {
    color: var(--muted);
    font-size: 11px;
  }
  .menu button:hover {
    background: var(--accent);
    color: #fff;
  }
  .menu button:hover span {
    color: rgb(255 255 255 / 80%);
  }
  .menu .danger {
    color: var(--danger);
  }
  .menu hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 6px;
  }
  .inspector {
    position: absolute;
    z-index: 6;
    right: 30px;
    bottom: 80px;
    width: 240px;
    padding: 12px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }
  .inspector header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .inspector .where {
    flex: 1;
    color: var(--muted);
  }
  .inspector label {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .inspector label span {
    color: var(--muted);
  }
  .inspector .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .inspector input,
  .inspector select,
  .inspector textarea {
    font: inherit;
    padding: 5px 7px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .inspector textarea {
    resize: vertical;
  }
  .inspector .close {
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 16px;
    padding: 0 4px;
  }
  .inspector .actions {
    display: flex;
    gap: 8px;
  }
  .inspector .actions button {
    flex: 1;
  }
  .inspector .delete {
    color: var(--danger);
  }
  .inspector .done {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .inspector .saved {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .inspector .hint {
    margin: 0;
  }
  /* Spuren werden im richtigen Verhältnis gesetzt (Seiten und Abstände, siehe tracks()) */
  .grid {
    display: grid;
    width: 100%;
    min-width: 180px;
    gap: 0;
    outline: 1px solid var(--line);
    background: var(--bg);
  }
  .gap {
    position: relative;
    background: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--accent) 22%, transparent) 0 3px,
      transparent 3px 6px
    );
  }
  .gap span {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    font-size: 10px;
    color: var(--accent);
    background: var(--panel);
    padding: 0 3px;
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none;
  }
  .gap.v span {
    top: 8px;
    transform: translate(-50%, 0);
  }
  .row-turn {
    position: absolute;
    left: calc(-1 * var(--turn));
    width: calc(var(--turn) - 4px);
    border: 0;
    border-radius: 4px;
    padding: 0;
    background: color-mix(in srgb, var(--text) 5%, var(--bg));
    color: var(--muted);
  }
  .gaps-settings {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    font-size: 12px;
  }
  .gaps-settings .gl {
    color: var(--muted);
    flex-basis: 100%;
  }
  .gaps-settings .gg {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .gaps-settings label {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .gaps-settings small {
    color: var(--muted);
  }
  .gaps-settings input {
    width: 52px;
    padding: 4px 6px;
    font: inherit;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .gaps-settings .hint {
    flex-basis: 100%;
    margin: 0;
  }
  .cell {
    position: relative;
    min-height: 0;
    border-right: 1px dashed var(--line);
    border-bottom: 1px dashed var(--line);
    background: var(--panel);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cell.empty {
    background: transparent;
  }
  .cell.bad {
    outline: 2px solid var(--danger);
    outline-offset: -2px;
  }
  .cell input {
    width: 100%;
    border: 0;
    background: transparent;
    text-align: center;
    font: 600 clamp(14px, 2.4vw, 26px) / 1 -apple-system, BlinkMacSystemFont, sans-serif;
    color: inherit;
    padding: 0;
  }
  .cell input:focus {
    outline: none;
  }
  .cell:focus-within {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .cell.rot input {
    transform: rotate(180deg);
    color: var(--accent);
  }
  .turn {
    position: absolute;
    right: 3px;
    bottom: 3px;
    padding: 0 4px;
    font-size: 11px;
    line-height: 16px;
    border-radius: 4px;
    opacity: 0.6;
  }
  .cell:hover .turn {
    opacity: 1;
  }

  .coverage {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 64px;
    overflow: auto;
  }
  .chip {
    font-size: 12px;
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-variant-numeric: tabular-nums;
  }
  .chip.missing {
    border-color: var(--danger);
    color: var(--danger);
  }
  .chip.multi {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }

  footer {
    display: flex;
    gap: 10px;
    align-items: center;
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .status {
    flex: 1;
    margin: 0;
    color: var(--danger);
  }
  .status.ok {
    color: var(--ok);
  }
</style>
