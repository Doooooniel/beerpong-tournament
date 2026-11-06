# @bierpong/server

Fastify-Server: HTTP-API, WebSocket-Hub, SQLite-Ereignisspeicher, Login, Timer-Planung. Liefert im Produktivbetrieb `packages/web/dist` aus.

Struktur, Protokoll und Schema: siehe `docs/ARCHITECTURE.md` → „server“, „WebSocket-Protokoll“, „Datenbank“.

Konfiguration über Umgebungsvariablen: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (./data).
