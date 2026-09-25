# Portal de Vagas em Dados · DSE Academy

Portal aberto e gratuito com vagas de **engenharia, análise, ciência de dados e ML no Brasil**,
feito pela comunidade de dados para a comunidade de dados.

- Busca com filtros por senioridade, stacks, empresa e modelo de trabalho
- Stacks identificadas automaticamente em cada vaga (taxonomia com ~95 skills, sinônimos PT/EN)
- **Perfil de competências**: as skills mais pedidas por área e nível, e o que falta no seu perfil
- **Aderência à vaga**: compara as suas skills com uma vaga específica
- **Meu perfil** com login por e-mail (Supabase): vagas salvas e skills em qualquer aparelho
- Coleta semanal automática (GitHub Actions) e publicação no GitHub Pages

## Arquitetura

```
Gupy (portal público de vagas)
   │  ingestion/gupy.py        coleta com paginação, retry, rate limit e trava de coleta suspeita
   ▼
data/raw/gupy_AAAAMMDD.json    JSON bruto (não versionado; guardado como artefato no CI)
   │  enrichment/schema.py     VagaBruta normalizada + deduplicação de republicações
   │  enrichment/taxonomia.py  stacks por palavra-chave (taxonomy.yaml)
   │  enrichment/extractor.py  senioridade e área pelo título; LLM opcional (Gemini/Ollama)
   ▼
app/build_site.py              gera site/ (HTML + CSS + JS + dados.js + config.js)
   ▼
GitHub Pages                   site estático; busca, filtros e perfis rodam no navegador
   ▲
Supabase (Auth + Postgres)     login por link no e-mail, perfis e vagas salvas (Row Level Security)
```

## Como rodar localmente

Requisitos: Python 3.13.

```bash
python -m venv .venv
.venv/Scripts/activate          # Windows (no Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt

python -m pytest -q             # testes
python -m ingestion.gupy        # coleta -> data/raw/
python -m app.build_site --servir   # gera site/ e serve em http://localhost:8765
```

Sem configuração do Supabase o portal funciona em **modo local**: as vagas salvas ficam só no navegador.

### Login (Supabase)

1. Crie um projeto no [Supabase](https://supabase.com) (plano gratuito).
2. Em **SQL Editor**, rode [`supabase/migrations/001_perfil_candidato.sql`](supabase/migrations/001_perfil_candidato.sql).
3. Em **Authentication → URL Configuration**: Site URL `http://localhost:8765` e Redirect URL `http://localhost:8765/**`
   (em produção, o endereço do GitHub Pages).
4. Copie `.env.example` para `.env` e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY`
   (a chave **publishable**/anon; nunca a *secret*/*service_role*).

O envio de e-mails padrão do Supabase tem limite baixo por hora; para uso real, configure um SMTP próprio.

### Enriquecimento com LLM (opcional)

Desligado por padrão: as stacks vêm da taxonomia por palavra-chave. Para separar obrigatórias de desejáveis:

```bash
python -m enrichment.extractor data/raw/gupy_AAAAMMDD.json --limite 50                 # Gemini (GEMINI_API_KEY)
python -m enrichment.extractor data/raw/gupy_AAAAMMDD.json --limite 50 --provedor ollama
```

## Automação

[`.github/workflows/pipeline.yml`](.github/workflows/pipeline.yml) roda **toda sexta às 02:00 (Brasília)**
e também manualmente (*Actions → Run workflow*): testes → coleta → build → publicação.
Se a coleta trouxer menos de 200 vagas, nada é publicado e o site anterior continua no ar.

Configuração no GitHub: *Settings → Pages → Source: GitHub Actions* e as variáveis
`SUPABASE_URL` e `SUPABASE_ANON_KEY` em *Settings → Secrets and variables → Actions → Variables*.

## Fonte dos dados e uso responsável

As vagas vêm do endpoint público que alimenta o portal de vagas da Gupy, que **não é uma API documentada
para terceiros**. A coleta é conservadora (1 requisição/s, User-Agent identificado, uma vez por semana)
e não captura dados pessoais.

> **Pendente:** revisar os termos de uso e o `robots.txt` da Gupy e registrar a conclusão aqui antes de
> tornar o portal público.

## Estrutura

```
ingestion/     conectores de fontes (gupy.py; greenhouse.py e lever.py planejados)
enrichment/    schema, taxonomia de skills e extração
app/           geração do site (dados.py, build_site.py) e front-end (web/)
supabase/      migrações do banco (perfis e vagas salvas)
tests/         testes (pytest)
```
