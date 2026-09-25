"""Gera o site estático do portal em site/ (HTML + CSS + JS + dados + config).

Uso:
    python -m app.build_site              # gera em site/
    python -m app.build_site --servir     # gera e serve em http://localhost:8765 (necessário para o login)
    python -m app.build_site --abrir      # gera e abre o arquivo direto do disco (sem login)

O login (Supabase) é configurado pelo .env: SUPABASE_URL, SUPABASE_ANON_KEY e,
opcionalmente, AUTH_PROVEDORES (ex.: "github,google"). Sem essas variáveis o site
funciona no modo local: vagas salvas ficam só no navegador.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import shutil
import webbrowser
from pathlib import Path

from dotenv import load_dotenv

from app.dados import exportar

WEB = Path(__file__).with_name("web")
SAIDA = Path("site")
PORTA = 8765


def escrever_config(destino: Path) -> bool:
    """config.js só com valores públicos: a chave anon do Supabase é feita para ir ao navegador
    (o acesso aos dados é limitado pelas políticas de Row Level Security)."""
    load_dotenv()
    url = os.environ.get("SUPABASE_URL", "").strip()
    chave = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    provedores = [p.strip() for p in os.environ.get("AUTH_PROVEDORES", "").split(",") if p.strip()]
    config = {"supabaseUrl": url, "supabaseAnonKey": chave, "provedores": provedores} if url and chave else {}
    destino.write_text("window.PORTAL_CONFIG = " + json.dumps(config) + ";\n", encoding="utf-8")
    return bool(config)


def construir(saida: Path = SAIDA) -> dict:
    if saida.exists():
        shutil.rmtree(saida)
    shutil.copytree(WEB, saida)
    resumo = exportar(saida / "dados.js")
    resumo["login"] = escrever_config(saida / "config.js")
    return resumo


class _HandlerSPA(http.server.SimpleHTTPRequestHandler):
    """Serve o site; página inexistente redireciona para "/" mantendo a query string.

    O retorno do login (link do e-mail) pode chegar num caminho diferente de "/",
    conforme a Site URL configurada no Supabase. O redirecionamento leva o ?code=
    para a raiz, onde o supabase-js conclui o login. Arquivos (com extensão) que não
    existem continuam dando 404.
    """

    def send_head(self):
        rota, _, query = self.path.partition("?")
        if not Path(self.translate_path(rota)).exists() and not Path(rota).suffix:
            print(f"  caminho inexistente {rota!r} -> redirecionando para /")
            self.send_response(302)
            self.send_header("Location", "/" + (f"?{query}" if query else ""))
            self.end_headers()
            return None
        return super().send_head()


def servir(saida: Path, porta: int = PORTA) -> None:
    handler = functools.partial(_HandlerSPA, directory=str(saida))
    with http.server.ThreadingHTTPServer(("localhost", porta), handler) as servidor:
        url = f"http://localhost:{porta}/"
        print(f"Servindo em {url} (Ctrl+C para parar)")
        webbrowser.open(url)
        try:
            servidor.serve_forever()
        except KeyboardInterrupt:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--saida", type=Path, default=SAIDA)
    grupo = parser.add_mutually_exclusive_group()
    grupo.add_argument("--servir", action="store_true", help=f"serve em http://localhost:{PORTA} e abre o navegador")
    grupo.add_argument("--abrir", action="store_true", help="abre o arquivo direto do disco (login não funciona)")
    args = parser.parse_args()

    resumo = construir(args.saida)
    indice = (args.saida / "index.html").resolve()
    print(f"{resumo['vagas']} vagas, {resumo['com_stacks']} com stacks identificadas, "
          f"{resumo['enriquecidas']} enriquecidas por LLM -> {indice}")
    print("Login: " + ("configurado (Supabase)" if resumo["login"] else "não configurado; vagas salvas ficam no navegador"))
    if args.servir:
        servir(args.saida)
    elif args.abrir:
        webbrowser.open(indice.as_uri())


if __name__ == "__main__":
    main()
