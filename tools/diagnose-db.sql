\set ON_ERROR_STOP off
\pset pager off

\echo '=== 1. Chi sono (deve essere dispensa_app, non superuser, RLS attiva) ==='
select current_user, current_setting('is_superuser') as superuser,
       (select rolbypassrls from pg_roles where rolname = current_user) as bypass_rls;

\echo '=== 2. Colonne di public.users (servono email, display_name, avatar) ==='
select string_agg(column_name, ', ' order by ordinal_position) as columns
from information_schema.columns where table_schema = 'public' and table_name = 'users';

\echo '=== 3. Privilegi di dispensa_app ==='
select has_table_privilege(current_user, 'public.users', 'INSERT') as users_insert,
       has_table_privilege(current_user, 'public.families', 'INSERT') as families_insert,
       has_table_privilege(current_user, 'public.family_memberships', 'INSERT') as memberships_insert,
       has_table_privilege(current_user, 'public.audit_events', 'INSERT') as audit_insert,
       has_table_privilege(current_user, 'public.outbox_events', 'INSERT') as outbox_insert;

\echo '=== 4. Simulazione upsert utente (come /auth/me) - transazione annullata ==='
begin;
select set_config('app.user_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('app.family_id', '', true);
insert into users (id, email, display_name, avatar)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'diag@example.com', 'diag', null)
on conflict (id) do update
  set email = coalesce(excluded.email, users.email),
      display_name = coalesce(excluded.display_name, users.display_name),
      avatar = coalesce(excluded.avatar, users.avatar),
      updated_at = now()
returning id;
rollback;

\echo '=== 5. Simulazione creazione famiglia (come POST /families) - transazione annullata ==='
begin;
select set_config('app.user_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
       set_config('app.family_id', '', true);
insert into users (id, email, display_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'diag@example.com', 'diag')
on conflict (id) do nothing;
insert into families (id, display_name, creator_user_id, locale, timezone, unit_system, status, version, created_at, updated_at)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'diag', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'it-IT', 'Europe/Rome', 'METRIC', 'ACTIVE', 1, now(), now());
insert into family_memberships (id, family_id, user_id, role, status, joined_at, version, created_at, updated_at)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'OWNER', 'ACTIVE', now(), 1, now(), now());
select set_config('app.family_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
insert into audit_events (family_id, actor_id, action, resource_type, resource_id, outcome, trace_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'family.created', 'family', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SUCCESS', 'diagtrace0000000000');
insert into outbox_events (event_id, event_type, event_version, aggregate_type, aggregate_id, family_id, payload)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'family.created', 1, 'family', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}'::jsonb);
rollback;

\echo '=== FINE: se non compaiono righe ERROR sopra, il database e'' a posto ==='
