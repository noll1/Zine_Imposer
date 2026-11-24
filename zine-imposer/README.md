# Zine Imposer

A small app that lets you import your zines and booklets to create print-ready PDFs in the format of
your choice. You can also build your own templates and share them with students or friends. A 3D view
makes it easy to check that your booklet is set up correctly. You can flip through the pages or preview
the final print-ready files.

- Version: Beta 0.1.2
- Platform: macOS (Apple Silicon and Intel)
- Interface language: German

## Note on development

This app was vibecoded. The code was written by an AI (Claude by Anthropic) based on my descriptions,
tests and feedback; I am a graphic designer, not a software developer. The imposition logic is covered
by automated tests and the output has been measured against real print sheets. Always make a test print
before a larger print run.

## Features

- Binding types: saddle stitch, signatures (sewn or perfect bound), single-sheet zine (8 pages),
  perfect binding from single sheets, accordion fold (leporello), 24-page fold sheet (16 + 8)
- Custom imposition schemes: grid, page positions and rotation, automatic back side, gaps between
  pages, text and fold or cut lines on the sheet
- Templates: save settings, export them as a file and import them on another computer
- Bleed per edge (top, bottom, inside, outside), detected from the PDF
- Crop and fold marks, adjustable per sheet edge
- Preview: page overview, 3D booklet, print sheet view with zoom
- Remove duplicate pages, add blank pages, warning when pages are missing

## Installation

1. Open `Zine Imposer Beta 0.1.2.dmg` and drag Zine Imposer into the Applications folder.
2. Start the app once. macOS will block it because it is not notarized by Apple.
3. Open System Settings > Privacy & Security, scroll down and click "Open Anyway" next to Zine Imposer.

If macOS reports that the app is damaged, run this command in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Zine Imposer.app"
```

## Usage

The interface is in German. Labels are given below as they appear in the app, with a translation.

### 1. Export the PDF from InDesign

- Export **pages**, not spreads, and choose **All** as the range.
- Under Marks and Bleed, enable **Use Document Bleed Settings**. Crop marks are not needed; the app
  adds them.
- All pages should have the same size.

### 2. Import the PDF

Drag the PDF into the window or click the drop area. The app shows the page count, page size and trim
size. If the PDF contains bleed information, it is offered under *Anschnitt und Marken* (Bleed and
marks) and can be applied with *übernehmen* (apply).

### 3. Choose the settings

- *Bindung* (Binding): choose the binding type. A short description is shown below the selection.
- *Seitenaufbau* (Page setup): keep *Titelseite vorhanden* (has cover page) checked if page 1 is the
  cover. Blank pages can be added at the front or back.
- *Druckbogen* (Print sheet): choose the sheet size and, for duplex printing, whether the printer flips
  on the short or long edge.
- *Anschnitt* (Bleed): use the chain button to set all four edges at once, or set them individually,
  e.g. 3 / 3 / 0 / 3 mm (top, bottom, inside, outside).
- *Marken* (Marks): enable crop and fold marks and set their length and offset per edge.

*Ergebnis* (Result) shows the number of sheets and blank pages. A warning appears if a binding with a
fixed page count is missing pages.

### 4. Check the preview

The preview has three views:

- *Seiten* (Pages): the booklet as spreads. Hover over a page and click × to remove it. Removed pages
  can be restored.
- *3D*: the folded booklet. Flip through it with the arrow keys or the slider.
- *Druckbogen* (Print sheet): the pages as placed on the sheets. Zoom with the trackpad or
  Ctrl + scroll wheel, drag to pan.

The preview quality can be set to *Schnell* (fast), *Normal*, *Scharf* (sharp) or *Detail*.

### 5. Create the print sheets

Click *Druckbogen erstellen* (Create print sheets) and choose a location. Print double-sided with the
image centered; for most bindings, flip on the short edge.

## Templates

Settings can be saved as a template under *Vorlage* (Template). The app includes a template for the
24-page fold sheet (460 × 320 mm, bleed 3 / 3 / 0 / 3 mm).

*Exportieren* (Export) saves a template as a `.vorlage.json` file. To import it, drag the file into the
window or use *Importieren* (Import). An example is included in [`beispiel-vorlagen`](beispiel-vorlagen).

Templates are stored in `~/Library/Application Support/Zine Imposer/templates`.

## Custom imposition schemes

Under *Bindung*, *Eigenes Schema erstellen* (Create custom scheme) opens the scheme editor. The 24-page
fold sheet can be used as a starting point via *Als eigenes Schema bearbeiten* (Edit as custom scheme).

1. Set the number of pages and the grid (columns × rows) for each sheet.
2. Enter a page number in each cell. ↻ rotates a page by 180°; ↻ at the start of a row rotates the
   whole row.
3. Enable the back side and fill it with *Aus Vorderseite berechnen* (Calculate from front).
4. Enter the gaps between pages in mm (trim edge to trim edge). Bleed extends into a gap up to its
   middle.
5. Add text, fold lines or cut lines with a right-click or *+ Anweisung* (Add instruction). Lines snap
   to grid lines. Text with a white background interrupts the line below it.
6. *Übernehmen* (Apply) is available once every page appears in the scheme.

Save the result as a template to share it.

## Troubleshooting

**Cells on the print sheet are empty.** The PDF has fewer pages than the binding requires, usually
because only a page range was exported. Check *Seiten* (Pages) and *Ergebnis* (Result).

**"Passt nicht auf den Bogen" (Does not fit on the sheet).** Pages, gaps and marks need more space than
the sheet provides. Choose a larger sheet or shorten or disable the marks.

**Back sides are upside down.** Change the flip edge in the printer settings or under *Duplex* in the
app.

**Colors.** Color spaces and profiles are passed through unchanged. The PDF/X output intent is not
carried over; check the final PDF with your print shop's preflight.

## Development

Built with Electron, Svelte and TypeScript. PDFs are created with pdf-lib, the preview uses pdf.js and
three.js. Requires Node.js (LTS) on macOS.

```bash
npm install        # install dependencies
npm run dev        # start the app in development mode
npm test           # run the tests for the imposition core
npm run build:mac  # build the .dmg into dist/
```

| Folder | Contents |
| --- | --- |
| `src/core` | Imposition logic without UI: page order, binding types, geometry, PDF output, tests |
| `src/main` | Electron main process: files, templates, PDF processing in a worker thread |
| `src/preload` | Bridge between the window and the main process |
| `src/renderer` | User interface: settings, preview, scheme editor |
| `beispiel-vorlagen` | Example template with a custom scheme |

New binding types can be added as data (see `falz24Layout` in `src/core/custom.ts`).
