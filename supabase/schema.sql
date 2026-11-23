-- =====================================================================
--  Maktaba / Bookstore — Supabase schema
--  Run this whole file once in: Supabase Dashboard → SQL Editor → New query
--  It is idempotent enough to re-run safely after edits.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. PROFILES (one row per auth user)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  role         text not null default 'reader' check (role in ('reader','admin')),
  preferred_lang text default 'en' check (preferred_lang in ('ar','en','fr')),
  created_at   timestamptz not null default now()
);

-- Auto-create a profile when someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Stop non-admins from promoting themselves
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ---------------------------------------------------------------------
-- 2. BOOKS
-- ---------------------------------------------------------------------
create table if not exists public.books (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  title         text not null,
  subtitle      text,
  author        text not null default '',
  description   text default '',
  language      text not null default 'en' check (language in ('ar','en','fr')),
  category      text default '',
  tags          text[] default '{}',
  isbn          text,
  publisher     text,
  published_year int,
  price         numeric(10,2) not null default 0 check (price >= 0),
  currency      text not null default 'USD',
  cover_url     text,                 -- public URL (covers bucket)
  file_path     text,                 -- path inside private "books" bucket
  sample_url    text,                 -- public URL of preview PDF (samples bucket)
  sample_pages  int default 10,
  page_count    int,
  file_size     bigint,
  allow_download boolean not null default true,
  is_published  boolean not null default false,
  is_featured   boolean not null default false,
  views         int not null default 0,
  downloads     int not null default 0,
  rating_avg    numeric(3,2) not null default 0,
  rating_count  int not null default 0,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists books_published_idx on public.books (is_published, published_at desc);
create index if not exists books_language_idx  on public.books (language);
create index if not exists books_category_idx  on public.books (category);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.is_published and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;

drop trigger if exists books_touch on public.books;
create trigger books_touch before insert or update on public.books
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. PURCHASES (written only by the PayPal edge function or an admin)
-- ---------------------------------------------------------------------
create table if not exists public.purchases (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  book_id           uuid not null references public.books(id) on delete cascade,
  amount            numeric(10,2) not null default 0,
  currency          text not null default 'USD',
  provider          text not null default 'paypal' check (provider in ('paypal','gift','manual')),
  provider_order_id text unique,
  payer_email       text,
  status            text not null default 'completed' check (status in ('completed','refunded')),
  created_at        timestamptz not null default now(),
  unique (user_id, book_id)
);

-- Does the current user have full access to a book?
create or replace function public.has_book_access(p_book_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.books b
    where b.id = p_book_id and b.is_published
      and (b.price = 0 or exists (
        select 1 from public.purchases p
        where p.book_id = b.id and p.user_id = auth.uid() and p.status = 'completed'))
  );
$$;

-- Used by storage policy: may the current user read this file in the "books" bucket?
create or replace function public.can_read_book_file(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.books b
    where b.file_path = p_path and public.has_book_access(b.id)
  );
$$;

-- ---------------------------------------------------------------------
-- 4. READING PROGRESS, BOOKMARKS, WISHLIST, REVIEWS
-- ---------------------------------------------------------------------
create table if not exists public.reading_progress (
  user_id     uuid not null references auth.users(id) on delete cascade,
  book_id     uuid not null references public.books(id) on delete cascade,
  page        int  not null default 1,
  total_pages int,
  percent     numeric(5,2) default 0,
  zoom        numeric(4,2),
  finished    boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists public.bookmarks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  book_id     uuid not null references public.books(id) on delete cascade,
  page        int  not null,
  note        text default '',
  created_at  timestamptz not null default now()
);
create index if not exists bookmarks_user_book_idx on public.bookmarks (user_id, book_id);

create table if not exists public.wishlist (
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  book_id     uuid not null references public.books(id) on delete cascade,
  user_name   text,
  rating      int  not null check (rating between 1 and 5),
  comment     text default '',
  created_at  timestamptz not null default now(),
  unique (user_id, book_id)
);

-- Fill reviewer name from profile (so we never expose emails publicly)
create or replace function public.review_set_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select coalesce(nullif(full_name,''), 'Reader') into new.user_name
  from public.profiles where id = new.user_id;
  return new;
end $$;

drop trigger if exists reviews_set_name on public.reviews;
create trigger reviews_set_name before insert or update on public.reviews
  for each row execute function public.review_set_name();

-- Keep books.rating_avg / rating_count in sync
create or replace function public.refresh_book_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare bid uuid := coalesce(new.book_id, old.book_id);
begin
  update public.books b set
    rating_avg   = coalesce((select round(avg(rating)::numeric, 2) from public.reviews where book_id = bid), 0),
    rating_count = (select count(*) from public.reviews where book_id = bid)
  where b.id = bid;
  return null;
end $$;

drop trigger if exists reviews_refresh_rating on public.reviews;
create trigger reviews_refresh_rating after insert or update or delete on public.reviews
  for each row execute function public.refresh_book_rating();

-- Public counters (views / downloads) — callable by anyone, only increments
create or replace function public.increment_book_stat(p_book_id uuid, p_field text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_field = 'views' then
    update public.books set views = views + 1 where id = p_book_id and is_published;
  elsif p_field = 'downloads' then
    update public.books set downloads = downloads + 1 where id = p_book_id and is_published;
  end if;
end $$;

-- Admin helper: give a book to a reader by e-mail (gift / manual sale)
create or replace function public.admin_grant_book(p_email text, p_book_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select id into uid from public.profiles where lower(email) = lower(trim(p_email));
  if uid is null then return 'user_not_found'; end if;
  insert into public.purchases (user_id, book_id, amount, provider, status)
  values (uid, p_book_id, 0, 'gift', 'completed')
  on conflict (user_id, book_id) do update set status = 'completed';
  return 'ok';
end $$;

-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.books            enable row level security;
alter table public.purchases        enable row level security;
alter table public.reading_progress enable row level security;
alter table public.bookmarks        enable row level security;
alter table public.wishlist         enable row level security;
alter table public.reviews          enable row level security;

-- profiles
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self read"   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles self update" on public.profiles for update using (id = auth.uid() or public.is_admin());

-- books
drop policy if exists "books public read" on public.books;
drop policy if exists "books admin write" on public.books;
create policy "books public read" on public.books for select using (is_published or public.is_admin());
create policy "books admin write" on public.books for all using (public.is_admin()) with check (public.is_admin());

-- purchases
drop policy if exists "purchases own read"   on public.purchases;
drop policy if exists "purchases admin all"  on public.purchases;
create policy "purchases own read"  on public.purchases for select using (user_id = auth.uid() or public.is_admin());
create policy "purchases admin all" on public.purchases for all using (public.is_admin()) with check (public.is_admin());

-- reading_progress / bookmarks / wishlist: owner only
drop policy if exists "progress own" on public.reading_progress;
create policy "progress own" on public.reading_progress for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "bookmarks own" on public.bookmarks;
create policy "bookmarks own" on public.bookmarks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "wishlist own" on public.wishlist;
create policy "wishlist own" on public.wishlist for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reviews: everyone reads, owner writes, admin moderates
drop policy if exists "reviews read"        on public.reviews;
drop policy if exists "reviews own insert"  on public.reviews;
drop policy if exists "reviews own update"  on public.reviews;
drop policy if exists "reviews own delete"  on public.reviews;
create policy "reviews read"       on public.reviews for select using (true);
create policy "reviews own insert" on public.reviews for insert with check (user_id = auth.uid());
create policy "reviews own update" on public.reviews for update using (user_id = auth.uid());
create policy "reviews own delete" on public.reviews for delete using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- 6. STORAGE BUCKETS
--    covers  : public  (cover images)
--    samples : public  (free preview PDFs of paid books)
--    books   : PRIVATE (full PDFs — only readable when has_book_access)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('covers','covers', true)   on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('samples','samples', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('books','books', false)    on conflict (id) do update set public = false;

drop policy if exists "public read covers/samples" on storage.objects;
drop policy if exists "read book files with access" on storage.objects;
drop policy if exists "admin insert files" on storage.objects;
drop policy if exists "admin update files" on storage.objects;
drop policy if exists "admin delete files" on storage.objects;

create policy "public read covers/samples" on storage.objects for select
  using (bucket_id in ('covers','samples'));

create policy "read book files with access" on storage.objects for select
  using (bucket_id = 'books' and (public.is_admin() or public.can_read_book_file(name)));

create policy "admin insert files" on storage.objects for insert
  with check (bucket_id in ('covers','samples','books') and public.is_admin());
create policy "admin update files" on storage.objects for update
  using (bucket_id in ('covers','samples','books') and public.is_admin());
create policy "admin delete files" on storage.objects for delete
  using (bucket_id in ('covers','samples','books') and public.is_admin());

-- =====================================================================
--  AFTER you create your own account on the website, make yourself admin:
--    update public.profiles set role = 'admin' where email = 'you@example.com';
-- =====================================================================
