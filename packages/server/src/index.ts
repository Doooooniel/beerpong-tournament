import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp();

await app.listen({ port: config.port, host: config.host });
console.log(`Bierpong-Server läuft auf http://${config.host}:${config.port}`);
