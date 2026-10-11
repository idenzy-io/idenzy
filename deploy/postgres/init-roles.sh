#!/bin/sh
# Postgres's first start: the roles every migration assumes, and the two logins that use them
# (infra/docker/postgres-init does the same for development, with one login for both).
#
#   idenzy_owner      owns the schema; runs migrations; never serves a request
#   idenzy_app        the runtime role: owns nothing, one verb at a time on one table at a time
#   idenzy_migrator   the migration job's login, whose every session is idenzy_owner
#   idenzy_api        the API's and the workers' login, whose every session is idenzy_app
#
# The logins' passwords come from files the compose file mounts, so they are in no environment and
# in no command line. The same passwords are inside DATABASE_URL and DATABASE_MIGRATION_URL in
# Secret Manager (docs/guide/deploy.md).
set -eu

api_password=$(cat /run/secrets/postgres-api)
migrator_password=$(cat /run/secrets/postgres-migrator)

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v api_password="$api_password" -v migrator_password="$migrator_password" <<'SQL'
CREATE ROLE idenzy_app NOLOGIN NOBYPASSRLS;
CREATE ROLE idenzy_owner NOLOGIN;

CREATE ROLE idenzy_migrator LOGIN PASSWORD :'migrator_password' IN ROLE idenzy_owner;
CREATE ROLE idenzy_api LOGIN PASSWORD :'api_password' IN ROLE idenzy_app;

-- Every session of the migration login is the owner, so what a migration creates is the owner's and
-- its default privileges are the owner's. Every session of the runtime login is the runtime role.
ALTER ROLE idenzy_migrator SET role = 'idenzy_owner';
ALTER ROLE idenzy_api SET role = 'idenzy_app';

-- The owner creates the schema's objects and the migrator's bookkeeping schema; nobody else
-- creates anything.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE, USAGE ON SCHEMA public TO idenzy_owner;
GRANT CREATE ON DATABASE idenzy TO idenzy_owner;
SQL
