-- Tracks whether a user has already been shown the interactive onboarding tour
-- (see CLAUDE.md "Next priority: interactive onboarding tour", design agreed 2026-09-24).
-- Stored on profiles (not localStorage) so it travels with the account across
-- devices/browsers, same reasoning as the existing must_change_password column.
alter table public.profiles
  add column if not exists has_seen_onboarding boolean not null default false;
