"""Conector Gupy.

Usa o endpoint público que alimenta o portal de vagas (não é uma API documentada
para terceiros): coleta com rate limit conservador e User-Agent identificado.

Uso:
    python -m ingestion.gupy            # coleta e salva em data/raw/gupy_<data>.json
"""

from __future__ import annotations

import html
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import httpx

from enrichment.schema import (
    Fonte,
    ModeloTrabalho,
    TipoContrato,
    VagaBruta,
    deduplicar,
    normalizar_texto,
    uf_de,
)

log = logging.getLogger(__name__)

BASE_URL = "https://employability-portal.gupy.io/api/v1/jobs"
USER_AGENT = "portal-vagas-dados-academy/0.1 (projeto comunitario; coleta de vagas de dados)"

TERMOS_BUSCA = [
    "dados",
    "engenheiro de dados",
    "data engineer",
    "analista de dados",
    "cientista de dados",
    "data scientist",
    "analytics engineer",
    "machine learning",
    "mlops",
    "BI",
    "power bi",
]

PAGE_SIZE = 100
PAUSA_ENTRE_REQUISICOES = 1.0  # segundos
MAX_TENTATIVAS = 4

# O campo `pagination.total` da resposta não é confiável (com limit=100 volta 100):
# a paginação termina quando a página vem vazia.

TIPO_CONTRATO_GUPY = {
    "vacancy_type_effective": TipoContrato.CLT,
    "vacancy_legal_entity": TipoContrato.PJ,
    "vacancy_type_internship": TipoContrato.ESTAGIO,
    "vacancy_type_trainee": TipoContrato.TRAINEE,
    "vacancy_type_apprentice": TipoContrato.APRENDIZ,
    "vacancy_type_temporary": TipoContrato.TEMPORARIO,
    "vacancy_type_associate": TipoContrato.COOPERADO,
    "vacancy_type_autonomous": TipoContrato.AUTONOMO,
    "vacancy_type_outsource": TipoContrato.TERCEIRIZADO,
    "vacancy_type_talent_pool": TipoContrato.BANCO_TALENTOS,
    "vacancy_type_parter": TipoContrato.OUTRO,  # sic, grafia da própria Gupy
}

MODELO_TRABALHO_GUPY = {
    "remote": ModeloTrabalho.REMOTO,
    "hybrid": ModeloTrabalho.HIBRIDO,
    "on-site": ModeloTrabalho.PRESENCIAL,
}


# ---------------------------------------------------------------------------
# Coleta
# ---------------------------------------------------------------------------

def _get(client: httpx.Client, params: dict[str, Any]) -> dict[str, Any]:
    """GET com backoff exponencial para 429/5xx e erros de rede."""
    for tentativa in range(1, MAX_TENTATIVAS + 1):
        try:
            r = client.get(BASE_URL, params=params)
            if r.status_code == 429 or r.status_code >= 500:
                raise httpx.HTTPStatusError(f"status {r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return r.json()
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if tentativa == MAX_TENTATIVAS or (status is not None and 400 <= status < 500 and status != 429):
                raise
            espera = 2 ** tentativa
            log.warning("falha em %s (%s), nova tentativa em %ss", params, e, espera)
            time.sleep(espera)
    raise AssertionError("inalcançável")


def buscar_termo(client: httpx.Client, termo: str) -> Iterable[dict[str, Any]]:
    offset = 0
    while True:
        pagina = _get(client, {"jobName": termo, "limit": PAGE_SIZE, "offset": offset}).get("data", [])
        if not pagina:
            return
        yield from pagina
        offset += PAGE_SIZE
        time.sleep(PAUSA_ENTRE_REQUISICOES)


def coletar_payloads(termos: Iterable[str] = TERMOS_BUSCA) -> dict[int, dict[str, Any]]:
    """Payloads brutos da Gupy, deduplicados por id entre os termos."""
    payloads: dict[int, dict[str, Any]] = {}
    with httpx.Client(timeout=30, headers={"User-Agent": USER_AGENT}) as client:
        for termo in termos:
            antes = len(payloads)
            n = 0
            for v in buscar_termo(client, termo):
                payloads[v["id"]] = v
                n += 1
            log.info("%-22s %4d vagas (%d novas)", termo, n, len(payloads) - antes)
    return payloads


# ---------------------------------------------------------------------------
# Normalização
# ---------------------------------------------------------------------------

# Sufixo que a Gupy adiciona ao duplicar uma vaga no painel da empresa.
_SUFIXO_COPIA = re.compile(r"\s*\(\s*c[óo]pia\s*\)", re.IGNORECASE)


def limpar_titulo(titulo: str) -> str:
    return _SUFIXO_COPIA.sub("", titulo).strip()


def limpar_descricao(texto: str | None) -> str:
    """A Gupy envia entidades HTML no texto (&nbsp;, &amp;); decodifica e troca o espaço não separável."""
    return html.unescape(texto or "").replace(" ", " ")


def _vazio_para_none(valor: str | None) -> str | None:
    return (valor.strip() or None) if isinstance(valor, str) else valor


def para_vaga(payload: dict[str, Any], coletada_em: datetime) -> VagaBruta | None:
    """Converte um payload da Gupy em VagaBruta. Retorna None para vagas fora do Brasil."""
    pais = _vazio_para_none(payload.get("country"))
    if pais and normalizar_texto(pais) != "brasil":
        return None

    tipo_raw = payload.get("type")
    tipo = TIPO_CONTRATO_GUPY.get(tipo_raw)
    if tipo is None and tipo_raw:
        log.warning("tipo de contrato desconhecido: %s (vaga %s)", tipo_raw, payload.get("id"))
        tipo = TipoContrato.OUTRO

    badges = payload.get("badges") or {}
    pcd = payload.get("disabilities")
    if badges.get("isPWD"):
        pcd = True

    return VagaBruta(
        fonte=Fonte.GUPY,
        source_id=str(payload["id"]),
        titulo=limpar_titulo(payload["name"]),
        empresa=payload["careerPageName"].strip(),
        empresa_id=str(payload["companyId"]) if payload.get("companyId") is not None else None,
        descricao=limpar_descricao(payload.get("description")),
        url=payload["jobUrl"],
        pais=pais,
        uf=uf_de(payload.get("state")),
        cidade=_vazio_para_none(payload.get("city")),
        modelo_trabalho=MODELO_TRABALHO_GUPY.get(payload.get("workplaceType")),
        tipo_contrato=tipo,
        pcd=pcd,
        publicada_em=payload["publishedDate"],
        prazo_candidatura=_vazio_para_none(payload.get("applicationDeadline")),
        coletada_em=coletada_em,
        payload=payload,
    )


def normalizar(payloads: Iterable[dict[str, Any]], coletada_em: datetime) -> list[VagaBruta]:
    vagas = []
    for p in payloads:
        try:
            vaga = para_vaga(p, coletada_em)
        except Exception:
            log.exception("payload inválido (vaga %s)", p.get("id"))
            continue
        if vaga is not None:
            vagas.append(vaga)
    return vagas


def coletar(termos: Iterable[str] = TERMOS_BUSCA) -> list[VagaBruta]:
    coletada_em = datetime.now(timezone.utc)
    return deduplicar(normalizar(coletar_payloads(termos).values(), coletada_em))


# ---------------------------------------------------------------------------

class ColetaSuspeita(RuntimeError):
    """Poucas vagas: provavelmente a API mudou ou bloqueou a coleta. Não publicar."""


def main(saida: Path = Path("data/raw"), minimo: int = 0) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    coletada_em = datetime.now(timezone.utc)
    payloads = coletar_payloads()

    vagas = normalizar(payloads.values(), coletada_em)
    unicas = deduplicar(vagas)
    log.info("%d payloads -> %d no Brasil -> %d vagas únicas", len(payloads), len(vagas), len(unicas))

    # Trava antes de gravar: numa execução automática, uma coleta vazia não pode
    # virar a "última coleta" e publicar um portal sem vagas.
    if len(unicas) < minimo:
        raise ColetaSuspeita(f"só {len(unicas)} vagas únicas (mínimo {minimo}); coleta não gravada")

    saida.mkdir(parents=True, exist_ok=True)
    arquivo = saida / f"gupy_{coletada_em:%Y%m%d}.json"
    arquivo.write_text(json.dumps(list(payloads.values()), ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("bruto salvo em %s", arquivo)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Coleta vagas de dados na Gupy.")
    parser.add_argument("--saida", type=Path, default=Path("data/raw"))
    parser.add_argument("--minimo", type=int, default=0, help="falha se vierem menos vagas únicas que isso")
    args = parser.parse_args()
    main(args.saida, args.minimo)
