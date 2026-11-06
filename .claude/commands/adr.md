---
description: Neues ADR anlegen
argument-hint: <Titel der Entscheidung>
---

Lege ein neues ADR für „$ARGUMENTS“ an.

1. Nächste freie Nummer aus `docs/adr/README.md` ermitteln.
2. Datei `docs/adr/NNNN-<kebab-titel>.md` nach der Vorlage in `docs/adr/README.md` anlegen, Status „Vorgeschlagen“, heutiges Datum.
3. Kontext mit Bezug auf SPEC-IDs füllen, mindestens eine Alternative nennen.
4. Zeile in der Tabelle in `docs/adr/README.md` ergänzen.
5. Dem Nutzer die Entscheidung in zwei Sätzen vorlegen und auf Bestätigung warten, bevor Code danach geändert wird.
