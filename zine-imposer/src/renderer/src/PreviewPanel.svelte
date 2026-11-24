<script lang="ts">
  // Vorschau mit drei Ansichten: Seitenübersicht, 3D-Heft, Druckbögen.
  // Alle Ansichten nutzen dieselben Vorschaubilder aus dem ThumbStore.
  import { onDestroy } from 'svelte'
  import { ThumbStore } from './lib/thumbstore'
  import type { LoadProgress, PreviewQuality } from './lib/thumbstore'
  import BookletPreview from './BookletPreview.svelte'
  import PagesView from './PagesView.svelte'
  import SheetView from './SheetView.svelte'
  import type { ImpositionSettings } from '../../core/settings'
  import type { PageRef } from '../../core/sequence'
  import type { PdfInfo } from '../../core/api'

  /** Nummer des im Hauptprozess geöffneten PDFs */
  export let docId: number
  export let info: PdfInfo
  export let sequence: PageRef[] = []
  export let settings: ImpositionSettings
  /** Meldet den Ladefortschritt (für den Ladebildschirm) */
  export let onLoadProgress: ((p: LoadProgress) => void) | undefined = undefined
  /** Entfernte Seiten (0-basiert) und wie man sie entfernt bzw. zurückholt */
  export let excluded: number[] = []
  export let onExclude: (page: number) => void = () => {}
  export let onRestore: (page: number | null) => void = () => {}

  type Mode = 'pages' | '3d' | 'sheets'
  const MODES: { id: Mode; label: string }[] = [
    { id: 'pages', label: 'Seiten' },
    { id: '3d', label: '3D' },
    { id: 'sheets', label: 'Druckbogen' }
  ]

  // Ansicht und Qualität werden pro Rechner gemerkt
  const read = (key: string) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const write = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ohne Speicher: egal
    }
  }
  let mode: Mode = (['pages', '3d', 'sheets'] as const).find((m) => m === read('preview-mode')) ?? '3d'
  let quality: PreviewQuality =
    (['fast', 'normal', 'sharp', 'detail'] as const).find((q) => q === read('preview-quality')) ??
    'normal'
  $: write('preview-mode', mode)
  $: write('preview-quality', quality)

  const store = new ThumbStore()
  let busy = false
  const offBusy = store.onBusy((b) => (busy = b))
  const offLoad = store.onLoadProgress((p) => onLoadProgress?.(p))
  onDestroy(() => {
    offBusy()
    offLoad()
    store.dispose()
  })

  $: store.setQuality(quality)
  $: store.load(docId)

  // Leere Eingabefelder (null) nicht in die Rechnung lassen
  const n = (v: unknown) => (Number(v) > 0 ? Number(v) : 0)
  $: safe = {
    ...settings,
    bleed: {
      top: n(settings.bleed.top),
      bottom: n(settings.bleed.bottom),
      inner: n(settings.bleed.inner),
      outer: n(settings.bleed.outer)
    }
  } as ImpositionSettings
</script>

<div class="preview">
  <div class="bar">
    <div class="modes" role="tablist" aria-label="Ansicht">
      {#each MODES as m}
        <button role="tab" aria-selected={mode === m.id} class:active={mode === m.id} on:click={() => (mode = m.id)}>
          {m.label}
        </button>
      {/each}
    </div>
    {#if busy}
      <span class="busy">Seiten werden gerendert …</span>
    {/if}
    <select bind:value={quality} title="Auflösung der Vorschaubilder" aria-label="Vorschauqualität">
      <option value="fast">Schnell</option>
      <option value="normal">Normal</option>
      <option value="sharp">Scharf</option>
      <option value="detail">Detail (langsam)</option>
    </select>
  </div>

  {#if mode === 'pages'}
    <PagesView {store} {info} {sequence} settings={safe} {excluded} {onExclude} {onRestore} />
  {:else if mode === '3d'}
    <BookletPreview
      {store}
      {info}
      {sequence}
      bleed={safe.bleed}
      bleedLayout={safe.bleedLayout}
      cover={safe.cover}
    />
  {:else}
    <SheetView
      {store}
      {info}
      {sequence}
      settings={safe}
      {quality}
      onQuality={(q) => (quality = q)}
    />
  {/if}
</div>

<style>
  .preview {
    flex: 1;
    min-height: 260px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-radius: 14px;
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
  }
  .modes {
    display: flex;
    padding: 2px;
    border-radius: 9px;
    background: var(--bg);
    border: 1px solid var(--line);
  }
  .modes button {
    font: inherit;
    padding: 4px 12px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .modes button.active {
    background: var(--panel);
    box-shadow: 0 1px 2px rgb(0 0 0 / 20%);
    font-weight: 600;
  }
  .busy {
    flex: 1;
    color: var(--muted);
    font-size: 12px;
  }
  select {
    margin-left: auto;
    font: inherit;
    padding: 3px 6px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: inherit;
  }
</style>
