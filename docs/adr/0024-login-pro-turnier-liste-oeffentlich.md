# 0024 – Login pro Turnier, Turnierliste öffentlich

- Status: Akzeptiert
- Datum: 2026-11-06

## Kontext
ADR 013 vergibt ein Passwort pro Turnier. Turnierliste und „Turnier anlegen“ (M01) kommen aber vor der Wahl eines Turniers; M17 verlangt Passwortschutz des Adminpanels.

## Entscheidung
`GET /api/tournaments` und `POST /api/tournaments` erfordern keinen Login. Das Passwort wird beim Anlegen vergeben (scrypt-Hash, nicht leer). Login erfolgt je Turnier über `POST /api/login`; die Sitzung gilt nur für dieses Turnier. Die Liste enthält nur `id, name, createdAt, archived`.

## Alternativen
Globales Installationspasswort zusätzlich zum Turnierpasswort: mehr Aufwand ohne Nutzen, solange der Server nur auf localhost lauscht (ADR 023).

## Konsequenzen
Einfacher Ablauf für den Veranstalter. Mit LAN-Betrieb (K01) sehen alle im Netz die Turniernamen; dann neu bewerten.
