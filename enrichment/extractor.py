"""Enriquecimento de vagas com LLM (Gemini, structured output).

O LLM extrai área, senioridade e skills em texto livre (ExtracaoLLM); o mapeamento
das skills para a taxonomia é feito depois, em código, para ser determinístico e
auditável.

Provedores:
- gemini (padrão): camada gratuita da API. Requer GEMINI_API_KEY (no ambiente ou no
  arquivo .env). Modelo por GEMINI_MODEL; requisições por minuto por GEMINI_RPM.
- ollama: local e gratuito, mais lento. Requer o Ollama rodando e o modelo baixado.
  Modelo por OLLAMA_MODEL.

A saída é incremental: vagas que já estão no .jsonl são puladas, então dá para
reexecutar no dia seguinte quando a cota diária da camada gratuita acabar.

Uso:
    python -m enrichment.extractor data/raw/gupy_20260922.json --limite 50   # amostra
    python -m enrichment.extractor data/raw/gupy_20260922.json --limite 0    # todas
    python -m enrichment.extractor data/raw/gupy_20260922.json --provedor ollama
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

from dotenv import load_dotenv

from enrichment.schema import (
    Area,
    ExtracaoLLM,
    Senioridade,
    TipoContrato,
    VagaBruta,
    VagaEnriquecida,
    deduplicar,
    normalizar_texto,
)
from enrichment.taxonomia import Taxonomia, chave_skill

log = logging.getLogger(__name__)
load_dotenv()  # antes das constantes abaixo, que leem o ambiente

# Incremente sempre que mudar SYSTEM_PROMPT, montar_prompt ou ExtracaoLLM.
PROMPT_VERSION = "v3"
MODELO_OLLAMA = os.environ.get("OLLAMA_MODEL") or "qwen2.5:7b"
MODELO_GEMINI = os.environ.get("GEMINI_MODEL") or "gemini-3.6-flash"
OLLAMA_URL = os.environ.get("OLLAMA_URL") or "http://localhost:11434"
# Limites da camada gratuita mudam com frequência: confira em https://ai.google.dev/gemini-api/docs/rate-limits
GEMINI_RPM = float(os.environ.get("GEMINI_RPM") or "8")
MAX_CHARS_DESCRICAO = 12_000
MAX_TOKENS_RESPOSTA = 1024  # corta respostas em loop (listas intermináveis)
MAX_PALAVRAS_SKILL = 4  # itens mais longos são frases, não skills
MAX_TENTATIVAS = 4

SYSTEM_PROMPT = """\
Você extrai informações estruturadas de vagas de emprego brasileiras da área de dados.
Responda apenas com o JSON do schema. Não invente: se a informação não estiver na vaga, use o valor vazio/nulo.

## area
- engenharia_dados: pipelines, ingestão, ETL/ELT, plataforma de dados, data lake/warehouse.
- analise_dados: análise, relatórios, KPIs, SQL/Excel para apoiar o negócio.
- ciencia_dados: modelos estatísticos/preditivos, experimentação.
- ml_engineering: colocar modelos em produção, MLOps, IA generativa aplicada.
- analytics_engineering: modelagem de dados para consumo analítico (dbt, camadas semânticas).
- bi: dashboards e ferramentas de BI (Power BI, Tableau, Looker) como atividade principal.
- governanca_dados: governança, qualidade, catálogo, data owners.
- dba: administração de bancos de dados.
- gestao_dados: liderança de times ou áreas de dados.
- negocio_com_dados: função de negócio (comercial, finanças, RH, operações, marketing...)
  que usa dados como parte do trabalho, mas não é uma vaga de dados.
- fora_do_escopo: a vaga cita "dados" em outro sentido (ex.: privacidade/LGPD jurídica,
  redes de dados/telecom, coleta ou digitação de dados).

## senioridade
Use o título primeiro:
- entrada: estágio, trainee, aprendiz.
- junior: júnior, jr, analista I, assistente.
- pleno: pleno, pl, analista II.
- senior: sênior, sr, analista III.
- especialista: especialista, staff, principal, tech lead, arquiteto(a).
- gestao: coordenador(a), gerente, head, diretor(a).
Se o título não indicar o nível, deduza pelos requisitos (anos de experiência, escopo, autonomia)
e marque senioridade_inferida = true. Se não houver base para deduzir, use nao_identificada.

## skills
- Apenas competências técnicas: linguagens, ferramentas, plataformas, bancos, serviços de cloud,
  bibliotecas, métodos técnicos (ex.: estatística, modelagem dimensional, ETL).
- NÃO inclua soft skills, idiomas, formação acadêmica nem conhecimento de negócio.
- Inclua SOMENTE o que está escrito no texto da vaga. Nunca complete a lista com tecnologias
  comuns da área que a vaga não cita.
- Um item por tecnologia, com 1 a 4 palavras: "AWS (S3, Glue)" deve virar "AWS", "S3", "Glue".
  Não inclua responsabilidades ou atividades ("geração de relatórios", "documentação").
- skills_desejaveis: itens marcados como diferencial, desejável, "nice to have", "será um plus".
  Todo o resto que for requisito vai em skills_obrigatorias. Não repita um item nas duas listas.

## afirmativa
Grupos para os quais a vaga é afirmativa ou exclusiva (ex.: "vaga afirmativa para mulheres").
Frases genéricas de diversidade ("todas as pessoas são bem-vindas") NÃO tornam a vaga afirmativa.

## salário
Valores mensais em reais, só se explicitamente informados. Não converta benefícios em salário.
"""


def montar_prompt(vaga: VagaBruta) -> str:
    descricao = vaga.descricao[:MAX_CHARS_DESCRICAO]
    return (
        f"Título: {vaga.titulo}\n"
        f"Empresa: {vaga.empresa}\n"
        f"Tipo de contrato: {vaga.tipo_contrato or 'não informado'}\n"
        f"Modelo de trabalho: {vaga.modelo_trabalho or 'não informado'}\n\n"
        f"Descrição:\n{descricao}"
    )


# Regras de título/contrato: quando o nível está explícito, não depende do LLM.
# Ordem importa: a primeira regra que casar vence ("Tech Lead Sênior" -> especialista).
_SENIORIDADE_TITULO = [
    (Senioridade.ENTRADA, r"est[aá]gi|trainee|aprendiz"),
    (Senioridade.GESTAO, r"coordena|gerente|\bhead\b|\bdiretora?\b|superintendente"),
    (Senioridade.ESPECIALISTA, r"especialista|staff|principal|tech ?lead|arquitet"),
    (Senioridade.SENIOR, r"s[eê]nior|\bsr\b|\biii\b"),
    (Senioridade.PLENO, r"pleno|\bpl\b|\bii\b"),
    (Senioridade.JUNIOR, r"j[uú]nior|\bjr\b|\bi\b|assistente"),
]
_CONTRATO_ENTRADA = {TipoContrato.ESTAGIO, TipoContrato.TRAINEE, TipoContrato.APRENDIZ}


def senioridade_explicita(vaga: VagaBruta) -> Senioridade | None:
    if vaga.tipo_contrato in _CONTRATO_ENTRADA:
        return Senioridade.ENTRADA
    for nivel, padrao in _SENIORIDADE_TITULO:
        if re.search(padrao, vaga.titulo, re.IGNORECASE):
            return nivel
    return None


# Área pelo título, para vagas sem enriquecimento por LLM, em três camadas. Os padrões
# rodam sobre o título normalizado (minúsculas, sem acento). Ordem importa: a primeira
# regra que casar vence ("Gerente de Engenharia de Dados" -> gestão; "Analytics Engineer" -> AE).

# Camada 1: "dados" em outro sentido (jurídico/privacidade, telecom, atendimento, digitação).
_FORA_DO_ESCOPO = re.compile(
    r"privacidade|protecao de dados|advogad|juridic|telecomunica|comunicacao de dados"
    r"|redes (e )?(de )?comunica|coleta de dados|processamento de dados|eletrotecnic"
)

# Camada 2: áreas de dados, incluindo as variações comuns na Gupy
# ("Analista Dados JR", "Eng de Dados", "Arquiteto(a) de Dados", "Estagiário(a) - Dados").
_AREA_TITULO = [
    (Area.GESTAO_DADOS, r"coordena|gerente|\bhead\b|\bdiretora?\b|superintendente|tech lead|squad leader|product owner"),
    (Area.ANALYTICS_ENGINEERING, r"analytics engineer"),
    (Area.ML_ENGINEERING, r"machine learning|\bml\b|mlops|\bllm|\bia\b|inteligencia artificial"),
    (Area.ENGENHARIA_DADOS, r"engenh|engineer|data platform|\beng\.? (de )?dados|arquitet\w*(\(a\))? (e eng\. )?de dados"
                            r"|arquitetura de dados|plataforma de dados|infraestrutura (para|de) dados|observabilidade de dados"),
    (Area.CIENCIA_DADOS, r"cientista|scientist|ciencia de dados"),
    (Area.GOVERNANCA_DADOS, r"governanca|data governance|qualidade de dados|data quality|dados mestres|master data"
                            r"|gestao de dados|controle de dados"),
    (Area.DBA, r"\bdba\b|banco (de )?dados|database admin|administrador\w*(\(a\))? (de )?dados"),
    (Area.BI, r"\bbi\b|business intelligence|power ?bi"),
    (Area.ANALISE_DADOS, r"analista de dados|data analyst|analise de dados|analytics|analista (de )?intelig"
                         r"|analista (jr |pl |sr |junior |pleno |senior )?(de )?dados|especialista (de|em) dados"
                         r"|estagi\w*(\(a\))?( -)? (de )?dados|estagio (em|de) dados|aprendiz de dados"
                         r"|consultor\w*(\(a\))? de dados|assistente de dados|dados e indicadores|inteligencia de dados"),
]

# Camada 3: sobrou "dados"/"data" no título -> função de negócio que usa dados
# ("Analista Comercial | Dados", "Analista de RH (foco em dados)").
_CITA_DADOS = re.compile(r"\bdados\b|\bdata\b")


def classificar_area(titulo: str) -> Area | None:
    """Área da vaga pelo título. None quando o título não indica nada relacionado a dados."""
    t = normalizar_texto(titulo)
    if _FORA_DO_ESCOPO.search(t):
        return Area.FORA_DO_ESCOPO
    for area, padrao in _AREA_TITULO:
        if re.search(padrao, t):
            return area
    if _CITA_DADOS.search(t):
        return Area.NEGOCIO_COM_DADOS
    return None


def _citada(skill: str, texto_vaga: str) -> bool:
    """Anti-alucinação: a skill (ou, se tiver parênteses, a parte fora deles) aparece na vaga."""
    base = chave_skill(re.sub(r"\(.*?\)", "", skill))
    return bool(base) and base in texto_vaga


class CotaEsgotada(RuntimeError):
    """429 persistente: provavelmente a cota diária acabou. Interrompe o lote."""


# Assinatura do cliente LLM: (system_prompt, prompt) -> JSON (texto). Injetável nos testes.
ChamadaLLM = Callable[[str, str], str]


def cliente_ollama(modelo: str = MODELO_OLLAMA, url: str = OLLAMA_URL) -> ChamadaLLM:
    import httpx

    client = httpx.Client(base_url=url, timeout=300)
    schema = ExtracaoLLM.model_json_schema()

    def chamar(system_prompt: str, prompt: str) -> str:
        r = client.post("/api/chat", json={
            "model": modelo,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "format": schema,  # structured output: a resposta segue o JSON schema
            "stream": False,
            "options": {"temperature": 0, "num_ctx": 8192, "num_predict": MAX_TOKENS_RESPOSTA},
        })
        r.raise_for_status()
        return r.json()["message"]["content"]

    return chamar


def cliente_gemini(modelo: str = MODELO_GEMINI, rpm: float = GEMINI_RPM) -> ChamadaLLM:
    from google import genai
    from google.genai import errors, types

    if not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
        raise SystemExit("Defina GEMINI_API_KEY no .env (crie a chave em https://aistudio.google.com/apikey).")

    client = genai.Client()
    intervalo = 60 / rpm
    ultima = 0.0

    def chamar(system_prompt: str, prompt: str) -> str:
        nonlocal ultima
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            response_schema=ExtracaoLLM,
            temperature=0,
            max_output_tokens=MAX_TOKENS_RESPOSTA,
            # Tokens de raciocínio contam no limite de saída e na cota; extração não precisa deles.
            thinking_config=(
                types.ThinkingConfig(thinking_budget=0) if modelo.startswith("gemini-2.5")
                else types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)
            ),
        )
        for tentativa in range(1, MAX_TENTATIVAS + 1):
            time.sleep(max(0.0, ultima + intervalo - time.monotonic()))  # respeita o limite por minuto
            ultima = time.monotonic()
            try:
                return client.models.generate_content(model=modelo, contents=prompt, config=config).text
            except errors.APIError as e:
                if e.code not in (429, 500, 503):
                    raise
                if tentativa == MAX_TENTATIVAS:
                    if e.code == 429:
                        raise CotaEsgotada(str(e)) from e
                    raise
                espera = 30 * tentativa if e.code == 429 else 2 ** tentativa
                log.warning("Gemini %s, nova tentativa em %ss", e.code, espera)
                time.sleep(espera)
        raise AssertionError("inalcançável")

    return chamar


class Extrator:
    def __init__(self, llm: ChamadaLLM, modelo: str, taxonomia: Taxonomia | None = None):
        self.llm = llm
        self.modelo = modelo
        self.taxonomia = taxonomia or Taxonomia.carregar()

    def extrair(self, vaga: VagaBruta) -> ExtracaoLLM:
        """Chama o LLM e aplica as regras determinísticas por cima da resposta."""
        extracao = ExtracaoLLM.model_validate_json(self.llm(SYSTEM_PROMPT, montar_prompt(vaga)))
        texto_vaga = chave_skill(f"{vaga.titulo} {vaga.descricao}")

        def validas(skills: list[str]) -> list[str]:
            return [s for s in skills if _citada(s, texto_vaga) and len(s.split()) <= MAX_PALAVRAS_SKILL]

        atualizacao: dict = {
            "skills_obrigatorias": validas(extracao.skills_obrigatorias),
            "skills_desejaveis": validas(extracao.skills_desejaveis),
        }
        if nivel := senioridade_explicita(vaga):
            atualizacao |= {"senioridade": nivel, "senioridade_inferida": False}
        elif extracao.senioridade != Senioridade.NAO_IDENTIFICADA:
            atualizacao["senioridade_inferida"] = True
        return extracao.model_copy(update=atualizacao)

    def enriquecer(self, vaga: VagaBruta) -> VagaEnriquecida:
        extracao = self.extrair(vaga)
        obrigatorias, nao_mapeadas_obr = self.taxonomia.mapear(extracao.skills_obrigatorias)
        desejaveis, nao_mapeadas_des = self.taxonomia.mapear(extracao.skills_desejaveis)
        desejaveis = [s for s in desejaveis if s not in obrigatorias]
        nao_mapeadas = list(dict.fromkeys(nao_mapeadas_obr + nao_mapeadas_des))

        return VagaEnriquecida(
            chave=vaga.chave,
            extracao=extracao,
            skills_obrigatorias=obrigatorias,
            skills_desejaveis=desejaveis,
            skills_nao_mapeadas=nao_mapeadas,
            prompt_version=PROMPT_VERSION,
            modelo_llm=self.modelo,
            enriquecida_em=datetime.now(timezone.utc),
        )

    def enriquecer_lote(self, vagas: Iterable[VagaBruta]) -> Iterable[VagaEnriquecida]:
        """Enriquece em sequência. Falhas pontuais são logadas e a vaga fica para a próxima
        execução; cota esgotada interrompe o lote."""
        for vaga in vagas:
            try:
                yield self.enriquecer(vaga)
            except CotaEsgotada:
                log.error("cota do provedor esgotada; reexecute mais tarde para continuar")
                return
            except Exception:
                log.exception("falha ao enriquecer %s", vaga.chave)


# ---------------------------------------------------------------------------

def main() -> None:
    from ingestion.gupy import normalizar

    parser = argparse.ArgumentParser(description="Enriquece uma amostra de vagas brutas da Gupy.")
    parser.add_argument("bruto", type=Path, help="JSON bruto gerado por ingestion.gupy")
    parser.add_argument("--limite", type=int, default=50, help="tamanho da amostra aleatória (0 = todas)")
    parser.add_argument("--semente", type=int, default=42)
    parser.add_argument("--saida", type=Path, default=Path("data/enriched"))
    parser.add_argument("--provedor", choices=["gemini", "ollama"], default="gemini")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    for ruidoso in ("httpx", "google_genai"):
        logging.getLogger(ruidoso).setLevel(logging.WARNING)
    coletada_em = datetime.fromtimestamp(args.bruto.stat().st_mtime, timezone.utc)
    payloads = json.loads(args.bruto.read_text(encoding="utf-8"))
    vagas = deduplicar(normalizar(payloads, coletada_em))
    if args.limite:
        vagas = random.Random(args.semente).sample(vagas, min(args.limite, len(vagas)))

    if args.provedor == "ollama":
        extrator = Extrator(cliente_ollama(), f"ollama/{MODELO_OLLAMA}")
    else:
        extrator = Extrator(cliente_gemini(), f"gemini/{MODELO_GEMINI}")
    args.saida.mkdir(parents=True, exist_ok=True)
    arquivo = args.saida / f"{args.bruto.stem}_{PROMPT_VERSION}_{args.provedor}.jsonl"

    feitas = set()
    if arquivo.exists():
        feitas = {json.loads(linha)["chave"] for linha in arquivo.read_text(encoding="utf-8").splitlines() if linha}
    pendentes = [v for v in vagas if v.chave not in feitas]
    titulos = {v.chave: v.titulo for v in pendentes}
    log.info("%d selecionadas, %d já enriquecidas, %d pendentes", len(vagas), len(vagas) - len(pendentes), len(pendentes))

    n = 0
    with arquivo.open("a", encoding="utf-8") as f:
        for enriquecida in extrator.enriquecer_lote(pendentes):
            linha = {"titulo": titulos[enriquecida.chave], **enriquecida.model_dump(mode="json")}
            f.write(json.dumps(linha, ensure_ascii=False) + "\n")
            f.flush()
            n += 1
    log.info("%d/%d pendentes enriquecidas em %s", n, len(pendentes), arquivo)


if __name__ == "__main__":
    main()
