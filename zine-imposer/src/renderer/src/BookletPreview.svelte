<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { BookletViewer } from './lib/booklet'
  import type { ThumbStore } from './lib/thumbstore'
  import type { PageRef } from '../../core/sequence'
  import type { PdfInfo } from '../../core/api'
  import { pageBleed } from '../../core/settings'
  import type { Bleed, BleedLayout } from '../../core/settings'

  export let store: ThumbStore
  export let info: PdfInfo
  export let sequence: PageRef[] = []
  export let bleed: Bleed
  export let bleedLayout: BleedLayout = 'facing'
  export let cover = true

  let container: HTMLDivElement
  let viewer: BookletViewer | null = null
  let position = 0
  let leafCount = 0

  $: if (viewer && sequence.length >= 2) {
    // Werte lokal festhalten, damit die Funktion unten nicht an spätere Änderungen gebunden ist
    const b = { ...bleed }
    const mode = bleedLayout
    const c = cover
    viewer.setLayout({
      sequence,
      fullW: info.widthMm,
      fullH: info.heightMm,
      bleedOf: (index) => pageBleed({ bleed: b, bleedLayout: mode, cover: c }, index)
    })
  }
  $: label = spreadLabel(position, leafCount, sequence)

  // Zeigt die Seitenzahlen deiner Datei (nicht die Heftseiten); "leer" = Leerseite
  const pageName = (ref: PageRef | undefined) => (ref === null ? 'leer' : String((ref ?? 0) + 1))

  function spreadLabel(k: number, n: number, seq: PageRef[]): string {
    if (!n) return ''
    if (k === 0) return `Außen vorne: ${pageName(seq[0])}`
    if (k === n) return `Außen hinten: ${pageName(seq[2 * n - 1])}`
    return `Seiten ${pageName(seq[2 * k - 1])} | ${pageName(seq[2 * k])}`
  }

  function onSlide(e: Event) {
    viewer?.goTo(Number((e.currentTarget as HTMLInputElement).value))
  }

  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.key === 'ArrowRight') viewer?.step(1)
    if (e.key === 'ArrowLeft') viewer?.step(-1)
  }

  onMount(() => {
    const v = new BookletViewer(container, store)
    v.onChange = (p, n) => {
      position = p
      leafCount = n
    }
    viewer = v
  })

  onDestroy(() => viewer?.dispose())
</script>

<svelte:window on:keydown={onKey} />

<div class="booklet">
  <div class="stage" bind:this={container} role="img" aria-label="3D-Vorschau des Hefts"></div>
  <div class="controls">
    <button on:click={() => viewer?.step(-1)} disabled={position <= 0} aria-label="Zurück">◀</button>
    <input type="range" min="0" max={leafCount} step="1" value={position} on:input={onSlide} />
    <button on:click={() => viewer?.step(1)} disabled={position >= leafCount} aria-label="Weiter">▶</button>
    <span class="label">{label}</span>
  </div>
</div>

<style>
  .booklet {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .stage {
    flex: 1;
    min-height: 0;
    background: color-mix(in srgb, var(--text) 6%, var(--panel));
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-top: 1px solid var(--line);
  }
  .controls input {
    flex: 1;
  }
  .label {
    min-width: 150px;
    text-align: right;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  button {
    font: inherit;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
