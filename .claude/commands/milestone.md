---
description: Nächsten offenen Meilenstein aus docs/PLAN.md umsetzen
argument-hint: [Meilenstein, z. B. M3]
---

1. Lies `CLAUDE.md`, `docs/PLAN.md`, `docs/SPEC.md` und `docs/ARCHITECTURE.md`. Für UI-Meilensteine zusätzlich `DESIGN.md`.
2. Wähle den Meilenstein `$ARGUMENTS`, sonst den ersten mit offenen Checkboxen. Notiere den aktuellen Commit als Basis (`git log -1 --format=%h`).
3. Skizziere den Plan in wenigen Punkten (Dateien, Tests, betroffene SPEC-IDs, welche Subagenten du wann einsetzt) und warte auf Bestätigung.
4. Betrifft der Meilenstein Regeln in core (M2, M3): Rufe für jede Regelgruppe zuerst den Subagenten `test-writer` auf. Zeige dem Nutzer seinen Bericht, besonders Unklarheiten in der SPEC, und kläre sie, bevor du implementierst.
5. Setze Punkt für Punkt um, bis die Tests grün sind.
6. Nach jedem Punkt `npm run check`, dann Checkbox abhaken und committen (`feat(scope): … (IDs)`).
7. Rufe am Ende den Subagenten `reviewer` mit dem Basis-Commit auf. Behebe alles unter „Muss behoben werden“ und lass erneut prüfen.
8. Führe `/ponytail-review` aus und übernimm nur Vorschläge, die den Architekturregeln nicht widersprechen.
9. Abschluss: Zeige den Reviewer-Bericht und fasse kurz zusammen, was fertig ist und was offen bleibt.
