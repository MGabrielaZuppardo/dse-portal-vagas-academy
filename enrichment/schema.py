"""Contrato de dados do pipeline.

Três modelos, um por etapa:

- VagaBruta:        saída dos conectores (ingestion/*). Só campos que a fonte entrega
                    estruturados, já normalizados para os enums abaixo.
- ExtracaoLLM:      o que o LLM devolve (structured output). Skills em texto livre.
- VagaEnriquecida:  ExtracaoLLM + skills mapeadas para a taxonomia + metadados de auditoria.

De-paras específicos de cada fonte (ex.: `vacancy_type_effective` -> CLT) ficam no
conector correspondente; aqui ficam só os enums canônicos e normalizações genéricas.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, computed_field


# ---------------------------------------------------------------------------
# Enums canônicos
# ---------------------------------------------------------------------------

class Fonte(StrEnum):
    GUPY = "gupy"
    GREENHOUSE = "greenhouse"
    LEVER = "lever"


class TipoContrato(StrEnum):
    CLT = "clt"
    PJ = "pj"
    ESTAGIO = "estagio"
    TRAINEE = "trainee"
    APRENDIZ = "aprendiz"
    TEMPORARIO = "temporario"
    COOPERADO = "cooperado"
    AUTONOMO = "autonomo"
    TERCEIRIZADO = "terceirizado"
    BANCO_TALENTOS = "banco_talentos"  # não é vaga aberta; filtrar na visualização
    OUTRO = "outro"


class ModeloTrabalho(StrEnum):
    REMOTO = "remoto"
    HIBRIDO = "hibrido"
    PRESENCIAL = "presencial"


class Senioridade(StrEnum):
    ENTRADA = "entrada"          # estágio, trainee
    JUNIOR = "junior"            # júnior, analista I, assistente
    PLENO = "pleno"              # pleno, analista II
    SENIOR = "senior"            # sênior, analista III
    ESPECIALISTA = "especialista"  # especialista, staff, principal, tech lead
    GESTAO = "gestao"            # coordenação, gerência, head
    NAO_IDENTIFICADA = "nao_identificada"


class Area(StrEnum):
    ENGENHARIA_DADOS = "engenharia_dados"
    ANALISE_DADOS = "analise_dados"
    CIENCIA_DADOS = "ciencia_dados"
    ML_ENGINEERING = "ml_engineering"
    ANALYTICS_ENGINEERING = "analytics_engineering"
    BI = "bi"
    GOVERNANCA_DADOS = "governanca_dados"
    DBA = "dba"
    GESTAO_DADOS = "gestao_dados"
    NEGOCIO_COM_DADOS = "negocio_com_dados"  # função de negócio que usa dados (comercial, RH, operações...)
    FORA_DO_ESCOPO = "fora_do_escopo"  # "dados" em outro sentido (privacidade/LGPD, redes, coleta/digitação)


class GrupoAfirmativo(StrEnum):
    MULHERES = "mulheres"
    PESSOAS_NEGRAS = "pessoas_negras"
    PCD = "pcd"
    LGBTQIAPN = "lgbtqiapn"
    PESSOAS_50_MAIS = "pessoas_50_mais"
    INDIGENAS = "indigenas"
    OUTRO = "outro"


# ---------------------------------------------------------------------------
# Normalizações genéricas
# ---------------------------------------------------------------------------

def normalizar_texto(texto: str | None) -> str:
    """Minúsculas, sem acento, espaços colapsados. Usado em chaves e comparações."""
    if not texto:
        return ""
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sem_acento).strip().lower()


_UF_POR_NOME = {
    "acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM", "bahia": "BA",
    "ceara": "CE", "distrito federal": "DF", "espirito santo": "ES", "goias": "GO",
    "maranhao": "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
    "minas gerais": "MG", "para": "PA", "paraiba": "PB", "parana": "PR",
    "pernambuco": "PE", "piaui": "PI", "rio de janeiro": "RJ",
    "rio grande do norte": "RN", "rio grande do sul": "RS", "rondonia": "RO",
    "roraima": "RR", "santa catarina": "SC", "sao paulo": "SP", "sergipe": "SE",
    "tocantins": "TO",
}
UFS = frozenset(_UF_POR_NOME.values())


def uf_de(estado: str | None) -> str | None:
    """'São Paulo' -> 'SP'. Aceita também a sigla. Retorna None se não reconhecer."""
    chave = normalizar_texto(estado)
    if not chave:
        return None
    if chave.upper() in UFS:
        return chave.upper()
    return _UF_POR_NOME.get(chave)


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

class VagaBruta(BaseModel):
    """Vaga como coletada, com os campos estruturados da fonte já normalizados."""

    model_config = ConfigDict(frozen=True)

    fonte: Fonte
    source_id: str
    titulo: str
    empresa: str
    empresa_id: str | None = None
    descricao: str
    url: str

    pais: str | None = None
    uf: str | None = None
    cidade: str | None = None
    modelo_trabalho: ModeloTrabalho | None = None
    tipo_contrato: TipoContrato | None = None
    pcd: bool | None = None  # vaga aceita/é exclusiva para PcD

    publicada_em: datetime
    prazo_candidatura: date | None = None
    coletada_em: datetime

    # Chaves de outras publicações da mesma vaga, absorvidas por deduplicar().
    duplicatas: list[str] = Field(default_factory=list)

    # Payload original da fonte: permite remapear campos sem coletar de novo.
    payload: dict[str, Any] = Field(default_factory=dict, repr=False)

    @computed_field
    @property
    def chave(self) -> str:
        """Chave natural dentro da fonte (upsert)."""
        return f"{self.fonte}:{self.source_id}"

    @computed_field
    @property
    def hash_dedup(self) -> str:
        """Identifica a mesma vaga publicada em fontes diferentes (título + empresa + cidade)."""
        base = "|".join(normalizar_texto(x) for x in (self.titulo, self.empresa, self.cidade))
        return hashlib.sha256(base.encode()).hexdigest()[:16]


def deduplicar(vagas: list[VagaBruta]) -> list[VagaBruta]:
    """Republicações da mesma vaga (mesmo hash_dedup) contam como uma só.

    Representante do grupo: a vaga aberta (não banco de talentos) publicada mais
    recentemente. As chaves das demais ficam em `duplicatas`.
    """
    grupos: dict[str, list[VagaBruta]] = {}
    for v in vagas:
        grupos.setdefault(v.hash_dedup, []).append(v)

    resultado = []
    for grupo in grupos.values():
        grupo.sort(key=lambda v: (v.tipo_contrato != TipoContrato.BANCO_TALENTOS, v.publicada_em), reverse=True)
        principal, *demais = grupo
        if demais:
            principal = principal.model_copy(update={"duplicatas": [v.chave for v in demais]})
        resultado.append(principal)
    return resultado


class ExtracaoLLM(BaseModel):
    """Schema de structured output enviado ao LLM. Mantenha simples: sem validações
    que o modelo não consiga respeitar, e descrições que funcionem como instrução."""

    area: Area = Field(description="Área principal da vaga. Use fora_do_escopo se não for uma vaga de dados.")
    senioridade: Senioridade
    senioridade_inferida: bool = Field(
        description="true se a senioridade NÃO estiver explícita no título e foi deduzida pelos requisitos."
    )
    anos_experiencia_min: int | None = Field(default=None, description="Menor número de anos exigido, se citado.")
    skills_obrigatorias: list[str] = Field(
        default_factory=list, description="Tecnologias/ferramentas exigidas, como aparecem no texto."
    )
    skills_desejaveis: list[str] = Field(
        default_factory=list, description="Tecnologias/ferramentas marcadas como diferencial/desejável."
    )
    afirmativa: list[GrupoAfirmativo] = Field(
        default_factory=list, description="Grupos para os quais a vaga é afirmativa ou exclusiva. Vazio se nenhuma."
    )
    salario_min: float | None = Field(default=None, description="Salário mensal mínimo em R$, se informado.")
    salario_max: float | None = Field(default=None, description="Salário mensal máximo em R$, se informado.")


class VagaEnriquecida(BaseModel):
    """Resultado do enriquecimento, ligado à VagaBruta por `chave`."""

    chave: str
    extracao: ExtracaoLLM

    # Preenchidos após o LLM, pelo mapeamento determinístico com taxonomy.yaml
    skills_obrigatorias: list[str] = Field(default_factory=list)  # ids canônicos
    skills_desejaveis: list[str] = Field(default_factory=list)    # ids canônicos
    skills_nao_mapeadas: list[str] = Field(default_factory=list)  # vão para revisão manual

    prompt_version: str
    modelo_llm: str
    enriquecida_em: datetime
