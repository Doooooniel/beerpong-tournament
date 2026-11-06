# SPEC – Bierpong-Turnier-Manager (kompakt)

Stand: 2026-11-06. Lesbare Langfassung: Pflichtenheft (Claude Docs). Bei Widerspruch gilt diese Datei, bis sie aktualisiert ist.

## Begriffe

- **Turnier**: Konfiguration + Teams + Phasen + Ereignisse. Mehrere Turniere pro Installation.
- **Team**: Name + 1..n Spieler (keine Regeln zur Anzahl).
- **Tisch**: nur Nummer (1..n).
- **Runde**: Spieltag der Gruppenphase oder KO-Stufe.
- **Durchgang (heat)**: Teil einer Runde, wenn Partien > Tische. Ein Timer pro Durchgang.
- **Partie (match)**: Team A vs. Team B an einem Tisch.
- **Freilos (bye)**: spielfrei, 0 Punkte.
- **Stechen (playoff)**: Entscheidungsspiel bei unaufgelöstem Gleichstand; Form frei, Admin trägt Sieger ein.

## Muss (M)

| ID | Anforderung |
|---|---|
| M01 | Turniere anlegen, speichern (SQLite), wieder öffnen, mehrere Turniere |
| M02 | Tischanzahl einstellbar |
| M03 | Teams mit Name + flexibler Spielerzahl; nach Start nur Name/Spieler änderbar |
| M04 | Modus: Gruppen + KO oder nur KO |
| M05 | Gruppenanzahl ∈ {1,2,4,8,…}; Zuteilung per Drag-and-drop-Panel oder Button „Zufällig“ |
| M06 | Gruppen: jeder gegen jeden, einfach; Freilose bei ungleicher Gruppengröße |
| M07 | Ergebnis: Sieg A · Sieg B · Sieg durch Zeit A · Sieg durch Zeit B · Unentschieden |
| M08 | Punkte: 3 / 2 / 1 / 0 (Gruppenphase) |
| M09 | Tiebreaker: direkter Vergleich → Becherdifferenz (falls erfasst) → Stechen; Grund anzeigen |
| M10 | Weiterkommende je Gruppe einstellbar (Standard Hälfte); Gruppen × Weiterkommende = 2^k |
| M11 | KO-Baum Über-Kreuz (A1–B2); Freilose immer zufällig |
| M12 | Ein Timer pro Durchgang; Dauer je Phase; HF/P3/Finale ohne Limit |
| M13 | Timer: Start, Pause, Fortsetzen, Verlängern, Neustart |
| M14 | KO-Gleichstand nach Zeit: nächster Becher gewinnt → nur Sieger erfassen |
| M15 | Automatische Verteilung von Partien auf Tische/Durchgänge |
| M16 | Status Runde/Durchgang: preparing → running → finished |
| M17 | Adminpanel mit Passwort |
| M18 | Präsentationsansicht ohne Bedienelemente, Echtzeit-Sync |
| M19 | Rückgängig (letzte Aktion + gezielt aus Protokoll) |
| M20 | Änderungsprotokoll (was, wann) |
| M21 | Lokal ohne Internet lauffähig |

## Soll (S)

| ID | Anforderung |
|---|---|
| S01 | Becherdifferenz optional (pro Turnier an/aus, Standard aus) |
| S02 | „Nächste Spiele“ auf Beamer; Einstellung aus → nur in Phase `preparing` sichtbar |
| S03 | Ton bei Ablauf + Vorwarnungen (einstellbar, Standard 5 min, 1 min, 30 s), an/aus |
| S04 | Spiel um Platz 3, einstellbar |
| S05 | Podium-Ansicht |
| S06 | Beamer-Modi: `rotation` (Ansichten automatisch, Intervall einstellbar) und `fixed` (Admin wählt Ansicht); Admin schaltet um |
| S07 | Export als JSON |

## Kann (K)

K01 Mehrgeräte-Zugriff im LAN (mehrere Schiris) · K02 mobiles Adminpanel / App · K03 QR-Code Zuschaueransicht · K04 Internet-Hosting · K05 konfigurierbares Stechen · K06 Import · K07 Statistiken

**Nicht im Umfang:** Benutzerkonten, Online-Anmeldung, Zahlungen, Wurf-Erfassung, Doppel-KO.

## Regeln im Detail

### Ergebnis → Punkte (nur Gruppenphase)

| outcome | Sieger | Verlierer |
|---|---|---|
| `win` (alle Becher) | 3 | 0 |
| `winByTime` | 2 | 0 |
| `draw` (gleiche Becher bei Ablauf) | 1 | 1 |
| `bye` | 0 | – |

`draw` ist in KO-Phasen unzulässig (Validierungsfehler). Im KO zählt nur der Sieger; `win` und `winByTime` werden trotzdem gespeichert.

### Ergebnis-Payload

```ts
ResultRecorded.payload = {
  matchId: string,
  outcome: 'win' | 'winByTime' | 'draw',
  winnerTeamId?: string,          // Pflicht bei win/winByTime, verboten bei draw
  cups?: { a: number; b: number } // nur wenn settings.trackCups; ganze Zahlen ≥ 0
}
```

- `cups.a` = Anzahl Becher, die Team A getroffen hat; `cups.b` analog. Becherdifferenz eines Teams = Summe getroffen − Summe kassiert über alle Gruppenpartien.
- Ist `trackCups` an, ist `cups` in der Gruppenphase Pflicht und im KO optional (gespeichert, nicht gewertet).
- Validierung: `draw` ⇒ `cups.a === cups.b`; `win`/`winByTime` ⇒ `cups` des Siegers ist nicht kleiner als die des Verlierers; `draw` im KO ⇒ Fehler `DRAW_NOT_ALLOWED_IN_KNOCKOUT`.
- Freilose haben kein `ResultRecorded`; sie stehen mit `bye: true` im Spielplan und zählen 0 Punkte.
- Korrektur eines Ergebnisses = `undo` auf das Ereignis und neues `recordResult`, kein Überschreiben.

### Tabelle

Sortierung: Punkte desc → Tiebreaker-Kette. Tabellenzeile enthält `played, wins, winsByTime, draws, losses, points, cupDiff?, rank, rankReason`.

Tiebreaker bei Punktgleichheit von n Teams:
1. Mini-Tabelle nur aus Partien dieser n Teams (Punkte). Löst sie teilweise, Rest rekursiv erneut ab Schritt 1.
2. Becherdifferenz (gesamt) – nur wenn `settings.trackCups`.
3. Sonst `needsPlayoff` – Gruppe ist nicht abgeschlossen, bis ein Stechen-Ergebnis vorliegt.

`rankReason` ∈ `points | headToHead | cupDiff | playoff | tied`.

- Ein Stechen (`needsPlayoff`) ist nur nötig, wenn der unaufgelöste Gleichstand einen Platz ≤ q (Weiterkommende) berührt. Gleichstände dahinter teilen sich den Platz mit `rankReason: 'tied'`.

**Stechen**

```ts
PlayoffRecorded.payload = { groupId: string, tiedTeamIds: string[], winnerTeamId: string }
```

- `tiedTeamIds` sind genau die Teams, die die Kette nicht trennen konnte (mind. 2); `winnerTeamId` muss darin enthalten sein.
- Der Sieger erhält den besten freien Platz dieser Teilmenge mit `rankReason: 'playoff'`.
- Die übrigen Teams werden erneut ab Schritt 1 der Kette bewertet. Bleiben mehrere gleichauf, wird ein weiteres Stechen verlangt (`needsPlayoff`).
- Ein Stechen kann per `undo` aufgehoben werden; liegen spätere Stechen darauf, gilt die Abhängigkeitswarnung (M19).

### Gruppen

- Teams werden so verteilt, dass Gruppengrößen sich um max. 1 unterscheiden.
- Spielplan: Circle-Methode; bei ungerader Größe Dummy-Team = Freilos.
- Runde r der Gruppenphase = Runde r aller Gruppen gleichzeitig.
- Jede Gruppe hat mindestens 2 Teams (Fehlercode `GROUP_TOO_SMALL`).
- Weiterkommende je Gruppe `q` muss eine Zweierpotenz sein und `q ≤` Größe der kleinsten Gruppe; zusätzlich `Gruppen × q ≥ 2`. Verstoß: `INVALID_ADVANCERS`.
- Standardwert für `q`: größte Zweierpotenz ≤ ⌊kleinste Gruppengröße / 2⌋, mindestens 1 (2 Teams → 1; 3 → 1; 4 → 2; 5 → 2; 6 → 2; 8 → 4).

### Tische und Durchgänge

- Partien einer Runde → Durchgänge à `tableCount` Partien, in Reihenfolge Gruppe A, B, … .
- Tischnummer 1..n innerhalb des Durchgangs. Admin darf vor Start tauschen.
- Admin startet jeden Durchgang manuell. Durchgänge laufen streng nacheinander: Ein Durchgang kann erst gestartet werden, wenn der vorherige Durchgang (auch über Runden- und Phasengrenzen hinweg) `finished` ist.
- Ergebnisse können nur für Partien eines gestarteten Durchgangs erfasst werden (Fehler `HEAT_NOT_STARTED`); das Adminpanel bietet die Eingabe nur dort an. Freilos-Sieger im KO stehen ohne Ergebnis fest.

**Status (abgeleitet, nie gespeichert)**

- Durchgang: `preparing`, solange kein `HeatStarted` vorliegt; `running` ab `HeatStarted`; `finished`, sobald alle Partien ein Ergebnis haben (Freilose zählen als erledigt).
- Runde: `preparing`, wenn kein Durchgang gestartet ist; `finished`, wenn alle Durchgänge `finished` sind; sonst `running`.
- Ein abgelaufener Timer ändert den Status nicht; der Durchgang bleibt `running`, bis alle Ergebnisse erfasst sind.

### KO

- Teilnehmer = Gruppen × Weiterkommende (muss 2^k sein) bzw. alle Teams bei Nur-KO.
- **Setzregel (deterministisch, ohne Zufall):**
  1. Gruppen in Reihenfolge A, B, C, … zu Paaren (A,B), (C,D), … zusammenfassen. Bei einer einzelnen Gruppe entfällt das Paaren.
  2. Innerhalb eines Paares (X,Y) mit `q` Weiterkommenden entstehen genau `q` Partien: `Xk – Y(q+1−k)` für `k = 1..q` (für `q = 1` also `X1 – Y1`). Einzelne Gruppe mit `q` Teams: `Pk – P(q+1−k)` für `k = 1..q/2`.
  3. Baumreihenfolge: Partien so auf die Baumplätze verteilen, dass Teams derselben Gruppe möglichst spät aufeinandertreffen. (A,B)-Partien oben, (C,D)-Partien unten usw.; Platz 1 und 2 derselben Gruppe liegen in gegenüberliegenden Baumhälften.
  - Verbindliche Beispiele: 2 Gruppen, q=2: `A1–B2`, `B1–A2`. · 4 Gruppen, q=2: `A1–B2`, `C1–D2`, `B1–A2`, `D1–C2`. · 2 Gruppen, q=4: `A1–B4`, `A3–B2`, `B1–A4`, `B3–A2`. · 8 Gruppen, q=1: `A1–B1`, `C1–D1`, `E1–F1`, `G1–H1`. · 1 Gruppe, q=4: `P1–P4`, `P2–P3`.
- `PhaseAdvanced` (bei Nur-KO `TournamentStarted`) enthält den vollständigen Baum aller Stufen. Spätere Partien verweisen auf ihre Quellen (`winnerOf: matchId`, bei Platz 3 `loserOf: matchId`).
- Eine KO-Partie ist spielbar, sobald beide Quellen ein Ergebnis haben. Die Durchgänge einer KO-Stufe werden berechnet, sobald alle Partien der Stufe spielbar sind. Ein Freilos-Gewinner gilt sofort als Sieger. `TablesSwapped` wirkt als Überschreibung der berechneten Zuordnung.
- Nur-KO: alle Teams werden zufällig auf die Baumplätze gelost; bei n ≠ 2^k auf nächste 2^k auffüllen, Freilose zufällig verteilen, nie zwei Freilose in einer Partie (Ergebnis im Ereignis gespeichert).
- Zeitlimit je Stufe aus `settings.timerByPhase` (Schlüssel siehe „Einstellungen“); `semifinal`, `thirdPlace`, `final` = `null`.

### Timer

- Gespeichert: `durationMs | null`, `startedAt`, `pausedAt`, `pausedTotalMs`.
- remaining = durationMs − (now − startedAt − pausedTotalMs − (pausedAt ? now − pausedAt : 0)).
- Neustart setzt auf die Dauer aus `HeatStarted` zurück; Verlängerungen verfallen.
- Warnungen `settings.timerWarningsMs` (Standard `[300000, 60000, 30000]`).

### Einstellungen

```ts
Settings = {
  mode: 'groupsKo' | 'koOnly',           // Standard 'groupsKo' (M04)
  groupCount: number,                    // Zweierpotenz ≥ 1, Standard 2 (M05); bei 'koOnly' ignoriert
  trackCups: boolean,                    // Standard false (S01)
  thirdPlaceMatch: boolean,              // Standard false (S04)
  advancersPerGroup: number | null,      // null = Standard nach „Gruppen“, berechnet beim Start (ADR 026)
  timerByPhase: {
    group: number | null,                // ms, Standard 900000 (15 min)
    ko64: number | null, ko32: number | null, ko16: number | null,
    quarterfinal: number | null,         // Standard je 600000 (10 min)
    semifinal: null, thirdPlace: null, final: null   // fest null (M12)
  },
  timerWarningsMs: number[],             // Standard [300000, 60000, 30000]
  soundEnabled: boolean,                 // Standard true (S03)
  showUpcomingOnlyInPreparing: boolean,  // S02
  rotationIntervalMs: number             // Standard 15000
}
```

- KO-Stufen heißen nach der Zahl der verbleibenden Teams: 64 → `ko64`, 32 → `ko32`, 16 → `ko16`, 8 → `quarterfinal`, 4 → `semifinal`, 2 → `final`.
- `semifinal`, `thirdPlace`, `final` sind im Schema das Literal `null`; Setzen eines Wertes ist ein Validierungsfehler.

### Beamer-Ansichten

`timer` (Timer + aktuelle Partien je Tisch) · `standings` · `bracket` · `upcoming` · `podium`.
Rotation durchläuft `timer, standings, bracket, upcoming` (je nach Phase sinnvoll gefiltert), Intervall `settings.rotationIntervalMs` (Standard 15000).

### Admin & Protokoll

- Ein Passwort pro Turnier (scrypt-Hash), beim Anlegen vergeben, nicht leer. Ein Schiri pro Gerät.
- `GET /api/tournaments` und `POST /api/tournaments` erfordern keinen Login; die Liste enthält nur `id, name, createdAt, archived`.
- `POST /api/login { tournamentId, password }` setzt ein Session-Cookie, das nur für dieses Turnier gilt. Befehle über WebSocket und Export erfordern die Sitzung des Turniers; der Beamer braucht keine.
- Protokolleintrag: Zeit, Ereignistyp, Ziel, alter/neuer Wert, aufgehoben ja/nein.
- Korrektur eines Ergebnisses, von dem spätere KO-Partien abhängen → Warnung + Bestätigung.

## Nichtfunktional

N01 Sync < 1 s · N02 Timer-Abweichung < 0,5 s · N03 Neustart verliert nichts (inkl. Timer) · N05 Start mit `npm start` · N06 64 Teams / 16 Tische flüssig · N07 Beamer lesbar aus 5 m, 1920×1080 · N08 Ergebnis in ≤ 2 Klicks · N09 Passwort nur als Hash · N10 UI Deutsch, Texte zentral · N11 core ohne UI-Abhängigkeit, getestet · N12 LAN später ohne Umbau
