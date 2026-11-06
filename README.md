# Bierpong-Turnier-Manager

Lokale Web-App zum Ausrichten eines Bierpong-Turniers mit Gruppenphase und KO-Runde, Timer, Adminpanel und Beamer-Ansicht.

## Start

Voraussetzung: Node.js LTS.

```
npm install
npm start
```

- Adminpanel: http://localhost:3000/admin
- Beamer (Vollbild auf zweitem Bildschirm): http://localhost:3000/beamer

## Für Entwickler

- Arbeitsanweisungen für Claude Code: `CLAUDE.md`
- Spezifikation: `docs/SPEC.md`
- Architektur: `docs/ARCHITECTURE.md`
- Plan: `docs/PLAN.md`
- Entscheidungen: `docs/adr/README.md`
- Gestaltung: `DESIGN.md`

## Einrichtung Claude Code

Einmalig:

1. Node.js LTS und Claude Code installiert haben.
2. Language Server für das TypeScript-Plugin installieren:
   ```
   npm i -g typescript typescript-language-server
   ```
3. Zip entpacken, `DESIGN.md` in den Projektstamm legen.
4. Git einrichten und den Ausgangsstand sichern (der Reviewer vergleicht gegen Commits):
   ```
   cd bierpong
   git init
   git add .
   git commit -m "chore: project scaffold"
   ```
5. Im Ordner `claude` starten und dem Ordner vertrauen. Claude Code fragt dann, ob die in `.claude/settings.json` hinterlegten Plugins und der Ponytail-Marktplatz installiert werden sollen.
   - Offiziell (claude-plugins-official): typescript-lsp, context7, playwright, commit-commands
   - Community: ponytail (`DietrichGebert/ponytail`) – Repo vorher kurz prüfen. Voraussetzung: `node` im PATH (Hooks). Standardmodus in `~/.config/ponytail/config.json` (Windows: `%APPDATA%\ponytail\config.json`) auf `{"defaultMode":"full"}` setzen, nie `ultra`
6. `/reload-plugins` ausführen. Mit `/agents` prüfen, dass `reviewer` und `test-writer` gelistet sind.

Jeder Meilenstein:

1. Mit Shift+Tab in den Plan-Modus wechseln.
2. `/milestone` eingeben (oder gezielt `/milestone M3`).
3. Plan lesen, bei Bedarf nachsteuern, dann freigeben.
4. Während der Arbeit Freigaben erteilen, wenn Claude fragt.
5. Am Ende Reviewer-Bericht lesen, `git log` ansehen, dann selbst `git push`.

Subagenten: `test-writer` schreibt in M2/M3 die Regeltests aus der SPEC, `reviewer` prüft am Ende jedes Meilensteins. Beide sind in `.claude/agents/` definiert.
