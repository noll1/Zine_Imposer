<script lang="ts">
  // Seitenübersicht: das fertige Heft als Doppelseiten, in Lesereihenfolge.
  import type { ThumbStore } from './lib/thumbstore'
  import { visible } from './lib/visible'
  import PageImage from './PageImage.svelte'
  import { pageBleed } from '../../core/settings'
  import type { ImpositionSettings } from '../../core/settings'
  import type { PageRef } from '../../core/sequence'
  import type { PdfInfo } from '../../core/api'

  export let store: ThumbStore
  export let info: PdfInfo
  export let sequence: PageRef[] = []
  export let settings: ImpositionSettings
  export let excluded: number[] = []
  export let onExclude: (page: number) => void = () => {}
  export let onRestore: (page: number | null) => void = () => {}

  type Slot = { slot: number; page: PageRef } | null

  // Umschlag rechts allein, dann Doppelseiten, die letzte Seite links allein
  $: spreads = toSpreads(sequence)
  function toSpreads(seq: PageRef[]): [Slot, Slot][] {
    if (!seq.length) return []
    const at = (i: number): Slot => (i >= 0 && i < seq.length ? { slot: i, page: seq[i] } : null)
    const rows: [Slot, Slot][] = [[null, at(0)]]
    for (let i = 1; i < seq.length; i += 2) rows.push([at(i), at(i + 1)])
    return rows
  }

  $: trimW = info.widthMm - settings.bleed.inner - settings.bleed.outer
  $: trimH = info.heightMm - settings.bleed.top - settings.bleed.bottom

  // Nur die sichtbaren Doppelseiten anfordern, von oben nach unten
  let shown = new Set<number>()
  function setVisible(row: number, isVisible: boolean) {
    if (isVisible) shown.add(row)
    else shown.delete(row)
    shown = shown
  }
  $: requestVisible(shown, spreads)
  function requestVisible(rows: Set<number>, all: [Slot, Slot][]) {
    const order = rows.size ? [...rows].sort((a, b) => a - b) : all.map((_, i) => i).slice(0, 6)
    const pages: number[] = []
    for (const r of order) {
      for (const s of all[r] ?? []) if (s && s.page !== null) pages.push(s.page)
    }
    store.want(pages)
  }

  const name = (p: PageRef) => (p === null ? 'leer' : `S. ${p + 1}`)
</script>

<div class="pages">
  {#if excluded.length}
    <div class="removed">
      <span>Entfernt:</span>
      {#each excluded as p}
        <button class="chip" title="Seite {p + 1} wieder ins Heft nehmen" on:click={() => onRestore(p)}>
          S. {p + 1} <span aria-hidden="true">↺</span>
        </button>
      {/each}
      <button class="link" on:click={() => onRestore(null)}>Alle wiederherstellen</button>
    </div>
  {/if}
  {#each spreads as spread, r (r)}
    <div class="spread" use:visible={(v) => setVisible(r, v)}>
      {#each spread as s}
        <figure class:gap={!s}>
          {#if s}
            <div class="card" style="aspect-ratio: {trimW} / {trimH}">
              {#if s.page !== null}
                <button
                  class="remove"
                  title="Seite {s.page + 1} aus dem Heft entfernen"
                  aria-label="Seite {s.page + 1} entfernen"
                  on:click={() => s.page !== null && onExclude(s.page)}>×</button
                >
              {/if}
              <PageImage
                {store}
                page={s.page}
                fullW={info.widthMm}
                fullH={info.heightMm}
                bleed={s.page === null ? { left: 0, right: 0, top: 0, bottom: 0 } : pageBleed(settings, s.page)}
              />
            </div>
            <figcaption>
              <strong>{name(s.page)}</strong>
              <span>Heftseite {s.slot + 1}</span>
            </figcaption>
          {/if}
        </figure>
      {/each}
    </div>
  {/each}
</div>

<style>
  .pages {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 22px 28px;
    align-content: flex-start;
    background: color-mix(in srgb, var(--text) 6%, var(--panel));
  }
  .spread {
    display: flex;
  }
  figure {
    margin: 0;
    width: 104px;
  }
  .card {
    position: relative;
    width: 100%;
    box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
  }
  figure:first-child .card {
    box-shadow: -1px 1px 3px rgb(0 0 0 / 25%);
  }
  .removed {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--panel);
    font-size: 12px;
  }
  .removed > span {
    color: var(--muted);
  }
  .chip {
    font: inherit;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: inherit;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--accent);
  }
  .link {
    font: inherit;
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 2px 4px;
  }
  .remove {
    position: absolute;
    z-index: 1;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    border: 0;
    background: rgb(0 0 0 / 65%);
    color: #fff;
    font-size: 15px;
    line-height: 22px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .card:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }
  .remove:hover {
    background: var(--danger);
  }
  figcaption {
    display: flex;
    justify-content: space-between;
    gap: 4px;
    padding: 4px 2px 0;
    font-size: 11px;
    color: var(--muted);
  }
  figcaption strong {
    color: var(--text);
    font-weight: 600;
  }
</style>
