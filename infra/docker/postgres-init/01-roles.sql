-- Roles are cluster-level objects, not schema, so they are created by provisioning
-- rather than by a migration: this script locally, Terraform on Cloud SQL. A schema
-- migration that assumes a role exists is a migration that cannot run on a fresh
-- cluster, which is how the first attempt at this failed.

-- The runtime role. It owns nothing, may create nothing, and holds one verb at a time on
-- one table at a time -- which is the whole of what bounds a query that escapes the
-- repository layer, now that there are no policies to bound which rows it sees
-- (PROJECT.md 4.10). NOBYPASSRLS is kept because it costs nothing and is the right
-- default for a role that must never be able to opt out of a policy added later.
CREATE ROLE idenzy_app NOLOGIN NOBYPASSRLS;

-- Schema owner. Runs migrations, never serves requests.
CREATE ROLE idenzy_owner NOLOGIN;

-- Local development login, member of both. In a real deployment these are separate
-- service accounts with separate credentials and no shared login.
GRANT idenzy_app TO idenzy;
GRANT idenzy_owner TO idenzy;
