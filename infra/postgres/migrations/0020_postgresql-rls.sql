BEGIN;

-- Production tenant isolation. Request-serving services set app.user_id from the
-- verified OIDC subject before every DB operation. Background workers use a dedicated
-- DB connection context (app.service=true) and are therefore explicitly trusted to
-- process cross-family work. The application user must not own these tables in production;
-- FORCE ROW LEVEL SECURITY is intentional defense-in-depth.

CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.app_is_service()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.service', true) = 'true'
$$;

CREATE OR REPLACE FUNCTION public.app_current_family_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.family_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.app_family_visible(target_family_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.app_is_service()
      OR target_family_id = public.app_current_family_id()
$$;

-- User-owned data.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self_or_service ON public.users;
CREATE POLICY users_self_or_service ON public.users
  USING (public.app_is_service() OR id = public.app_current_user_id())
  WITH CHECK (public.app_is_service() OR id = public.app_current_user_id());

-- Tenant root and membership graph.
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.families FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS families_member_or_creator_or_service ON public.families;
CREATE POLICY families_member_or_creator_or_service ON public.families
  USING (public.app_is_service() OR creator_user_id = public.app_current_user_id() OR public.app_family_visible(id))
  WITH CHECK (public.app_is_service() OR creator_user_id = public.app_current_user_id());

ALTER TABLE public.family_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_member_or_self_or_service ON public.family_memberships;
CREATE POLICY memberships_member_or_self_or_service ON public.family_memberships
  USING (public.app_is_service() OR user_id = public.app_current_user_id() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR user_id = public.app_current_user_id() OR public.app_family_visible(family_id));

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_family_or_service ON public.audit_events;
CREATE POLICY audit_family_or_service ON public.audit_events
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbox_family_or_service ON public.outbox_events;
CREATE POLICY outbox_family_or_service ON public.outbox_events
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.family_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invites_family_or_creator_or_service ON public.family_invites;
CREATE POLICY invites_family_or_creator_or_service ON public.family_invites
  USING (public.app_is_service() OR created_by = public.app_current_user_id() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR created_by = public.app_current_user_id() OR public.app_family_visible(family_id));

ALTER TABLE public.family_join_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_join_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS join_attempts_self_or_service ON public.family_join_attempts;
CREATE POLICY join_attempts_self_or_service ON public.family_join_attempts
  USING (public.app_is_service() OR user_id = public.app_current_user_id() OR EXISTS (
    SELECT 1 FROM public.family_invites fi WHERE fi.id = invite_id AND public.app_family_visible(fi.family_id)
  ))
  WITH CHECK (public.app_is_service() OR user_id = public.app_current_user_id() OR EXISTS (
    SELECT 1 FROM public.family_invites fi WHERE fi.id = invite_id AND public.app_family_visible(fi.family_id)
  ));

-- Inventory.
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS locations_family_or_service ON public.locations;
CREATE POLICY locations_family_or_service ON public.locations
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_items_family_or_service ON public.stock_items;
CREATE POLICY stock_items_family_or_service ON public.stock_items
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_lots_family_or_service ON public.stock_lots;
CREATE POLICY stock_lots_family_or_service ON public.stock_lots
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_movements_family_or_service ON public.stock_movements;
CREATE POLICY stock_movements_family_or_service ON public.stock_movements
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

-- stock_thresholds is a compatibility VIEW created by migration 0017.
-- PostgreSQL does not support ALTER TABLE ... ENABLE ROW LEVEL SECURITY on views,
-- so tenant isolation is inherited from the underlying stock_items rows.
-- Shopping. shopping_items/sources inherit tenant ownership from shopping_lists.
ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_lists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopping_lists_family_or_service ON public.shopping_lists;
CREATE POLICY shopping_lists_family_or_service ON public.shopping_lists
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopping_items_list_family_or_service ON public.shopping_items;
CREATE POLICY shopping_items_list_family_or_service ON public.shopping_items
  USING (public.app_is_service() OR EXISTS (
    SELECT 1 FROM public.shopping_lists sl WHERE sl.id = list_id AND public.app_family_visible(sl.family_id)
  ))
  WITH CHECK (public.app_is_service() OR EXISTS (
    SELECT 1 FROM public.shopping_lists sl WHERE sl.id = list_id AND public.app_family_visible(sl.family_id)
  ));

ALTER TABLE public.shopping_item_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_item_sources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopping_sources_list_family_or_service ON public.shopping_item_sources;
CREATE POLICY shopping_sources_list_family_or_service ON public.shopping_item_sources
  USING (public.app_is_service() OR EXISTS (
    SELECT 1 FROM public.shopping_items si
    JOIN public.shopping_lists sl ON sl.id = si.list_id
    WHERE si.id = item_id AND public.app_family_visible(sl.family_id)
  ))
  WITH CHECK (public.app_is_service() OR EXISTS (
    SELECT 1 FROM public.shopping_items si
    JOIN public.shopping_lists sl ON sl.id = si.list_id
    WHERE si.id = item_id AND public.app_family_visible(sl.family_id)
  ));

-- Per-user privacy preferences.
ALTER TABLE public.privacy_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_consents_user_or_service ON public.privacy_consents;
CREATE POLICY privacy_consents_user_or_service ON public.privacy_consents
  USING (public.app_is_service() OR user_id = public.app_current_user_id())
  WITH CHECK (public.app_is_service() OR user_id = public.app_current_user_id());

-- Privacy and notifications.
ALTER TABLE public.privacy_erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_erasure_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_erasure_family_or_service ON public.privacy_erasure_requests;
CREATE POLICY privacy_erasure_family_or_service ON public.privacy_erasure_requests
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.export_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS export_artifacts_family_or_service ON public.export_artifacts;
CREATE POLICY export_artifacts_family_or_service ON public.export_artifacts
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.privacy_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_export_family_or_service ON public.privacy_export_jobs;
CREATE POLICY privacy_export_family_or_service ON public.privacy_export_jobs
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_family_or_service ON public.notifications;
CREATE POLICY notifications_family_or_service ON public.notifications
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.user_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_settings_family_or_user_or_service ON public.user_notification_settings;
CREATE POLICY notification_settings_family_or_user_or_service ON public.user_notification_settings
  USING (public.app_is_service() OR user_id = public.app_current_user_id() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR user_id = public.app_current_user_id() OR public.app_family_visible(family_id));

-- Receipt history still lives in public until the Stores/OCR extraction is complete.
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipts_family_or_service ON public.receipts;
CREATE POLICY receipts_family_or_service ON public.receipts
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipt_items_receipt_family_or_service ON public.receipt_items;
CREATE POLICY receipt_items_receipt_family_or_service ON public.receipt_items
  USING (public.app_is_service() OR EXISTS (
    SELECT 1 FROM public.receipts r WHERE r.id = receipt_id AND public.app_family_visible(r.family_id)
  ))
  WITH CHECK (public.app_is_service() OR EXISTS (
    SELECT 1 FROM public.receipts r WHERE r.id = receipt_id AND public.app_family_visible(r.family_id)
  ));

-- Extracted domain schemas.
ALTER TABLE recipes_domain.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes_domain.recipes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipes_family_or_service ON recipes_domain.recipes;
CREATE POLICY recipes_family_or_service ON recipes_domain.recipes
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE recipes_domain.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes_domain.recipe_ingredients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipe_ingredients_recipe_family_or_service ON recipes_domain.recipe_ingredients;
CREATE POLICY recipe_ingredients_recipe_family_or_service ON recipes_domain.recipe_ingredients
  USING (public.app_is_service() OR EXISTS (
    SELECT 1 FROM recipes_domain.recipes r WHERE r.id = recipe_id AND public.app_family_visible(r.family_id)
  ))
  WITH CHECK (public.app_is_service() OR EXISTS (
    SELECT 1 FROM recipes_domain.recipes r WHERE r.id = recipe_id AND public.app_family_visible(r.family_id)
  ));

ALTER TABLE nutrition_domain.nutrition_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_domain.nutrition_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nutrition_targets_user_or_service ON nutrition_domain.nutrition_targets;
CREATE POLICY nutrition_targets_user_or_service ON nutrition_domain.nutrition_targets
  USING (public.app_is_service() OR user_id = public.app_current_user_id())
  WITH CHECK (public.app_is_service() OR user_id = public.app_current_user_id());

ALTER TABLE nutrition_domain.nutrition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_domain.nutrition_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nutrition_logs_family_or_user_or_service ON nutrition_domain.nutrition_logs;
CREATE POLICY nutrition_logs_family_or_user_or_service ON nutrition_domain.nutrition_logs
  USING (public.app_is_service() OR user_id = public.app_current_user_id() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR user_id = public.app_current_user_id() OR public.app_family_visible(family_id));

ALTER TABLE stores_domain.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores_domain.stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stores_family_or_service ON stores_domain.stores;
CREATE POLICY stores_family_or_service ON stores_domain.stores
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE stores_domain.store_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores_domain.store_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_prices_store_family_or_service ON stores_domain.store_prices;
CREATE POLICY store_prices_store_family_or_service ON stores_domain.store_prices
  USING (public.app_is_service() OR EXISTS (
    SELECT 1 FROM stores_domain.stores s WHERE s.id = store_id AND public.app_family_visible(s.family_id)
  ))
  WITH CHECK (public.app_is_service() OR EXISTS (
    SELECT 1 FROM stores_domain.stores s WHERE s.id = store_id AND public.app_family_visible(s.family_id)
  ));

ALTER TABLE ocr_domain.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_domain.jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocr_jobs_family_or_service ON ocr_domain.jobs;
CREATE POLICY ocr_jobs_family_or_service ON ocr_domain.jobs
  USING (public.app_is_service() OR public.app_family_visible(family_id))
  WITH CHECK (public.app_is_service() OR public.app_family_visible(family_id));

ALTER TABLE ocr_domain.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_domain.drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocr_drafts_job_family_or_service ON ocr_domain.drafts;
CREATE POLICY ocr_drafts_job_family_or_service ON ocr_domain.drafts
  USING (public.app_is_service() OR EXISTS (
    SELECT 1 FROM ocr_domain.jobs j WHERE j.id = job_id AND public.app_family_visible(j.family_id)
  ))
  WITH CHECK (public.app_is_service() OR EXISTS (
    SELECT 1 FROM ocr_domain.jobs j WHERE j.id = job_id AND public.app_family_visible(j.family_id)
  ));

COMMIT;
