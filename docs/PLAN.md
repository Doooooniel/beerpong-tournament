# PLAN – Meilensteine

Jeder Meilenstein endet mit grünem `npm run check`. Checkboxen abhaken, sobald erledigt.

## M1 Gerüst
- [x] npm Workspaces (`packages/*`), `tsconfig.base.json` (strict), Projekt-Referenzen
- [x] ESLint + Prettier, Vitest-Workspace, Skripte `dev`, `start`, `test`, `e2e`, `check`, `db:generate`
- [x] Leere Pakete core/server/web mit je einem Smoke-Test

## M2 core – Domäne
- [ ] `domain/types.ts`, `result.ts`
- [ ] Befehle + Ereignisse mit Zod (Startumfang aus ARCHITECTURE.md)
- [ ] `decide`, `apply`, `replay`
- [ ] Undo / Redo über `Undone`, `undo/dependents.ts` (M19, A5)

## M3 core – Regeln
- [ ] Gruppenverteilung manuell + zufällig (M05)
- [ ] Rundenturnier mit Freilosen (M06)
- [ ] Tische und Durchgänge (M15)
- [ ] Punkte 3/2/1/0 (M08)
- [ ] Tiebreaker-Kette mit `rankReason`, Stechen (M09)
- [ ] Validierung Gruppen × Weiterkommende = 2^k (M10)
- [ ] KO-Baum Über-Kreuz, zufällige Freilose, Platz 3 optional (M11, S04)
- [ ] KO-Regeln: kein `draw`, Zeitlimit je Stufe, HF/Finale ohne Limit (M12, M14)
- [ ] Timer-Mathematik + Warnstufen (M13, S03)

## M4 server
- [ ] Drizzle-Schema + Migration, Event-Store mit Transaktion
- [ ] Konfiguration (PORT/HOST/DATA_DIR) per Zod prüfen, klarer Abbruch bei ungültigen Werten; verständlicher Fehler, wenn das better-sqlite3-Binding fehlt
- [ ] SQLite-Pragmas beim Öffnen: WAL, synchronous NORMAL, foreign_keys (R6)
- [ ] Login (scrypt, Cookie) (M17)
- [ ] WebSocket-Hub, Protokoll, Command-Handler
- [ ] Wiederherstellung nach Neustart inkl. Timer-Planung (N03)
- [ ] Export JSON (S07)

## M5 web – Grundlage
- [ ] Router `/admin`, `/beamer`, WS-Client mit Reconnect, Store
- [ ] `useRemaining`, i18n `de.ts`
- [ ] Basis-UI nach `DESIGN.md`

## M6 web – Admin
- [ ] Login, Turnierliste (M01)
- [ ] Teams + Spieler, Tischanzahl (M02, M03)
- [ ] Gruppen-Panel mit Drag-and-drop + „Zufällig“ (M05)
- [ ] Spielplan, Durchgang starten, Tische tauschen (M15, M16)
- [ ] Timer-Steuerung (M13)
- [ ] Ergebniseingabe ≤ 2 Klicks, optional Becher (M07, S01, N08)
- [ ] Stechen erfassen (M09)
- [ ] Protokoll + gezieltes Rückgängig (M19, M20)
- [ ] Beamer-Steuerung: Modus, Ansicht, Intervall (S06)
- [ ] Einstellungen

## M7 web – Beamer
- [ ] TimerView mit Partien je Tisch und Warnstufen
- [ ] StandingsView mit `rankReason`
- [ ] BracketView
- [ ] UpcomingView, abhängig von S02-Einstellung
- [ ] PodiumView (S05)
- [ ] Rotation / Fest, Ton-Freigabe
- [ ] Screen Wake Lock auf `/beamer`, Warnung im Adminpanel bei fehlender Unterstützung (R1)

## M8 Abschluss
- [ ] Playwright: Gruppen + KO, nur KO
- [ ] README für Veranstalter inkl. Checkliste vor dem Turnier: Energiesparen aus, Export als Sicherung, Ton freigeben (R1, R2, R6)
- [ ] README: Build-Tools für `better-sqlite3` je Betriebssystem, falls kein vorgebautes Paket passt; `allowScripts.better-sqlite3: false` erklären und manuellen Weg `npm rebuild better-sqlite3` nennen (R5)
- [ ] Performance-Check 64 Teams / 16 Tische (N06)
