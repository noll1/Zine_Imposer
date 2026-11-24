<script lang="ts">
  // Eine Seite aus dem Vorschau-Speicher, auf das Endformat zugeschnitten.
  // Der umgebende Rahmen bestimmt die Größe; das Bild füllt ihn aus.
  import { onDestroy } from 'svelte'
  import type { ThumbStore } from './lib/thumbstore'

  export let store: ThumbStore
  export let page: number | null
  export let fullW: number // Seitengröße im PDF inkl. Anschnitt, mm
  export let fullH: number
  export let bleed: { left: number; right: number; top: number; bottom: number }
  export let rotate: 0 | 180 = 0
  /** Wie viel Anschnitt an jeder Kante sichtbar bleibt (mm, in Ausrichtung der Seite) */
  export let extend: { left: number; right: number; top: number; bottom: number } = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0
  }

  let version = 0
  const unsubscribe = store.subscribe((i) => {
    if (i === -1 || i === page) version++
  })
  onDestroy(unsubscribe)

  // version ändert sich, sobald ein neues Bild im Speicher liegt
  const urlFor = (p: number | null, _v: number) => (p === null ? undefined : store.get(p)?.url)
  $: url = urlFor(page, version)
  // Sichtbar ist das Endformat plus der Anschnitt an den Kanten aus „extend“
  $: visW = fullW - bleed.left - bleed.right + extend.left + extend.right
  $: visH = fullH - bleed.top - bleed.bottom + extend.top + extend.bottom
  $: imgStyle =
    `width:${(fullW / visW) * 100}%;height:${(fullH / visH) * 100}%;` +
    `left:${(-(bleed.left - extend.left) / visW) * 100}%;top:${(-(bleed.top - extend.top) / visH) * 100}%`
</script>

<div class="pg" class:blank={page === null} class:rot={rotate === 180}>
  {#if url}
    <img src={url} alt="" draggable="false" style={imgStyle} />
  {:else if page !== null}
    <span class="wait">{page + 1}</span>
  {/if}
</div>

<style>
  .pg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #fff;
  }
  .pg.blank {
    background: repeating-linear-gradient(
      135deg,
      #fff 0 6px,
      color-mix(in srgb, #000 5%, #fff) 6px 7px
    );
  }
  .pg.rot {
    transform: rotate(180deg);
  }
  img {
    position: absolute;
    max-width: none;
    user-select: none;
    animation: appear 0.25s ease-out; /* Bilder blenden weich ein statt aufzuploppen */
  }
  .wait {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #bbb;
    font-weight: 600;
    /* Platzhalter schimmert, solange das Bild gerendert wird */
    background: linear-gradient(100deg, transparent 30%, rgb(0 0 0 / 5%) 50%, transparent 70%);
    background-size: 200% 100%;
    animation: skel 1.3s ease-in-out infinite;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
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
    img,
    .wait {
      animation: none;
    }
  }
</style>
