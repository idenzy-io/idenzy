# syntax=docker/dockerfile:1.7
#
# One image for the server side of a deployment: the API, the workers, the migration job and the
# bootstrap command, chosen by the command a container runs (deploy/compose.yaml):
#
#   api/dist/main.js        the API
#   api/dist/migrate.js     the migration job, before a new revision takes traffic
#   api/dist/bootstrap.js   what a new deployment needs once
#   workers/dist/main.js    the workers
#
# Built from the repository root: `docker build -f deploy/Dockerfile .`.

# The Node of .nvmrc, which CI and development run, on the Debian the runtime image is built from.
# Pinned by digest as well as tag, so a rebuild is the same base until somebody moves it on purpose.
FROM node:26.7.0-trixie-slim@sha256:5758d367d7b4f48b73a9bb3530e687e47efb289f3b43f9c0450a25225ae0db5d AS build
# argon2 is the one dependency with a native build (pnpm-workspace's onlyBuiltDependencies), and it
# needs a compiler. glibc here and glibc in the runtime image, so the binary it builds runs there.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# The pnpm of package.json's packageManager. Node 25 stopped bundling corepack, so it is installed
# by version rather than enabled.
RUN npm install -g pnpm@11.0.9
WORKDIR /src

# The lockfile and manifests first, so a source change does not refetch every dependency.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/workers/package.json apps/workers/
COPY packages packages
COPY tools tools
RUN pnpm install --frozen-lockfile --filter "@idenzy/api..." --filter "@idenzy/workers..."

COPY . .
RUN pnpm turbo run build --filter "@idenzy/api..." --filter "@idenzy/workers..." \
  --output-logs=errors-only
# A self-contained tree per app: its production dependencies, workspace packages copied in with
# their `dist`, and nothing from the rest of the repository. Peer checking is off for this step
# alone: the legacy deploy re-reads the whole lockfile, whose Nuxt half has peers the server apps
# never install, and `pnpm install` above has already checked the part that ships.
RUN pnpm deploy --legacy --config.strict-peer-dependencies=false --filter @idenzy/api --prod /out/api \
  && pnpm deploy --legacy --config.strict-peer-dependencies=false --filter @idenzy/workers --prod /out/workers

# Distroless: no shell, no package manager, a non-root user. What runs is node and our code.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:a3bb283a564754266646d6029c5b6aa4f760b9415dae1398db8d7f8142ee1375
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /out/api ./api
COPY --from=build --chown=nonroot:nonroot /out/workers ./workers
ENV NODE_ENV=production
USER nonroot
EXPOSE 3001
CMD ["api/dist/main.js"]
