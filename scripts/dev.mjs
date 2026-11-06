// Startet Server (tsx watch) und Vite parallel; beendet beide gemeinsam.
import { spawn, spawnSync } from 'node:child_process';

const tasks = [
  ['server', 'npm run dev -w @bierpong/server'],
  ['web', 'npm run dev -w @bierpong/web'],
];

let stopping = false;
const shutdown = (code) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    // Unter Windows trifft kill() nur die cmd-Shell; /T beendet auch Vite bzw. tsx darunter.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else child.kill();
  }
  process.exitCode = code;
};

// Feste Befehlszeilen ohne Nutzereingaben; die Shell wird für npm.cmd unter Windows gebraucht.
const children = tasks.map(([name, command]) => {
  const child = spawn(command, { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    console.log(`[${name}] beendet (${code ?? 'signal'})`);
    shutdown(code ?? 0);
  });
  return child;
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
