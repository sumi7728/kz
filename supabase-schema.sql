drop table if exists public.comment_replies cascade;
drop table if exists public.comments cascade;
drop table if exists public.posts cascade;
drop table if exists public.ai_character_requests cascade;
drop table if exists public.ai_character_settings cascade;
drop table if exists public.characters cascade;
drop table if exists public.profiles cascade;

create extension if not exists pgcrypto;

create table public.profiles (
  id text primary key,
  username text unique not null,
  password_hash text not null,
  role text not null default 'player' check (role in ('player', 'admin')),
  display_name text not null default '玩家',
  avatar_url text,
  player_character_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index only_one_admin_idx on public.profiles(role) where role = 'admin';

create table public.characters (
  id text primary key,
  owner_id text not null references public.profiles(id) on delete cascade,
  name text not null,
  handle text unique not null,
  personality text,
  appearance text,
  speaking_style text,
  avatar_url text,
  prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_character_settings (
  id text primary key default ('mem_' || gen_random_uuid()::text),
  owner_id text not null references public.profiles(id) on delete cascade,
  character_id text not null,
  memory text,
  interaction_mode text,
  nickname text,
  rules text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, character_id)
);

create table public.ai_character_requests (
  id text primary key default ('request_' || gen_random_uuid()::text),
  owner_id text not null references public.profiles(id) on delete cascade,
  name text not null,
  handle text not null,
  concept text,
  personality text,
  appearance text,
  speaking_style text,
  prompt text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.posts (
  id text primary key default ('post_' || gen_random_uuid()::text),
  author_id text not null references public.profiles(id) on delete cascade,
  character_id text not null,
  ai_character_id text,
  text text not null,
  image_url text,
  created_at timestamptz not null default now()
);

create table public.comments (
  id text primary key default ('comment_' || gen_random_uuid()::text),
  post_id text not null references public.posts(id) on delete cascade,
  author_id text not null references public.profiles(id) on delete cascade,
  text text not null,
  ai_character_id text,
  created_at timestamptz not null default now()
);

create table public.comment_replies (
  id text primary key default ('reply_' || gen_random_uuid()::text),
  comment_id text not null references public.comments(id) on delete cascade,
  character_id text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index profiles_username_idx on public.profiles(username);
create index characters_owner_id_idx on public.characters(owner_id);
create index characters_handle_idx on public.characters(handle);
create index ai_character_settings_owner_idx on public.ai_character_settings(owner_id);
create index ai_character_requests_owner_idx on public.ai_character_requests(owner_id);
create index ai_character_requests_status_idx on public.ai_character_requests(status);
create index posts_created_at_idx on public.posts(created_at desc);
create index posts_author_id_idx on public.posts(author_id);
create index posts_character_id_idx on public.posts(character_id);
create index posts_ai_character_id_idx on public.posts(ai_character_id);
create index comments_post_id_idx on public.comments(post_id);
create index comments_ai_character_id_idx on public.comments(ai_character_id);
create index comment_replies_comment_id_idx on public.comment_replies(comment_id);
