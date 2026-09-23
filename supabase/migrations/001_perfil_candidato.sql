-- Perfil do candidato e vagas salvas.
--
-- Rode no Supabase: Dashboard > SQL Editor > cole este arquivo > Run.
-- A autenticação (tabela auth.users) é do próprio Supabase; aqui ficam só os dados do portal.
-- Row Level Security garante que cada pessoa lê e altera apenas as próprias linhas,
-- mesmo com a chave pública (anon) exposta no site.

-- ---------------------------------------------------------------------------
-- Perfil: dados que a própria pessoa informa
-- ---------------------------------------------------------------------------
create table if not exists public.perfis (
  id            uuid primary key references auth.users (id) on delete cascade,
  nome          text check (char_length(nome) <= 120),
  habilidades   text[] not null default '{}' check (cardinality(habilidades) <= 100),
  area          text check (char_length(area) <= 40),
  senioridade   text check (char_length(senioridade) <= 40),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Vagas salvas: guarda um resumo para a vaga continuar listada depois de sair da coleta
-- ---------------------------------------------------------------------------
create table if not exists public.vagas_salvas (
  user_id  uuid not null references auth.users (id) on delete cascade default auth.uid(),
  vaga_id  text not null check (char_length(vaga_id) <= 80),
  titulo   text check (char_length(titulo) <= 300),
  empresa  text check (char_length(empresa) <= 200),
  url      text check (char_length(url) <= 1000),
  salva_em timestamptz not null default now(),
  primary key (user_id, vaga_id)
);

create index if not exists vagas_salvas_user_salva_em on public.vagas_salvas (user_id, salva_em desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.perfis enable row level security;
alter table public.vagas_salvas enable row level security;

drop policy if exists "perfil: dono lê" on public.perfis;
drop policy if exists "perfil: dono cria" on public.perfis;
drop policy if exists "perfil: dono altera" on public.perfis;
create policy "perfil: dono lê"     on public.perfis for select using (auth.uid() = id);
create policy "perfil: dono cria"   on public.perfis for insert with check (auth.uid() = id);
create policy "perfil: dono altera" on public.perfis for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "salvas: dono lê" on public.vagas_salvas;
drop policy if exists "salvas: dono cria" on public.vagas_salvas;
drop policy if exists "salvas: dono remove" on public.vagas_salvas;
create policy "salvas: dono lê"     on public.vagas_salvas for select using (auth.uid() = user_id);
create policy "salvas: dono cria"   on public.vagas_salvas for insert with check (auth.uid() = user_id);
create policy "salvas: dono remove" on public.vagas_salvas for delete using (auth.uid() = user_id);

-- Limite por pessoa, para ninguém usar a tabela como armazenamento genérico.
create or replace function public.limitar_vagas_salvas() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.vagas_salvas where user_id = new.user_id) >= 500 then
    raise exception 'limite de 500 vagas salvas atingido';
  end if;
  return new;
end $$;

drop trigger if exists limitar_vagas_salvas on public.vagas_salvas;
create trigger limitar_vagas_salvas before insert on public.vagas_salvas
  for each row execute function public.limitar_vagas_salvas();

-- ---------------------------------------------------------------------------
-- LGPD: a pessoa pode apagar a própria conta e todos os dados (cascata nas tabelas acima)
-- ---------------------------------------------------------------------------
create or replace function public.excluir_minha_conta() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.excluir_minha_conta() from public, anon;
grant execute on function public.excluir_minha_conta() to authenticated;
