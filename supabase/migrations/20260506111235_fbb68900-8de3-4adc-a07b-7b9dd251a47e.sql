create table public.user_preferences (
  user_id uuid primary key,
  theme jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
create policy "Users select own prefs" on public.user_preferences for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own prefs" on public.user_preferences for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own prefs" on public.user_preferences for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own prefs" on public.user_preferences for delete to authenticated using (auth.uid() = user_id);