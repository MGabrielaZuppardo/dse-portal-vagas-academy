"""Mapeamento determinístico de skills em texto livre para a taxonomia (taxonomy.yaml)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from enrichment.schema import normalizar_texto

TAXONOMIA_PADRAO = Path(__file__).with_name("taxonomy.yaml")

_PARENTESES = re.compile(r"\(([^)]*)\)")
_SEPARADORES = re.compile(r"[\s\-_.]+")
# Linguagem R: só a letra maiúscula isolada ("Python ou R", "R, SAS"), nunca "R$", "P&R", "R&D".
_LINGUAGEM_R = re.compile(r"(?<![\w&/$.\-])R(?![\w&/$'.\-+])")


def chave_skill(texto: str) -> str:
    """'Power-BI' / 'power bi' / 'PowerBI' -> 'powerbi'. Mantém '/', '+' e '#'."""
    return re.sub(r"[\s\-_.]", "", normalizar_texto(texto))


def _padrao_textual(termo: str) -> re.Pattern:
    """Regex de palavra inteira sobre texto normalizado; separadores do termo são opcionais."""
    partes = [re.escape(p) for p in _SEPARADORES.split(normalizar_texto(termo)) if p]
    return re.compile(r"(?<![a-z0-9])" + r"[\s\-_.]?".join(partes) + r"(?![a-z0-9])")


@dataclass(frozen=True)
class Skill:
    id: str
    nome: str
    categoria: str
    pai: str | None = None
    sinonimos: tuple[str, ...] = ()


@dataclass
class Taxonomia:
    versao: int
    skills: dict[str, Skill]
    _indice: dict[str, str] = field(default_factory=dict, repr=False)
    _padroes: list[tuple[re.Pattern, str]] = field(default_factory=list, repr=False)

    @classmethod
    def carregar(cls, caminho: Path = TAXONOMIA_PADRAO) -> Taxonomia:
        dados = yaml.safe_load(caminho.read_text(encoding="utf-8"))
        skills = {}
        for s in dados["skills"]:
            skill = Skill(
                id=s["id"], nome=s["nome"], categoria=s["categoria"],
                pai=s.get("pai"), sinonimos=tuple(s.get("sinonimos", [])),
            )
            if skill.id in skills:
                raise ValueError(f"id duplicado na taxonomia: {skill.id}")
            skills[skill.id] = skill

        indice: dict[str, str] = {}
        for skill in skills.values():
            if skill.pai and skill.pai not in skills:
                raise ValueError(f"{skill.id}: pai inexistente {skill.pai!r}")
            for termo in (skill.id, skill.nome, *skill.sinonimos):
                chave = chave_skill(termo)
                if indice.get(chave, skill.id) != skill.id:
                    raise ValueError(f"'{termo}' mapeia para {indice[chave]} e {skill.id}")
                indice[chave] = skill.id
        ignorar = {chave_skill(t) for t in dados.get("ignorar_na_busca_textual", [])}
        padroes = [
            (_padrao_textual(termo), skill.id)
            for skill in skills.values()
            for termo in dict.fromkeys((skill.nome, *skill.sinonimos, skill.id.replace("_", " ")))
            if chave_skill(termo) not in ignorar
        ]
        return cls(versao=dados["versao"], skills=skills, _indice=indice, _padroes=padroes)

    def nomes(self) -> list[str]:
        return [s.nome for s in self.skills.values()]

    def indice(self) -> dict[str, str]:
        """{chave_skill(termo): id} para todos os ids, nomes e sinônimos."""
        return dict(self._indice)

    def resolver(self, texto: str) -> list[str]:
        """Ids canônicos para um item extraído. Lista vazia se não mapear.

        Tenta o texto inteiro; depois, se houver parênteses ("AWS (S3, Glue)"),
        o texto sem eles e cada item de dentro.
        """
        if skill_id := self._indice.get(chave_skill(texto)):
            return [skill_id]
        ids = []
        if _PARENTESES.search(texto):
            candidatos = [_PARENTESES.sub("", texto)]
            for dentro in _PARENTESES.findall(texto):
                candidatos += dentro.split(",")
            ids = [i for c in candidatos if (i := self._indice.get(chave_skill(c)))]
        return ids

    def com_ancestrais(self, skill_id: str) -> list[str]:
        cadeia = []
        atual: str | None = skill_id
        while atual and atual not in cadeia:
            cadeia.append(atual)
            atual = self.skills[atual].pai
        return cadeia

    def extrair_do_texto(self, texto: str) -> list[str]:
        """Skills citadas num texto livre (ex.: descrição da vaga), por palavra-chave.

        Casa nomes e sinônimos como palavras inteiras, ignorando acento, caixa e separadores
        ("Power-BI" == "power bi" == "PowerBI"). Não distingue obrigatória de desejável.
        Retorna ids com ancestrais, na ordem da taxonomia.
        """
        normalizado = normalizar_texto(texto)
        achados = {skill_id for padrao, skill_id in self._padroes if padrao.search(normalizado)}
        if "r" in self.skills and _LINGUAGEM_R.search(texto or ""):
            achados.add("r")
        ids: dict[str, None] = {}
        for skill_id in self.skills:
            if skill_id in achados:
                ids.update(dict.fromkeys(self.com_ancestrais(skill_id)))
        ordem = list(self.skills)
        return sorted(ids, key=ordem.index)

    def mapear(self, textos: list[str]) -> tuple[list[str], list[str]]:
        """-> (ids canônicos com ancestrais, sem repetição, na ordem; textos não mapeados)."""
        ids: dict[str, None] = {}
        nao_mapeadas: list[str] = []
        for texto in textos:
            resolvidos = self.resolver(texto)
            if not resolvidos:
                nao_mapeadas.append(texto.strip())
            for skill_id in resolvidos:
                ids.update(dict.fromkeys(self.com_ancestrais(skill_id)))
        return list(ids), nao_mapeadas
