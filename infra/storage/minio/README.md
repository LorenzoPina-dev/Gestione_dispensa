# MinIO local object storage

`bootstrap.sh` creates the private media bucket idempotently and applies a bounded lifecycle.
Media is addressed by opaque IDs and pre-signed URLs; credentials are injected at runtime and
never committed.
