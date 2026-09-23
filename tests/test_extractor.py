import json
from datetime import datetime, timezone

import pytest

from enrichment.extractor import PROMPT_VERSION, Extrator, senioridade_explicita
from enrichment.schema import Area, Senioridade
from ingestion.gupy import para_vaga
from tests.test_gupy import COLETA, payload

DESCRICAO = "Requisitos: Python, PySpark, Azure Data Factory e Kedro. Diferencial: Spark, Terraform."


def llm_falso(resposta: dict):
    chamadas = []

    def chamar(system_prompt, prompt):
        chamadas.append((system_prompt, prompt))
        return json.dumps(resposta)

    chamar.chamadas = chamadas
    return chamar


def test_enriquecer_mapeia_skills_e_audita():
    llm = llm_falso({
        "area": "engenharia_dados",
        "senioridade": "pleno",
        "senioridade_inferida": False,
        "skills_obrigatorias": ["Python", "PySpark", "Azure Data Factory", "Kedro"],
        "skills_desejaveis": ["Spark", "Terraform"],
        "afirmativa": [],
    })
    extrator = Extrator(llm, "modelo-teste")
    vaga = para_vaga(payload(description=DESCRICAO), COLETA)

    e = extrator.enriquecer(vaga)

    assert e.chave == "gupy:12491485"
    assert e.extracao.area is Area.ENGENHARIA_DADOS
    assert e.extracao.senioridade is Senioridade.PLENO
    assert e.skills_obrigatorias == ["python", "spark", "azure_data_factory", "azure"]
    assert e.skills_desejaveis == ["terraform"]  # spark já é obrigatória
    assert e.skills_nao_mapeadas == ["Kedro"]
    assert e.prompt_version == PROMPT_VERSION and e.modelo_llm == "modelo-teste"

    _, prompt = llm.chamadas[0]
    assert "Engenheiro de Dados Pleno" in prompt


def test_descarta_skills_que_nao_estao_na_vaga_e_frases():
    llm = llm_falso({
        "area": "engenharia_dados", "senioridade": "pleno", "senioridade_inferida": False,
        "skills_obrigatorias": ["Python", "Snowflake", "Kafka", "Azure Data Factory (ADF)"],
        "skills_desejaveis": ["experiência com projetos de dados em cloud"],
    })
    e = Extrator(llm, "t").enriquecer(para_vaga(payload(description=DESCRICAO), COLETA))
    assert e.extracao.skills_obrigatorias == ["Python", "Azure Data Factory (ADF)"]
    assert e.extracao.skills_desejaveis == []


def test_senioridade_do_titulo_prevalece_sobre_llm():
    llm = llm_falso({"area": "engenharia_dados", "senioridade": "junior", "senioridade_inferida": True})
    e = Extrator(llm, "t").enriquecer(para_vaga(payload(), COLETA))  # título diz "Pleno"
    assert e.extracao.senioridade == "pleno" and e.extracao.senioridade_inferida is False


def test_senioridade_sem_titulo_fica_como_inferida():
    llm = llm_falso({"area": "analise_dados", "senioridade": "senior", "senioridade_inferida": False})
    e = Extrator(llm, "t").enriquecer(para_vaga(payload(name="Analista de Dados"), COLETA))
    assert e.extracao.senioridade == "senior" and e.extracao.senioridade_inferida is True


@pytest.mark.parametrize(
    "titulo, tipo, esperado",
    [
        ("Estágio de Sistemas e Eficiência de Dados", "vacancy_type_effective", "entrada"),
        ("Analista de Dados", "vacancy_type_internship", "entrada"),
        ("ANL ENGENHARIA TI JR - DADOS", "vacancy_type_effective", "junior"),
        ("Analista de Domínio III (Diretoria de Dados)", "vacancy_type_effective", "senior"),
        ("Analista de Dados Pl - Santana", "vacancy_type_effective", "pleno"),
        ("Tech Lead de Dados Sênior", "vacancy_type_effective", "especialista"),
        ("Coordenador(a) de BI", "vacancy_type_effective", "gestao"),
        ("Analista de Dados", "vacancy_type_effective", None),
        ("Engenheiro de Dados (Snowflake)", "vacancy_type_effective", None),
    ],
)
def test_senioridade_explicita(titulo, tipo, esperado):
    assert senioridade_explicita(para_vaga(payload(name=titulo, type=tipo), COLETA)) == esperado


def test_lote_pula_falhas():
    def llm_quebrado(system_prompt, prompt):
        return "não é json"

    extrator = Extrator(llm_quebrado, "modelo-teste")
    assert list(extrator.enriquecer_lote([para_vaga(payload(), COLETA)])) == []


def test_lote_para_quando_cota_esgota():
    from enrichment.extractor import CotaEsgotada

    chamadas = []

    def llm_sem_cota(system_prompt, prompt):
        chamadas.append(prompt)
        raise CotaEsgotada("429")

    vagas = [para_vaga(payload(id=i), COLETA) for i in range(3)]
    assert list(Extrator(llm_sem_cota, "t").enriquecer_lote(vagas)) == []
    assert len(chamadas) == 1  # não tenta as outras vagas


@pytest.mark.parametrize(
    "titulo, esperado",
    [
        ("Engenheiro de Dados Pleno (Azure/Databricks)", "engenharia_dados"),
        ("Pessoa Engenheira de Dados Sênior (DataSecOps)", "engenharia_dados"),
        ("Analytics Engineer Sr", "analytics_engineering"),
        ("CAS | Cientista de Dados - Foco em Crédito", "ciencia_dados"),
        ("Machine Learning Engineer", "ml_engineering"),
        ("Gerente de Engenharia de Dados", "gestao_dados"),
        ("Analista de Governança de Dados Sênior", "governanca_dados"),
        ("Especialista em Banco de Dados IDMS", "dba"),
        ("Analista de BI Pleno", "bi"),
        ("Analista de Dados Pleno - Unidade Santana", "analise_dados"),
        ("Analista Comercial Pleno | Dados e PBM", None),
    ],
)
def test_area_pelo_titulo(titulo, esperado):
    from enrichment.extractor import area_pelo_titulo

    assert area_pelo_titulo(titulo) == esperado
