"""Importa lista de candidatos e fotos oficiais de urna do TSE (DivulgaCandContas).

O que produz, em resultados_geo/candidatos_2026/:

    cargo-000N.json            {sq: {sq, urna, nome, numero, partido, situacao,
                                     coligacao, uf, cargo, foto}}
    fotos/{sqCandidato}.jpg    foto oficial de urna

E o arquivo que js/apuracao-dados.js le para a pagina existir antes da primeira
urna. Rode de novo sempre que a Justica Eleitoral mexer no registro: candidatura
nova entra, renuncia passa a `situacao: "Renuncia"` (e o front tira da tela),
deferimento e indeferimento aparecem em `situacao`. Cada rodada imprime o que
mudou desde a anterior.

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

ACESSO. O DivulgaCandContas fica atras de Akamai, que barra por impressao
digital de TLS: `urllib`, `curl` e `requests` levam 403 com endpoint valido e
cabecalho de navegador. Por isso aqui e curl_cffi com `impersonate="chrome"`,
que apresenta o handshake de um Chrome de verdade e passa. O `--probe` diz em
segundos se este ponto de saida funciona, antes de voce esperar a varredura
inteira. Se ainda der BLOQUEADO (VPN, proxy, CI), o caminho de escape e
`scripts/apuracao/ponte_divulgacand.py`, que colhe pelo proprio navegador.

Este script nao inventa dado: se a API nao responder, ele falha e diz por que,
e um cargo que volta vazio preserva o arquivo que ja estava no repositorio.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from pathlib import Path

try:
    from curl_cffi import requests as navegador
except ImportError:                                  # pragma: no cover
    print("Falta curl_cffi (pip install curl_cffi). Sem ele o Akamai do TSE "
          "devolve 403 para qualquer cliente HTTP comum.", file=sys.stderr)
    raise

RAIZ = Path(__file__).resolve().parent.parent.parent
DESTINO = RAIZ / "resultados_geo" / "candidatos_2026"

BASE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1"
# A foto de urna sai do mesmo host, no caminho de arquivo estatico. O sufixo da
# unidade eleitoral ('BR' para presidente, a sigla da UF nos demais) e
# obrigatorio: sem ele o TSE devolve 404 para todo candidato, inclusive os que
# tem foto. Quem dita o formato e o `fotoUrl` do endpoint de detalhe
# (/candidatura/buscar/...); no de listagem esse campo vem sempre nulo.
FOTO = "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/{idEleicao}/{sq}/{ue}"

# O TSE nao publica endpoint de listagem de eleicoes (todos os caminhos de
# /eleicao/ devolvem 404). Este e o id da ordinaria de 2026, o mesmo que o
# DivulgaCandContas usa na propria pagina. Trocavel por --id-eleicao quando
# vier o segundo turno ou uma suplementar.
ID_ELEICAO = "20322002026"
CICLO = "2026"

CABECALHOS = {
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
            r = navegador.get(url, headers=CABECALHOS, impersonate="chrome", timeout=30)
            if r.status_code == 403:
                raise Bloqueado(url)
            if r.status_code == 404:
                return None
            if r.status_code != 200:
                if tentativa == tentativas:
                    print(f"  ! HTTP {r.status_code} em {url}", file=sys.stderr)
                    return None
                time.sleep(2 ** tentativa)
                continue
            return r.content if binario else r.json()
        except Bloqueado:
            raise
        except Exception as e:  # noqa: BLE001
            if tentativa == tentativas:
                print(f"  ! {type(e).__name__} em {url}", file=sys.stderr)
                return None
        time.sleep(2 ** tentativa)
    return None


class Bloqueado(RuntimeError):
    """403 do Akamai: esta rede nao fala com o DivulgaCandContas."""


def candidatos_de(ciclo: str, uf: str, id_eleicao: str, cargo: int) -> list[dict]:
    """Lista de candidatos de um cargo numa UF. Para Presidente o TSE usa a
    pseudo-UF 'BR'."""
    url = f"{BASE}/candidatura/listar/{ciclo}/{uf}/{id_eleicao}/{cargo}/candidatos"
    dados = buscar(url)
    if not dados:
        return []
    return dados.get("candidatos", []) if isinstance(dados, dict) else []


def normalizar(c: dict, cargo: int, uf: str) -> dict:
    """Mesmos campos que o front le em cargo-000N.json. `situacao` e o que
    decide se a linha aparece: js/apuracao-dados.js tira da tela quem esta em
    Renuncia."""
    return {
        "sq": str(c.get("id") or c.get("sqCandidato") or ""),
        "urna": (c.get("nomeUrna") or "").strip(),
        "nome": (c.get("nomeCompleto") or c.get("nomeCandidato") or "").strip(),
        "numero": str(c.get("numero") or ""),
        "partido": ((c.get("partido") or {}).get("sigla") or "").strip(),
        "situacao": (c.get("descricaoSituacao") or "").strip(),
        "coligacao": (c.get("nomeColigacao") or "").strip(),
        "uf": uf,
        "cargo": f"{cargo:04d}",
        "foto": c.get("fotoUrl") or None,
    }


# ------------------------------------------------------------------ execucao

def probe(id_eleicao: str = ID_ELEICAO) -> int:
    """Diz, em segundos, se esta rede consegue falar com o DivulgaCandContas."""
    print("Testando acesso ao DivulgaCandContas...")
    try:
        lista = candidatos_de(CICLO, "BR", id_eleicao, 1)
    except Bloqueado:
        print("\n  BLOQUEADO (403 do Akamai).")
        print("  Esta rede nao acessa o DivulgaCandContas. Rode da sua maquina,")
        print("  fora de VPN/proxy, e com curl_cffi instalado.")
        return 2
    if not lista:
        print(f"\n  Passou o Akamai, mas a eleicao {id_eleicao} nao devolveu")
        print("  candidato a presidente. Id errado, ou servico fora do ar.")
        return 1
    print(f"  OK. Eleicao {id_eleicao}: {len(lista)} candidatos a presidente.")
    return 0


def diferenca(antes: dict, agora: dict) -> None:
    """O que mudou desde a ultima rodada. E o unico jeito de saber, sem ler o
    diff do JSON minificado, quem saiu, quem entrou e quem trocou de situacao."""
    def rotulo(c):
        return f"{c.get('urna') or c.get('nome')} ({c.get('partido')}/{c.get('uf')})"

    saiu = [antes[k] for k in antes.keys() - agora.keys()]
    entrou = [agora[k] for k in agora.keys() - antes.keys()]
    mudou = [(antes[k], agora[k]) for k in antes.keys() & agora.keys()
             if (antes[k].get("situacao") or "") != (agora[k].get("situacao") or "")]

    for c in sorted(saiu, key=rotulo):
        print(f"    - saiu da lista  {rotulo(c)} [{c.get('situacao')}]")
    for c in sorted(entrou, key=rotulo):
        print(f"    + entrou         {rotulo(c)} [{c.get('situacao')}]")
    for a, b in sorted(mudou, key=lambda p: rotulo(p[1])):
        print(f"    ~ {rotulo(b)}: {a.get('situacao') or '(vazio)'} -> {b.get('situacao')}")
    if not (saiu or entrou or mudou):
        print("    (nada mudou)")


def coletar(cargos: list[int], com_fotos: bool, destino: Path,
            id_eleicao: str = ID_ELEICAO) -> int:
    print(f"Eleicao {id_eleicao} (ciclo {CICLO}), cargos {cargos}")
    destino.mkdir(parents=True, exist_ok=True)

    todos: dict[str, dict] = {}
    for cargo in cargos:
        # Presidente e nacional; os demais correm UF a UF.
        alvos = ["BR"] if cargo == 1 else UFS
        do_cargo: dict[str, dict] = {}
        for uf in alvos:
            try:
                lista = candidatos_de(CICLO, uf, id_eleicao, cargo)
            except Bloqueado:
                print("BLOQUEADO no meio da varredura (403).", file=sys.stderr)
                return 2
            for c in lista:
                sq = str(c.get("id") or c.get("sqCandidato") or "")
                if not sq:
                    continue
                do_cargo[sq] = normalizar(c, cargo, uf)
            print(f"  {CARGOS.get(cargo, cargo)} {uf}: {len(lista)} candidatos")

        if not do_cargo:
            # Sobrescrever com vazio apagaria a lista boa que ja esta no site.
            print(f"  ! {CARGOS.get(cargo, cargo)}: nenhum candidato, arquivo "
                  f"preservado.", file=sys.stderr)
            continue

        alvo = destino / f"cargo-{cargo:04d}.json"
        antigo = json.loads(alvo.read_text(encoding="utf-8")) if alvo.exists() else {}
        alvo.write_text(json.dumps(do_cargo, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
        print(f"  {len(do_cargo)} candidatos -> {alvo.name} (antes: {len(antigo)})")
        diferenca(antigo, do_cargo)
        todos.update(do_cargo)

    if com_fotos:
        baixar_fotos(todos, id_eleicao, destino / "fotos")
    return 0


# Quem o front tira da tela antes da primeira urna, e para quem, portanto, nao
# vale a pena guardar foto. Espelha FORA_DA_DISPUTA de js/apuracao-dados.js; se
# a regra de la mudar, o pior que acontece aqui e sobrar um jpg que ninguem pede.
FORA_DA_DISPUTA = re.compile(r"^(Ren[uú]ncia|Indeferido)\s*$", re.IGNORECASE)


def baixar_fotos(candidatos: dict[str, dict], id_eleicao: str, pasta: Path) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    novas = ausentes = 0
    for i, (sq, c) in enumerate(candidatos.items(), 1):
        alvo = pasta / f"{sq}.jpg"
        if alvo.exists() or FORA_DA_DISPUTA.match(c.get("situacao") or ""):
            continue
        try:
            img = buscar(FOTO.format(idEleicao=id_eleicao, sq=sq, ue=c.get("uf") or "BR"),
                         binario=True)
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


def autoteste() -> int:
    """Sem rede. Cobre o que quebraria em silencio: o formato que o front le, e
    a recusa a sobrescrever um cargo com lista vazia."""
    import tempfile

    cru = {"id": 123, "nomeUrna": " FULANO ", "nomeCompleto": "FULANO DE TAL",
           "numero": 45, "partido": {"sigla": "XPTO"},
           "descricaoSituacao": "Renuncia", "nomeColigacao": "SO XPTO",
           "fotoUrl": None}
    n = normalizar(cru, 3, "MG")
    assert n["sq"] == "123" and n["cargo"] == "0003" and n["uf"] == "MG"
    assert n["urna"] == "FULANO" and n["numero"] == "45"
    assert n["situacao"] == "Renuncia", "situacao e o campo que o front filtra"
    assert set(n) == {"sq", "urna", "nome", "numero", "partido", "situacao",
                      "coligacao", "uf", "cargo", "foto"}

    global candidatos_de
    original = candidatos_de
    with tempfile.TemporaryDirectory() as tmp:
        destino = Path(tmp)
        alvo = destino / "cargo-0001.json"
        alvo.write_text(json.dumps({"9": {"urna": "JA ESTAVA"}}), encoding="utf-8")
        try:
            candidatos_de = lambda *a, **k: []      # TSE fora do ar
            coletar([1], False, destino)
        finally:
            candidatos_de = original
        assert json.loads(alvo.read_text(encoding="utf-8")) == {"9": {"urna": "JA ESTAVA"}},             "lista vazia do TSE nao pode apagar a lista boa do site"

    print("autoteste ok")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe", action="store_true", help="so testa o acesso e sai")
    ap.add_argument("--autoteste", action="store_true", help="checagem sem rede e sai")
    ap.add_argument("--id-eleicao", default=ID_ELEICAO,
                    help="id da eleicao no DivulgaCandContas (outro turno, suplementar)")
    ap.add_argument("--cargos", nargs="*", type=int, default=[1, 3, 5],
                    help="1 presidente, 3 governador, 5 senador, 6/7/8 deputados")
    ap.add_argument("--fotos", action="store_true", help="baixa tambem as fotos de urna")
    ap.add_argument("--destino", type=Path, default=DESTINO)
    args = ap.parse_args()

    if args.autoteste:
        return autoteste()
    if args.probe:
        return probe(args.id_eleicao)
    return coletar(args.cargos, args.fotos, args.destino, args.id_eleicao)


if __name__ == "__main__":
    raise SystemExit(main())
