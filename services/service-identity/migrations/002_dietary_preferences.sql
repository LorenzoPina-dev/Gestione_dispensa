CREATE TABLE IF NOT EXISTS dietary_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  allergen_tags text[] NOT NULL DEFAULT '{}',
  dietary_restrictions text[] NOT NULL DEFAULT '{}',
  trace_policy varchar(16) NOT NULL DEFAULT 'WARN'
    CHECK (trace_policy IN ('WARN','EXCLUDE')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dietary_preferences_allergens_gin
  ON dietary_preferences USING gin(allergen_tags);

CREATE INDEX IF NOT EXISTS dietary_preferences_diet_gin
  ON dietary_preferences USING gin(dietary_restrictions);

INSERT INTO dietary_preferences(user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
