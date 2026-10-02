"""Plantao da noite de apuracao: coleta do TSE em ciclo e publica no site.

Le so o ambiente oficial do TSE (resultados.tse.jus.br/oficial) e recusa
qualquer EA11 que nao esteja em fase oficial. Publica direto no Worker do
electomaps.com.br (worker/apuracao.js), que guarda no R2 e serve em /dados/ —
sem GitHub no caminho.

Duas camadas, com custos muito diferentes:

    camada alta (BR + 27 UFs)   28 arquivos por cargo    -> toda volta (~45s)
    camada municipal            5.569 arquivos por cargo -> em fatias, a cada volta

A municipal anda em fatias de --fatia-mun segundos depois da camada alta, em vez
de parar tudo pelos minutos que uma rodada inteira leva: o placar do Brasil e
dos estados nunca congela enquanto os municipios andam.

    $env:CHAVE_PLANTAO = "<a chave do Worker>"      # PowerShell
    python scripts/apuracao/plantao.py --publicar https://electomaps.com.br/dados/

Sem --publicar, so grava em --saida (para conferir com --servir).
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import http.client
import http.server
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coleta import (acompanhamento, camada_alta, camada_municipal,  # noqa: E402
                    cargos_da_eleicao, eleicoes_ordinarias, eleitos, escolher_ufs,
                    escrever_indice, municipios)
from tse import (BASE, CARGOS, CARGOS_COM_UF, CARGOS_PROPORCIONAIS,  # noqa: E402
                 Cliente, eleicao_de, ufs_do_cargo)

# A projecao precisa de numpy. Sem ele o plantao segue so com os snapshots: a
# coleta nao pode depender de um extra.
try:
    import projecao  # noqa: E402
except ImportError as _err:
    projecao = None
    print(f"  ! projecao desligada: {_err}", flush=True)

RAIZ = Path(__file__).resolve().parent.parent.parent


def projetar_rodada(saida: Path, eleicao: str, cargo: str, turno: str) -> None:
    """Projecao do resultado final de presidente, depois de cada camada municipal.

    No 2o turno a base e o 1o turno da propria eleicao, se ele ja tiver sido
    resumido (base_projecao.py --saida base_projecao_2026.json); senao, 2022."""
    if projecao is None or cargo != "0001":
        return
    base_2t = projecao.AQUI / "base_projecao_2026.json"
    caminho = base_2t if turno == "2" and base_2t.exists() else projecao.BASE_PADRAO
    try:
        r = projecao.rodada(saida, eleicao, cargo, projecao.carregar_base(caminho))
        print(f"  projecao {eleicao}-{cargo}: {r.get('pct_apurado', 0):.1f}% apurado, "
              f"suficiente={r.get('suficiente')}", flush=True)
    except Exception as err:  # noqa: BLE001 — a coleta vale mais que a projecao
        print(f"  ! projecao {eleicao}-{cargo} falhou ({type(err).__name__}: {err})", flush=True)


def servir(porta: int, saida: Path) -> None:
    """Sobe um servidor local para a pagina e imprime o endereco pronto.

    A pagina le os snapshots por fetch, e navegador nao faz fetch de file://.
    Sem servidor a tela abre e fica vazia, sem dizer por que — e o erro mais
    provavel de quem esta so acompanhando uma janela de teste.
    """
    from functools import partial

    manipulador = partial(http.server.SimpleHTTPRequestHandler, directory=str(RAIZ))
    manipulador.log_message = lambda *a, **k: None
    servidor = http.server.ThreadingHTTPServer(("127.0.0.1", porta), manipulador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()

    dados = saida.resolve().relative_to(RAIZ).as_posix() + "/"
    endereco = f"http://127.0.0.1:{porta}"
    print("", flush=True)
    print(f"  mapa presidencial  {endereco}/apuracao-presidente.html?cargo=0001&dados={dados}",
          flush=True)
    print(f"  governadores       {endereco}/apuracao-governador.html?dados={dados}", flush=True)
    print(f"  senado             {endereco}/apuracao-senado.html?dados={dados}", flush=True)
    print(f"  um estado          {endereco}/apuracao-uf.html?uf=sp&cargo=0003&dados={dados}",
          flush=True)
    print(f"  deputados          {endereco}/apuracao-deputados.html?cargo=0006&dados={dados}",
          flush=True)
    print("", flush=True)


def saude(caminho: Path, estado: dict) -> None:
    """Escreve o status.json que a pagina de saude do plantao le.

    Um plantao de seis horas so e observavel se ele contar o que esta fazendo:
    qual geracao do TSE foi lida (idg), qual a hora da totalizacao no arquivo,
    quantas requisicoes sairam e quantos 404 voltaram. O teto e de 100 requisicoes
    por IP por segundo e um 404 repetido bloqueia igual a excesso — dez minutos
    fora do ar, renovados a cada nova tentativa. Sem esse arquivo, a primeira
    noticia de bloqueio seria a tela vazia.
    """
    caminho.write_text(json.dumps(estado, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")


def _put(destino: str, nome: str, corpo: bytes, chave: str, quem: str) -> int:
    """Um PUT no Worker. Devolve o status, ou 0 se a rede nao respondeu."""
    req = urllib.request.Request(destino + nome, data=corpo, method="PUT", headers={
        "Authorization": f"Bearer {chave}", "X-Plantao": quem,
        "Content-Type": "application/json", "User-Agent": "electomaps-plantao/1.0"})
    for tentativa in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status
        except urllib.error.HTTPError as err:
            if err.code in (400, 403, 409, 413):  # repetir nao muda a resposta
                return err.code
        except (urllib.error.URLError, http.client.HTTPException, OSError):
            pass
        time.sleep(2 * (tentativa + 1))
    return 0


def enviar(saida: Path, destino: str, chave: str, quem: str,
           enviados: dict[str, str]) -> tuple[int, str]:
    """Grava no Worker cada snapshot que mudou desde o ultimo envio aceito.

    Devolve (quantos foram aceitos, situacao). indice.json e status.json vao por
    ultimo, depois dos dados que descrevem. O que falhar fica sem marca e vai de
    novo na volta seguinte; nenhuma falha de rede derruba o plantao.

    409 quer dizer que outro plantao esta no comando: este segue coletando, e o
    Worker o deixa assumir sozinho se o outro ficar alguns minutos calado.
    """
    def pendentes(nomes: list[str]) -> list[tuple[str, bytes, str]]:
        lista = []
        for nome in nomes:
            try:
                corpo = (saida / nome).read_bytes()
            except OSError:
                continue
            marca = hashlib.sha1(corpo).hexdigest()
            if enviados.get(nome) != marca:
                lista.append((nome, corpo, marca))
        return lista

    todos = sorted(p.name for p in saida.glob("*.json"))
    fim = [n for n in ("indice.json", "status.json") if n in todos]
    aceitos, situacao = 0, "ok"
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        for lote in (pendentes([n for n in todos if n not in fim]), pendentes(fim)):
            codigos = pool.map(lambda item: _put(destino, item[0], item[1], chave, quem), lote)
            for (nome, _, marca), codigo in zip(lote, codigos):
                if codigo == 204:
                    enviados[nome] = marca
                    aceitos += 1
                elif codigo == 409:
                    situacao = "em espera (outro plantao no comando)"
                elif codigo == 403:
                    situacao = "CHAVE RECUSADA pelo Worker"
                elif situacao == "ok":
                    situacao = f"falha ({codigo or 'sem rede'}) em {nome}; vai de novo"
            if situacao != "ok" and not situacao.startswith("falha"):
                break
    return aceitos, situacao


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--eleicao", default="auto",
                    help="codigos separados por virgula, ou 'auto' para pegar as "
                         "eleicoes ordinarias que o proprio EA11 listar. Em 2026 a "
                         "geral e duas: a federal (presidente) e a estadual "
                         "(governador, senador, assembleias)")
    ap.add_argument("--servir", type=int, default=0, metavar="PORTA",
                    help="sobe um servidor local nesta porta e imprime o endereco "
                         "da tela; sem isso, a pagina precisa ser servida a parte")
    # 0008 e a Camara Legislativa do DF, que faz as vezes de Assembleia ali. So
    # entra se o EA11 declarar o cargo (cargos_da_eleicao), e so para o DF
    # (ufs_do_cargo), entao pedir aqui nao custa 404 nenhum.
    ap.add_argument("--cargos", default="0001,0003,0005,0006,0007,0008",
                    help="codigos separados por virgula, ou apelidos: " + ", ".join(CARGOS))
    ap.add_argument("--uf", nargs="*", default=[],
                    help="UFs separadas por espaco (padrao: todas as da eleicao)")
    ap.add_argument("--ambiente", default="oficial", help="pasta de ambiente no CDN")
    ap.add_argument("--base", default=BASE, help="host do CDN")
    ap.add_argument("--minutos", type=float, default=720,
                    help="duracao do plantao (padrao: 12 horas, a noite inteira)")
    ap.add_argument("--intervalo-alto", type=float, default=45)
    ap.add_argument("--intervalo-mun", type=float, default=0,
                    help="pausa entre uma rodada municipal completa e a proxima")
    ap.add_argument("--fatia-mun", type=float, default=30,
                    help="segundos de camada municipal por volta, depois da camada alta")
    ap.add_argument("--taxa", type=float, default=60.0,
                    help="requisicoes/s; o teto do TSE e 100 por IP e a folga e de proposito")
    ap.add_argument("--paralelo", type=int, default=24,
                    help="requisicoes simultaneas; o teto real e --taxa")
    ap.add_argument("--saida", type=Path, default=RAIZ / "scratch" / "apuracao" / "plantao")
    ap.add_argument("--publicar", metavar="URL",
                    help="endereco do Worker, ex.: https://electomaps.com.br/dados/ "
                         "(a chave vem da variavel de ambiente CHAVE_PLANTAO)")
    ap.add_argument("--nome", default=socket.gethostname(),
                    help="como este plantao se identifica ao Worker (padrao: o nome "
                         "da maquina); dois plantoes precisam de nomes diferentes")
    args = ap.parse_args()

    chave = os.environ.get("CHAVE_PLANTAO", "")
    destino = (args.publicar or "").rstrip("/") + "/"
    if args.publicar and not chave:
        print("--publicar precisa da chave em CHAVE_PLANTAO.", flush=True)
        return 1

    cargos = [CARGOS.get(c.strip(), c.strip()) for c in args.cargos.split(",") if c.strip()]
    saida: Path = args.saida
    saida.mkdir(parents=True, exist_ok=True)

    base, ambiente = args.base, args.ambiente
    cli = Cliente(ambiente=ambiente, por_segundo=args.taxa, base=base)
    config = cli.config_eleicoes()
    # O EA11 diz a fase em que foi gerado: "o" e resultado de verdade. Qualquer
    # outra coisa e dado de teste, e publicar dado de teste como apuracao e o
    # pior erro possivel da noite.
    if config.get("f") != "o":
        print(f"EA11 em fase '{config.get('f')}' em {base}/{ambiente}: nao e o ambiente "
              "oficial — nada sera coletado.", flush=True)
        return 1
    if args.eleicao.strip().lower() in ("auto", "todas"):
        # So 1o turno: o site e do 1o turno, e o 2o turno entra no EA11 assim que
        # o 1o acaba — religar o plantao de madrugada passaria a pedir arquivos
        # de 2o turno que ainda nao existem, e 404 em serie bloqueia.
        eleicoes = [e for e in eleicoes_ordinarias(config, cargos)
                    if str(eleicao_de(config, e).get("t", "")) == "1"]
        print(f"eleicoes descobertas no EA11: {', '.join(eleicoes) or '(nenhuma)'}",
              flush=True)
        if not eleicoes:
            print("nenhuma eleicao ordinaria com os cargos pedidos neste ambiente.",
                  flush=True)
            return 1
    else:
        eleicoes = [e.strip() for e in args.eleicao.split(",") if e.strip()]
    # Cada eleicao traz os seus cargos e a sua lista de municipios; pedir o cargo
    # errado na eleicao errada e 404 em serie.
    plano: dict[str, list[str]] = {}
    mapas: dict[str, dict] = {}
    for eleicao in eleicoes:
        do_pleito = cargos_da_eleicao(config, eleicao, cargos)
        if not do_pleito:
            print(f"  ! eleicao {eleicao} nao tem nenhum dos cargos pedidos — fora do plano",
                  flush=True)
            continue
        plano[eleicao] = do_pleito
        mapas[eleicao] = municipios(cli, config, eleicao)
    if not plano:
        print("nenhuma eleicao pedida tem os cargos pedidos.", flush=True)
        return 1

    ufs = escolher_ufs(mapas[next(iter(plano))], args.uf)
    escrever_indice(saida, base, ambiente, config, plano)
    resumo_plano = " | ".join(f"{e}:{','.join(c)}" for e, c in plano.items())
    print(f"plantao: {base}/{ambiente} | fase {config.get('f')} | {resumo_plano} | "
          f"{len(ufs)} UFs | {args.minutos:.0f} min | saida {saida}", flush=True)

    if args.servir:
        servir(args.servir, saida)

    fim = time.monotonic() + args.minutos * 60
    partida = time.time()
    proxima_municipal = 0.0
    # Rodada municipal em andamento, (eleicao, cargo, uf), consumida em fatias.
    fila: list[tuple[str, str, str]] = []
    enviados: dict[str, str] = {}  # arquivo -> sha1 do ultimo envio aceito
    situacao = ""
    volta = 0
    # Cargos cuja totalizacao final ja foi vista: o EA10 daquele cargo passa a
    # existir e vale reler a cada volta municipal. Antes disso e 404 em serie.
    finalizados: set[str] = set()
    estados: dict[str, dict] = {}

    while time.monotonic() < fim:
        inicio = time.monotonic()
        volta += 1
        # Mesma licao do laco da pagina: uma volta que estoura nao pode levar o
        # plantao junto. Numa noite de seis horas qualquer excecao nao prevista —
        # rede, disco, um campo novo do TSE — encerraria a cobertura em silencio, e
        # o unico aviso seria a tela parada no ultimo boletim.
        municipal = False
        aceitos = 0
        try:
            for eleicao, do_pleito in plano.items():
                alvos = escolher_ufs(mapas[eleicao], args.uf)
                for cargo in do_pleito:
                    estado = camada_alta(cli, config, eleicao, cargo, alvos, saida,
                                         silencioso=True)
                    if estado:
                        estados[f"{eleicao}-{cargo}"] = estado
                        if estado.get("tf") == "s":
                            finalizados.add((eleicao, cargo))

            # EA14: uma requisicao por eleicao e volta, e dela sai o mapa de onde
            # ainda se esta contando — andamento por UF e municipios por estagio.
            ab = {}
            for eleicao in plano:
                ab = acompanhamento(cli, config, eleicao, saida, silencioso=True) or ab

            # O placar novo vai ao ar antes da fatia municipal.
            if args.publicar:
                aceitos, situacao = enviar(saida, destino, chave, args.nome, enviados)

            if not fila and time.monotonic() >= proxima_municipal:
                # Deputado nao tem mapa por municipio: a pagina de deputados le so
                # a camada alta e as listas (lista-{uf}). No simulado de 15/09 eles
                # eram 2 dos 5 cargos de uma rodada municipal de ~13 min, e
                # atrasavam o mapa municipal e a projecao do resto. Vereador fica:
                # e cargo municipal, sem camada alta.
                fila = [(eleicao, cargo, uf)
                        for eleicao, do_pleito in plano.items()
                        for cargo in do_pleito
                        if not (cargo in CARGOS_COM_UF and cargo in CARGOS_PROPORCIONAIS)
                        for uf in ufs_do_cargo(cargo, escolher_ufs(mapas[eleicao], args.uf))]
            limite = time.monotonic() + args.fatia_mun
            while fila and time.monotonic() < limite:
                eleicao, cargo, uf = fila.pop(0)
                municipal = True
                camada_municipal(cli, config, eleicao, cargo, [uf], mapas[eleicao],
                                 saida, paralelo=args.paralelo, silencioso=True)
                if fila and fila[0][:2] == (eleicao, cargo):
                    continue
                # Ultima UF deste cargo na rodada: a projecao le o pais inteiro.
                projetar_rodada(saida, eleicao, cargo,
                                str(eleicao_de(config, eleicao).get("t", "1")))
                # Prefeito nao tem camada alta: a totalizacao final aparece no
                # snapshot municipal, entao ela e lida aqui.
                pacote = saida / f"{eleicao}-{cargo}-{uf}.json"
                if (eleicao, cargo) not in finalizados and pacote.exists():
                    try:
                        dados = json.loads(pacote.read_text(encoding="utf-8"))
                        if any(e.get("tf") == "s" for e in dados.get("abr", {}).values()):
                            finalizados.add((eleicao, cargo))
                    except (ValueError, OSError):
                        pass
            if municipal and not fila:
                for eleicao, cargo in sorted(finalizados):
                    eleitos(cli, config, eleicao, cargo,
                            escolher_ufs(mapas[eleicao], args.uf), saida, silencioso=True)
                proxima_municipal = time.monotonic() + args.intervalo_mun

            saude(saida / "status.json", {
                "ambiente": ambiente,
                "base": base,
                "fase": config.get("f", ""),
                "eleicoes": plano,
                "volta": volta,
                "inicio": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(partida)),
                "agora": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "segundos": round(time.time() - partida),
                "intervalo_alto": args.intervalo_alto,
                "intervalo_mun": args.intervalo_mun,
                "taxa": args.taxa,
                "municipal": municipal,
                "fila_municipal": len(fila),
                "publicacao": situacao,
                "req": dict(cli.contador),
                "taxa_medida": round(cli.contador["get"] / max(1.0, time.time() - partida), 1),
                "bloqueado_por": round(cli.bloqueio_restante()),
                "abrangencia": (ab.get("br") or {}) if ab else {},
                "estado": estados,
                "finalizados": [f"{e}-{c}" for e, c in sorted(finalizados)],
            })

        except Exception as err:  # noqa: BLE001 — ver comentario acima
            print(f"  ! volta {volta} falhou ({type(err).__name__}: {err}); "
                  f"seguindo para a proxima", flush=True)

        if args.publicar:
            mais, situacao = enviar(saida, destino, chave, args.nome, enviados)
            aceitos += mais

        gasto = time.monotonic() - inicio
        print(f"  volta {volta:>4} | {gasto:6.1f}s | municipal={'sim' if municipal else 'nao'}"
              f" (faltam {len(fila)} UFs) | {cli.contador['get']} gets, "
              f"{cli.contador['304']} 304, {cli.contador['404']} 404, "
              f"{cli.contador['bytes'] / 1e6:.0f} MB"
              + (f" | {aceitos} enviados, {situacao}" if args.publicar else ""), flush=True)

        # Se uma volta demorou mais que o intervalo, segue direto: o atraso ja
        # e o sinal de que o gargalo e a rede, nao a espera.
        espera = args.intervalo_alto - (time.monotonic() - inicio)
        if espera > 0:
            time.sleep(espera)

    print(f"plantao encerrado apos {volta} voltas.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
