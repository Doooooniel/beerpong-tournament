# 0026 – Undo-Kaskade, Protokoll im Zustand, Modus und Gruppenanzahl in Settings

- Status: Akzeptiert
- Datum: 2026-11-06

## Kontext
M19 verlangt Rückgängig (letzte Aktion und gezielt aus dem Protokoll) mit Warnung bei abhängigen späteren Ereignissen; M20 ein Änderungsprotokoll. ARCHITECTURE gibt `decide(state, command, ctx)` vor – ohne Ereignisliste kann `decide` aber weder die letzte Aktion noch Abhängigkeiten bestimmen. Außerdem fehlen in `Settings` der Modus (M04) und die Gruppenanzahl (M05), und der Standard für `advancersPerGroup` (M10) hängt von Gruppengrößen ab, die beim Anlegen noch nicht feststehen.

## Entscheidung
1. **Protokoll im Zustand:** `TournamentState.log` enthält alle Ereignisse in `seq`-Reihenfolge mit Flag `undone`. Es dient `decide` (undo, Abhängigkeiten) und dem Protokoll im Adminpanel und geht mit dem Vollzustand an die Clients (ADR 020). `apply(state, Undone)` baut den fachlichen Zustand aus dem Log neu auf.
2. **Kaskade:** Hängen spätere aktive Ereignisse vom Ziel ab (`undo/dependents.ts`, transitiv), liefert `decide` ohne `confirm: true` den Fehler `UNDO_HAS_DEPENDENTS` mit deren IDs. Mit Bestätigung entsteht **ein** `Undone`-Ereignis: `undoes` = Ziel, `payload.cascade` = abhängige Ereignis-IDs. Ziel und Kaskade werden gemeinsam aufgehoben und gemeinsam wiederhergestellt.
3. **Wirksamkeit:** Ein Ereignis ist aufgehoben, wenn ein wirksames `Undone` es als Ziel oder in der Kaskade nennt. Berechnung rückwärts über das Log (O(n)). Ein `Undone` auf ein `Undone` stellt wieder her (Redo).
4. **`undo` (letzte Aktion)** zielt auf das jüngste wirksame Ereignis, das weder `Undone` noch Beamer-Steuerung (`BeamerModeSet`, `BeamerViewSet`) ist. Wiederholtes `undo` geht weiter zurück. `undoEvent` zielt beliebig.
5. **Redo nur ohne neuere Aktionen:** Wiederherstellen ist nur erlaubt, wenn nach dem `Undone` keine wirksamen Ereignisse außer `Undone` und Beamer-Steuerung liegen; sonst `REDO_NOT_POSSIBLE`. Das verhindert Widersprüche (z. B. zwei Ergebnisse für dieselbe Partie).
6. **Settings:** neue Felder `mode: 'groupsKo' | 'koOnly'` (Standard `groupsKo`) und `groupCount: number` (Zweierpotenz ≥ 1, Standard 2), änderbar per `updateSettings` bis zum Start. `advancersPerGroup: number | null`; `null` = Standard nach SPEC-Formel, berechnet beim Start.

## Alternativen
- Undo verweigern, solange Abhängige bestehen: sicher, aber am Turniertag umständlich (Admin müsste rückwärts einzeln aufheben).
- Ein `Undone` je abhängigem Ereignis: Redo müsste mehrere Ereignisse wieder zusammenführen; Protokoll wird unübersichtlich.
- Ereignisliste als viertes Argument von `decide`: Zustand schlanker, aber das Protokoll bräuchte einen eigenen Übertragungsweg.
- Modus/Gruppenanzahl nur bei `createTournament`: keine Korrektur vor dem Start möglich.
- `advancersPerGroup` immer als Zahl: unklar, ob der Admin den Wert bewusst gesetzt hat.

## Konsequenzen
- Broadcast wächst mit der Zahl der Ereignisse (bei 64 Teams wenige hundert, unkritisch für N06).
- Undo nach `apply` erfordert einen Neuaufbau aus dem Log statt einer inkrementellen Änderung.
- SPEC → „Einstellungen“ wird um `mode`, `groupCount` und `advancersPerGroup: number | null` ergänzt.
