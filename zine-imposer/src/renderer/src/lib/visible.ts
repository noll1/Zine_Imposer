// src/renderer/src/lib/visible.ts
// Svelte-Aktion: meldet, ob ein Element gerade im sichtbaren Bereich (plus Rand) liegt.
export function visible(node: HTMLElement, onChange: (isVisible: boolean) => void) {
  let cb = onChange
  const observer = new IntersectionObserver((entries) => cb(entries[0].isIntersecting), {
    rootMargin: '300px'
  })
  observer.observe(node)
  return {
    update(next: (isVisible: boolean) => void) {
      cb = next
    },
    destroy() {
      observer.disconnect()
      cb(false)
    }
  }
}
