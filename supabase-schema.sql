drop table if exists public.comment_replies cascade;
drop table if exists public.comments cascade;
drop table if exists public.posts cascade;
drop table if exists public.characters cascade;
drop table if exists public.profiles cascade;

create table public.profiles (
  id text primary key,
  display_name text not null default '匿名玩家',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.characters (
  id text primary key,
  owner_id text not null references public.profiles(id) on delete cascade,
  name text not null,
  handle text not null,
  personality text,
  appearance text,
  speaking_style text,
  avatar_url text,
  prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(handle)
);

create table public.posts (
  id text primary key default ('post_' || gen_random_uuid()::text),
  author_id text not null references public.profiles(id) on delete cascade,
  character_id text not null,
  text text not null,
  image_url text,
  created_at timestamptz not null default now()
);

create table public.comments (
  id text primary key default ('comment_' || gen_random_uuid()::text),
  post_id text not null references public.posts(id) on delete cascade,
  author_id text not null references public.profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table public.comment_replies (
  id text primary key default ('reply_' || gen_random_uuid()::text),
  comment_id text not null references public.comments(id) on delete cascade,
  character_id text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index characters_owner_id_idx on public.characters(owner_id);
create index characters_handle_idx on public.characters(handle);
create index posts_created_at_idx on public.posts(created_at desc);
create index posts_character_id_idx on public.posts(character_id);
create index comments_post_id_idx on public.comments(post_id);
create index comment_replies_comment_id_idx on public.comment_replies(comment_id);
