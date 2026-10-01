CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS notifications_domain;

CREATE TABLE IF NOT EXISTS notifications_domain.notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  family_id uuid NULL,
  type varchar(64) NOT NULL,
  title varchar(200) NOT NULL,
  body text NOT NULL,
  payload jsonb NULL,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notifications_domain.preferences (
  user_id uuid PRIMARY KEY,
  expiration boolean NOT NULL DEFAULT true,
  low_stock boolean NOT NULL DEFAULT true,
  offers boolean NOT NULL DEFAULT false,
  family boolean NOT NULL DEFAULT true,
  system boolean NOT NULL DEFAULT true,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  push boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notifications_domain.idempotency_keys (
  key varchar(255) PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  family_id uuid NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN ('processing','completed','failed')),
  response_status integer NULL,
  response_body jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications_domain.outbox_events (
  event_id uuid PRIMARY KEY,
  event_type varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  aggregate_id uuid NOT NULL,
  family_id uuid NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
  ON notifications_domain.notifications(user_id,read_at,created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_family_user_created_idx
  ON notifications_domain.notifications(family_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_outbox_publish_idx
  ON notifications_domain.outbox_events(published_at,created_at);
