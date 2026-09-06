import { io } from 'socket.io-client';

// Connect to the same origin (served by the backend). Uses relative URL so it works
// both in dev (via Vite proxy) and in production / live preview.
export const socket = io({
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
