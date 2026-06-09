create table if not exists public.profiles (
  id text primary key,
  display_name text not null default '匿名玩家',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.profiles(id) on delete cascade,
  name text not null,
  personality text,
  appearance text,
  speaking_style text,
  avatar_url text,
  prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id text not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id text not null references public.profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.comment_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists characters_owner_id_idx on public.characters(owner_id);
create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists posts_character_id_idx on public.posts(character_id);
create index if not exists comments_post_id_idx on public.comments(post_id);
create index if not exists comment_replies_comment_id_idx on public.comment_replies(comment_id);
