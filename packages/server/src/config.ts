export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => ({
  port: Number(env['PORT'] ?? 3000),
  host: env['HOST'] ?? '127.0.0.1',
  dataDir: env['DATA_DIR'] ?? './data',
});
