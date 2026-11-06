# ARCHITECTURE – Bierpong-Turnier-Manager (kompakt)

Ziel: ein Node-Prozess, ein Port (3000), SQLite-Datei, zwei Browser-Routen. Lesbare Langfassung mit Diagramm: Architektur-Dokument (Claude Docs).

## Schichten

```
web (React/Vite)  ──WebSocket──►  server (Fastify)  ──►  SQLite (events)
      │                                 │
      └──────────── import ─────────────┴──► core (reine Logik)
```

| Paket | Darf importieren | Verboten |
|---|---|---|
| `@bierpong/core` | zod | Node-APIs, I/O, `Date.now()`, `Math.random()`, React |
| `@bierpong/server` | core, fastify, drizzle, better-sqlite3 | React, web |
| `@bierpong/web` | core, react, zustand, react-router | server, Node-APIs |

## core – Modulübersicht

```
packages/core/src/
  domain/        types.ts (Tournament, Team, Table, Group, Round, Heat, Match, Settings, TournamentState)
  commands/      ein Zod-Schema + Typ je Befehl; index.ts exportiert Union `Command`
  events/        ein Zod-Schema + Typ je Ereignis (mit `v`); Union `DomainEvent`
  decide.ts      decide(state, command, ctx) → Result<NewEvent[], DomainError>   (NewEvent = Ereignis ohne seq)
  apply.ts       apply(state, event) → state   (rein)
  replay.ts      replay(events) → state        (überspringt aufgehobene)
  schedule/      roundRobin.ts, assignTables.ts
  bracket/       buildBracket.ts, crossSeeding.ts, byes.ts
  standings/     computeStandings.ts, tiebreak.ts
  timer/         remaining.ts, warnings.ts
  undo/          dependents.ts (welche späteren Ereignisse hängen ab)
  result.ts      Result<T,E>, ok(), err()
  index.ts       öffentliche API
```

`ctx` für `decide` liefert alles Nichtdeterministische vom Server: `{ now: number; random: () => number; newId: () => string }`. Ergebnisse von Zufall landen als Werte im Ereignis (z. B. `GroupsAssigned { assignment }`).

### Befehle (Startumfang)

`createTournament, updateSettings, addTeam, renameTeam, setPlayers, removeTeam (nur vor Start), setTableCount, assignTeamToGroup, randomizeGroups, startTournament, advancePhase, swapTables, startHeat, pauseTimer, resumeTimer, extendTimer, restartTimer, recordResult, recordPlayoff, setBeamerMode, setBeamerView, undo, undoEvent`

`advancePhase` (nur Gruppen + KO): erlaubt, wenn alle Gruppenpartien ein Ergebnis haben und keine Gruppe `needsPlayoff` meldet; erzeugt `PhaseAdvanced { bracket }`. Fehlercodes: `GROUP_STAGE_INCOMPLETE`, `PLAYOFF_REQUIRED`, `INVALID_ADVANCERS`. Es gibt keinen Befehl „Durchgang beenden“: Status ist abgeleitet (SPEC → Tische und Durchgänge).

### Ereignisse (Startumfang)

`TournamentCreated, SettingsUpdated, TeamAdded, TeamRenamed, PlayersSet, TeamRemoved, TableCountSet, TeamAssignedToGroup, GroupsAssigned, TournamentStarted (enthält Spielplan + ggf. Freilose), TablesSwapped, HeatStarted, TimerPaused, TimerResumed, TimerExtended, TimerRestarted, ResultRecorded, PlayoffRecorded, PhaseAdvanced (enthält generierten KO-Baum), BeamerModeSet, BeamerViewSet, Undone`

Jedes Ereignis: `{ id, seq, type, v, at, payload, undoes?: eventId }`.

`TournamentState.log` enthält alle Ereignisse mit Flag `undone` (Protokoll, Grundlage für `undo`). `Undone` hebt Ziel (`undoes`) und `payload.cascade` gemeinsam auf; Details in ADR 026.

## server

```
packages/server/src/
  index.ts           Start: Migrationen, Fastify, Static, WS, Timer-Wiederherstellung
  config.ts          PORT (3000), HOST (127.0.0.1), DATA_DIR (./data)
  db/schema.ts       Drizzle: tournaments, events, snapshots
  db/client.ts       better-sqlite3 + drizzle
  store/eventStore.ts  append (Transaktion, seq lückenlos), load(tournamentId)
  store/tournamentRegistry.ts  hält State im Speicher je offenem Turnier
  auth/              scrypt-Hash, Session-Cookie (httpOnly, SameSite=Strict)
  http/routes.ts     POST /api/login (je Turnier), GET /api/tournaments (öffentlich), POST /api/tournaments (öffentlich, Passwort wird gesetzt), GET /api/tournaments/:id/export (Sitzung)
  ws/protocol.ts     Zod-Schemas der WS-Nachrichten
  ws/hub.ts          Verbindungen je Turnier, broadcast(state)
  commands/handle.ts auth → validate → core.decide → eventStore.append → apply → broadcast
  timer/scheduler.ts setTimeout für Warnungen/Ablauf, sendet `timer`-Nachricht (nicht persistiert)
```

## WebSocket-Protokoll

| Richtung | type | payload |
|---|---|---|
| C→S | `hello` | `{ role: 'admin' \| 'beamer', tournamentId }` |
| C→S | `command` | `{ requestId, command }` – nur admin mit gültiger Session |
| S→C | `state` | `{ version, serverTime, state }` |
| S→C | `ack` | `{ requestId }` |
| S→C | `error` | `{ requestId?, code, message }` |
| S→C | `timer` | `{ heatId, kind: 'warning' \| 'expired', thresholdMs? }` |
| S→C | `tick` | `{ serverTime }` alle 10 s |

Reconnect im Client: exponentielles Backoff (0,5 s → max 5 s), nach Verbindung erneut `hello`.

## web

```
packages/web/src/
  main.tsx, App.tsx (Router)
  shared/ws/client.ts       Verbindung, Reconnect, send(command): Promise
  shared/store/useTournament.ts  Zustand-Store (state, version, serverOffset)
  shared/hooks/useRemaining.ts   Restzeit 4×/s aus Timerwerten + serverOffset
  shared/i18n/de.ts         alle UI-Texte
  shared/ui/                Basis-Komponenten nach DESIGN.md
  admin/pages/              Login, TournamentList, Setup, Groups, Schedule, Results, Beamer, Log, Settings
  admin/components/
  beamer/BeamerPage.tsx     Modus rotation/fixed
  beamer/views/             TimerView, StandingsView, BracketView, UpcomingView, PodiumView
  beamer/audio.ts           Web Audio, Freigabe per Klick
  beamer/wakeLock.ts        Screen Wake Lock: Bildschirm bleibt an; bei visibilitychange erneut anfordern
```

Beamer-Robustheit: `/beamer` fordert beim Laden und nach jedem Wiederanzeigen `navigator.wakeLock.request('screen')` an. Wird es nicht unterstützt oder abgelehnt, zeigt das Adminpanel eine Warnung („Energiesparen am Laptop deaktivieren“).

Dev: Vite (5173) proxyt `/api` und `/ws` an Fastify (3000). Prod: Fastify liefert `packages/web/dist` aus.

## Datenbank

```
tournaments(id TEXT PK, name TEXT, created_at INT, password_hash TEXT, version INT, archived INT)
events(id TEXT PK, tournament_id TEXT FK, seq INT, type TEXT, v INT, payload TEXT JSON, at INT, undoes TEXT NULL,
       UNIQUE(tournament_id, seq))
snapshots(tournament_id TEXT, seq INT, state TEXT JSON, PRIMARY KEY(tournament_id, seq))
```

Migrationen: drizzle-kit, beim Start automatisch angewendet.

SQLite-Einstellungen beim Öffnen: `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`. WAL macht die Datei robust gegen Abbrüche beim Schreiben; `-wal`- und `-shm`-Dateien in `data/` sind normal und gitignored.

`better-sqlite3` ist ein natives Modul. Für Node LTS gibt es vorgebaute Binärpakete; fehlen sie für eine Plattform, braucht `npm install` Build-Tools (Windows: Visual Studio Build Tools, macOS: Xcode Command Line Tools, Linux: build-essential, Python 3). `engines.node` in `package.json` auf die aktuelle LTS festlegen.

## Tests

- core: Vitest, Tabellentests mit festen Seeds, Ziel ≥ 90 % Abdeckung.
- server: Vitest + `:memory:`-SQLite; Befehl → Broadcast; Neustart-Wiederherstellung.
- web: Vitest + Testing Library.
- e2e: Playwright, 8 Teams / 2 Tische, beide Modi; zweiter Browser-Kontext als Beamer.
