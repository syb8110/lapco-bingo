LAPCo Bingo (Starter)

What this is:
- A single-page static web app that shows a 5×5 bingo grid.
- Uses Supabase Auth (Google) for sign-in.
- Saves which tiles a user has completed in a `completions` table.
- No build step. Deploy anywhere (Vercel, Netlify).

Setup (DB):
1) In Supabase -> SQL Editor, run this SQL once:

create extension if not exists pgcrypto;

create table if not exists tiles (
  tile_code text primary key,
  label text not null
);

create table if not exists completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  tile_code text not null,
  created_at timestamptz default now(),
  primary key (user_id, tile_code)
);

alter table tiles enable row level security;
alter table completions enable row level security;

create policy "tiles: readable to all" on tiles
for select using (true);

create policy "completions: read own" on completions
for select using (auth.uid() = user_id);

create policy "completions: write own" on completions
for insert with check (auth.uid() = user_id);

create policy "completions: delete own" on completions
for delete using (auth.uid() = user_id);

2) Deploy this folder to Vercel.

3) Open the site and paste your SUPABASE URL + Publishable (anon) key in the top bar, click Save, then Sign in with Google.

4) Click tiles to mark complete; click again to uncheck.
