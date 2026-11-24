// src/preload/index.ts
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { readFile } from 'fs/promises'
import type { Api, ImposeEvent } from '../core/api'

const api: Api = {
  pathForFile: (file) => webUtils.getPathForFile(file),
  pdfOpen: (path) => ipcRenderer.invoke('pdf:open', path),
  imposeSave: (settings, name) => ipcRenderer.invoke('impose:save', settings, name),
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  saveTemplate: (settings) => ipcRenderer.invoke('templates:save', settings),
  deleteTemplate: (name) => ipcRenderer.invoke('templates:delete', name),
  exportTemplate: (settings) => ipcRenderer.invoke('templates:export', settings),
  importTemplatesDialog: () => ipcRenderer.invoke('templates:import-dialog'),
  importTemplateText: (text, fileName) => ipcRenderer.invoke('templates:import-text', text, fileName),

  thumbsRender: (docId, index, px) => ipcRenderer.invoke('thumbs:render', docId, index, px),
  thumbsReady: () => ipcRenderer.send('thumbs:ready'),
  // Render-Fenster: liest die Datei selbst von der Festplatte (nur auf Anweisung des Hauptprozesses)
  onThumbsLoad: (cb) => {
    ipcRenderer.on('thumbs:load', (_e, docId: number, path: string) => {
      readFile(path)
        .then((buf) => cb(docId, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)))
        .catch(() => cb(docId, null))
    })
  },
  onThumbsRender: (cb) => {
    ipcRenderer.on('thumbs:render', (_e, reqId: number, docId: number, index: number, px: number) =>
      cb(reqId, docId, index, px)
    )
  },
  thumbsDone: (reqId, bytes) => ipcRenderer.send('thumbs:done', reqId, bytes),
  onImposeProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: ImposeEvent) => cb(ev)
    ipcRenderer.on('impose:progress', listener)
    return () => ipcRenderer.removeListener('impose:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)