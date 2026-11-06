# Ember Studio – Design für den Bierpong-Turnier-Manager

Warmes, handwerklich wirkendes Designsystem: Terrakotta und Amber auf Stein- und Cremetönen, Serifen-Überschriften gegen eine klare Sans-Serif. Ruhig, fokussiert, leicht edel. Diese Datei ist die einzige Quelle für Farben, Typografie, Abstände und Komponentenstil (siehe `CLAUDE.md`).

## Geltungsbereich und Vorrang

- Zwei Oberflächen: **Admin** (`/admin`, hell, Maus/Touch am Laptop) und **Beamer** (`/beamer`, dunkel, 1920×1080, Lesbarkeit aus 5 m, SPEC N07).
- Bei Widerspruch gilt: Abschnitte „App-Komponenten“, „Beamer“ und „Admin-Layout“ **vor** den allgemeinen Komponenten- und Do/Don't-Regeln. Die Farbwerte der Tokens sind bindend.
- Alle UI-Texte stehen in `packages/web/src/shared/i18n/de.ts`, nie in Komponenten.
- Keine Icon-Bibliothek. Benötigte Symbole (Haken, Pfeil, Pause, Lautsprecher) als kleine Inline-SVGs in `shared/ui/icons.tsx`. Eine Icon-Bibliothek wäre eine neue Abhängigkeit.
- Nicht verwendet in dieser App: Avatare, Projektkarten mit Farbstreifen, Benachrichtigungs-Badges, Workspace-Umschalter.

## Colors – Hell (Admin)

Die Werte der ersten Tabelle sind unverändert aus dem ursprünglichen Entwurf.

| Token | Wert | Verwendung |
|---|---|---|
| `--primary` | `#C2410C` | Terrakotta: Primäraktion, aktiver Zustand, Links, Fokusring, Fortschritt |
| `--primary-hover` | `#9A3412` | Hover auf Primärelementen; Text auf `--surface-raised` |
| `--accent` | `#F59E0B` | Amber: Hinweise, Markierungen, „läuft gerade“ |
| `--neutral` | `#78716C` | Stein: Platzhalter, Zeitstempel, Metadaten. **Nur auf `--bg`** |
| `--bg` | `#FAFAF9` | Seitenhintergrund |
| `--surface` | `#F5F5F4` | Karten, Panels, Modals |
| `--surface-raised` | `#E7E5E4` | Hover, gewählte Zeilen, aktive Tabs |
| `--text` | `#1C1917` | Überschriften, Fließtext |
| `--text-secondary` | `#57534E` | Beschreibungen, Beschriftungen, Text auf Surface |
| `--border` | `#D6D3D1` | Kanten, Trenner, Eingabefelder |
| `--success` | `#16A34A` | Flächen/Rahmen für „erledigt“ |
| `--warning` | `#D97706` | Flächen/Rahmen für „Achtung“ |
| `--error` | `#DC2626` | Flächen/Rahmen für Fehler, destruktive Aktionen |

Ergänzungen (Text und Flächen mit ausreichendem Kontrast):

| Token | Wert | Verwendung |
|---|---|---|
| `--success-strong` | `#15803D` | Text „erledigt“ (4,8:1 auf `--bg`); Fläche mit weißem Text (5,0:1) |
| `--warning-strong` | `#B45309` | Text „Achtung“ (4,8:1 auf `--bg`) |
| `--error-strong` | `#B91C1C` | Fehlertext (6,2:1 auf `--bg`) |
| `--on-primary` | `#FFFFFF` | Text auf `--primary` (5,2:1) und `--error` (4,8:1) |
| `--on-accent` | `#1C1917` | Text auf `--accent` (8,1:1) und `--warning` (5,5:1) |
| `--focus-ring` | `rgba(194,65,12,0.12)` | 3-px-Ring um Eingaben |

Kontrastregeln (hell):
- Weißer Text nur auf `--primary`, `--error`, `--success-strong`. **Nie** weiß auf `--accent`, `--warning`, `--success` (unter 3,4:1).
- `--neutral` hat auf `--surface` nur 4,4:1; dort `--text-secondary` verwenden.
- Auf `--surface-raised` ist `--primary` zu schwach (4,1:1); dort `--primary-hover` verwenden.
- Farbe trägt nie allein eine Bedeutung. Status immer zusätzlich mit Text oder Symbol.

## Colors – Dunkel (Beamer)

Gleiche Tokennamen, andere Werte. Die Beamer-Ansicht setzt `data-theme="dark"` auf dem Wurzelelement. Der Beamer ist **fest dunkel**; ein Umschalter wäre eine SPEC-Änderung.

| Token | Wert | Kontrast auf `--bg` / `--surface` |
|---|---|---|
| `--bg` | `#1C1917` | – |
| `--surface` | `#292524` | – |
| `--surface-raised` | `#44403C` | – |
| `--border` | `#57534E` | Trenner (nicht für Text) |
| `--text` | `#FAFAF9` | 16,7 / 14,5 |
| `--text-secondary` | `#D6D3D1` | 11,7 / 10,2 |
| `--neutral` | `#A8A29E` | 6,9 / 6,0, nur für Nebeninformation |
| `--primary` (Text, Rahmen, aktiver Zustand) | `#FB923C` | 7,7 / 6,7 |
| `--primary-fill` (Flächen mit weißem Text) | `#C2410C` | weiß darauf 5,2 |
| `--accent` | `#F59E0B` | 8,1 |
| `--success` | `#4ADE80` | 10,0 / 8,7 |
| `--warning` | `#FBBF24` | 10,5 / 9,1 |
| `--error` | `#F87171` | 6,3 / 5,5 |
| `--error-fill` | `#B91C1C` | weiß darauf 6,5 |

Beamer-Regeln:
- Wesentliche Informationen (Timer, Teamnamen, Punkte, Tischnummern) mindestens **7:1**: `--text` oder `--text-secondary` auf `--bg` oder `--surface`. Auf `--surface-raised` nur `--text`.
- `--neutral`, `--error` und `--primary` als Textfarbe nur ab 28 px Schriftgröße.
- Nur die Tokens aus dieser Tabelle; keine neuen Farben.

## Typography

- **Anzeige:** Playfair Display, Gewicht 700, Laufweite −0,02 em.
- **Text/UI:** Source Sans 3, Gewichte 400 und 600.
- **Code:** Fira Code wird in dieser App nicht eingebunden (es gibt keine Code-Anzeige). Nur nachrüsten, falls das nötig wird.
- **Schriften werden lokal ausgeliefert, nicht von Google Fonts geladen** (die App läuft ohne Internet, SPEC M21). Die Dateien liegen in `packages/web/src/shared/fonts/` (`playfair-display-latin-700-normal.woff2`, `source-sans-3-latin-400-normal.woff2`, `source-sans-3-latin-600-normal.woff2`; Lizenz SIL OFL 1.1 liegt dabei). Einbindung per `@font-face` mit `font-display: swap` und relativen `url()`-Pfaden, damit Vite sie bündelt. Der Latin-Umfang enthält ä, ö, ü, ß und die typografischen Anführungszeichen.
- **Gewichte:** Playfair nur in 700, Source Sans nur in 400 und 600. Keine weiteren Gewichte, kein Kursiv.
- **Zahlen:** Immer in Source Sans 3 setzen, nie in Playfair (dessen Ziffern sind standardmäßig Mediävalziffern). Source Sans 3 hat standardmäßig gleich breite Ziffern; `font-variant-numeric: proportional-nums` (pnum) darf bei Timer, Tabellen und Ergebnissen nie gesetzt werden.
- Schriftfamilien-Fallbacks: `Georgia, serif` für Anzeige, `system-ui, sans-serif` für Text.

**Skala Admin:** Display 64 · Headline 48 · Section 28 · Subhead 20 · Body 16 · Small 14 · Caption 12 · Overline 11 (Großbuchstaben, weit gesperrt). In der Praxis genügen Section, Subhead, Body, Small.

**Skala Beamer (1920×1080):**

| Rolle | Größe | Schrift |
|---|---|---|
| Timer | 240 px | Source Sans 3, 600, gleich breite Ziffern |
| Ansichtstitel | 64 px | Playfair 700 |
| Tischnummer | 72 px | Source Sans 3, 600 |
| Teamname in Partie | 48 px | Source Sans 3, 600 |
| Tabellen-/Baumzeile | 32 px | Source Sans 3, 400 (Teamname 600) |
| Nebeninformation (Spieler, Begründung) | 28 px | Source Sans 3, 400 |

Kleinste erlaubte Schrift auf dem Beamer: **28 px**.

## Elevation

Admin: Karten liegen flach mit 1-px-Rand `--border`; bei Hover weicher Schatten `0 4px 16px rgba(28,25,23,0.06)`. Gewählte Karten: 2 px linker Rand `--primary`. Primärbuttons erhalten bei Hover einen warmen Schein `0 4px 12px rgba(194,65,12,0.25)`. Modals: `0 24px 48px rgba(28,25,23,0.12)` mit Hintergrundunschärfe. Beamer: keine Schatten; Ebenen nur über `--surface` und `--border`.

## Spacing und Radien

- Basis 4 px. Skala: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.
- Komponentenpolster: klein 8×12, mittel 12×16, groß 16×24.
- Abstände zwischen Abschnitten: 24 / 32 / 48 px (mobil / Tablet / Desktop). Kartenraster: 16 px mobil, 24 px Desktop.
- Admin-Inhalt: maximale Breite 1200 px, 24 px seitlich.
- **Beamer: 48 px Sicherheitsrand** auf allen Seiten (Projektoren beschneiden Ränder), Raster 24 px.
- Radien: 4 px Inline-Code/kleine Badges · 8 px Buttons, Eingaben, Auswahlfelder · 12 px Karten, Panels, Modals · 9999 px Chips, Fortschrittsbalken. Keine Mischung innerhalb einer Komponentenart.

## Components (Admin)

- **Buttons:** Primär = `--primary` Fläche, weißer Text, 8 px, Gewicht 600. Sekundär = transparent, 1 px `--border`, `--text`. Ghost = nur Text. Destruktiv = `--error` Fläche, weißer Text. Übergang 150 ms. Höhen: klein 32, mittel 40, groß 48. Hover Primär: `--primary-hover` plus Schein.
- **Karten:** `--surface`, 1 px `--border`, 12 px Radius, 16 px Polster. Hover hebt um 2 px an (nur Admin).
- **Eingaben:** 1 px `--border`, Hintergrund `--surface`, 8 px Radius, 12 px Polster, 16 px Schrift. Fokus: Rand `--primary` plus Ring `0 0 0 3px var(--focus-ring)`. Fehler: Rand `--error`, Text `--error-strong`. Beschriftung 14 px, 600, über dem Feld.
- **Chips:** Pillenform. Kategorie: `--surface-raised`-Hintergrund, `--text-secondary`. Aktiv: `--primary` Fläche, weißer Text. Semantisch: Hintergrund mit 12 % der Statusfarbe, Text in der `-strong`-Variante.
- **Fortschrittsbalken:** 4 px hoch, `--surface-raised` Spur, `--primary` Füllung, 300 ms Übergang. Verwendung: Anteil erfasster Ergebnisse je Durchgang („3 von 8“) mit Zahl in Small darüber.
- **Tabs:** Unterstrichen. Inaktiv `--neutral`/`--text-secondary`, aktiv `--primary` mit 2 px Unterstrich, Hover Hintergrund `--surface-raised`.
- **Dialoge:** Modal mit 12 px Radius. Genau eine Primäraktion. Destruktive Bestätigungen (Rückgängig mit Folgen, SPEC M19) nennen die betroffenen Partien.

## Admin-Layout

- **Navigation:** Seitenleiste, 256 px, `--bg`, 1 px Trenner rechts. Oben App-Name „Bierpong“ und Turniername. Einträge: Einrichtung, Gruppen, Spielplan, Ergebnisse, Beamer, Protokoll, Einstellungen. Aktiv: 3 px Balken links in `--primary` und leicht getönter Hintergrund. Keine einklappbaren Abschnitte. Unter 900 px Breite wird die Leiste zu einem Menü-Button oben.
- **Inhalt:** Seitentitel in Playfair 28 px, darunter Inhalt in Karten.
- **Dauerhafter Kopf** der Turnieransicht: Turniername, aktuelle Runde/Durchgang, Verbindungsstatus (verbunden / getrennt, mit Text), Button „Rückgängig“ (Ghost).
- **Warnbanner** (oberhalb des Inhalts, `--warning` Rahmen, `--warning-strong` Text, Symbol): Ton auf dem Beamer nicht freigegeben, Wake Lock nicht verfügbar („Energiesparen am Laptop deaktivieren“), Verbindung getrennt.

## App-Komponenten

**Partiekarte (Ergebniseingabe, N08: ≤ 2 Klicks).** Karte mit Tischnummer (Overline), zwei Teamzeilen A und B. Ergebnisse als fünf Schaltflächen in sekundärem Stil: „Sieg A“, „Sieg B“, „Sieg durch Zeit A“, „Sieg durch Zeit B“, „Unentschieden“ (im KO ausgeblendet; dort nur Sieger). Mindesthöhe 48 px, Abstand 8 px. Gewählte Schaltfläche: aktiver Chip-Stil (`--primary`). Ist `trackCups` an, erscheinen zwei Zahlenfelder (48 px, Pfeiltasten und direkte Eingabe). Pro Partiekarte genau ein Primärbutton „Speichern“; er ist erst aktiv, wenn ein Ergebnis gewählt ist. Gespeicherte Karte: linker Rand 4 px `--success-strong`, Ergebnistext, Ghost-Button „Ändern“.

**Durchgangsstatus.** Chip: `preparing` = Kategorie-Stil; `running` = `--accent`-Fläche mit `--on-accent`-Text; `finished` = Statusstil Erfolg mit Haken. Immer mit Textlabel.

**Timer (Admin und Beamer).** Anzeige `MM:SS` (ab 1 h `H:MM:SS`), gleich breite Ziffern.
- *Läuft* (über erster Warnschwelle): `--text`.
- *Warnstufe 1* (erste Schwelle erreicht): Ziffern `--warning-strong` (Beamer: `--warning`), Zusatztext „Noch X min“.
- *Warnstufen darüber hinaus*: Ziffern `--error-strong` (Beamer: `--error`). Bei der **letzten** Schwelle zusätzlich langsames Pulsieren (Deckkraft 1,0 ↔ 0,7, 1 s), abgeschaltet bei `prefers-reduced-motion`.
- *Pausiert*: Ziffern `--text-secondary`, Zusatzlabel „Pausiert“ mit Pause-Symbol.
- *Abgelaufen*: Timerfläche in `--error` (Beamer: `--error-fill`) mit weißem Text „Zeit abgelaufen“, Ziffern `00:00`.
- *Ohne Zeitlimit* (`durationMs = null`): statt Ziffern der Text „Ohne Zeitlimit“ (Halbfinale, Platz 3, Finale).
- Admin-Steuerung: Start/Fortsetzen (Primär), Pause, Verlängern (+1 min, +5 min), Neustart (Sekundär; Neustart mit Bestätigung).

**Gruppentabelle.** Spalten: Rang · Team · Sp · S · SZ · U · N · (Becherdifferenz, falls erfasst) · Punkte. Zahlen rechtsbündig, gleich breite Ziffern. Zeilenhöhe Admin 40 px, Beamer 44 px. Weiterkommende Zeilen: linker Streifen 4 px `--success-strong` (Beamer `--success`). Gleichstandsgrund (`rankReason`) als kleiner Chip hinter dem Teamnamen (Texte aus `de.ts`: „Direkter Vergleich“, „Becherdifferenz“, „Stechen“). Offener Gleichstand: Warnstil-Chip „Stechen nötig“. Gruppenkopf: Gruppenbuchstabe in Playfair 700.

**KO-Baum.** Spalten je Stufe von links nach rechts, Partieknoten als Karte (12 px Radius, 1 px `--border`). Verbindungslinien 2 px `--border`. Sieger: Teamname 600 plus Haken; Verlierer: `--text-secondary`. Aktuell gespielte Partie: 2 px linker Rand `--primary` (Beamer `--primary` dunkel). Offene Slots: „Sieger von …“ in `--neutral`. Freilos: Text „Freilos“. Platz-3-Spiel unter dem Finale, abgesetzt.

**Gruppen-Panel (Drag-and-drop).** Team als Chip-ähnliche Karte (8 px Radius, 1 px Rand) in Spalten je Gruppe. Greifen: Schatten wie Modal, Cursor „grabbing“. Gültige Ablagefläche: gestrichelter 2-px-Rand `--primary`, Hintergrund `--surface-raised`. Ungültig: Rand `--error`. Tastaturbedienung: Team wählen, Gruppe per Auswahlfeld zuweisen (Alternative zu Drag-and-drop). Button „Zufällig“ sekundär.

**Podium.** Drei Säulen, Höhen 100 % / 75 % / 60 % (Platz 1 mittig). Platz 1: `--accent`-Fläche mit `--on-accent`; Platz 2 und 3: `--surface-raised`. Platz-Ziffer in Playfair 700 (Ausnahme zur Zahlenregel, da Ziffern 1–3 groß und einzeln stehen und mit `font-variant-numeric: lining-nums` gesetzt werden). Teamname darunter, Spielernamen als Nebeninformation. Keine Konfetti-Effekte.

## Beamer

- **Reine Anzeige:** Kein Cursor (`cursor: none`), keine Bildlaufleisten, kein Hover, keine anklickbaren Elemente außer der einmaligen Tonfreigabe („Zum Aktivieren des Tons klicken“, großer sekundärer Button, verschwindet danach).
- **Raster:** 1920×1080, 48 px Rand, Inhalt füllt die Fläche. Kein Scrollen; lange Listen werden in Spalten aufgeteilt oder auf mehrere Rotationsseiten verteilt.
- **Kopfzeile** (80 px): Turniername links (Playfair 700, 36 px), Runde/Durchgang rechts (Source Sans 3, 28 px).
- **Timer-Ansicht:** Timer zentriert (240 px), darunter Fortschrittsbalken (Höhe 12 px, 100 % Breite) und darunter die Partien je Tisch in einem Raster (bis 4 Spalten): Tischnummer, Team A, „gegen“, Team B.
- **Tabellenansicht:** Spaltenzahl nach Gruppenzahl: 1 Gruppe = 1 Spalte, 2 = 2, 4 = 2×2, 8 = 4×2. Teamnamen einzeilig, bei Platzmangel Auslassungspunkte; Zeilenhöhe nie unter 44 px.
- **Baumansicht:** Skaliert auf die Fläche; Schrift bleibt ≥ 28 px, bei vielen Stufen wird der Baum in Hälften (oben/unten) geteilt.
- **Rotation:** Wechsel per Überblendung 300 ms (entfällt bei `prefers-reduced-motion`).
- **Verbindungsverlust:** Dezenter Rand und Text „Verbindung wird wiederhergestellt …“ (`--warning`); letzter Stand bleibt sichtbar, Timer läuft lokal weiter.

## Motion

Übergänge 150 ms (Buttons, Hover), 300 ms (Fortschritt, Überblendung). Keine dekorativen Animationen. Einzige Dauer-Animation: Pulsieren der letzten Timer-Warnstufe. `prefers-reduced-motion: reduce` schaltet Übergänge über 0 ms und das Pulsieren ab.

## Do's and Don'ts

- Terrakotta (`--primary`) nur für interaktive Elemente und aktive Zustände, nie als Dekoration.
- Raster von 4 px konsequent einhalten.
- Playfair nur für Überschriften und die Gruppenbuchstaben, Source Sans 3 für alles andere, besonders für Zahlen.
- Warmen Ton halten: keine kühlen Grautöne, kein reines Schwarz oder Weiß (Ausnahme: `--on-primary` `#FFFFFF`).
- Amber sparsam: Hinweise und „läuft gerade“.
- Pro Ansicht eine Primäraktion; **Ausnahme**: jede Partiekarte in der Ergebniseingabe hat ihren eigenen „Speichern“-Button.
- Nicht mehr als die festgelegten Gewichte (Playfair 700, Source Sans 400 und 600).
- Radien nicht mischen: Buttons 8 px, Karten 12 px.
- Keine Dekoration, keine Schatten und keine Hover-Effekte auf dem Beamer.
- Weißen Text nicht auf Amber, Warning oder `--success` setzen.
- Farbe nie als einziges Zeichen: Status immer mit Text oder Symbol.

## Umsetzung

- Tokens als CSS-Variablen in `packages/web/src/shared/ui/tokens.css` (`:root` hell, `[data-theme="dark"]` dunkel); Komponenten greifen nur auf Variablen zu, nie auf Hex-Werte.
- Basiskomponenten in `packages/web/src/shared/ui/`. Reines CSS bzw. CSS-Module; keine zusätzliche Styling-Bibliothek ohne ADR.
- Kontrastwerte in dieser Datei sind berechnet (WCAG 2.x). Ändert sich ein Token, sind die betroffenen Paare neu zu prüfen.
