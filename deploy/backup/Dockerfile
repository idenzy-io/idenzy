# The nightly backup: pg_dump, encrypted with age to a recipient whose private key is held offline,
# streamed to the backup bucket. The Google Cloud CLI image, because it is the uploader that works
# with nothing but `storage.objects.create`, which is all the runtime may do to that bucket.
FROM gcr.io/google.com/cloudsdktool/google-cloud-cli:542.0.0-alpine
RUN apk add --no-cache postgresql17-client age
COPY backup.sh /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
