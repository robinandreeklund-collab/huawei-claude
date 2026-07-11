# Cloud Run–ready image for the relay backend.
#
# Claude Code (which the Agent SDK spawns) needs git and a POSIX toolchain in
# the image so its Bash/Read/Edit tools work inside the container.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
# Install all deps incl. devDependencies (TypeScript) needed for the build step.
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build \
  # Drop devDependencies from the runtime image (smaller, less attack surface).
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
ENV WORKSPACE_DIR=/tmp/workspace
EXPOSE 8080

# Run as the unprivileged built-in `node` user (uid 1000), not root. The app and
# Claude Code's tools only write under /tmp (and any mounted DATA_DIR), which the
# node user can write to.
RUN chown -R node:node /app
USER node

CMD ["node", "dist/server.js"]
