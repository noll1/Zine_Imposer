// src/main/index.ts
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { basename, join } from 'path'
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { imposeToFile, pdfInfo, stopPdfWorker } from './pdfclient'
import { parseSettings } from '../core/settings'
import type { ImpositionSettings } from '../core/settings'
import type {
  ImportResult,
  ImposeEvent,
  ImposeResult,
  PdfOpenResult,
  SimpleResult
} from '../core/api'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// App-Name und fester Datenordner: Entwicklungsmodus und fertige App teilen sich die Vorlagen
const APP_NAME = 'Zine Imposer'
app.setName(APP_NAME)
app.setPath('userData', join(app.getPath('appData'), APP_NAME))

const templatesDir = () => join(app.getPath('userData'), 'templates')

/** Vorlagen aus dem alten Ordner („imposer“) einmalig übernehmen. */
async function migrateOldTemplates() {
  const target = templatesDir()
  const old = join(app.getPath('appData'), 'imposer', 'templates')
  if (existsSync(target) || !existsSync(old)) return
  await cp(old, target, { recursive: true })
}
const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'vorlage'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    closeThumbWindow() // Render-Fenster gehört zum Hauptfenster
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- Vorschaubilder: eigener, unsichtbarer Render-Prozess ------------------
// pdf.js braucht für große Bilder viel Rechenzeit. Läuft das in einem eigenen Fenster-Prozess,
// bleibt das Hauptfenster (3D-Ansicht, Bedienung) davon unberührt.

let thumbWindow: BrowserWindow | null = null
let thumbReady: Promise<void> | null = null
let markThumbReady: (() => void) | null = null
let currentDoc: { id: number; path: string } | null = null
let sentDocId = 0 // welches PDF das Render-Fenster gerade hat
let docCounter = 0
let requestCounter = 0
const pendingThumbs = new Map<number, (bytes: Uint8Array | null) => void>()

function closeThumbWindow() {
  for (const resolve of pendingThumbs.values()) resolve(null)
  pendingThumbs.clear()
  if (thumbWindow && !thumbWindow.isDestroyed()) thumbWindow.destroy()
  thumbWindow = null
  thumbReady = null
}

function ensureThumbWindow(): Promise<BrowserWindow> {
  if (thumbWindow && !thumbWindow.isDestroyed() && thumbReady) {
    const win = thumbWindow
    return thumbReady.then(() => win)
  }
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 400,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false // unsichtbar, soll aber volle Geschwindigkeit haben
    }
  })
  thumbWindow = win
  sentDocId = 0
  thumbReady = new Promise<void>((resolve) => (markThumbReady = resolve))
  win.webContents.on('render-process-gone', () => {
    // Abgestürzt (z. B. zu wenig Speicher): offene Anfragen beenden, beim nächsten Mal neu starten
    closeThumbWindow()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/thumbs.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/thumbs.html'))
  }
  return thumbReady.then(() => {
    syncDoc(win)
    return win
  })
}

/** Dem Render-Fenster das aktuelle PDF geben, falls es das noch nicht hat (auch nach einem Neustart). */
function syncDoc(win: BrowserWindow) {
  if (currentDoc && sentDocId !== currentDoc.id && !win.isDestroyed()) {
    sentDocId = currentDoc.id
    win.webContents.send('thumbs:load', currentDoc.id, currentDoc.path)
  }
}

ipcMain.on('thumbs:ready', () => markThumbReady?.())


ipcMain.handle(
  'thumbs:render',
  async (_e, docId: number, index: number, px: number): Promise<Uint8Array | null> => {
    if (!currentDoc || currentDoc.id !== docId) return null
    const win = await ensureThumbWindow()
    syncDoc(win)
    const reqId = ++requestCounter
    return new Promise((resolve) => {
      pendingThumbs.set(reqId, resolve)
      win.webContents.send('thumbs:render', reqId, docId, index, px)
      setTimeout(() => {
        if (pendingThumbs.delete(reqId)) resolve(null)
      }, 120_000)
    })
  }
)

ipcMain.on('thumbs:done', (_e, reqId: number, bytes: Uint8Array | null) => {
  const resolve = pendingThumbs.get(reqId)
  pendingThumbs.delete(reqId)
  resolve?.(bytes)
})

// --- PDF ---------------------------------------------------------------

// Das Fenster schickt nur den Dateipfad. Gelesen und geprüft wird im Hintergrund-Thread,
// die Vorschaubilder liest das Render-Fenster selbst – so friert beim Laden nichts ein.
ipcMain.handle('pdf:open', async (_e, path: unknown): Promise<PdfOpenResult> => {
  if (typeof path !== 'string' || !path) {
    return { ok: false, error: 'Die Datei konnte nicht geöffnet werden.' }
  }
  const id = ++docCounter
  currentDoc = { id, path }
  for (const resolve of pendingThumbs.values()) resolve(null) // alte Anfragen verwerfen
  pendingThumbs.clear()
  // Vorschau schon parallel vorbereiten, während das PDF geprüft wird
  void ensureThumbWindow()
    .then(syncDoc)
    .catch(() => undefined)
  try {
    const info = await pdfInfo(path)
    return { ok: true, info, docId: id }
  } catch (err) {
    return { ok: false, error: msg(err) }
  }
})

ipcMain.handle(
  'impose:save',
  async (e, raw: unknown, suggestedName: string): Promise<ImposeResult> => {
    try {
      const settings = parseSettings(raw)
      const doc = currentDoc
      if (!doc) throw new Error('Bitte zuerst ein PDF laden.')
      const send = (p: ImposeEvent) => {
        if (!e.sender.isDestroyed()) e.sender.send('impose:progress', p)
      }

      // Erst fragen, wohin – dann im Hintergrund rechnen und direkt dorthin schreiben
      send({ phase: 'dialog' })
      const options = {
        defaultPath: suggestedName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      }
      const win = BrowserWindow.fromWebContents(e.sender)
      const choice = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (choice.canceled || !choice.filePath) return { ok: true, canceled: true }

      await imposeToFile(doc.path, settings, choice.filePath, send)
      return { ok: true, canceled: false, path: choice.filePath }
    } catch (err) {
      return { ok: false, error: msg(err) }
    }
  }
)

// --- Vorlagen ----------------------------------------------------------

ipcMain.handle('templates:list', async (): Promise<ImpositionSettings[]> => {
  const dir = templatesDir()
  await mkdir(dir, { recursive: true })
  const result: ImpositionSettings[] = []
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      result.push(parseSettings(JSON.parse(await readFile(join(dir, file), 'utf-8'))))
    } catch {
      // kaputte oder fremde Dateien überspringen
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'de'))
})

/** Vorlage prüfen und im Vorlagen-Ordner ablegen. Gibt den Namen zurück. */
async function storeTemplate(raw: unknown): Promise<string> {
  const settings = parseSettings(raw)
  const name = String(settings.name ?? '').trim()
  if (!name) throw new Error('Bitte einen Namen für die Vorlage eingeben')
  await mkdir(templatesDir(), { recursive: true })
  const { exclude: _doc, ...template } = settings // entfernte Seiten gehören zur Datei, nicht zur Vorlage
  await writeFile(
    join(templatesDir(), `${slug(name)}.json`),
    JSON.stringify({ ...template, name }, null, 2)
  )
  return name
}

ipcMain.handle('templates:save', async (_e, raw: unknown): Promise<SimpleResult> => {
  try {
    await storeTemplate(raw)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: msg(err) }
  }
})

/** Endung für geteilte Vorlagen-Dateien */
const SHARE_EXT = 'vorlage.json'

ipcMain.handle('templates:export', async (e, raw: unknown): Promise<ImposeResult> => {
  try {
    const settings = parseSettings(raw)
    const name = String(settings.name ?? '').trim()
    if (!name) throw new Error('Bitte einen Namen für die Vorlage eingeben')
    const options = {
      defaultPath: `${slug(name)}.${SHARE_EXT}`,
      filters: [{ name: 'Vorlage', extensions: ['json'] }]
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const choice = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (choice.canceled || !choice.filePath) return { ok: true, canceled: true }
    const { exclude: _doc, ...template } = settings // entfernte Seiten gehören zur Datei
    await writeFile(choice.filePath, JSON.stringify({ ...template, name }, null, 2))
    return { ok: true, canceled: false, path: choice.filePath }
  } catch (err) {
    return { ok: false, error: msg(err) }
  }
})

async function importTexts(files: { name: string; text: string }[]): Promise<ImportResult> {
  const result: ImportResult = { imported: [], errors: [] }
  for (const f of files) {
    try {
      let data: unknown
      try {
        data = JSON.parse(f.text)
      } catch {
        throw new Error('Keine gültige Vorlagen-Datei (JSON)')
      }
      result.imported.push(await storeTemplate(data))
    } catch (err) {
      result.errors.push({ file: f.name, error: msg(err) })
    }
  }
  return result
}

ipcMain.handle('templates:import-dialog', async (e): Promise<ImportResult> => {
  const options = {
    properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
    filters: [{ name: 'Vorlage', extensions: ['json'] }]
  }
  const win = BrowserWindow.fromWebContents(e.sender)
  const choice = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (choice.canceled) return { imported: [], errors: [] }
  const files = await Promise.all(
    choice.filePaths.map(async (p) => ({ name: basename(p), text: await readFile(p, 'utf-8') }))
  )
  return importTexts(files)
})

ipcMain.handle(
  'templates:import-text',
  async (_e, text: string, fileName: string): Promise<ImportResult> =>
    importTexts([{ name: String(fileName), text: String(text) }])
)

ipcMain.handle('templates:delete', async (_e, name: string): Promise<SimpleResult> => {
  try {
    await rm(join(templatesDir(), `${slug(name)}.json`), { force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: msg(err) }
  }
})

// --- App-Start ---------------------------------------------------------

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('de.zine-imposer.app')
  await migrateOldTemplates().catch(() => undefined)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeThumbWindow()
  stopPdfWorker()
})