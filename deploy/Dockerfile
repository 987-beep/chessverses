# Multi-stage build for ChessVerse (realtime chess game server).
# Builds the React client, then runs the Node + Socket.IO server which
# serves the client and handles the realtime game protocol on one origin.
FROM node:20-alpine AS build
WORKDIR /app

# Install + build the client
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# Install server deps
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install

# Runtime image
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "index.js"]
