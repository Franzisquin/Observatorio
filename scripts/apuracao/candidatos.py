"""Importa lista de candidatos e fotos oficiais de urna do TSE (DivulgaCandContas).

O que produz, em resultados_geo/candidatos_2026/:

    candidatos.json            {sqCandidato: {nome, urna, numero, partido, cargo, uf}}
    por-cargo/{cargo}.json     recorte por cargo, para carga mais leve
    fotos/{sqCandidato}.jpg    foto oficial de urna

O front (js/apuracao-ui.js) procura a foto por `fotos/{sq}.jpg`, onde `sq` e a
chave que o snapshot de apuracao usa. Em 2026 essa chave e o `sqcand` do TSE,
o mesmo `sqCandidato` do DivulgaCandContas — os dois casam. (No ensaio de 2022 a
chave e o numero do candidato, layout antigo; ali a foto nao casa e a linha
simplesmente sai sem foto.)

    python scripts/apuracao/candidatos.py --probe
    python scripts/apuracao/candidatos.py --cargos 1 3 5
    python scripts/apuracao/candidatos.py --cargos 1 3 5 --fotos

FOTOS. O `--fotos` daqui puxa uma a uma do DivulgaCandContas, e so funciona
depois que o registro e julgado (antes disso `fotoUrl` vem nulo). O caminho que
funciona hoje e o pacote de dados abertos: baixe os `foto_cand2026_{UE}_div.zip`
de https://dadosabertos.tse.jus.br/dataset/candidatos-2026 e rode

    python scripts/apuracao/extrair_fotos.py <pasta-dos-zips>

que extrai so os candidatos dos cargos exibidos e escreve o manifesto.

ACESSO. O DivulgaCandContas fica atras de Akamai e recusa cliente que nao
pareca navegador: de varias redes (datacenter, CI, VPN) a resposta e 403
"Access Denied" independente do cabecalho. Rode da sua maquina, na sua rede.
O `--probe` diz em segundos se aquele ponto de saida passa, antes de voce
esperar por uma varredura inteira. Se der BLOQUEADO, use
`scripts/apuracao/ponte_divulgacand.py`, que colhe pelo proprio navegador —
foi assim que a lista de 2026 que esta em resultados_geo/candidatos_2026/
entrou no repositorio.

Este script nao inventa dado: se a API nao responder, ele falha e diz por que.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
DESTINO = RAIZ / "resultados_geo" / "candidatos_2026"

BASE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1"
# A foto de urna sai do mesmo host, no caminho de arquivo estatico.
FOTO = "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/{idEleicao}/{sq}"

# Cabecalhos de navegador. Nao burlam o Akamai quando o bloqueio e por origem
# da conexao, mas resolvem o caso em que o bloqueio e so pelo user-agent.
CABECALHOS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9",
    "Referer": "https://divulgacandcontas.tse.jus.br/divulga/",
}

CARGOS = {1: "Presidente", 3: "Governador", 5: "Senador",
          6: "Deputado Federal", 7: "Deputado Estadual", 8: "Deputado Distrital"}

UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
       "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]


class Limitador:
    """Uma requisicao a cada `intervalo` segundos. O DivulgaCandContas nao
    publica limite, entao vamos devagar de proposito: derrubar o acesso no meio
    da varredura custa mais que os minutos que a pressa economizaria."""

    def __init__(self, intervalo: float = 0.35):
        self.intervalo = intervalo
        self._trava = threading.Lock()
        self._ultimo = 0.0

    def esperar(self):
        with self._trava:
            agora = time.monotonic()
            atraso = self._ultimo + self.intervalo - agora
            if atraso > 0:
                time.sleep(atraso)
            self._ultimo = time.monotonic()


LIMITE = Limitador()


def buscar(url: str, binario: bool = False, tentativas: int = 3):
    """Devolve JSON (ou bytes) da URL. None quando o TSE nao entrega."""
    for tentativa in range(1, tentativas + 1):
        LIMITE.esperar()
        try:
            req = urllib.request.Request(url, headers=CABECALHOS)
            with urllib.request.urlopen(req, timeout=30) as r:
                dados = r.read()
            return dados if binario else json.loads(dados.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 403:
                raise Bloqueado(url) from e
            if e.code == 404:
                return None
            if tentativa == tentativas:
                print(f"  ! HTTP {e.code} em {url}", file=sys.stderr)
                return None
        except Exception as e:  # noqa: BLE001
            if tentativa == tentativas:
                print(f"  ! {type(e).__name__} em {url}", file=sys.stderr)
                return None
        time.sleep(2 ** tentativa)
    return None


class Bloqueado(RuntimeError):
    """403 do Akamai: esta rede nao fala com o DivulgaCandContas."""


def eleicoes_de(ano: int) -> list[dict]:
    dados = buscar(f"{BASE}/eleicao/eleicoes-ano/{ano}")
    return dados if isinstance(dados, list) else []


def candidatos_de(ciclo: str, uf: str, id_eleicao: str, cargo: int) -> list[dict]:
    """Lista de candidatos de um cargo numa UF. Para Presidente o TSE usa a
    pseudo-UF 'BR'."""
    url = f"{BASE}/candidatura/listar/{ciclo}/{uf}/{id_eleicao}/{cargo}/candidatos"
    dados = buscar(url)
    if not dados:
        return []
    return dados.get("candidatos", []) if isinstance(dados, dict) else []


def normalizar(c: dict, cargo: int, uf: str) -> dict:
    return {
        "nome": (c.get("nomeCompleto") or c.get("nomeCandidato") or "").strip(),
        "urna": (c.get("nomeUrna") or "").strip(),
        "numero": str(c.get("numero") or ""),
        "partido": ((c.get("partido") or {}).get("sigla") or "").strip(),
        "cargo": CARGOS.get(cargo, str(cargo)),
        "uf": uf,
    }


# ------------------------------------------------------------------ execucao

def probe() -> int:
    """Diz, em segundos, se esta rede consegue falar com o DivulgaCandContas."""
    print("Testando acesso ao DivulgaCandContas...")
    try:
        anos = buscar(f"{BASE}/eleicao/eleicoes-anos")
    except Bloqueado:
        print("\n  BLOQUEADO (403 do Akamai).")
        print("  Esta rede nao acessa o DivulgaCandContas. Rode da sua maquina,")
        print("  fora de VPN/proxy. Nada a fazer no codigo.")
        return 2
    if not anos:
        print("\n  Sem resposta utilizavel. Servico fora do ar?")
        return 1
    print(f"  OK. Anos disponiveis: {anos if isinstance(anos, list) else '(formato inesperado)'}")
    for e in eleicoes_de(2026):
        print(f"  eleicao 2026: id={e.get('id')} ciclo={e.get('idProcessoEleitoral')} "
              f"{e.get('nomeEleicao') or e.get('descricao')}")
    return 0


def coletar(ano: int, cargos: list[int], com_fotos: bool, destino: Path) -> int:
    try:
        eleicoes = eleicoes_de(ano)
    except Bloqueado:
        print("BLOQUEADO (403). Rode `--probe` para o diagnostico.", file=sys.stderr)
        return 2

    if not eleicoes:
        print(f"O TSE nao lista eleicao para {ano}. Se o registro de candidaturas\n"
              f"ainda nao encerrou, nao ha o que importar.", file=sys.stderr)
        return 1

    ordinaria = next((e for e in eleicoes if str(e.get("tipoEleicao", "")).lower().startswith("ordin")),
                     eleicoes[0])
    id_eleicao = str(ordinaria.get("id"))
    ciclo = str(ordinaria.get("idProcessoEleitoral") or id_eleicao)
    print(f"Eleicao {id_eleicao} (ciclo {ciclo}): {ordinaria.get('nomeEleicao') or ''}")

    todos: dict[str, dict] = {}
    for cargo in cargos:
        # Presidente e nacional; os demais correm UF a UF.
        alvos = ["BR"] if cargo == 1 else UFS
        do_cargo: dict[str, dict] = {}
        for uf in alvos:
            try:
                lista = candidatos_de(ciclo, uf, id_eleicao, cargo)
            except Bloqueado:
                print("BLOQUEADO no meio da varredura (403).", file=sys.stderr)
                return 2
            for c in lista:
                sq = str(c.get("id") or c.get("sqCandidato") or "")
                if not sq:
                    continue
                do_cargo[sq] = normalizar(c, cargo, uf)
            print(f"  {CARGOS.get(cargo, cargo)} {uf}: {len(lista)} candidatos")
        todos.update(do_cargo)
        (destino / "por-cargo").mkdir(parents=True, exist_ok=True)
        (destino / "por-cargo" / f"{cargo:04d}.json").write_text(
            json.dumps(do_cargo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    destino.mkdir(parents=True, exist_ok=True)
    (destino / "candidatos.json").write_text(
        json.dumps(todos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\n{len(todos)} candidatos -> {destino / 'candidatos.json'}")

    if com_fotos:
        baixar_fotos(todos, id_eleicao, destino / "fotos")
    return 0


def baixar_fotos(candidatos: dict[str, dict], id_eleicao: str, pasta: Path) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    novas = ausentes = 0
    for i, sq in enumerate(candidatos, 1):
        alvo = pasta / f"{sq}.jpg"
        if alvo.exists():
            continue
        try:
            img = buscar(FOTO.format(idEleicao=id_eleicao, sq=sq), binario=True)
        except Bloqueado:
            print("BLOQUEADO durante as fotos (403).", file=sys.stderr)
            return
        if img and len(img) > 512:      # abaixo disso e placeholder de erro
            alvo.write_bytes(img)
            novas += 1
        else:
            ausentes += 1
        if i % 50 == 0:
            print(f"  fotos: {i}/{len(candidatos)}")
    # Manifesto: a pagina so pede foto que existe, em vez de tentar e cair no
    # onerror uma vez por candidato.
    existentes = sorted(f.stem for f in pasta.glob("*.jpg"))
    (pasta.parent / "fotos.json").write_text(
        json.dumps(existentes, separators=(",", ":")), encoding="utf-8")
    print(f"fotos: {novas} baixadas, {ausentes} sem imagem -> {pasta}")
    print(f"manifesto: {len(existentes)} fotos -> {pasta.parent / 'fotos.json'}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe", action="store_true", help="so testa o acesso e sai")
    ap.add_argument("--ano", type=int, default=2026)
    ap.add_argument("--cargos", nargs="*", type=int, default=[1, 3, 5],
                    help="1 presidente, 3 governador, 5 senador, 6/7/8 deputados")
    ap.add_argument("--fotos", action="store_true", help="baixa tambem as fotos de urna")
    ap.add_argument("--destino", type=Path, default=DESTINO)
    args = ap.parse_args()

    if args.probe:
        return probe()
    return coletar(args.ano, args.cargos, args.fotos, args.destino)


if __name__ == "__main__":
    raise SystemExit(main())
