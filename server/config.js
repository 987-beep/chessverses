// Server configuration.
// Reads Insforge connection details from environment variables (set in the
// Insforge dashboard / .env). Falls back to sensible defaults for local dev.
import 'dotenv/config';

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

export const config = {
  // ---- Insforge (live production backend) ----
  insforgeBaseUrl: env('INSFORGE_BASE_URL', 'https://your-project.region.insforge.app'),
  insforgeApiKey: env('INSFORGE_API_KEY', 'ik_your-insforge-api-key-here'),

  // ---- Which backend to use ----
  // 'insforge' = live Insforge Postgres via the rawsql API
  // 'memory'   = in-process store (for local testing / no credentials)
  dbMode: env('DB_MODE', 'insforge'),

  // ---- HTTP server ----
  port: Number(env('PORT', 4000)),
  host: env('HOST', '0.0.0.0'),

  // ---- App ----
  appName: env('APP_NAME', 'ChessVerse'),
  sessionSecret: env('SESSION_SECRET', 'chessverse-dev-secret-change-me'),
};

export default config;
