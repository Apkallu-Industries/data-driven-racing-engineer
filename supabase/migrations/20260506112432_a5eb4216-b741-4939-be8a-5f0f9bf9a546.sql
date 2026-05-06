create table public.shared_themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  description text,
  theme jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shared_themes enable row level security;

create policy "Anyone can view shared themes"
  on public.shared_themes for select
  using (true);

create policy "Owners insert own themes"
  on public.shared_themes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Owners update own themes"
  on public.shared_themes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Owners delete own themes"
  on public.shared_themes for delete
  to authenticated
  using (auth.uid() = user_id);

create index shared_themes_created_at_idx on public.shared_themes(created_at desc);
create index shared_themes_user_id_idx on public.shared_themes(user_id);