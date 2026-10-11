#!/usr/bin/env bash
# Every credential a new deployment needs, made once, on your own machine (docs/guide/deploy.md).
#
#   deploy/setup-secrets.sh <gcp-project> <kms-key-name> [out-dir]
#
# 1. Generates a password for each store's login into out-dir (default ./idenzy-secrets), unless one
#    is there already: running it again changes nothing that exists.
# 2. Puts what the services read into Secret Manager: the database and Valkey URLs with those
#    passwords inside, the ClickHouse passwords, and a field-encryption key wrapped by KMS.
# 3. Makes the backup key pair: recipient.txt goes to the server, backup-identity.txt never does.
#
# Needs gcloud (signed in as somebody who may add secret versions and encrypt with the key), openssl
# and age. The plaintext field key exists only inside one pipe.
set -euo pipefail

project=${1:?usage: setup-secrets.sh <gcp-project> <kms-key-name> [out-dir]}
kms_key=${2:?usage: setup-secrets.sh <gcp-project> <kms-key-name> [out-dir]}
out=${3:-./idenzy-secrets}

umask 077
mkdir -p "$out"

password() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }
for name in postgres-superuser postgres-api postgres-migrator valkey \
  clickhouse-app clickhouse-ingest clickhouse-owner clickhouse-eraser; do
  [ -s "$out/$name" ] || password > "$out/$name"
done

has_version() {
  gcloud secrets versions list "$1" --project "$project" --limit 1 --format 'value(name)' 2>/dev/null | grep -q .
}
put() {
  if has_version "$1"; then echo "kept $1"; return; fi
  printf '%s' "$2" | gcloud secrets versions add "$1" --project "$project" --data-file=- >/dev/null
  echo "set  $1"
}

put idenzy-database-url "postgres://idenzy_api:$(cat "$out/postgres-api")@postgres:5432/idenzy"
put idenzy-database-migration-url "postgres://idenzy_migrator:$(cat "$out/postgres-migrator")@postgres:5432/idenzy"
put idenzy-valkey-url "redis://:$(cat "$out/valkey")@valkey:6379"
put idenzy-clickhouse-password "$(cat "$out/clickhouse-app")"
put idenzy-clickhouse-ingest-password "$(cat "$out/clickhouse-ingest")"
put idenzy-clickhouse-owner-password "$(cat "$out/clickhouse-owner")"
put idenzy-clickhouse-eraser-password "$(cat "$out/clickhouse-eraser")"

# The field-encryption key: 32 random bytes, wrapped by KMS under the context the services open it
# with (FIELD_KEY_CONTEXT in @idenzy/crypto), so it can only ever be opened as a field key.
if has_version idenzy-field-key; then
  echo "kept idenzy-field-key"
else
  aad=$(mktemp) && printf 'idenzy:field-encryption' > "$aad"
  openssl rand 32 \
    | gcloud kms encrypt --key "$kms_key" --plaintext-file=- --ciphertext-file=- \
        --additional-authenticated-data-file="$aad" \
    | base64 | tr -d '\n' \
    | gcloud secrets versions add idenzy-field-key --project "$project" --data-file=- >/dev/null
  rm -f "$aad"
  echo "set  idenzy-field-key"
fi

if [ ! -s "$out/backup-identity.txt" ]; then
  age-keygen -o "$out/backup-identity.txt" 2>/dev/null
fi
age-keygen -y "$out/backup-identity.txt" > "$out/recipient.txt"

cat <<DONE

Done. In $out:
  postgres-*, valkey, clickhouse-*   copy to the server's /opt/idenzy/secrets/
  recipient.txt                      copy to the server's /opt/idenzy/backup/recipient.txt
  backup-identity.txt                the only key that opens a backup: keep it offline, twice,
                                     and never on the server

Still to add by hand (they come from outside): idenzy-aws-secret-access-key and
idenzy-operator-google-client-secret, with
  printf '%s' VALUE | gcloud secrets versions add NAME --project $project --data-file=-
DONE
