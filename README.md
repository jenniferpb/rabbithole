# The Research Board

A corkboard-style, hand-pinned "web" of your research that anyone visiting the
page can add a card (and a thread) to, live. Built for Neocities + Supabase.

Neocities only hosts static files — it can't remember anything a visitor
submits. Supabase gives you a free hosted database with a JS API you can call
straight from the browser, so submissions show up for everyone instantly.

## 1. Create the database (5 minutes)

1. Go to https://supabase.com, sign in, and create a new project (free tier).
2. Once it's ready, open the **SQL Editor** and run this once:

```sql
create extension if not exists pgcrypto;

create table nodes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text default '',
  url text,
  category text not null default 'other',
  author text default 'anonymous',
  x double precision not null,
  y double precision not null,
  rotation double precision not null default 0,
  created_at timestamptz default now()
);

create table edges (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references nodes(id) on delete cascade,
  target_id uuid not null references nodes(id) on delete cascade,
  created_at timestamptz default now()
);

alter table nodes enable row level security;
alter table edges enable row level security;

-- anyone can read the board
create policy "public read nodes" on nodes for select using (true);
create policy "public read edges" on edges for select using (true);

-- anyone can pin a new card or thread
create policy "public insert nodes" on nodes for insert with check (true);
create policy "public insert edges" on edges for insert with check (true);

-- anyone can drag a card to reposition it (title/notes are NOT editable
-- once pinned, on purpose — see "About moderation" below)
create policy "public reposition nodes" on nodes for update
  using (true) with check (true);

-- no delete policy for either table on purpose: nothing anonymous
-- can wipe the board. You can delete spam yourself from the Table Editor.

alter publication supabase_realtime add table nodes;
alter publication supabase_realtime add table edges;
```

3. Go to **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key (not the service role key — that one stays secret).

## 2. Configure the site

Open `config.js` and paste in the two values:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

## 3. Add your splash image

Drop whatever image you want to open on (a photo, a scan, anything) into the
folder as `splash.jpg`. It appears full-screen on load and fades out after
about 2.5 seconds, or immediately on click / any keypress. If you'd rather
use a different filename or format, change the `src="splash.jpg"` in
`index.html`. If you skip this step the splash just shows the fade without
an image — nothing breaks.

## 4. Hosting: use GitHub Pages, not a free Neocities account

Neocities' free tier ships with a security policy that only lets the page
talk to its own domain — it silently blocks the connection to Supabase, so
the board will never load there unless you pay for Neocities Supporter.
GitHub Pages hosts static files the same way, for free, with no such
restriction. Same files, no code changes.

**One-time setup (all through github.com, no command line needed):**

1. Make a free account at https://github.com if you don't have one.
2. Click the **+** in the top right → **New repository**. Name it anything
   (e.g. `research-web`), keep it **Public**, and click **Create repository**.
3. On the new repo's page, click **uploading an existing file** (or drag
   files onto the page). Upload everything in this folder: `index.html`,
   `style.css`, `app.js`, `config.js`, `splash.jpg`, and `.nojekyll`.
   Commit the changes.
4. Go to the repo's **Settings** tab → **Pages** in the left sidebar. Under
   "Build and deployment," set **Source** to **Deploy from a branch**,
   branch **main**, folder **/ (root)**. Click **Save**.
5. Wait about a minute, then refresh that Settings → Pages screen — it'll
   show your live URL, something like
   `https://yourusername.github.io/research-web/`.

Any time you want to update a file afterward, just open it in the repo on
github.com, click the pencil (edit) icon, make the change, and commit —
the live site updates automatically within a minute or two.

## About moderation

You picked "no gatekeeping," so anyone can pin a card or a thread, and
nothing gets held for approval. Two guardrails are already built in to keep
that from turning into a mess:

- **Nobody can delete anything except you.** There's no anonymous delete
  policy, so the worst a bad actor can do is add junk, not erase the board.
  Delete spam yourself anytime from the Supabase Table Editor.
- **Nobody can edit an existing card's text**, only its position on the
  board. So a card's title/notes/link stay as the person who pinned it wrote
  them — reposition is the only shared action.

If spam becomes a real problem, the cleanest next step is adding a
`created_at`-based rate limit in a Supabase Edge Function, or swapping the
anon insert policy for one that requires a lightweight auth (e.g. Supabase's
anonymous sign-in, so at least submissions are attributable to a session).

## Customizing

- Categories + pin colors live in `app.js` near the top (`CATEGORIES`).
- Board size (the pannable canvas) is `BOARD_WIDTH` / `BOARD_HEIGHT` in
  `app.js`.
- Fonts, cork texture, and thread color are all in `style.css`.
