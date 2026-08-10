-- Run this once in Supabase → SQL Editor, on a new project.

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  platform text,
  created_at timestamptz not null default now()
);

alter table waitlist enable row level security;

-- The site inserts rows directly from the browser using the public anon key.
-- This policy allows that (and only that) — no select/update/delete for anon,
-- so signups can't be read or tampered with from the client.
create policy "public can insert signups" on waitlist
  for insert
  to anon
  with check (true);
