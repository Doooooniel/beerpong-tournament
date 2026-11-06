# ADRs

Alle bisherigen Entscheidungen kompakt. Neue ADRs als eigene Datei `NNNN-titel.md` nach der Vorlage unten anlegen (Slash-Befehl `/adr`) und hier in die Tabelle eintragen.

| Nr | Titel | Status | Entscheidung |
|---|---|---|---|
| 001 | Lokales Hosting, ein Gerät | Akzeptiert | Server, DB, beide Ansichten auf einem Rechner |
| 002 | SQLite | Akzeptiert | Eine Datei, alle Turniere |
| 003 | Echtzeit per Server-Push | Akzeptiert | Server pusht Zustand an alle Ansichten |
| 004 | Globaler Timer pro Durchgang, serverseitig | Akzeptiert | Start/Dauer/Pausen gespeichert, Clients rechnen |
| 005 | Punkte 3/2/1/0 | Akzeptiert | Nur Gruppenphase |
| 006 | Tiebreaker-Kette | Akzeptiert | Direkter Vergleich → Becherdifferenz → Stechen, mit Grund |
| 007 | Becherdifferenz optional | Akzeptiert | Pro Turnier an/aus |
| 008 | Gruppen = 2^k, Freilose bei Lücken | Akzeptiert | Gesamtpunktzahl zählt |
| 009 | KO über Kreuz | Akzeptiert | A1–B2; Freilose zufällig |
| 010 | KO-Gleichstand: nächster Becher | Akzeptiert | HF/Finale ohne Limit |
| 011 | Ereignisprotokoll für Rückgängig | Akzeptiert | Undo = Gegenereignis |
| 012 | Tabellen berechnet | Akzeptiert | Keine gespeicherten Tabellen |
| 013 | Passwort pro Turnier | Akzeptiert | Ein Schiri pro Gerät |
| 014 | TypeScript-Monorepo | Akzeptiert | npm Workspaces: core, server, web |
| 015 | React + Vite | Akzeptiert | Kein Next.js (keine nativen WebSockets, SSR nutzlos) |
| 016 | Fastify | Akzeptiert | Statt Express/Hono |
| 017 | Rohe WebSockets | Akzeptiert | @fastify/websocket, eigenes JSON-Protokoll; kein Socket.IO |
| 018 | Drizzle + better-sqlite3 | Akzeptiert | Kein Prisma |
| 019 | Ereignisspeicher als einzige Quelle | Akzeptiert | Zustand = replay(events) |
| 020 | Vollständiger Zustand statt Diffs | Akzeptiert | Broadcast mit Version |
| 021 | Zufall im Ereignis speichern | Akzeptiert | Reducer deterministisch |
| 022 | Zod für Befehle | Akzeptiert | Schema in core, genutzt von server und web |
| 023 | Ein Prozess, ein Port | Akzeptiert | 3000, Host 127.0.0.1; LAN später via 0.0.0.0 |
| 024 | Login pro Turnier, Liste öffentlich | Akzeptiert | Passwort beim Anlegen; Liste ohne Login, Sitzung je Turnier |
| 025 | Status abgeleitet, KO-Baum komplett im Ereignis | Akzeptiert | Kein Statusereignis; `advancePhase` erzeugt den vollständigen Baum |

## Vorlage

```markdown
# NNNN – Titel

- Status: Vorgeschlagen | Akzeptiert | Ersetzt durch NNNN
- Datum: YYYY-MM-DD

## Kontext
Was zwingt zur Entscheidung? Bezug auf SPEC-IDs.

## Entscheidung
Was wird gemacht.

## Alternativen
Was wurde verworfen und warum.

## Konsequenzen
Positiv, negativ, was sich dadurch ändert.
```
