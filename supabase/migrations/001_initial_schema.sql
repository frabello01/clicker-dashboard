-- Clicker Dashboard — initial schema
-- Run this in the Supabase SQL editor (or via the CLI) on a fresh project.

-- ---------- helpers ----------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

-- ---------- devices ----------
-- Nomix dongle + iPhone pair. The `id` is the Nomix device ID; we cache
-- friendly metadata locally so the UI doesn't need to round-trip for it.

create table public.devices (
  id text primary key,
  alias text,
  online boolean not null default false,
  last_seen timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger devices_set_updated_at before update on public.devices
  for each row execute function public.set_updated_at();

-- ---------- accounts ----------
-- Social profiles operated through a device.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  email text,
  phone text,
  password_encrypted text,
  device_id text references public.devices(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','checkpoint','banned','paused')),
  proxy_label text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index accounts_device_id_idx on public.accounts(device_id);
create index accounts_status_idx on public.accounts(status);

create trigger accounts_set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

-- ---------- media ----------
-- Files uploaded into Supabase Storage and tracked here for reuse across
-- posts. The actual binary lives in the `media` storage bucket (created
-- below); this table is the catalogue.

create table public.media (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('image','video')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  width int,
  height int,
  duration_seconds numeric,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- posts ----------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('reel','carousel')),
  caption text,
  scheduled_for timestamptz,
  status text not null default 'draft'
    check (status in ('draft','queued','running','posted','failed')),
  result_log jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_media (
  post_id uuid not null references public.posts(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete restrict,
  position int not null default 0,
  primary key (post_id, media_id)
);

create index posts_account_id_idx on public.posts(account_id);
create index posts_status_idx on public.posts(status);

create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

-- ---------- warmup runs ----------

create table public.warmup_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  config jsonb not null default '{}',
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  log jsonb,
  created_at timestamptz not null default now()
);

create index warmup_runs_account_id_idx on public.warmup_runs(account_id);
create index warmup_runs_status_idx on public.warmup_runs(status);

-- ---------- jobs ----------
-- Generic queue for any long-running workflow. The cron orchestrator picks
-- up rows where status in ('pending','running') and next_run_at <= now()
-- and advances them by a few steps before persisting state.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  account_id uuid references public.accounts(id) on delete set null,
  device_id text references public.devices(id) on delete set null,
  payload jsonb not null default '{}',
  state jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','running','completed','failed','cancelled')),
  attempts int not null default 0,
  next_run_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_status_idx on public.jobs(status);
create index jobs_next_run_idx on public.jobs(next_run_at)
  where status in ('pending','running');

create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------- Row-Level Security ----------
-- Single-user dashboard: any authenticated user has full access.
-- Tighten later if you ever add team members.

alter table public.devices       enable row level security;
alter table public.accounts      enable row level security;
alter table public.media         enable row level security;
alter table public.posts         enable row level security;
alter table public.post_media    enable row level security;
alter table public.warmup_runs   enable row level security;
alter table public.jobs          enable row level security;

create policy "auth full" on public.devices       for all to authenticated using (true) with check (true);
create policy "auth full" on public.accounts      for all to authenticated using (true) with check (true);
create policy "auth full" on public.media         for all to authenticated using (true) with check (true);
create policy "auth full" on public.posts         for all to authenticated using (true) with check (true);
create policy "auth full" on public.post_media    for all to authenticated using (true) with check (true);
create policy "auth full" on public.warmup_runs   for all to authenticated using (true) with check (true);
create policy "auth full" on public.jobs          for all to authenticated using (true) with check (true);

-- ---------- Storage bucket for media ----------

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy "auth read media" on storage.objects
  for select to authenticated
  using (bucket_id = 'media');

create policy "auth write media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media');

create policy "auth delete media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media');
