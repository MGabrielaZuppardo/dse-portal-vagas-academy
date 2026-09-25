import pytest

from enrichment.taxonomia import Taxonomia


@pytest.fixture(scope="module")
def tax():
    return Taxonomia.carregar()


def test_taxonomia_carrega_sem_conflitos(tax):
    assert len(tax.skills) >= 60


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("PySpark", ["spark"]),
        ("Apache Spark", ["spark"]),
        ("power-bi", ["power_bi"]),
        ("PowerBI", ["power_bi"]),
        ("Modelagem Dimensional", ["modelagem_dados"]),
        ("Glue", ["aws_glue", "aws"]),
        ("DAX", ["dax", "power_bi"]),
        ("RAG", ["rag", "llm"]),
        ("SQL (avançado)", ["sql"]),
        ("AWS (S3, Glue)", ["aws", "aws_s3", "aws_glue"]),
        ("estatística", ["estatistica"]),
    ],
)
def test_mapear(tax, texto, esperado):
    ids, nao_mapeadas = tax.mapear([texto])
    assert ids == esperado
    assert nao_mapeadas == []


def test_nao_mapeadas_e_sem_repeticao(tax):
    ids, nao_mapeadas = tax.mapear(["Spark", "PySpark", "Google Sheets", "Glue", "S3"])
    assert ids == ["spark", "aws_glue", "aws", "aws_s3"]
    assert nao_mapeadas == ["Google Sheets"]


@pytest.mark.parametrize(
    "texto, contem, nao_contem",
    [
        ("Experiência com PySpark, Power-BI e Apache Airflow.", ["spark", "power_bi", "airflow"], []),
        ("Pipelines em AWS Glue e S3; desejável Terraform.", ["aws_glue", "aws", "aws_s3", "terraform"], []),
        ("Linguagens como Python, R ou SQL", ["python", "r", "sql"], []),
        ("Salário R$ 8.000 e área de P&R", [], ["r"]),
        ("Graduação em Informática; conhecimento na ponta do iceberg", [], ["informatica", "iceberg"]),
        ("Experiência com Informatica PowerCenter", ["informatica"], []),
        ("Trabalhou na Shell com funções lambda", [], ["shell", "aws_lambda"]),
        ("Sparkling é outra coisa; PostgreSQLite também", [], ["spark", "postgresql"]),
    ],
)
def test_extrair_do_texto(tax, texto, contem, nao_contem):
    ids = tax.extrair_do_texto(texto)
    assert set(contem) <= set(ids)
    assert not set(nao_contem) & set(ids)
