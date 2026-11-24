// src/renderer/src/lib/booklet.ts
// 3D-Heft. Die Seitenbilder kommen fertig aus dem ThumbStore (gerendert im Render-Fenster),
// hier wird nur noch hochgeladen und gezeichnet – deshalb ruckelt die Ansicht nicht mehr.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { PageRef } from '../../../core/sequence'
import type { ThumbStore } from './thumbstore'

const PREFETCH = 8 // so viele Seiten rund um die sichtbare Doppelseite vorab anfordern
const MAX_TEXTURES = 48 // höchstens so viele Seiten als Textur auf der Grafikkarte halten

export interface BookletLayout {
  sequence: PageRef[] // Seiten des fertigen Hefts in Lesereihenfolge (null = Leerseite)
  fullW: number // Seitenbreite im PDF inkl. Anschnitt, mm
  fullH: number
  /** Anschnitt einer Quellseite (0-basiert) in mm: links/rechts/oben/unten */
  bleedOf: (srcIndex: number) => { left: number; right: number; top: number; bottom: number }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export class BookletViewer {
  onChange?: (position: number, leafCount: number) => void

  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(35, 1, 10, 10000)
  private controls: OrbitControls
  private book = new THREE.Group()
  private leaves: THREE.Group[] = []
  private textures = new Map<number, THREE.Texture>()
  private loadingTex = new Set<number>()
  private materials = new Map<number, THREE.MeshBasicMaterial>()
  private slotOf = new Map<number, number>()
  private layout: BookletLayout | null = null
  private pageW = 100
  private eps = 0.1
  private sizeKey = ''
  private current = 0
  private target = 0
  private dirty = true
  private generation = 0
  private rafId = 0
  private observer: ResizeObserver
  private unsubscribe: () => void

  constructor(
    private container: HTMLElement,
    private store: ThumbStore
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    const canvas = this.renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    this.scene.add(this.book)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.addEventListener('change', () => (this.dirty = true))

    // Fertige Seitenbilder aus dem gemeinsamen Speicher übernehmen
    this.unsubscribe = store.subscribe((index) => {
      if (index < 0) this.clearTextures()
      else this.loadTexture(index)
      this.requestPages()
    })

    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(container)
    this.resize()
    this.tick()
  }

  setLayout(layout: BookletLayout): void {
    this.layout = layout
    this.rebuild()
  }

  goTo(position: number): void {
    this.target = clamp(Math.round(position), 0, this.leaves.length)
    this.onChange?.(this.target, this.leaves.length)
    this.requestPages()
  }

  step(delta: number): void {
    this.goTo(Math.round(this.target) + delta)
  }

  dispose(): void {
    this.generation++
    this.unsubscribe()
    cancelAnimationFrame(this.rafId)
    this.observer.disconnect()
    this.disposeLeaves()
    this.clearTextures()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // --- Seitenbilder ------------------------------------------------------------

  private center() {
    return 2 * this.target - 0.5 // zwischen linker und rechter sichtbarer Seite
  }

  /** Dem Speicher sagen, welche Seiten jetzt gebraucht werden (nächste zuerst). */
  private requestPages() {
    const seq = this.layout?.sequence
    if (!seq) return
    const center = this.center()
    const near: { page: number; d: number }[] = []
    seq.forEach((page, slot) => {
      const d = Math.abs(slot - center)
      if (page !== null && d <= PREFETCH) near.push({ page, d })
    })
    near.sort((a, b) => a.d - b.d)
    this.store.want(near.map((n) => n.page))
    for (const { page } of near) this.loadTexture(page)
  }

  /** Bild aus dem Speicher als Textur hochladen (Dekodieren läuft außerhalb des Hauptthreads). */
  private loadTexture(page: number) {
    if (this.textures.has(page) || this.loadingTex.has(page) || !this.materials.has(page)) return
    const thumb = this.store.get(page)
    if (!thumb) return
    const gen = this.generation
    this.loadingTex.add(page)
    createImageBitmap(thumb.blob, { imageOrientation: 'flipY' })
      .then((bitmap) => {
        this.loadingTex.delete(page)
        if (gen !== this.generation) {
          bitmap.close()
          return
        }
        const tex = new THREE.Texture(bitmap)
        tex.flipY = false // schon beim Dekodieren gespiegelt
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        tex.needsUpdate = true
        this.textures.set(page, tex)
        this.attachTexture(page)
        this.evictFarTextures()
      })
      .catch(() => this.loadingTex.delete(page))
  }

  /** Grafikspeicher begrenzen: weit entfernte Seiten wieder abgeben. */
  private evictFarTextures() {
    if (this.textures.size <= MAX_TEXTURES) return
    const center = this.center()
    const byDistance = [...this.textures.keys()].sort(
      (a, b) =>
        Math.abs((this.slotOf.get(b) ?? 1e9) - center) -
        Math.abs((this.slotOf.get(a) ?? 1e9) - center)
    )
    for (const page of byDistance.slice(0, this.textures.size - MAX_TEXTURES)) {
      this.disposeTexture(page)
      const mat = this.materials.get(page)
      if (mat) {
        mat.map = null
        mat.needsUpdate = true
      }
    }
    this.dirty = true
  }

  private disposeTexture(page: number) {
    const tex = this.textures.get(page)
    if (!tex) return
    ;(tex.image as ImageBitmap | undefined)?.close?.()
    tex.dispose()
    this.textures.delete(page)
  }

  /** Nur das Endformat zeigen: Ausschnitt der Textur je nach Anschnitt dieser Seite. */
  private applyCrop(tex: THREE.Texture, page: number, mirrored: boolean) {
    const l = this.layout
    if (!l) return
    const b = l.bleedOf(page)
    const rx = (l.fullW - b.left - b.right) / l.fullW
    const ry = (l.fullH - b.top - b.bottom) / l.fullH
    const ox = b.left / l.fullW
    const oy = b.bottom / l.fullH
    if (mirrored) {
      // Rückseite wird von hinten betrachtet: Textur horizontal spiegeln
      tex.repeat.set(-rx, ry)
      tex.offset.set(ox + rx, oy)
    } else {
      tex.repeat.set(rx, ry)
      tex.offset.set(ox, oy)
    }
  }

  private attachTexture(page: number) {
    const tex = this.textures.get(page)
    const mat = this.materials.get(page)
    if (!tex || !mat) return
    this.applyCrop(tex, page, (this.slotOf.get(page) ?? 0) % 2 === 1)
    mat.map = tex
    mat.needsUpdate = true
    this.dirty = true
  }

  // --- Szene -----------------------------------------------------------------

  private clearTextures() {
    this.generation++
    for (const page of [...this.textures.keys()]) this.disposeTexture(page)
    this.loadingTex.clear()
    for (const mat of this.materials.values()) {
      mat.map = null
      mat.needsUpdate = true
    }
    this.dirty = true
  }

  private disposeLeaves() {
    for (const leaf of this.leaves) {
      leaf.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        ;(m.material as THREE.Material | undefined)?.dispose()
      })
      this.book.remove(leaf)
    }
    this.leaves = []
  }

  private slotMaterial(page: PageRef, slot: number, side: THREE.Side) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side,
      polygonOffset: true, // Fläche etwas nach hinten, damit die Kante nicht flackert
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    })
    if (page !== null) {
      this.materials.set(page, mat)
      this.slotOf.set(page, slot)
      this.attachTexture(page)
    }
    return mat
  }

  private rebuild() {
    this.disposeLeaves()
    this.materials.clear()
    this.slotOf.clear()
    this.dirty = true
    const l = this.layout
    if (!l) return

    // Endformat: Breite und Höhe sind für alle Seiten gleich (Anschnitt nur anders verteilt)
    const b0 = l.bleedOf(0)
    const w = l.fullW - b0.left - b0.right
    const h = l.fullH - b0.top - b0.bottom
    const seq = l.sequence
    if (w <= 0 || h <= 0 || seq.length < 2) return

    this.pageW = w
    this.eps = Math.max(w, h) * 0.0006 // kleiner Abstand zwischen den Blättern gegen Flackern
    const count = Math.floor(seq.length / 2)

    for (let j = 0; j < count; j++) {
      const leaf = new THREE.Group()
      const geo = new THREE.PlaneGeometry(w, h)
      geo.translate(w / 2, 0, 0) // Drehachse (Rücken) liegt bei x = 0, also immer in der Mitte

      leaf.add(new THREE.Mesh(geo, this.slotMaterial(seq[2 * j], 2 * j, THREE.FrontSide)))
      leaf.add(new THREE.Mesh(geo, this.slotMaterial(seq[2 * j + 1], 2 * j + 1, THREE.BackSide)))
      leaf.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x888888 })
        )
      )
      this.book.add(leaf)
      this.leaves.push(leaf)
    }

    this.target = clamp(this.target, 0, count)
    this.current = clamp(this.current, 0, count)
    this.applyPose()

    const key = `${w.toFixed(1)}x${h.toFixed(1)}`
    if (key !== this.sizeKey) {
      this.sizeKey = key
      this.fitCamera(h)
    }
    this.onChange?.(this.target, count)
    this.requestPages()
  }

  private applyPose() {
    const n = this.leaves.length
    for (let j = 0; j < n; j++) {
      const t = clamp(this.current - j, 0, 1)
      const e = t * t * (3 - 2 * t)
      this.leaves[j].rotation.y = -e * Math.PI // zur Kamera hin umblättern
      // Stapelreihenfolge: rechts liegt Blatt 0 oben, links das zuletzt umgeblätterte Blatt
      this.leaves[j].position.z = ((1 - e) * (n - j) + e * (j + 1)) * this.eps
    }
    this.dirty = true
  }

  private fitCamera(pageH: number) {
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const dist = Math.max(pageH / 2 / t, this.pageW / (t * this.camera.aspect)) * 1.25
    this.camera.near = dist * 0.05
    this.camera.far = dist * 20
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0, 0.18, 1).normalize().multiplyScalar(dist)
    this.controls.target.set(0, 0, 0)
    this.controls.minDistance = dist * 0.3
    this.controls.maxDistance = dist * 3
    this.controls.update()
  }

  private resize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  private tick = () => {
    this.rafId = requestAnimationFrame(this.tick)
    const diff = this.target - this.current
    if (diff !== 0) {
      this.current = Math.abs(diff) < 0.0005 ? this.target : this.current + diff * 0.14
      this.applyPose()
    }
    this.controls.update()
    if (this.dirty) {
      this.dirty = false
      this.renderer.render(this.scene, this.camera) // nur zeichnen, wenn sich etwas geändert hat
    }
  }
}
