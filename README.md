# Zine Imposer

**PDF rein, Druckbögen raus.**

Eine kleine Mac-App, die Zines und Hefte für den Druck ausschießt – damit die Seiten nach dem
Falzen, Schneiden und Heften in der richtigen Reihenfolge liegen.

**Version:** Beta 0.1.2 · **System:** macOS (Apple Silicon und Intel)

## Worum es geht

Wer ein Zine druckt, kennt das Problem: In InDesign liegen die Seiten schön der Reihe nach, auf dem
Druckbogen müssen sie aber kreuz und quer und teils auf dem Kopf stehen. Bisher hieß das:
Ausschießer-Vorlagen öffnen, Seiten von Hand platzieren, hoffen, dass nichts verrutscht.

Zine Imposer nimmt dir das ab. Du ziehst dein PDF hinein, wählst die Bindung, und die App erzeugt
die fertigen Druckbögen – mit Anschnitt, Schnittmarken und Hinweisen fürs Falzen. Vorher siehst du
dein Heft als 3D-Vorschau und kannst es durchblättern.

### Was die App kann

| Bereich | Was geht |
| --- | --- |
| **Bindungsarten** | Rückstichheftung · Lagenbindung (Faden-/Klebebindung) · Ein-Blatt-Zine (8 Seiten) · Klebebindung aus Einzelblättern · Leporello · Ausschießer 24 Seiten (Falzbogen 16 + 8) |
| **Eigene Schemata** | Raster frei anlegen, Seiten eintragen und drehen, Rückseite automatisch berechnen, Abstände (Stege) zwischen den Seiten, Texte sowie Falz- und Schnittlinien direkt auf dem Bogen |
| **Vorlagen** | Einstellungen speichern, als Datei weitergeben und importieren – z. B. als Kursvorlage |
| **Anschnitt** | je Seite (oben, unten, innen, außen), wird aus dem PDF erkannt |
| **Marken** | Schnitt- und Falzmarken, jede Bogenseite einzeln einstellbar |
| **Vorschau** | Seitenübersicht · 3D-Heft zum Durchblättern · Druckbogen-Ansicht mit Zoom |
| **Kontrolle** | doppelte Seiten entfernen, Leerseiten ergänzen, Warnung bei fehlenden Seiten |

## ✨ Gevibecoded

Ehrlich gesagt: Diese App ist **gevibecoded**. Ich komme aus dem Grafikdesign, nicht aus der
Softwareentwicklung. Der Code ist im Gespräch mit einer KI (Claude von Anthropic) entstanden – ich
habe beschrieben, was ich brauche, getestet, Fehler gemeldet und Wünsche nachgeschoben; die KI hat
programmiert.

Was das für dich heißt:

- Der Ausschieß-Kern ist mit automatischen Tests abgesichert, und die Ergebnisse wurden an echten
  Druckbögen nachgemessen. Trotzdem: **Mach vor einer großen Auflage immer einen Probedruck.**
- Manches ist sicher nicht so gelöst, wie es ein Profi lösen würde. Hinweise, Fehlerberichte und
  Verbesserungen sind herzlich willkommen.
- Für Farbverbindlichkeit (PDF/X, Profile) gilt: Die App verändert Farben nicht, prüft sie aber
  auch nicht. Das letzte Wort hat das Preflight deiner Druckerei.

## Anleitung

### 1. App installieren

1. `Zine Imposer Beta 0.1.2.dmg` öffnen und **Zine Imposer** in den Ordner **Programme** ziehen.
2. Die App einmal starten. macOS blockiert sie, weil sie nicht von Apple geprüft ist.
3. **Systemeinstellungen → Datenschutz & Sicherheit** öffnen, nach unten scrollen und bei Zine Imposer
   auf **„Trotzdem öffnen“** klicken. Ab jetzt startet die App normal.

Meldet macOS stattdessen, die App sei „beschädigt“, hilft dieser Befehl im Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Zine Imposer.app"
```

### 2. PDF aus InDesign exportieren

Die App braucht ein PDF mit **Einzelseiten** in Lesereihenfolge:

- Beim Export **„Seiten“** wählen, nicht „Druckbögen“, und bei „Bereich“ **„Alle“**.
- Unter **Marken und Anschnitt** die Option **„Anschnittseinstellungen des Dokuments verwenden“**
  aktivieren. Schnittmarken brauchst du hier nicht – die setzt die App.
- Alle Seiten sollten dasselbe Format haben.

### 3. PDF hineinziehen

Zieh das PDF ins Fenster oder klick auf das Ablagefeld. Die App zeigt dir sofort Seitenzahl,
Seitenformat und Endformat. Erkennt sie Anschnitt im PDF, schlägt sie ihn unter
**Anschnitt und Marken** mit einem Klick auf **„übernehmen“** vor.

### 4. Bindung und Bogen wählen

Rechts in den Einstellungen:

- **Bindung:** Unter jeder Bindungsart steht kurz, wie sie gefaltet und gebunden wird.
- **Seitenaufbau:** Ist Seite 1 dein Umschlag, lass **„Titelseite vorhanden“** angehakt. Fehlt etwas
  oder hat sich etwas verschoben, kannst du vorne oder hinten **Leerseiten** ergänzen.
- **Druckbogen:** Format wählen (A4, A3, SRA3 … oder eigene Maße). Bei Duplex-Druck einstellen, ob
  der Drucker an der kurzen oder langen Kante wendet.
- **Anschnitt:** Mit dem Ketten-Symbol stellst du alle vier Seiten gleich ein, ohne Kette einzeln –
  z. B. 3–3–0–3 mm (oben, unten, innen, außen).
- **Marken:** Schnitt- und Falzmarken einschalten und je Bogenseite Länge und Abstand festlegen.

Unter **Ergebnis** steht, was herauskommt – etwa „6 Bögen, 2 Leerseiten“. Fehlen bei einer Bindung
mit fester Seitenzahl Seiten, erscheint eine orange Warnung.

### 5. Vorschau prüfen

Oben in der Vorschau wählst du die Ansicht:

- **Seiten** – dein Heft als Doppelseiten. Fährst du mit der Maus über eine Seite, kannst du sie mit
  **×** aus dem Heft nehmen (praktisch bei doppelten Seiten). Entfernte Seiten holst du mit einem
  Klick zurück.
- **3D** – das fertige Heft zum Durchblättern, mit Pfeiltasten oder Schieberegler.
- **Druckbogen** – so liegen die Seiten auf den Bögen. Zoomen mit dem Trackpad oder Ctrl + Mausrad,
  verschieben durch Ziehen.

Läuft die Vorschau bei großen Bildern zäh, stell die Qualität rechts oben auf **„Schnell“**.
Fürs genaue Hinschauen beim Zoomen gibt es **„Scharf“** und **„Detail“**.

### 6. Druckbogen erstellen

Unten rechts auf **„Druckbogen erstellen“** klicken, Speicherort wählen – fertig. Der Fortschritt
steht in der Leiste daneben.

**Beim Drucken:** beidseitig, **„Druckbild zentriert“**, und bei den meisten Bindungen
**„Bindung an kurzer Kante“**. Ein Probedruck in Schwarzweiß auf normalem Papier lohnt sich immer.

## Vorlagen

Unter **Vorlage** speicherst du deine Einstellungen unter einem Namen und lädst sie später wieder.
Mitgeliefert ist der **Ausschießer 24 Seiten** (460 × 320 mm, Anschnitt 3–3–0–3) inklusive
Falzhinweisen.

**Vorlagen teilen:** Mit **„Exportieren …“** wird eine Vorlage zur Datei (`….vorlage.json`), die du
z. B. an einen Kurs verschickst. Wer sie bekommt, zieht sie einfach ins Fenster oder nutzt
**„Importieren …“**. Ein Beispiel liegt im Ordner [`beispiel-vorlagen`](beispiel-vorlagen).

## Eigenes Ausschießschema bauen

Für Falzungen, die es noch nicht gibt, öffnest du unter **Bindung** den Schema-Editor mit
**„Eigenes Schema erstellen …“** – oder nimmst den Ausschießer 24 mit
**„Als eigenes Schema bearbeiten …“** als Ausgangspunkt.

1. **Seiten im Heft** angeben und das **Raster** festlegen (Spalten × Zeilen je Bogen).
2. In jedes Feld die **Seitenzahl** eintragen. **↻** stellt eine Seite auf den Kopf,
   **↻ am Zeilenanfang** gleich die ganze Reihe.
3. **Rückseite bedrucken** einschalten und mit **„Aus Vorderseite berechnen“** automatisch füllen.
4. **Abstände zwischen den Seiten** eintragen (mm, Endformat zu Endformat) – z. B. ein Steg in der
   Mitte zum Falzen. Der Anschnitt ragt automatisch in den Steg hinein.
5. **Anweisungen** per Rechtsklick oder **„+ Anweisung“** einfügen: Text, Falzlinie oder
   Schnittlinie. Linien rasten auf den Rasterlinien ein, Texte lassen sich ziehen. Ein Text mit
   weißem Hintergrund unterbricht die Linie darunter – so wie die Hinweise in klassischen
   Ausschießer-Vorlagen.
6. Unten zeigt die Leiste **„Seiten im Schema“**, ob jede Seite vorkommt. **Übernehmen** geht erst,
   wenn alles stimmt.

Danach das Ganze als Vorlage speichern – fertig ist deine Kursvorlage.

## Häufige Fragen

**Auf den Druckbögen bleiben Felder weiß.**
Meist hat das PDF zu wenige Seiten (z. B. beim Export nur einen Bereich gewählt). Schau bei
„Seiten“ und „Ergebnis“ nach, wie viele Leerseiten ergänzt werden.

**„Passt nicht auf den Bogen“.**
Seiten, Abstände und Marken brauchen mehr Platz als das Bogenformat hat. Größeres Format wählen,
Marken verkürzen oder ausschalten.

**Die Rückseiten stehen auf dem Kopf.**
Am Drucker die andere Kante zum Wenden wählen – oder in der App bei „Duplex“ umstellen.

**Wo liegen meine Vorlagen?**
Unter `~/Library/Application Support/Zine Imposer/templates`.

## Für Entwickler:innen

Gebaut mit [Electron](https://www.electronjs.org), [Svelte](https://svelte.dev) und TypeScript.
PDFs werden mit [pdf-lib](https://pdf-lib.js.org) erzeugt, die Vorschau rendert
[pdf.js](https://mozilla.github.io/pdf.js/), das 3D-Heft [three.js](https://threejs.org).

Voraussetzung: [Node.js](https://nodejs.org) (LTS) auf macOS.

```bash
npm install        # Abhängigkeiten installieren
npm run dev        # App im Entwicklungsmodus starten
npm test           # Tests des Ausschieß-Kerns
npm run build:mac  # fertige App als .dmg im Ordner dist/
```

| Ordner | Inhalt |
| --- | --- |
| `src/core` | Ausschieß-Kern ohne Oberfläche: Seitenfolge, Bindungsarten, Geometrie, PDF-Ausgabe – mit Tests |
| `src/main` | Electron-Hauptprozess: Dateien, Vorlagen, PDF-Verarbeitung im Hintergrund-Thread |
| `src/preload` | Schnittstelle zwischen Fenster und Hauptprozess |
| `src/renderer` | Oberfläche: Einstellungen, Vorschau, Schema-Editor |
| `beispiel-vorlagen` | Beispiel für eine eigene Vorlage mit Schema |

Neue Bindungsarten entstehen am einfachsten als Schema (siehe `falz24Layout` in
`src/core/custom.ts`) – dafür muss man keine neue Logik schreiben.
