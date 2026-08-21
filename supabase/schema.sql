-- Run this in Supabase → SQL Editor (works for both new projects and existing tables)

-- 1. Create table if not exists
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  platform text,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  referrer_url text,
  created_at timestamptz not null default now()
);

-- 2. Migration for existing tables (safe to run multiple times)
alter table waitlist add column if not exists source text;
alter table waitlist add column if not exists utm_source text;
alter table waitlist add column if not exists utm_medium text;
alter table waitlist add column if not exists utm_campaign text;
alter table waitlist add column if not exists utm_content text;
alter table waitlist add column if not exists referrer_url text;

-- 3. Enable RLS
alter table waitlist enable row level security;

-- 4. RLS Policy: Allow anon to insert signups
-- The anon key is public — access is limited by this RLS policy (insert-only, no read/update/delete).
drop policy if exists "public can insert signups" on waitlist;
create policy "public can insert signups" on waitlist
  for insert
  to anon
  with check (true);
