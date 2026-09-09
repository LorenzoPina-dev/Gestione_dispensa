#!/bin/sh
set -eu

: "${MINIO_ENDPOINT:=http://minio:9000}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${OBJECT_STORAGE_BUCKET:=dispensa-media}"

mc alias set local "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "local/$OBJECT_STORAGE_BUCKET"
mc anonymous set none "local/$OBJECT_STORAGE_BUCKET"
mc ilm add --expiry-days "${OBJECT_STORAGE_EXPIRY_DAYS:-30}" "local/$OBJECT_STORAGE_BUCKET"

echo "MinIO bucket bootstrap completed: $OBJECT_STORAGE_BUCKET"