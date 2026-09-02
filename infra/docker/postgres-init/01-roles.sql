-- Roles are cluster-level objects, not schema, so they are created by provisioning
-- rather than by a migration: this script locally, Terraform on Cloud SQL. A schema
-- migration that assumes a role exists is a migration that cannot run on a fresh
-- cluster, which is how the first attempt at this failed.

-- The runtime role. NOBYPASSRLS is the point: the application connects only as this
-- role, so a query that escapes the repository layer still cannot escape the tenant
-- policy (ADR-0003).
CREATE ROLE idenzy_app NOLOGIN NOBYPASSRLS;

-- Schema owner. Runs migrations, never serves requests.
CREATE ROLE idenzy_owner NOLOGIN;

-- Local development login, member of both. In a real cell these are separate service
-- accounts with separate credentials and no shared login.
GRANT idenzy_app TO idenzy;
GRANT idenzy_owner TO idenzy;
