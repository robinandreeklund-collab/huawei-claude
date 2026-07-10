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
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV WORKSPACE_DIR=/tmp/workspace
EXPOSE 8080

CMD ["node", "dist/server.js"]
