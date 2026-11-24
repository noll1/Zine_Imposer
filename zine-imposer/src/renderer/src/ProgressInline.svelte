<script lang="ts">
  // Fortschrittsanzeige direkt an der Stelle, an der etwas passiert (kein Vollbild).
  // „Gefühlter“ Fortschritt: Ohne Messwerte läuft der Balken schnell los und wird dann immer
  // langsamer (1 − e^(−t/τ)), bleibt nie stehen und springt nie zurück. Mit echten Werten
  // folgt er diesen. Am Ende läuft er zügig voll und blendet weich aus.
  import { onDestroy } from 'svelte'
  import type { LoadingState } from './lib/loading'

  export let state: LoadingState | null = null
  /** Kleine Variante für Leisten (eine Zeile) */
  export let compact = false

  const MIN_VISIBLE = 400 // ms: einmal sichtbar, nicht sofort wieder weg
  const TAU = 1800 // ms: wie schnell sich ein Schritt ohne Messwerte seinem Ende nähert
  const SOFT_CAP = 0.9 // ohne Messwerte höchstens so weit innerhalb eines Schritts

  let visible = false
  let leaving = false
  let shown = 0 // angezeigter Fortschritt 0–1
  let shownAt = 0
  let stepStart = 0
  let lastStep = -1
  let startedAt = 0
  let slowHint = false
  let finishedRun = false
  let raf = 0
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  $: active = !!state && state.current < state.steps.length
  $: handle(state, active)
  $: label = state
    ? active
      ? `${state.steps[state.current]} …`
      : 'Fertig'
    : ''

  function reset() {
    shown = 0
    lastStep = -1
    startedAt = performance.now()
    slowHint = false
    finishedRun = false
  }

  function handle(s: LoadingState | null, isActive: boolean) {
    if (s && isActive) {
      clearTimeout(hideTimer)
      leaving = false
      if (!visible || finishedRun) {
        reset()
        visible = true
        shownAt = performance.now()
      }
      if (s.current !== lastStep) {
        lastStep = s.current
        stepStart = performance.now()
      }
      if (!raf) raf = requestAnimationFrame(frame)
      return
    }
    if (!visible || finishedRun) return
    finishedRun = true
    stop()
    if (s) shown = 1 // fertig: zügig voll
    const wait = Math.max(0, MIN_VISIBLE - (performance.now() - shownAt))
    hideTimer = setTimeout(() => {
      leaving = true
      hideTimer = setTimeout(() => {
        visible = false
        leaving = false
      }, 220)
    }, wait + (s ? 250 : 0))
  }

  function target(s: LoadingState, now: number) {
    const span = 1 / s.steps.length
    const start = s.current * span
    if (s.fraction !== null && s.fraction !== undefined) {
      return start + span * Math.min(1, Math.max(0, s.fraction))
    }
    return start + span * SOFT_CAP * (1 - Math.exp(-(now - stepStart) / TAU))
  }

  function frame(now: number) {
    raf = 0
    if (!state || !active) return
    const goal = target(state, now)
    shown = Math.max(shown, shown + (goal - shown) * 0.12) // nachlaufen, nie rückwärts
    slowHint = now - startedAt > 8000
    raf = requestAnimationFrame(frame)
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  onDestroy(() => {
    stop()
    clearTimeout(hideTimer)
  })
</script>

{#if visible && state}
  <div class="progress" class:compact class:leaving role="status" aria-live="polite">
    <div class="row">
      <span class="label">{label}</span>
      {#if !compact && active}
        <span class="step">Schritt {state.current + 1} von {state.steps.length}</span>
      {/if}
    </div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(shown * 100)}>
      <div class="fill" style="transform: scaleX({shown})"></div>
    </div>
    {#if slowHint && active && !compact}
      <span class="hint">Große Bilder brauchen etwas länger – die App arbeitet noch.</span>
    {/if}
  </div>
{/if}

<style>
  .progress {
    width: 100%;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
    animation: fade-in 0.15s ease-out;
    transition: opacity 0.2s ease;
  }
  .progress.compact {
    max-width: none;
    gap: 4px;
  }
  .progress.leaving {
    opacity: 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
  }
  .label {
    font-weight: 600;
  }
  .step,
  .hint {
    color: var(--muted);
    font-size: 12px;
  }
  .bar {
    position: relative;
    height: 5px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }
  .fill {
    position: absolute;
    inset: 0;
    transform-origin: left;
    transition: transform 0.2s ease-out;
    border-radius: inherit;
    background: var(--accent);
    overflow: hidden;
  }
  /* Schimmer: zeigt Aktivität, auch wenn der Balken gerade langsam ist */
  .fill::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / 45%), transparent);
    animation: shimmer 1.4s ease-in-out infinite;
  }
  @keyframes shimmer {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fill::after,
    .progress {
      animation: none;
    }
  }
</style>
