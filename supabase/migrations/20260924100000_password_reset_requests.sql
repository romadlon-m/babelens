-- Log of "Lupa kata sandi" requests submitted from login.html (via the
-- request-password-reset Edge Function). Used only for throttling: one
-- notification per NIP per 15 minutes and a global hourly cap, so the
-- unauthenticated endpoint can't be used to spam the admin's Discord channel.
-- Only the service role touches this table (the Edge Function).
create table if not exists public.password_reset_requests (
  id bigint generated always as identity primary key,
  nip_lama text not null,
  profile_found boolean not null,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_requests_nip_created_idx
  on public.password_reset_requests (nip_lama, created_at desc);
create index if not exists password_reset_requests_created_idx
  on public.password_reset_requests (created_at desc);

alter table public.password_reset_requests enable row level security;

revoke all on public.password_reset_requests from anon, authenticated;
grant select, insert on public.password_reset_requests to service_role;
grant usage, select on sequence public.password_reset_requests_id_seq to service_role;
