# CLAUDE.md – Bierpong-Turnier-Manager

Lokal gehostete Web-App zum Ausrichten eines Bierpong-Turniers: Adminpanel (Steuerung) + Präsentationsansicht (Beamer), live synchronisiert.

## Pflichtlektüre vor jeder Aufgabe

| Datei | Wann lesen |
|---|---|
| `docs/SPEC.md` | Immer bei fachlichen Fragen. Anforderungs-IDs (M01, S03, F7.2 …) sind verbindlich. |
| `docs/ARCHITECTURE.md` | Immer vor Code-Änderungen. Schichten, Datenfluss, Protokoll. |
| `docs/PLAN.md` | Zu Beginn jeder Sitzung. Nächsten offenen Meilenstein bearbeiten, Checkboxen pflegen. |
| `docs/adr/README.md` | Vor jeder Technologie- oder Strukturentscheidung. |
| `DESIGN.md` | Vor jeder UI-Arbeit. Einzige Quelle für Farben, Typografie, Abstände, Komponentenstil. |

Fehlt `DESIGN.md`, keine Gestaltung erfinden: neutrale Platzhalter-Styles verwenden und den Nutzer darauf hinweisen.

## Stack (fest, siehe ADR 014–023)

TypeScript strict · npm Workspaces · Node.js LTS · Fastify + @fastify/websocket · SQLite via better-sqlite3 + Drizzle ORM · Zod · React + Vite + React Router · Zustand · Vitest · Testing Library · Playwright · ESLint + Prettier.

Kein Next.js, kein Socket.IO, kein Prisma, keine zusätzlichen Frameworks ohne neues ADR.

Neue Abhängigkeiten: vorher begründen (Name, Zweck, warum Bordmittel nicht reichen) und auf Zustimmung warten. `npm install <paket>` und Änderungen an `package.json` sind absichtlich zustimmungspflichtig.

## Plugins und Vorrang

Aktiv im Projekt: `typescript-lsp` (Diagnosen nach jeder Änderung beachten), `context7` (aktuelle Doku zu Fastify, Drizzle, React Router, Vite nachschlagen statt raten), `playwright` (E2E-Tests und Beamer-Ansicht im Browser prüfen), `commit-commands`, `ponytail`.

- **Ponytail** nur im Modus `full` oder `light`, nie `ultra`. Am Ende jedes Meilensteins `/ponytail-review` ausführen.
- **Vorrang bei Konflikten:** Architekturregeln dieser Datei und ADRs > SPEC > DESIGN.md > Plugin-Vorgaben (Minimalismus, Stil, Design). Ereignisspeicher, reines core-Paket, Zod-Schemas und Undo über Gegenereignisse sind gewollte Struktur und werden nicht „wegvereinfacht“.
- Plugin-Empfehlungen zu neuen Paketen gelten als neue Abhängigkeit (siehe oben).

## Kontrollpunkte für den Nutzer

- Neue Meilensteine im Plan-Modus beginnen: Plan vorlegen, erst nach Freigabe ändern.
- Zustimmungspflichtig (über Berechtigungen abgesichert, per Shell umgehbar – nicht tun): neue Pakete, `package.json`, `CLAUDE.md`, `DESIGN.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/adr/**`, `.claude/**`.
- Gesperrt: `git push`, `git reset --hard`, `rm -rf`, Zugriff auf `data/`.
- Commits sind erlaubt, Push macht der Nutzer selbst.

## Struktur

```
packages/core/    reine Turnierlogik – KEINE Imports aus server/web, kein I/O, kein Date.now(), kein Math.random()
packages/server/  Fastify, WebSocket, SQLite, Auth, Timer-Planung
packages/web/     React-App: /admin und /beamer
docs/             Spezifikation, Architektur, Plan, ADRs
data/             SQLite-Datei (gitignored)
```

Abhängigkeiten nur: `web → core`, `server → core`. Niemals `core → *` oder `web ↔ server` per Import.

## Architekturregeln (nicht verhandelbar)

1. **Ereignisspeicher ist die einzige Wahrheit.** Zustand = Reduktion aller nicht aufgehobenen Ereignisse. Keine Zustandstabellen.
2. **Jede Änderung ist ein Befehl.** Ablauf: WS-Nachricht → Zod-Validierung → `core.decide(state, command)` → Ereignis(se) → Transaktion in SQLite → `core.apply` → Broadcast `state`.
3. **Rückgängig = Ereignis `Undone`** mit Verweis. Nie Ereignisse löschen oder ändern.
4. **Determinismus:** Zufall (Gruppen, Freilose) und Zeit werden beim Befehl im Server erzeugt und als Werte ins Ereignis geschrieben. Der Reducer ist rein.
5. **Tabellen/Platzierungen nie speichern**, immer in core berechnen (inkl. Begründung des Tiebreakers).
6. **Timer:** nur `durationMs`, `startedAt`, `pausedAt`, `pausedTotalMs` speichern. Clients rechnen Restzeit selbst.
7. **Broadcast = vollständiger Zustand** mit `version`. Keine Diffs.
8. **Beamer ist read-only.** Er sendet nur `hello`, niemals `command`.

## Fachregeln (Kurzfassung – Details in SPEC.md)

- Punkte Gruppenphase: Sieg 3 · Sieg durch Zeit 2 · Unentschieden 1 · Niederlage 0 · Freilos 0. Gewertet wird die Gesamtpunktzahl.
- Tiebreaker: direkter Vergleich → Becherdifferenz (nur wenn erfasst) → Stechen. Grund immer ausgeben.
- Gruppenanzahl = Zweierpotenz. Gruppen × Weiterkommende = Zweierpotenz (Standard: Hälfte weiter).
- KO: Über-Kreuz-Setzung (A1–B2). Freilose immer zufällig. Bei Gleichstand nach Zeit: „nächster Becher gewinnt“ → nur Sieger erfassen. Kein Unentschieden im KO.
- Halbfinale, Platz 3, Finale: ohne Zeitlimit.
- Ein Timer pro Durchgang; Admin startet jeden Durchgang manuell. Vorwarnungen Standard 5 min / 1 min / 30 s.
- Teams nach Start: umbenennen/Spieler ändern ja, hinzufügen/entfernen/tauschen nein.
- Ein Schiri pro Gerät, Login nur mit Turnierpasswort.

## Konventionen

- Code, Bezeichner, Commits: Englisch. UI-Texte und Doku: Deutsch. UI-Texte zentral in `packages/web/src/shared/i18n/de.ts`.
- Dateinamen kebab-case, React-Komponenten PascalCase.
- Keine `any`. Keine Default-Exports außer React-Seiten.
- Befehle und Ereignisse: `packages/core/src/commands/*` und `packages/core/src/events/*`, je ein Zod-Schema + Typ.
- Fehler in core: `Result<T, DomainError>` zurückgeben, keine Exceptions für fachliche Fehler.
- Neue Ereignistypen bekommen eine `v`-Nummer.

## Arbeitsweise

1. Meilenstein aus `docs/PLAN.md` wählen, Plan kurz skizzieren. Basis-Commit des Meilensteins notieren.
2. **core zuerst testgetrieben**: Regeltests schreibt der Subagent `test-writer` aus der SPEC, ohne die Implementierung zu kennen. Danach implementierst du, bis seine Tests grün sind. Seine Tests änderst du nur nach Rückfrage beim Nutzer.
3. Nach jeder Aufgabe `npm run check` ausführen. Nicht als erledigt melden, solange es rot ist.
4. Checkbox in `docs/PLAN.md` abhaken, Anforderungs-IDs im Commit nennen (`feat(core): tiebreaker chain (M09)`).
5. Am Ende jedes Meilensteins den Subagenten `reviewer` mit dem Basis-Commit aufrufen. Punkte unter „Muss behoben werden“ beheben, dann erneut prüfen lassen. Seinen Bericht dem Nutzer zeigen.
6. Weicht etwas von SPEC oder ARCHITECTURE ab: anhalten und fragen, oder ADR mit `/adr` vorschlagen.

## Subagenten

| Name | Wann | Darf |
|---|---|---|
| `test-writer` | M2, M3: vor jeder neuen core-Regel | Nur `packages/core/**/*.test.ts` schreiben; keine Implementierung lesen |
| `reviewer` | Ende jedes Meilensteins, auf Wunsch | Nur lesen, `git diff/log`, `npm run check` |

Beim Aufruf immer sagen, welcher Subagent was tut. Keine weiteren Subagenten anlegen ohne Zustimmung des Nutzers.

## Befehle

```
npm install          # einmalig
npm run dev          # Server (watch) + Vite mit Proxy
npm start            # Build + Produktion auf http://localhost:3000
npm test             # Vitest, alle Pakete
npm run e2e          # Playwright
npm run check        # typecheck + lint + test – muss grün sein
npm run db:generate  # Drizzle-Migration erzeugen
```
