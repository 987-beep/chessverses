# Root Dockerfile (auto-detected by Render / Railway / Fly.io).
# Builds the React client, then runs the Node + Socket.IO game server which
# serves the client and handles the realtime protocol on ONE origin — exactly
# what a realtime chess game needs (Vercel static hosting cannot do this).
#
# Build & run from the repo root:  docker build -t chessverse . && docker run -p 4000:4000 chessverse
FROM node:20-alpine AS build
WORKDIR /app

COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# Copy the server package manifest first (better layer caching), install deps,
# THEN copy the actual server source. (The previous version forgot this and the
# runtime image had no server/index.js, causing 'Cannot find module'.)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install
COPY server/ ./server/

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "index.js"]
