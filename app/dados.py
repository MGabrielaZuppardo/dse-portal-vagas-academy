"""Monta os dados do portal: vagas da coleta mais recente, stacks por palavra-chave e
enriquecimento com LLM (quando houver).

A busca, os filtros e o perfil de competências rodam no navegador (app/web/app.js) sobre
o JSON gerado aqui; este módulo não depende de nenhuma biblioteca de interface.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from enrichment.extractor import classificar_area, senioridade_explicita
from enrichment.schema import deduplicar
from enrichment.taxonomia import Taxonomia
from ingestion.gupy import normalizar

DIR_RAW = Path("data/raw")
DIR_ENRIQUECIDO = Path("data/enriched")


def ultimo_bruto(dir_raw: Path = DIR_RAW) -> Path:
    arquivos = sorted(dir_raw.glob("gupy_*.json"))
    if not arquivos:
        raise FileNotFoundError(f"nenhuma coleta em {dir_raw}; rode: python -m ingestion.gupy")
    return arquivos[-1]  # nome gupy_AAAAMMDD ordena por data


def carregar_enriquecimentos(dir_enriquecido: Path = DIR_ENRIQUECIDO) -> dict[str, dict]:
    """Último enriquecimento de cada vaga, considerando todos os .jsonl (provedores/versões)."""
    por_chave: dict[str, dict] = {}
    for arquivo in dir_enriquecido.glob("*.jsonl"):
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            if not linha.strip():
                continue
            registro = json.loads(linha)
            atual = por_chave.get(registro["chave"])
            if atual is None or registro["enriquecida_em"] > atual["enriquecida_em"]:
                por_chave[registro["chave"]] = registro
    return por_chave


def montar_vagas(
    payloads: list[dict], enriquecimentos: dict[str, dict], coletada_em: datetime, taxonomia: Taxonomia
) -> list[dict]:
    """Uma entrada por vaga única.

    `citadas` vem sempre da busca por palavra-chave na descrição (sem LLM). Se a vaga tiver
    passado pelo enriquecimento com LLM, `obrigatorias`/`desejaveis`/`area` também vêm preenchidos.
    """
    vagas = []
    for v in deduplicar(normalizar(payloads, coletada_em)):
        e = enriquecimentos.get(v.chave)
        x = e["extracao"] if e else {}
        nivel_titulo = senioridade_explicita(v)
        vagas.append({
            "id": v.chave,
            "titulo": v.titulo,
            "empresa": v.empresa,
            "uf": v.uf,
            "cidade": v.cidade,
            "modelo": v.modelo_trabalho.value if v.modelo_trabalho else None,
            "contrato": v.tipo_contrato.value if v.tipo_contrato else None,
            "pcd": v.pcd,
            "publicada_em": v.publicada_em.isoformat(),
            "prazo": v.prazo_candidatura.isoformat() if v.prazo_candidatura else None,
            "url": v.url,
            "descricao": v.descricao,
            "citadas": taxonomia.extrair_do_texto(f"{v.titulo}\n{v.descricao}"),
            "duplicatas": len(v.duplicatas),
            "enriquecida": e is not None,
            "area": x.get("area") or (area.value if (area := classificar_area(v.titulo)) else None),
            "senioridade": x.get("senioridade") or (nivel_titulo.value if nivel_titulo else None),
            "obrigatorias": e["skills_obrigatorias"] if e else [],
            "desejaveis": e["skills_desejaveis"] if e else [],
            "salario": [x.get("salario_min"), x.get("salario_max")] if x.get("salario_min") or x.get("salario_max") else None,
        })
    return vagas


def exportar(destino: Path, dir_raw: Path = DIR_RAW, dir_enriquecido: Path = DIR_ENRIQUECIDO) -> dict:
    """Grava `destino` como script JS (window.DADOS = {...}), que funciona abrindo o HTML
    direto do disco (file://), sem servidor."""
    arquivo = ultimo_bruto(dir_raw)
    coletada_em = datetime.fromtimestamp(arquivo.stat().st_mtime, timezone.utc)
    enriquecimentos = carregar_enriquecimentos(dir_enriquecido) if dir_enriquecido.exists() else {}
    taxonomia = Taxonomia.carregar()
    vagas = montar_vagas(json.loads(arquivo.read_text(encoding="utf-8")), enriquecimentos, coletada_em, taxonomia)

    dados = {
        "coletada_em": coletada_em.isoformat(),
        "skills": {s.id: s.nome for s in taxonomia.skills.values()},
        "sinonimos": taxonomia.indice(),  # chaves no formato de chave_skill (o JS replica a função)
        "pais": {s.id: s.pai for s in taxonomia.skills.values() if s.pai},  # quem sabe Glue também sabe AWS
        "vagas": vagas,
    }
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text("window.DADOS = " + json.dumps(dados, ensure_ascii=False) + ";\n", encoding="utf-8")
    return {
        "vagas": len(vagas),
        "com_stacks": sum(bool(v["citadas"]) for v in vagas),
        "enriquecidas": sum(v["enriquecida"] for v in vagas),
    }
