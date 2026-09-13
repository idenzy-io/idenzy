-- Users and roles are server-level objects, not schema, so they are created by provisioning
-- rather than by a migration — this script locally, Terraform in a real cell. Exactly the shape
-- `infra/docker/postgres-init/01-roles.sql` has, and for the same reason: a migration that
-- assumes a user exists cannot run on a fresh server.

CREATE DATABASE IF NOT EXISTS idenzy;

-- The runtime user. Every row policy is attached to this one, and it holds no privilege that
-- could be used to detach one: no ACCESS MANAGEMENT, no ALTER, no CREATE. An analytics query
-- that escapes the query layer still cannot escape the tenant predicate (ADR-0013).
-- The default is the nil uuid rather than empty, and rather than no default at all. It has to be
-- a value the policy can compare, because a policy that throws on an unset tenant turns a missing
-- SET into a 500 that reads like an outage; the nil uuid matches no project's rows, which is the
-- same answer Postgres gives when `app.project_id` was never set (ADR-0003).
CREATE USER IF NOT EXISTS idenzy_app IDENTIFIED WITH plaintext_password BY 'idenzy'
  SETTINGS SQL_idenzy_project_id = '00000000-0000-0000-0000-000000000000';

-- Schema owner. Runs migrations, never serves requests.
CREATE USER IF NOT EXISTS idenzy_owner IDENTIFIED WITH plaintext_password BY 'idenzy';

GRANT SELECT, INSERT ON idenzy.* TO idenzy_app;

-- The owner runs DDL and nothing else, which is why this is a list rather than `ALL`: no ACCESS
-- MANAGEMENT, so a migration cannot create a user or detach a row policy from one. `WITH GRANT
-- OPTION` on the two read verbs is what lets the migrator hand the runtime user access to a
-- database it has just created — the mirror of Postgres, where a new tenant table needs its own
-- grant and forgetting it makes the table unreadable rather than loud.
GRANT CREATE DATABASE, DROP DATABASE, CREATE TABLE, DROP TABLE, ALTER, OPTIMIZE ON *.* TO idenzy_owner;
GRANT CREATE ROW POLICY, ALTER ROW POLICY, DROP ROW POLICY, SHOW ROW POLICIES ON *.* TO idenzy_owner;
GRANT SELECT, INSERT ON *.* TO idenzy_owner WITH GRANT OPTION;
