<script lang="ts">
  import { onMount } from 'svelte'
  import {
    BINDINGS,
    BUILTIN_TEMPLATES,
    MARK_SIDES,
    SHEET_PRESETS,
    defaultSettings,
    usesDuplexSetting
  } from '../../core/settings'
  import type { Binding, ImpositionSettings, MarkSide } from '../../core/settings'
  import { buildSequence, missingPages } from '../../core/sequence'
  import type { PageRef } from '../../core/sequence'
  import type { PdfInfo } from '../../core/api'
  import PreviewPanel from './PreviewPanel.svelte'
  import ProgressInline from './ProgressInline.svelte'
  import type { LoadingState } from './lib/loading'
  import type { LoadProgress } from './lib/thumbstore'
  import SchemaEditor from './SchemaEditor.svelte'
  import { describeCustom, falz24Layout } from '../../core/custom'
  import type { CustomLayout } from '../../core/custom'
  import type { ImportResult } from '../../core/api'

  const BINDING_LABELS: Record<Binding, string> = {
    saddle: 'Rückstichheftung (Klammer)',
    signatures: 'Lagenbindung (Fadenheftung, Klebebindung)',
    onesheet: 'Ein-Blatt-Zine (8 Seiten)',
    cutstack: 'Klebebindung aus Einzelblättern (schneiden & stapeln)',
    leporello: 'Leporello (Zickzackfalz)',
    falz24: 'Ausschießer 24 Seiten (Falzbogen 16 + 8)',
    custom: 'Eigenes Schema (aus der Vorlage)'
  }
  const BINDING_HINTS: Record<Binding, string> = {
    saddle:
      'Gefaltete Bögen werden ineinandergesteckt und in der Mitte geheftet. Seitenzahl: Vielfaches von 4.',
    signatures:
      'Mehrere kleine Lagen, die hintereinander gebunden werden (Fadenheftung, Klebebindung, Buchbinden). Jede Lage ist ein kleines Rückstichheft.',
    onesheet:
      'Ein einzelnes Blatt wird gefaltet und in der Mitte eingeschnitten: genau 8 Seiten, ohne Heftung.',
    cutstack:
      'Zwei Seiten pro Bogen, beidseitig bedruckt. Die Bögen in der Mitte schneiden und die beiden Stapel hintereinanderlegen (erst links, dann rechts), danach leimen oder binden. Kein Falzen.',
    leporello:
      'Ein langer Streifen, zickzack gefaltet. Vorderseite: erste Hälfte der Seiten, Rückseite: zweite Hälfte. Der Bogen muss alle Seiten nebeneinander fassen, ggf. ein eigenes Format wählen.',
    falz24:
      'Nach der Ausschießer-Anleitung: Außenbogen mit den Seiten 1–8 und 17–24, Innenbogen mit den Seiten 9–16. Genau 24 Seiten, der Umschlag wird separat gemacht. Beim Drucken beidseitig und „Bindung an kurzer Kante“ einstellen.',
    custom:
      'Das Ausschießschema kommt aus der Vorlage: welche Seite in welchem Feld liegt und ob sie auf dem Kopf steht. Beim Drucken beidseitig mit „Bindung an kurzer Kante“.'
  }
  const MARK_LABELS: Record<MarkSide, string> = {
    top: 'Oben',
    bottom: 'Unten',
    left: 'Links',
    right: 'Rechts'
  }
  const SIGNATURE_OPTIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 4)
  const presetEntries = Object.entries(SHEET_PRESETS)
  const BUILTIN_PREFIX = 'builtin:'

  function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
  }
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',')
  const prevent = (e: Event) => e.preventDefault()
  const clampCount = (n: number) => Math.min(64, Math.max(0, Math.floor(Number(n) || 0)))
  const num = (n: unknown) => (Number(n) > 0 ? Number(n) : 0)

  /** Anschnitt laut PDF (TrimBox der ersten Seite) in oben/unten/innen/außen umrechnen. */
  function detectedBleed(
    inset: NonNullable<PdfInfo['trimInset']>,
    s: Pick<ImpositionSettings, 'cover' | 'bleedLayout'>
  ) {
    // Seite 1 ist eine rechte Seite, wenn es eine Titelseite gibt: innen = links
    const firstIsRight = s.bleedLayout === 'single' || s.cover
    return {
      top: inset.top,
      bottom: inset.bottom,
      inner: firstIsRight ? inset.left : inset.right,
      outer: firstIsRight ? inset.right : inset.left
    }
  }
  const sameBleed = (a: ImpositionSettings['bleed'], b: ImpositionSettings['bleed']) =>
    num(a.top) === b.top &&
    num(a.bottom) === b.bottom &&
    num(a.inner) === b.inner &&
    num(a.outer) === b.outer

  let settings: ImpositionSettings = plain(defaultSettings)
  let templates: ImpositionSettings[] = []
  let selectedTemplate = ''
  let docId = 0 // Nummer des geöffneten PDFs (0 = keins)
  let excluded: number[] = [] // entfernte Seiten der aktuellen Datei (0-basiert)
  let loadingName = '' // Datei, die gerade geladen wird
  let loadToken = 0
  let fileName = ''
  let info: PdfInfo | null = null
  let dragging = false
  let busy = false
  let message: { kind: 'error' | 'ok'; text: string } | null = null

  let sequence: PageRef[] = []
  let sequenceKey = ''
  let sequenceError = ''

  $: presetKey =
    presetEntries.find(
      ([, p]) => p.width === settings.sheet.width && p.height === settings.sheet.height
    )?.[0] ?? 'custom'
  $: trimW = info ? info.widthMm - (num(settings.bleed.inner) + num(settings.bleed.outer)) : 0
  $: trimH = info ? info.heightMm - (num(settings.bleed.top) + num(settings.bleed.bottom)) : 0
  $: bindingOptions = BINDINGS.filter((b) => b !== 'custom' || !!settings.custom)
  $: detected = info?.trimInset ? detectedBleed(info.trimInset, settings) : null
  $: userTemplateSelected = selectedTemplate !== '' && !selectedTemplate.startsWith(BUILTIN_PREFIX)
  $: updateSequence(
    info,
    settings.binding,
    settings.cover,
    settings.extraFront,
    settings.extraBack,
    settings.custom,
    excluded
  )
  // Fehlen bei einem festen Schema Seiten? (z. B. 12-seitiges PDF im Ausschießer 24)
  $: missing = info
    ? missingPages(info.pageCount, {
        binding: settings.binding,
        cover: settings.cover,
        extraFront: clampCount(settings.extraFront),
        extraBack: clampCount(settings.extraBack),
        custom: settings.custom,
        exclude: excluded
      })
    : null
  $: missingText =
    info && missing
      ? `Das PDF hat ${info.pageCount - excluded.length} ${info.pageCount - excluded.length === 1 ? 'Seite' : 'Seiten'}${excluded.length ? ' (nach dem Entfernen)' : ''}, ` +
        `${settings.binding === 'onesheet' ? 'das Ein-Blatt-Zine' : settings.binding === 'falz24' ? 'der Ausschießer' : 'das Schema'} ` +
        `erwartet ${missing.expected}. ${missing.missing} ${missing.missing === 1 ? 'Feld bleibt' : 'Felder bleiben'} leer.`
      : ''
  $: resultText = describe(
    info,
    sequence,
    sequenceError,
    settings.binding,
    settings.signaturePages,
    settings.twoCopies
  )

  // Seitenfolge des fertigen Hefts; wird nur neu gesetzt, wenn sie sich wirklich ändert
  function updateSequence(
    i: PdfInfo | null,
    binding: Binding,
    cover: boolean,
    extraFront: number,
    extraBack: number,
    custom: CustomLayout | undefined,
    exclude: number[]
  ) {
    let seq: PageRef[] = []
    let error = ''
    if (i) {
      try {
        seq = buildSequence(i.pageCount, {
          binding,
          cover,
          extraFront: clampCount(extraFront),
          extraBack: clampCount(extraBack),
          custom,
          exclude
        })
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    }
    const key = seq.map((p) => (p === null ? '-' : p)).join(',')
    if (key !== sequenceKey) {
      sequenceKey = key
      sequence = seq
    }
    sequenceError = error
  }

  function describe(
    i: PdfInfo | null,
    seq: PageRef[],
    error: string,
    binding: Binding,
    signaturePages: number,
    twoCopies: boolean
  ): string {
    if (!i) return ''
    if (error) return error
    const blanks = seq.filter((p) => p === null).length
    const blankText = blanks ? ` (${blanks} Leerseite${blanks > 1 ? 'n' : ''})` : ''
    switch (binding) {
      case 'saddle':
        return `${seq.length / 4} Bögen, ${seq.length / 2} Bogenseiten${blankText}`
      case 'signatures': {
        const lagen = Math.ceil(seq.length / (signaturePages || 16))
        return `${lagen} Lage${lagen > 1 ? 'n' : ''}, ${seq.length / 4} Bögen${blankText}`
      }
      case 'cutstack':
        return `${seq.length / 4} Bögen zum Schneiden${blankText}`
      case 'leporello':
        return `1 Streifen, ${seq.length / 2} Felder pro Seite${blankText}`
      case 'falz24':
        return twoCopies
          ? `3 Bögen für 2 Hefte${blankText}`
          : `2 Bögen für 1 Heft${blankText}`
      case 'custom':
        return settings.custom ? `${describeCustom(settings.custom)}${blankText}` : 'Schema fehlt'
      default:
        return `1 Blatt${blankText}`
    }
  }

  function payload(): ImpositionSettings {
    const s = plain(settings)
    s.bleed = {
      top: num(s.bleed.top),
      bottom: num(s.bleed.bottom),
      inner: num(s.bleed.inner),
      outer: num(s.bleed.outer)
    }
    s.extraFront = clampCount(s.extraFront)
    s.extraBack = clampCount(s.extraBack)
    s.twoCopies = !!s.twoCopies
    if (excluded.length) s.exclude = [...excluded]
    else delete s.exclude
    for (const side of MARK_SIDES) {
      const m = s.cropMarks.sides[side]
      m.length = Number(m.length) > 0 ? Number(m.length) : 5
      m.offset = Number(m.offset) >= 0 ? Number(m.offset) : 3
    }
    s.signaturePages = Math.min(64, Math.max(4, Math.round((s.signaturePages || 16) / 4) * 4))
    return s
  }

  onMount(refreshTemplates)

  async function refreshTemplates() {
    templates = await window.api.listTemplates()
  }

  // --- Fortschritt (wird dort angezeigt, wo es passiert) -------------------------
  const PDF_STEPS = ['PDF öffnen und prüfen', 'Vorschau vorbereiten', 'Erste Seiten rendern']
  const IMPOSE_STEPS = [
    'Speicherort wählen',
    'PDF einlesen',
    'Seiten auf Bögen verteilen',
    'Druck-PDF zusammenstellen',
    'Datei schreiben'
  ]
  let pdfLoading: LoadingState | null = null
  let imposeLoading: LoadingState | null = null
  $: pdfActive = !!pdfLoading && pdfLoading.current < pdfLoading.steps.length
  $: imposeActive = !!imposeLoading && imposeLoading.current < imposeLoading.steps.length

  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  function onPreviewProgress(p: LoadProgress) {
    if (!pdfLoading) return
    if (p.phase === 'rendering') {
      // Bis das erste Bild da ist: Vorschau wird vorbereitet; danach echte Zählung
      pdfLoading =
        p.done === 0
          ? { ...pdfLoading, current: 1, fraction: null }
          : { ...pdfLoading, current: 2, fraction: p.done / Math.max(1, p.total) }
    } else if (p.phase === 'ready') {
      pdfLoading = { ...pdfLoading, current: PDF_STEPS.length, fraction: null }
    }
  }

  onMount(() =>
    window.api.onImposeProgress((ev) => {
      if (!imposeLoading) return
      const step: Record<typeof ev.phase, number> = {
        dialog: 0,
        reading: 1,
        placing: 2,
        saving: 3,
        writing: 4
      }
      imposeLoading = {
        ...imposeLoading,
        current: step[ev.phase],
        // Beim Verteilen echter Fortschritt; im Speicherdialog steht der Balken still
        fraction:
          ev.phase === 'placing' ? ev.done / Math.max(1, ev.total) : ev.phase === 'dialog' ? 0 : null
      }
    })
  )

  async function loadFile(file: File) {
    message = null
    if (file.name.toLowerCase().endsWith('.json')) {
      await showImport(await window.api.importTemplateText(await file.text(), file.name))
      return
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      message = { kind: 'error', text: 'Bitte eine PDF-Datei oder eine Vorlagen-Datei (.json) verwenden.' }
      return
    }
    const path = window.api.pathForFile(file)
    if (!path) {
      message = { kind: 'error', text: 'Die Datei konnte nicht geöffnet werden.' }
      return
    }
    // Sofort Rückmeldung geben – gelesen wird im Hintergrund, das Fenster bleibt bedienbar
    const token = ++loadToken
    loadingName = `${file.name} · ${mb(file.size)}`
    pdfLoading = { title: 'PDF wird geladen', steps: PDF_STEPS, current: 0 }
    const res = await window.api.pdfOpen(path)
    if (token !== loadToken) return // inzwischen eine andere Datei
    if ('error' in res) {
      pdfLoading = null
      message = { kind: 'error', text: res.error }
      return
    }
    pdfLoading = { ...pdfLoading, current: 1 }
    fileName = file.name
    info = res.info
    docId = res.docId
    excluded = [] // neue Datei: nichts entfernt
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    dragging = true
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const files = [...(e.dataTransfer?.files ?? [])]
    // Vorlagen dürfen mehrere auf einmal kommen, PDF nur eines
    const json = files.filter((f) => f.name.toLowerCase().endsWith('.json'))
    if (json.length > 1) {
      importDroppedTemplates(json)
      return
    }
    if (files[0]) loadFile(files[0])
  }

  async function importDroppedTemplates(files: File[]) {
    const all: ImportResult = { imported: [], errors: [] }
    for (const f of files) {
      const r = await window.api.importTemplateText(await f.text(), f.name)
      all.imported.push(...r.imported)
      all.errors.push(...r.errors)
    }
    await showImport(all)
  }

  async function showImport(r: ImportResult) {
    if (!r.imported.length && !r.errors.length) return
    await refreshTemplates()
    if (r.imported.length === 1 && !r.errors.length) {
      selectedTemplate = r.imported[0]
      applyTemplate()
    }
    const parts: string[] = []
    if (r.imported.length) {
      parts.push(`Übernommen: ${r.imported.map((n) => `„${n}“`).join(', ')}`)
    }
    for (const e of r.errors) parts.push(`${e.file}: ${e.error}`)
    message = { kind: r.errors.length ? 'error' : 'ok', text: parts.join(' · ') }
  }

  async function importTemplates() {
    message = null
    await showImport(await window.api.importTemplatesDialog())
  }

  async function exportTemplate() {
    message = null
    const res = await window.api.exportTemplate(payload())
    if ('error' in res) message = { kind: 'error', text: res.error }
    else if (!res.canceled) message = { kind: 'ok', text: `Vorlage gespeichert: ${res.path}` }
  }

  // --- Schema-Editor ---------------------------------------------------------
  let editorOpen = false
  let editorStart: CustomLayout | null = null

  function openEditor(start: CustomLayout | null) {
    editorStart = start
    editorOpen = true
  }

  function applySchema(layout: CustomLayout) {
    settings.custom = layout
    settings.binding = 'custom'
    if (settings.name.startsWith('Ausschießer 24') || settings.name === 'Standard') {
      settings.name = layout.name ?? 'Eigenes Schema'
    }
    editorOpen = false
  }

  /** Seitenverhältnis des Endformats für die Felder im Editor */
  $: pageRatio = trimW > 0 && trimH > 0 ? trimW / trimH : 0.707

  function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) loadFile(file)
    input.value = ''
  }

  function onPreset(e: Event) {
    const key = (e.currentTarget as HTMLSelectElement).value
    const preset = SHEET_PRESETS[key as keyof typeof SHEET_PRESETS]
    if (preset) settings.sheet = { ...preset }
  }

  function applyTemplate() {
    let t: ImpositionSettings | undefined
    if (selectedTemplate.startsWith(BUILTIN_PREFIX)) {
      t = BUILTIN_TEMPLATES.find((x) => BUILTIN_PREFIX + x.name === selectedTemplate)
    } else {
      t = templates.find((x) => x.name === selectedTemplate)
    }
    settings = plain(t ?? defaultSettings)
    bleedLinked = allSame(settings.bleed)
  }

  // --- Anschnitt verketten (wie in InDesign): eine Eingabe gilt für alle vier Seiten ---
  const allSame = (b: ImpositionSettings['bleed']) =>
    num(b.top) === num(b.bottom) && num(b.top) === num(b.inner) && num(b.top) === num(b.outer)
  let bleedLinked = allSame(settings.bleed)

  function linkBleed(e: Event) {
    if (!bleedLinked) return
    const v = num((e.currentTarget as HTMLInputElement).value)
    settings.bleed = { top: v, bottom: v, inner: v, outer: v }
  }

  function toggleBleedLink() {
    bleedLinked = !bleedLinked
    if (bleedLinked) {
      const v = num(settings.bleed.top)
      settings.bleed = { top: v, bottom: v, inner: v, outer: v }
    }
  }

  async function saveTemplate() {
    message = null
    const res = await window.api.saveTemplate(payload())
    if ('error' in res) {
      message = { kind: 'error', text: res.error }
      return
    }
    await refreshTemplates()
    selectedTemplate = settings.name.trim()
    message = { kind: 'ok', text: `Vorlage „${selectedTemplate}“ gespeichert` }
  }

  async function removeTemplate() {
    if (!userTemplateSelected || !confirm(`Vorlage „${selectedTemplate}“ löschen?`)) return
    await window.api.deleteTemplate(selectedTemplate)
    selectedTemplate = ''
    await refreshTemplates()
  }

  async function create() {
    if (!docId || busy) return
    if (missingText && !confirm(`${missingText}\n\nTrotzdem Druckbogen erstellen?`)) return
    busy = true
    message = null
    const suggested = fileName.replace(/\.pdf$/i, '') + '-druckbogen.pdf'
    imposeLoading = { title: 'Druckbogen wird erstellt', steps: IMPOSE_STEPS, current: 0, fraction: 0 }
    const res = await window.api.imposeSave(payload(), suggested)
    const finished = !('error' in res) && !res.canceled
    if (finished && imposeLoading) {
      imposeLoading = { ...imposeLoading, current: IMPOSE_STEPS.length }
      await sleep(650) // Balken voll laufen lassen, dann die Meldung zeigen
    }
    imposeLoading = null
    busy = false
    if ('error' in res) message = { kind: 'error', text: res.error }
    else if (!res.canceled) message = { kind: 'ok', text: `Gespeichert: ${res.path}` }
  }
</script>

<svelte:window on:dragover={prevent} on:drop={prevent} />

<div class="app">
  <main>
    <section class="left">
      <label
        class="drop"
        class:active={dragging}
        class:filled={!!info || pdfActive}
        on:dragover={onDragOver}
        on:dragleave={() => (dragging = false)}
        on:drop={onDrop}
      >
        <input type="file" accept="application/pdf,.pdf" on:change={onPick} />
        {#if info || pdfLoading}
          <strong>{pdfActive ? loadingName : fileName}</strong>
          <ProgressInline state={pdfLoading} />
          {#if !pdfActive}
            <span class="muted">Zum Ersetzen neue PDF hierher ziehen oder klicken</span>
          {/if}
        {:else}
          <strong>PDF hierher ziehen</strong>
          <span class="muted">oder klicken zum Auswählen</span>
          <span class="muted small">
            Einzelseiten im gleichen Format. Aus InDesign exportieren mit „Seiten“, nicht
            „Druckbögen“.
          </span>
        {/if}
      </label>

      {#if !info && pdfActive}
        <!-- Platzhalter, bis das PDF geprüft ist: die Vorschau „ist schon da“ -->
        <div class="skeleton" aria-hidden="true">
          <div class="skel-facts"></div>
          <div class="skel-preview"></div>
        </div>
      {/if}
      {#if info}
        <dl class="facts">
          <div>
            <dt>Seiten</dt>
            <dd>
              {info.pageCount}{excluded.length ? ` (${excluded.length} entfernt)` : ''}
            </dd>
          </div>
          <div>
            <dt>Seitenformat (mit Anschnitt)</dt>
            <dd>{fmt(info.widthMm)} × {fmt(info.heightMm)} mm</dd>
          </div>
          <div><dt>Endformat</dt><dd>{fmt(trimW)} × {fmt(trimH)} mm</dd></div>
          <div><dt>Ergebnis</dt><dd class:warn={!!missingText}>{resultText}</dd></div>
        </dl>
        {#if missingText}
          <p class="warning" role="alert">
            <strong>Seiten fehlen.</strong>
            {missingText} Stimmt die Seitenzahl im InDesign-Export („Alle“ statt eines Bereichs) und die
            gewählte Bindung?
          </p>
        {/if}
        {#if docId}
          <PreviewPanel
            {docId}
            {info}
            {sequence}
            {settings}
            onLoadProgress={onPreviewProgress}
            {excluded}
            onExclude={(p) => (excluded = [...excluded, p].sort((a, b) => a - b))}
            onRestore={(p) => (excluded = p === null ? [] : excluded.filter((x) => x !== p))}
          />
        {/if}
      {/if}
    </section>

    <aside class="settings">
      <div class="group">
        <h2>Vorlage</h2>
        <div class="row">
          <select bind:value={selectedTemplate} on:change={applyTemplate}>
            <option value="">Standard</option>
            <optgroup label="Mitgeliefert">
              {#each BUILTIN_TEMPLATES as t}
                <option value={BUILTIN_PREFIX + t.name}>{t.name}</option>
              {/each}
            </optgroup>
            {#if templates.length}
              <optgroup label="Eigene">
                {#each templates as t}
                  <option value={t.name}>{t.name}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
          {#if userTemplateSelected}
            <button class="danger" on:click={removeTemplate}>Löschen</button>
          {/if}
        </div>
        <div class="row">
          <input type="text" bind:value={settings.name} placeholder="Name der Vorlage" />
          <button on:click={saveTemplate}>Speichern</button>
        </div>
        <div class="row share">
          <button on:click={importTemplates}>Importieren …</button>
          <button on:click={exportTemplate}>Exportieren …</button>
        </div>
        <p class="hint">
          Vorlagen lassen sich als Datei teilen, z. B. für einen Kurs. Vorlagen-Dateien kannst du auch
          einfach ins Fenster ziehen.
        </p>
      </div>

      <div class="group">
        <h2>Bindung</h2>
        <label class="field">
          <span>Art</span>
          <select bind:value={settings.binding}>
            {#each bindingOptions as b}
              <option value={b}>{BINDING_LABELS[b]}</option>
            {/each}
          </select>
        </label>
        <p class="hint">{BINDING_HINTS[settings.binding]}</p>
        {#if settings.binding === 'signatures'}
          <label class="field">
            <span>Seiten pro Lage</span>
            <select bind:value={settings.signaturePages}>
              {#each SIGNATURE_OPTIONS as n}
                <option value={n}>{n} Seiten ({n / 4} Bögen)</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if settings.binding === 'falz24'}
          <label class="check">
            <input type="checkbox" bind:checked={settings.twoCopies} />
            Zwei Exemplare (Außenbogen doppelt)
          </label>
          <p class="hint">
            Wie in der Anleitung: Seiten 1 und 2 des Ausschießers werden verdoppelt
            (1-2-1-2-3-4). Der Innenbogen enthält jede Seite zweimal, so ergeben sich zwei Hefte.
          </p>
          <button class="link" on:click={() => openEditor(falz24Layout(settings.twoCopies))}>
            Als eigenes Schema bearbeiten …
          </button>
          <p class="hint">
            Öffnet den Ausschießer im Schema-Editor, z. B. als Ausgangspunkt für eine Kursvorlage.
          </p>
        {/if}
        {#if settings.binding === 'custom' && settings.custom}
          <p class="schema">
            {settings.custom.name ? `${settings.custom.name}: ` : ''}{describeCustom(settings.custom)}
          </p>
          <button class="link" on:click={() => openEditor(settings.custom ?? null)}>
            Schema bearbeiten …
          </button>
        {:else if settings.binding !== 'falz24'}
          <button class="link" on:click={() => openEditor(null)}>Eigenes Schema erstellen …</button>
        {/if}
      </div>

      <div class="group">
        <h2>Seitenaufbau</h2>
        <label class="check">
          <input type="checkbox" bind:checked={settings.cover} />
          Titelseite vorhanden
        </label>
        <p class="hint">
          {settings.cover
            ? 'Seite 1 ist der Umschlag, die Doppelseiten beginnen bei Seite 2.'
            : 'Die Datei beginnt mit einer Doppelseite, der Umschlag bleibt leer.'}
        </p>
        <div class="row">
          <label class="field">
            <span>Leerseiten vorne</span>
            <input type="number" min="0" max="64" step="1" bind:value={settings.extraFront} />
          </label>
          <label class="field">
            <span>Leerseiten hinten</span>
            <input type="number" min="0" max="64" step="1" bind:value={settings.extraBack} />
          </label>
        </div>
        <p class="hint">
          Vorne: vor der ersten Inhaltsseite (hinter dem Umschlag). Hinten: am Ende. Danach wird
          automatisch auf die nötige Seitenzahl aufgefüllt.
        </p>
      </div>

      <div class="group">
        <h2>Druckbogen</h2>
        <label class="field">
          <span>Format</span>
          <select value={presetKey} on:change={onPreset}>
            {#each presetEntries as [key, p]}
              <option value={key}>{key} ({p.width} × {p.height} mm)</option>
            {/each}
            <option value="custom">Benutzerdefiniert</option>
          </select>
        </label>
        <div class="row">
          <label class="field">
            <span>Breite (mm)</span>
            <input type="number" min="1" step="0.1" bind:value={settings.sheet.width} />
          </label>
          <label class="field">
            <span>Höhe (mm)</span>
            <input type="number" min="1" step="0.1" bind:value={settings.sheet.height} />
          </label>
        </div>
        {#if usesDuplexSetting(settings.binding)}
          <label class="field">
            <span>Duplex: Wenden an der</span>
            <select bind:value={settings.duplexFlip}>
              <option value="short-edge">kurzen Kante</option>
              <option value="long-edge">langen Kante</option>
            </select>
          </label>
        {:else if settings.binding === 'falz24' || settings.binding === 'custom'}
          <p class="hint">
            Das Wenden ist durch den Ausschießer festgelegt. Beim Drucken beidseitig mit „Bindung an
            kurzer Kante“ und „Druckbild zentriert“ ausgeben.
          </p>
        {:else}
          <p class="hint">Wird nur einseitig bedruckt.</p>
        {/if}
      </div>

      <div class="group">
        <h2>Anschnitt und Marken</h2>
        <label class="field">
          <span>Anschnitt im PDF</span>
          <select bind:value={settings.bleedLayout}>
            <option value="facing">Doppelseiten (innen / außen)</option>
            <option value="single">Einzelseiten (links / rechts)</option>
          </select>
        </label>
        <div class="bleed-wrap">
          <div class="bleed">
          <label class="field">
            <span>Oben (mm)</span>
            <input
              type="number"
              min="0"
              step="0.5"
              bind:value={settings.bleed.top}
              on:input={linkBleed}
            />
          </label>
          <label class="field">
            <span>Unten (mm)</span>
            <input
              type="number"
              min="0"
              step="0.5"
              bind:value={settings.bleed.bottom}
              on:input={linkBleed}
            />
          </label>
          <label class="field">
            <span>{settings.bleedLayout === 'facing' ? 'Innen' : 'Links'} (mm)</span>
            <input
              type="number"
              min="0"
              step="0.5"
              bind:value={settings.bleed.inner}
              on:input={linkBleed}
            />
          </label>
          <label class="field">
            <span>{settings.bleedLayout === 'facing' ? 'Außen' : 'Rechts'} (mm)</span>
            <input
              type="number"
              min="0"
              step="0.5"
              bind:value={settings.bleed.outer}
              on:input={linkBleed}
            />
          </label>
          </div>
          <button
            class="chain"
            class:on={bleedLinked}
            aria-pressed={bleedLinked}
            title={bleedLinked
              ? 'Alle Seiten gleich – klicken, um einzeln einzustellen'
              : 'Alle Seiten gleich setzen'}
            aria-label="Anschnitt für alle Seiten gleich"
            on:click={toggleBleedLink}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              {#if bleedLinked}
                <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
                <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
              {:else}
                <path d="M15 7l1.5-1.5a3.5 3.5 0 0 1 5 5L20 12" />
                <path d="M9 17l-1.5 1.5a3.5 3.5 0 0 1-5-5L4 12" />
                <path d="M8 4v2M4 8h2M16 20v-2M20 16h-2" />
              {/if}
            </svg>
          </button>
        </div>
        {#if detected}
          <p class="hint">
            Laut PDF: oben {fmt(detected.top)}, unten {fmt(detected.bottom)},
            {settings.bleedLayout === 'facing' ? 'innen' : 'links'}
            {fmt(detected.inner)}, {settings.bleedLayout === 'facing' ? 'außen' : 'rechts'}
            {fmt(detected.outer)} mm
            {#if !sameBleed(settings.bleed, detected)}
              <button
                class="link"
                on:click={() => {
                  if (detected) settings.bleed = { ...detected }
                  bleedLinked = allSame(settings.bleed)
                }}
              >
                übernehmen
              </button>
            {/if}
          </p>
        {:else}
          <p class="hint">
            Wie unter „Dokument einrichten“ in InDesign. Beim PDF-Export „Anschnittseinstellungen des
            Dokuments verwenden“ aktivieren.
          </p>
        {/if}
        <label class="check">
          <input type="checkbox" bind:checked={settings.cropMarks.enabled} />
          Schnitt- und Falzmarken
        </label>
        {#if settings.cropMarks.enabled}
          <label class="field">
            <span>Abstand gemessen ab</span>
            <select bind:value={settings.cropMarks.from}>
              <option value="bleed">Anschnitt (Marken wandern mit)</option>
              <option value="trim">Endformat</option>
            </select>
          </label>
          <div class="marks">
            <span></span>
            <span class="col-head">Länge (mm)</span>
            <span class="col-head">Abstand (mm)</span>
            {#each MARK_SIDES as side}
              <label class="check side">
                <input type="checkbox" bind:checked={settings.cropMarks.sides[side].enabled} />
                {MARK_LABELS[side]}
              </label>
              <input
                type="number"
                min="1"
                step="0.5"
                aria-label="Länge {MARK_LABELS[side]}"
                disabled={!settings.cropMarks.sides[side].enabled}
                bind:value={settings.cropMarks.sides[side].length}
              />
              <input
                type="number"
                min="0"
                step="0.5"
                aria-label="Abstand {MARK_LABELS[side]}"
                disabled={!settings.cropMarks.sides[side].enabled}
                bind:value={settings.cropMarks.sides[side].offset}
              />
            {/each}
          </div>
          <p class="hint">
            Seiten beziehen sich auf den Druckbogen.
            {settings.cropMarks.from === 'bleed'
              ? 'Der Abstand zählt ab dem Anschnitt: mehr Anschnitt schiebt die Marken nach außen.'
              : 'Der Abstand zählt ab dem Endformat, Marken liegen aber nie im Anschnitt.'}
          </p>
        {/if}
      </div>
    </aside>
  </main>

  <footer>
    <div class="status">
      {#if imposeLoading}
        <ProgressInline state={imposeLoading} compact />
      {:else if message}
        <p class="msg {message.kind}">{message.text}</p>
      {/if}
    </div>
    <button class="primary" disabled={!docId || busy} on:click={create}>
      {busy ? (imposeActive && imposeLoading?.current === 0 ? 'Speicherort wählen …' : 'Wird erstellt …') : 'Druckbogen erstellen'}
    </button>
  </footer>

  {#if editorOpen}
    <SchemaEditor
      initial={editorStart}
      {pageRatio}
      pageWidthMm={trimW > 0 ? trimW : 105}
      onApply={applySchema}
      onCancel={() => (editorOpen = false)}
    />
  {/if}
</div>

<style>
  .app {
    height: 100%;
    display: grid;
    grid-template-rows: 1fr auto;
  }
  main {
    display: grid;
    /* minmax(0, …): breiter Inhalt (gezoomter Bogen) darf die Spalte nicht aufdrücken */
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 16px;
    padding: 16px;
    min-height: 0;
  }
  .left {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    min-width: 0;
  }

  .drop {
    flex: 1;
    min-height: 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    text-align: center;
    padding: 24px;
    border: 2px dashed var(--line);
    border-radius: 14px;
    background: var(--panel);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .drop input {
    display: none;
  }
  .drop.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--panel));
  }
  .drop.filled {
    flex: 0 0 auto;
    min-height: 120px;
    border-style: solid;
  }
  .drop strong {
    font-size: 15px;
    word-break: break-all;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 12px;
    max-width: 38ch;
  }

  .facts {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    padding: 16px;
    background: var(--panel);
    border-radius: 14px;
  }
  .facts div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .facts dt {
    color: var(--muted);
    font-size: 12px;
  }
  .facts dd {
    margin: 0;
    font-weight: 600;
  }
  .facts dd.warn {
    color: var(--warn);
  }
  .warning {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, var(--panel));
    font-size: 12px;
    line-height: 1.45;
  }
  .warning strong {
    color: var(--warn);
  }

  .settings {
    overflow-y: auto;
    background: var(--panel);
    border-radius: 14px;
    padding: 4px 16px 16px;
  }
  .group {
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .group:last-child {
    border-bottom: 0;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .hint {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 12px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    margin-top: 8px;
  }
  .row > :first-child {
    flex: 1;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    flex: 1;
  }
  .row .field {
    margin-top: 0;
  }
  .field span {
    color: var(--muted);
    font-size: 12px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
  }

  input[type='text'],
  input[type='number'],
  select {
    width: 100%;
    padding: 7px 9px;
    font: inherit;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .bleed-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bleed-wrap .bleed {
    flex: 1;
  }
  .chain {
    margin-top: 18px;
    width: 30px;
    height: 56px;
    padding: 0;
    display: grid;
    place-items: center;
    color: var(--muted);
    background: transparent;
  }
  .chain svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .chain.on {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .bleed {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .bleed .field {
    margin-top: 8px;
  }
  .share button {
    flex: 1;
  }
  .schema {
    margin: 10px 0 0;
    font-weight: 600;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    margin-top: 8px;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .hint button.link {
    margin: 0 0 0 4px;
    font-size: inherit;
  }
  .marks {
    display: grid;
    grid-template-columns: 1fr 84px 84px;
    gap: 6px 8px;
    align-items: center;
    margin-top: 10px;
  }
  .marks .col-head {
    color: var(--muted);
    font-size: 12px;
  }
  .marks .side {
    margin-top: 0;
  }
  input:disabled {
    opacity: 0.45;
  }
  input:focus,
  select:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  select:disabled {
    opacity: 0.5;
  }

  button {
    font: inherit;
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  button.danger {
    color: var(--danger);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    padding: 9px 18px;
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-top: 1px solid var(--line);
  }
  .status {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }
  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
    min-height: 0;
  }
  .skel-facts,
  .skel-preview {
    border-radius: 14px;
    background: linear-gradient(
        100deg,
        transparent 30%,
        color-mix(in srgb, var(--text) 6%, transparent) 50%,
        transparent 70%
      )
      var(--panel);
    background-size: 200% 100%;
    animation: skel 1.3s ease-in-out infinite;
  }
  .skel-facts {
    height: 92px;
  }
  .skel-preview {
    flex: 1;
    min-height: 260px;
  }
  @keyframes skel {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .skel-facts,
    .skel-preview {
      animation: none;
    }
  }
  .msg {
    margin: 0;
    flex: 1;
    word-break: break-word;
  }
  .msg.error {
    color: var(--danger);
  }
  .msg.ok {
    color: var(--ok);
  }
</style>