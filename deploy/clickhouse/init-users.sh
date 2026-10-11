#!/bin/bash
# ClickHouse's first start: the four identities ADR-0013 and ADR-0020 rely on, each with its own
# password from a file the compose file mounts (infra/docker/clickhouse-init/01-roles.sql is the
# same for development, with one password for all four).
#
# The grants on tables are the migration's (`migrateAnalytics`, run by the workers at boot), apart
# from what only this script can give: the owner's DDL and the right to pass on the verbs it grants.
set -eu

sha() { printf '%s' "$(cat "/run/secrets/$1")" | sha256sum | cut -d' ' -f1; }

clickhouse client --multiquery <<SQL
CREATE DATABASE IF NOT EXISTS idenzy;

CREATE USER IF NOT EXISTS idenzy_app IDENTIFIED WITH sha256_hash BY '$(sha clickhouse-app)'
  SETTINGS SQL_idenzy_project_id = '00000000-0000-0000-0000-000000000000';
CREATE USER IF NOT EXISTS idenzy_ingest IDENTIFIED WITH sha256_hash BY '$(sha clickhouse-ingest)';
CREATE USER IF NOT EXISTS idenzy_owner IDENTIFIED WITH sha256_hash BY '$(sha clickhouse-owner)';
CREATE USER IF NOT EXISTS idenzy_eraser IDENTIFIED WITH sha256_hash BY '$(sha clickhouse-eraser)';

GRANT SELECT ON idenzy.* TO idenzy_app;
GRANT INSERT ON idenzy.* TO idenzy_ingest;
GRANT CREATE DATABASE, DROP DATABASE, CREATE TABLE, DROP TABLE, ALTER, OPTIMIZE ON *.* TO idenzy_owner;
GRANT CREATE ROW POLICY, ALTER ROW POLICY, DROP ROW POLICY, SHOW ROW POLICIES ON *.* TO idenzy_owner;
GRANT SELECT, INSERT ON *.* TO idenzy_owner WITH GRANT OPTION;
GRANT ALTER DELETE ON *.* TO idenzy_owner WITH GRANT OPTION;
SQL
