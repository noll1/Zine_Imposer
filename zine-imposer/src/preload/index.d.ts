// src/preload/index.d.ts
import type { Api } from '../core/api'

declare global {
  interface Window {
    api: Api
  }
}