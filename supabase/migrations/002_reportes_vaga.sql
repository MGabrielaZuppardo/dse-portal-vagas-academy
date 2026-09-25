-- Relatos de erro enviados pelas pessoas na página de cada vaga ("Algo errado nesta vaga?").
--
-- Rode no Supabase: Dashboard > SQL Editor > cole este arquivo > Run.
-- Qualquer pessoa pode ENVIAR um relato (logada ou não); ninguém consegue LER pelo site.
-- A leitura é feita pelo painel do Supabase (Table Editor ou SQL Editor), que ignora a RLS.

create table if not exists public.reportes_vaga (
  id        bigint generated always as identity primary key,
  vaga_id   text not null check (char_length(vaga_id) <= 80),
  titulo    text check (char_length(titulo) <= 300),
  empresa   text check (char_length(empresa) <= 200),
  url       text check (char_length(url) <= 1000),
  tipo      text not null check (tipo in ('stack_errada', 'nao_e_vaga_de_dados', 'senioridade_errada', 'vaga_encerrada', 'outro')),
  stacks    text[] not null default '{}' check (cardinality(stacks) <= 30),  -- stacks marcadas como erradas
  detalhe   text check (char_length(detalhe) <= 500),
  user_id   uuid references auth.users (id) on delete set null default auth.uid(),  -- null quando anônimo
  criado_em timestamptz not null default now()
);

create index if not exists reportes_vaga_tipo_criado on public.reportes_vaga (tipo, criado_em desc);
create index if not exists reportes_vaga_vaga on public.reportes_vaga (vaga_id);

alter table public.reportes_vaga enable row level security;

-- Só inserção. Quem está logado não pode atribuir o relato a outra pessoa;
-- anônimos gravam user_id nulo. Sem política de SELECT/UPDATE/DELETE: o site não lê nem altera.
drop policy if exists "reportes: qualquer pessoa envia" on public.reportes_vaga;
create policy "reportes: qualquer pessoa envia" on public.reportes_vaga
  for insert to anon, authenticated
  with check (user_id is not distinct from auth.uid());

-- Consultas úteis (rode no SQL Editor):
--
--   -- volume por tipo
--   select tipo, count(*) from public.reportes_vaga group by tipo order by 2 desc;
--
--   -- stacks mais apontadas como erradas (candidatas a ajuste na taxonomy.yaml)
--   select s as stack, count(*) from public.reportes_vaga, unnest(stacks) s
--   where tipo = 'stack_errada' group by s order by 2 desc;
--
--   -- vagas apontadas como "não é vaga de dados" (candidatas à camada 1 da classificação)
--   select titulo, count(*) from public.reportes_vaga
--   where tipo = 'nao_e_vaga_de_dados' group by titulo order by 2 desc;
