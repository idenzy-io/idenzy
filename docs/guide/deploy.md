# Deploying

Production, stage one: one VPS runs everything that serves a request or holds state, and Google
holds what must not live on the box. This page is the whole procedure, in the order it has to
happen, and the reasons behind the parts that look arbitrary.

```
Cloudflare DNS (unproxied) ──> VPS: Caddy :443 ──> api, workers ──> Postgres, Valkey, ClickHouse
                                                     │
                     Google: KMS (the key every key is wrapped by), Secret Manager, backups
                     Amazon SES: email
```

| Host | What answers |
| --- | --- |
| `api.idenzy.io` | the auth API, for customers' applications; tokens' `iss` |
| `auth.idenzy.io` | the same API, as the dashboard project's verified auth domain (cookie mode) |
| `app.idenzy.io` | the panel, static |
| `console.idenzy.io` | the operator console, static |
| `events.idenzy.io/ses` | Amazon SNS delivering SES bounces and complaints to the workers |
| `idenzy.io` | redirects to the panel until the landing site is deployed |

## Rules that shape it

- **No secret in a file the repository or an environment holds.** The services read every
  credential from Secret Manager at boot (`secret://` in `deploy/.env`), as a service account whose
  key file is the one credential on disk. The stores' own passwords are files under
  `/opt/idenzy/secrets`, read once when each store first starts.
- **Keys are wrapped, not stored** (ADR-0021). Every project's signing key and the field-encryption
  key are encrypted by one Cloud KMS key the box can use and never read. A stolen disk or backup
  holds ciphertext.
- **Backups leave the box encrypted and cannot be deleted from it.** The box may add a backup to
  the bucket and nothing else; the bucket refuses deletion for a week whoever asks; the dump is
  encrypted to a key you keep offline.
- **Migrations are forward-only and run before the new revision starts**, so each must work with
  the revision before it too: add, then use, then remove, in separate deploys.
- **DNS records are unproxied** (grey cloud). Caddy terminates TLS with its own certificates; an API
  whose clients send bearer tokens has no business being decrypted at a CDN, and the client address
  the API rate-limits on is then the one Caddy sees (`TRUSTED_PROXY_HOPS=1`).

## Once, before the first deploy

### 1. Google Cloud

Create a project with billing, then from this repository:

```sh
gcloud auth login && gcloud auth application-default login
cd infra/terraform/environments/prod
terraform init
terraform apply -var project_id=YOUR_PROJECT
```

That makes the KMS key, the secrets (empty), the backup and export buckets and the runtime service
account. Then the runtime's key file, which Terraform deliberately does not make (its private half
would be in the state file):

```sh
gcloud iam service-accounts keys create gcp-runtime.json \
  --iam-account "$(terraform output -raw runtime_service_account)"
```

### 2. Credentials

```sh
deploy/setup-secrets.sh YOUR_PROJECT "$(terraform -chdir=infra/terraform/environments/prod output -raw kms_key_name)" ~/idenzy-secrets
```

It generates the stores' passwords, puts the database, Valkey and ClickHouse credentials and a
KMS-wrapped field-encryption key into Secret Manager, and makes the backup key pair. Running it
again changes nothing that exists. **`backup-identity.txt` is the only key that opens a backup:
keep two copies offline (a password manager and an encrypted drive), never on the server.**

### 3. Amazon SES (email)

Magic links are email, so this has to work before anybody can sign in.

1. In SES, region `eu-central-1`, verify the domain `idenzy.io`: add the three DKIM CNAMEs to
   Cloudflare (unproxied), and a custom MAIL FROM domain (`mail.idenzy.io`, its MX and SPF records).
2. Add a DMARC record: `_dmarc.idenzy.io TXT "v=DMARC1; p=quarantine; rua=mailto:YOU"`.
3. Create a configuration set, and an SNS topic subscribed to its bounce and complaint events with
   an HTTPS subscription to `https://events.idenzy.io/ses` (the workers confirm it themselves).
4. Request production access (out of the sandbox). Until it is granted SES sends only to verified
   addresses.
5. An IAM user allowed `ses:SendEmail` and `ses:SendRawEmail` on that identity and nothing else; its
   access key id goes in `deploy/.env`, its secret into Secret Manager:
   `printf '%s' SECRET | gcloud secrets versions add idenzy-aws-secret-access-key --project YOUR_PROJECT --data-file=-`

### 4. The VPS

Contabo, Ubuntu 24.04, in Germany, 8 GB of memory or more (ClickHouse wants room; without it 4 GB
does). Then, as root:

```sh
adduser --disabled-password deploy && usermod -aG docker deploy   # after installing Docker
apt install -y docker.io docker-compose-v2 ufw unattended-upgrades
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
install -d -o deploy -g deploy -m 700 /opt/idenzy /opt/idenzy/secrets /opt/idenzy/backup
```

Turn off SSH passwords (`PasswordAuthentication no`) and give `deploy` the deploy key's public half.
Copy `deploy/` from this repository to `/opt/idenzy`, then:

- `deploy/env.example` to `/opt/idenzy/.env`, filled in: `GCP_PROJECT_ID`, `KMS_KEY_NAME`,
  `BACKUP_BUCKET` (Terraform outputs), `ACME_EMAIL`, the SES values. Every `secret://` line must
  have a value in Secret Manager before the services start; leave a line commented out until it does.
- `gcp-runtime.json` and the files from `~/idenzy-secrets` (not `backup-identity.txt`) into
  `/opt/idenzy/secrets/`, `recipient.txt` into `/opt/idenzy/backup/`. The files are `0644` inside a
  `0700` directory: the containers run as different users and must read them, nobody else on the
  host can reach them.
- `docker login ghcr.io` with a token that may read packages, while the image is private.

### 5. Cloudflare DNS

A records for `api`, `auth`, `app`, `console`, `events`, `@` and `www`, all to the VPS address,
**DNS only**. Caddy obtains the certificates on first request.

### 6. GitHub

On `idenzy-io/idenzy`, an environment `production` (add yourself as a required reviewer) with the
secrets `DEPLOY_HOST`, `DEPLOY_USER` (`deploy`), `DEPLOY_SSH_KEY` (the private half) and
`DEPLOY_KNOWN_HOSTS` (`ssh-keyscan HOST`), and the repository variable
`PANEL_API_URL=https://auth.idenzy.io`.

## Deploying

Run **Deploy** from the Actions tab (or set the variable `DEPLOY=true` to deploy every push to
main). It builds the image and the panels, then on the box: pulls, migrates, starts, and waits for
`/readyz`. A revision that does not become ready is replaced by the previous one and the run fails.

**The first run** also creates the deployment's own projects (`bootstrap platform`), writes their
ids into `.env`, and prints two publishable keys in the log. Put them in the repository variables
`DASHBOARD_PUBLISHABLE_KEY` and `OPERATOR_PUBLISHABLE_KEY` and run Deploy again: the panels are
static builds and need them at build time.

## After it is up

- **The operator console** needs a Google OAuth client (Google Cloud console, Web application,
  redirect URI `https://api.idenzy.io/v1/auth/oauth/google/callback`). Its secret into Secret
  Manager as `idenzy-operator-google-client-secret`, the two `OPERATOR_GOOGLE_` lines uncommented,
  then `docker compose run --rm bootstrap platform`. Staff rows are the one thing the application
  cannot write (ADR-0018), so adding yourself runs as the schema owner, with its password read from
  the box for this one command:

  ```sh
  docker compose run --rm --entrypoint /nodejs/bin/node \
    -e DATABASE_MIGRATION_URL="postgres://idenzy_migrator:$(cat secrets/postgres-migrator)@postgres:5432/idenzy" \
    api api/node_modules/@idenzy/persistence/dist/staff-cli.js add you@idenzy.io owner
  ```
- **Analytics**: uncomment the `CLICKHOUSE_` lines and start with `--profile analytics`.
- **A customer's auth domain** (`auth.acme.com`): verified in the panel, CNAME to
  `api.idenzy.io`, a block in `caddy/customer-domains.caddy`, then
  `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.

## Restoring a backup

Once a quarter, on a scratch machine, so the day it matters is not the first time:

```sh
gcloud storage ls gs://BUCKET/                       # newest last
gcloud storage cat gs://BUCKET/NAME | age -d -i backup-identity.txt > idenzy.dump
pg_restore --no-owner -d postgres://… idenzy.dump
```

## What this stage does not have yet

- A second machine. The VPS is a single point of failure; backups bound what a loss costs, not how
  long the outage is. Managed Postgres (Terraform's `enable_managed_infrastructure`) is the next stage.
- Signing-key rotation (ADR-0021) and a scheduled rotation of the runtime's key file.
- Alerting beyond Docker's restart policy: an uptime check on `https://api.idenzy.io/readyz` from
  outside is the first thing to add.
