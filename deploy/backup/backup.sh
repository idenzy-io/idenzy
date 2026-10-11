#!/bin/sh
# Once a day: dump the database, encrypt it, upload it, and say so in the log.
#
# Encrypted on the box, to deploy/backup/recipient.txt (an age public key), so the bucket holds
# nothing anybody can read without the private key the operator keeps offline. Restore:
#   gcloud storage cat gs://BUCKET/NAME | age -d -i KEY | pg_restore -d idenzy
#
# A failed backup is loud in the log and is retried in an hour rather than a day.
set -eu
# A dump that fails half way must fail the upload, not store a truncated file as a backup.
set -o pipefail

gcloud auth activate-service-account --key-file=/run/secrets/gcp-runtime --quiet >/dev/null
printf 'postgres:5432:idenzy:idenzy_migrator:%s\n' "$(cat /run/secrets/postgres-migrator)" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"

while true; do
  name="idenzy-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
  if pg_dump --format=custom --no-owner \
      | age --encrypt --recipients-file /etc/backup/recipient.txt \
      | gcloud storage cp - "gs://${BACKUP_BUCKET}/${name}" --quiet; then
    echo "backup: wrote gs://${BACKUP_BUCKET}/${name}"
    sleep 86400
  else
    echo "backup: FAILED, retrying in an hour" >&2
    sleep 3600
  fi
done
