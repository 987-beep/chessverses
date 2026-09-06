import { io } from 'socket.io-client';
import { SERVER_URL } from './config.js';

// Connect to the backend. When split-hosted (Vercel frontend + separate backend)
// SERVER_URL points at the backend origin; otherwise it connects to the same
// origin that served us (the Node game server / live preview).
export const socket = io(SERVER_URL || undefined, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
  timeout: 10000,
});

export function emit(event, payload, cb) {
  if (typeof payload === 'function') { socket.emit(event, {}, payload); }
  else socket.emit(event, payload, cb);
}
