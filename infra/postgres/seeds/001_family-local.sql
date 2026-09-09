-- Synthetic family-local fixture. Never use this seed for production data.
BEGIN;

INSERT INTO users (id, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO families (
  id,
  display_name,
  creator_user_id,
  locale,
  timezone,
  unit_system
)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'Family Local Fixture',
  '00000000-0000-0000-0000-000000000001',
  'it-IT',
  'Europe/Rome',
  'METRIC'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO family_memberships (
  id,
  family_id,
  user_id,
  role,
  status,
  joined_at
)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'OWNER',
  'ACTIVE',
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO data_sources (id, kind, name, reliability_class)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  'MANUAL',
  'Family Local Fixture',
  'VERIFIED'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO brands (id, name, normalized_name)
VALUES (
  '00000000-0000-0000-0000-000000000021',
  'Fixture',
  'fixture'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, canonical_name, brand_id, default_unit, provenance_quality)
VALUES (
  '00000000-0000-0000-0000-000000000022',
  'Pasta fixture',
  '00000000-0000-0000-0000-000000000021',
  'pack',
  'VERIFIED'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, family_id, name, kind)
VALUES (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000010',
  'Dispensa',
  'PANTRY'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
