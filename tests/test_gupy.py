from datetime import datetime, timezone

from enrichment.schema import ModeloTrabalho, TipoContrato, deduplicar, uf_de
from ingestion.gupy import para_vaga

COLETA = datetime(2026, 9, 22, tzinfo=timezone.utc)


def payload(**extra):
    base = {
        "id": 12491485,
        "companyId": 295,
        "name": " Engenheiro de Dados Pleno (Azure/Databricks) ",
        "description": "Requisitos: Python, Spark.",
        "careerPageName": "Grupo Boticário",
        "jobUrl": "https://grupoboticario.gupy.io/job/abc",
        "country": "Brasil",
        "state": "São Paulo",
        "city": "Guarulhos",
        "workplaceType": "hybrid",
        "type": "vacancy_type_effective",
        "disabilities": False,
        "badges": None,
        "publishedDate": "2026-09-22T22:19:00.961Z",
        "applicationDeadline": "2026-09-26",
        "skills": None,
    }
    return base | extra


def test_mapeia_campos_estruturados():
    v = para_vaga(payload(), COLETA)
    assert v.chave == "gupy:12491485"
    assert v.titulo == "Engenheiro de Dados Pleno (Azure/Databricks)"
    assert v.uf == "SP"
    assert v.modelo_trabalho is ModeloTrabalho.HIBRIDO
    assert v.tipo_contrato is TipoContrato.CLT
    assert v.prazo_candidatura.isoformat() == "2026-09-26"
    assert v.pcd is False


def test_descarta_vaga_fora_do_brasil():
    assert para_vaga(payload(country="Chile"), COLETA) is None


def test_pais_vazio_e_mantido():
    v = para_vaga(payload(country="", state="", city=""), COLETA)
    assert v.pais is None and v.uf is None and v.cidade is None


def test_badge_pcd_prevalece():
    assert para_vaga(payload(badges={"isPWD": True}), COLETA).pcd is True


def test_tipo_desconhecido_vira_outro():
    assert para_vaga(payload(type="vacancy_type_novo"), COLETA).tipo_contrato is TipoContrato.OUTRO


def test_hash_dedup_ignora_acento_e_caixa():
    a = para_vaga(payload(), COLETA)
    b = para_vaga(payload(id=1, name="ENGENHEIRO DE DADOS PLENO (AZURE/DATABRICKS)", careerPageName="Grupo Boticario"), COLETA)
    assert a.hash_dedup == b.hash_dedup


def test_uf_de():
    assert uf_de("Goiás") == "GO"
    assert uf_de("pa") == "PA"
    assert uf_de("Pará") == "PA"
    assert uf_de("Paraná") == "PR"
    assert uf_de("Lisboa") is None


def test_remove_sufixo_copia():
    assert para_vaga(payload(name="ENGENHEIRO DADOS (CÓPIA)"), COLETA).titulo == "ENGENHEIRO DADOS"


def test_deduplicar_mantem_vaga_aberta_mais_recente():
    antiga = para_vaga(payload(id=1, publishedDate="2026-08-01T00:00:00Z"), COLETA)
    recente = para_vaga(payload(id=2, publishedDate="2026-09-01T00:00:00Z"), COLETA)
    pool = para_vaga(payload(id=3, publishedDate="2026-09-20T00:00:00Z", type="vacancy_type_talent_pool"), COLETA)
    outra = para_vaga(payload(id=4, city="Campinas"), COLETA)

    unicas = {v.source_id: v for v in deduplicar([antiga, pool, recente, outra])}

    assert set(unicas) == {"2", "4"}
    assert sorted(unicas["2"].duplicatas) == ["gupy:1", "gupy:3"]
    assert unicas["4"].duplicatas == []


def test_decodifica_entidades_html_da_descricao():
    v = para_vaga(payload(description="Python&nbsp;e SQL &amp; dbt"), COLETA)
    assert v.descricao == "Python e SQL & dbt"


def test_coleta_suspeita_nao_grava(tmp_path, monkeypatch):
    import pytest
    from ingestion import gupy

    monkeypatch.setattr(gupy, "coletar_payloads", lambda: {1: payload(id=1)})
    with pytest.raises(gupy.ColetaSuspeita):
        gupy.main(tmp_path, minimo=200)
    assert not list(tmp_path.iterdir())

    gupy.main(tmp_path, minimo=1)
    assert len(list(tmp_path.glob("gupy_*.json"))) == 1
