// src/main/worker-protocol.ts
// Nachrichten zwischen Hauptprozess und dem PDF-Hintergrund-Thread.
import type { PdfInfo } from '../core/api'
import type { ImposeProgress } from '../core/impose'

export type WorkerRequest =
  | { id: number; type: 'info'; path: string }
  | { id: number; type: 'impose'; path: string; settings: unknown; target: string }

export type WorkerProgress = ImposeProgress | { phase: 'writing' }

export type WorkerReply =
  | { id: number; type: 'progress'; progress: WorkerProgress }
  | { id: number; type: 'done'; info?: PdfInfo }
  | { id: number; type: 'error'; error: string }
