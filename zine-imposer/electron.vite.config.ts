import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [svelte()],
    build: {
      rolldownOptions: {
        // Zwei Seiten: das Hauptfenster und das unsichtbare Render-Fenster für Vorschaubilder
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          thumbs: resolve(__dirname, 'src/renderer/thumbs.html')
        }
      }
    }
  }
})
