// Runtime/build-time backend location.
//
// The client can run in two modes:
//   1. Same-origin (default): the backend Node server serves the built React app,
//      so a relative URL just works (used by the live preview / Dockerfile).
//   2. Split hosting (Vercel static frontend + separate backend): set
//      VITE_SERVER_URL to the backend's public origin at build time. The client
//      will then call <SERVER_URL>/api/... and connect Socket.IO to <SERVER_URL>.
//
// Example (Vercel env var):  VITE_SERVER_URL=https://chess-server.onrender.com
const raw = (import.meta.env && import.meta.env.VITE_SERVER_URL) || '';
export const SERVER_URL = raw ? String(raw).replace(/\/+$/, '') : '';

// Build a full API URL, prefixing with the backend origin when split-hosted.
export function api(path) {
  return `${SERVER_URL}/api${path.startsWith('/') ? path : '/' + path}`;
}
