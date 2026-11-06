# 0025 – Status abgeleitet, KO-Baum komplett im Ereignis

- Status: Akzeptiert
- Datum: 2026-11-06

## Kontext
M16 verlangt Status `preparing → running → finished` für Runden und Durchgänge. Architekturregeln 1 und 5 verbieten gespeicherte Zustandstabellen. `PhaseAdvanced` braucht einen auslösenden Befehl.

## Entscheidung
Status wird aus Ereignissen berechnet (kein `HeatStarted` = preparing; gestartet = running; alle Partien erfasst = finished). Der Befehl `advancePhase` erzeugt `PhaseAdvanced` mit dem vollständigen Baum aller Stufen; spätere Partien verweisen auf ihre Quellen (`winnerOf`, `loserOf`). Durchgänge von KO-Stufen werden berechnet; `TablesSwapped` überschreibt.

## Alternativen
Eigene Ereignisse `HeatFinished`/`RoundFinished`: Redundanz zu Ergebnissen, Gefahr von Widersprüchen bei Undo.

## Konsequenzen
Undo bleibt konsistent, da nichts doppelt gespeichert wird. Die Berechnung liegt in core und wird getestet.
