"""Prova as defesas contra o bloqueio do TSE, contra um servidor que pune de proposito.

As regras do TSE (apresentacao de julho/2026, slide 14) sao tres: no maximo 100
requisicoes por IP por segundo, bloqueio de 10 minutos RENOVADO a cada tentativa
durante a punicao, e 404 tambem pode bloquear. As defesas do cliente so valem se
sobreviverem ao caso real, entao aqui um servidor local devolve 429, 403 e 404 de
proposito e o cliente tem de se comportar.

    python scripts/apuracao/testar_limites.py
"""

from __future__ import annotations

import http.server
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tse  # noqa: E402
from tse import Cliente, Limitador  # noqa: E402

# A pausa de verdade e de 11 minutos. Aqui ela e encurtada para o teste caber num
# segundo — o que se prova e o comportamento, nao a duracao.
tse.PAUSA_BLOQUEIO = 2.0
tse.MEMORIA_404 = 30.0

PAGINA_AKAMAI = (b"<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>"
                 b"<H1>Access Denied</H1>You don't have permission to access "
                 b'"http://host/x" on this server.<P>Reference&#32;&#35;18'
                 b"<P>https://errors.edgesuite.net/18</P></BODY></HTML>")

falhas = 0
pedidos: dict[str, int] = {}
_trava = threading.Lock()


def ok(condicao: bool, rotulo: str, detalhe: str = "") -> None:
    global falhas
    if condicao:
        print(f"  [ok ] {rotulo}")
    else:
        falhas += 1
        print(f"  [ERRO] {rotulo}" + (f"  -> {detalhe}" if detalhe else ""))


class Punidor(http.server.BaseHTTPRequestHandler):
    """Devolve o que o caminho pedir. `/punir/<codigo>` responde com o codigo."""

    def do_GET(self):  # noqa: N802
        with _trava:
            pedidos[self.path] = pedidos.get(self.path, 0) + 1
        if self.path.startswith("/ok"):
            corpo = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
        elif self.path.startswith("/ausente"):
            self.send_error(404)
        elif self.path.startswith("/truncado"):
            # Promete mais bytes do que entrega: e o que o urllib devolve como
            # http.client.IncompleteRead. Na primeira vez trunca; depois responde
            # inteiro, para o teste poder provar que a retentativa resolve.
            with _trava:
                truncar = pedidos[self.path] == 1
            corpo = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Length", str(len(corpo) + (5 if truncar else 0)))
            self.end_headers()
            self.wfile.write(corpo)
        elif self.path.startswith("/akamai"):
            self.send_response(403)
            self.send_header("Content-Length", str(len(PAGINA_AKAMAI)))
            self.end_headers()
            self.wfile.write(PAGINA_AKAMAI)
        else:  # /punido
            self.send_error(429)

    def log_message(self, *a):  # silencio
        pass


def contagem(caminho: str) -> int:
    with _trava:
        return pedidos.get(caminho, 0)


def main() -> int:
    servidor = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Punidor)
    porta = servidor.server_address[1]
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{porta}"

    # ---------------------------------------------------------- limitador
    print("\nlimitador de taxa")
    lim = Limitador(por_segundo=50.0)
    inicio = time.monotonic()
    for _ in range(25):
        lim.esperar()
    gasto = time.monotonic() - inicio
    ok(gasto >= 0.44, "25 saidas a 50/s levam ao menos 0,48s", f"{gasto:.2f}s")
    ok(Cliente().contador["get"] == 0, "cliente novo comeca zerado")
    ok(Cliente()._limitador._intervalo >= 1 / 60.000001,
       "taxa padrao do cliente e 60/s, com folga para o teto de 100 do TSE")

    # ------------------------------------------------------- memoria de 404
    print("\nmemoria de 404 (404 repetido bloqueia igual a excesso)")
    cli = Cliente(base=base, tentativas=1)
    for _ in range(5):
        cli.bytes_de(f"{base}/ausente")
    ok(contagem("/ausente") == 1, "5 pedidos a uma URL ausente batem 1 vez no servidor",
       f"{contagem('/ausente')} idas")
    ok(cli.contador["404"] == 1, "conta um 404 so", str(cli.contador["404"]))
    ok(cli.contador["evitados"] == 4, "e conta 4 pedidos evitados",
       str(cli.contador["evitados"]))

    # --------------------------------------------- 403 do Akamai nao e punicao
    print("\n403 com pagina do Akamai = objeto inexistente, nao punicao")
    cli2 = Cliente(base=base, tentativas=2)
    cli2.bytes_de(f"{base}/akamai")
    ok(cli2.contador["bloqueios"] == 0, "nao abre o disjuntor",
       str(cli2.contador["bloqueios"]))
    ok(cli2.bloqueio_restante() == 0, "cliente segue liberado")
    ok(cli2.contador["404"] == 1, "contabiliza como ausencia")
    ok(cli2.bytes_de(f"{base}/ok") is not None, "e continua lendo normalmente")

    # ------------------------------------------------- resposta truncada
    # Foi o que matou o plantao de 15/09 depois de duas horas no ar:
    #   http.client.IncompleteRead(15573 bytes read, 1 more expected)
    # IncompleteRead nao herda de OSError, entao escapava de todos os except do
    # cliente e subia ate encerrar o processo.
    print("\nresposta truncada (IncompleteRead) e retentativa")
    cli5 = Cliente(base=base, tentativas=3)
    corpo = None
    estourou = None
    try:
        corpo = cli5.bytes_de(f"{base}/truncado")
    except Exception as err:  # noqa: BLE001 - e exatamente o que nao pode acontecer
        estourou = err
    ok(estourou is None, "resposta truncada nao sobe excecao para quem chamou",
       f"{type(estourou).__name__}: {estourou}" if estourou else "")
    ok(corpo == b'{"ok":true}', "a retentativa traz o corpo inteiro", repr(corpo))
    ok(contagem("/truncado") == 2, "custou duas idas ao servidor",
       f"{contagem('/truncado')} idas")

    # ------------------------------------------ 429 para TODAS as threads
    print("\ndisjuntor: 429 para o cliente inteiro, nao so a thread que levou")
    cli3 = Cliente(base=base, tentativas=1)
    ok(cli3.bytes_de(f"{base}/ok") is not None, "primeiro pedido passa")

    antes = contagem("/ok")
    cli3.bytes_de(f"{base}/punido")
    ok(cli3.contador["bloqueios"] == 1, "um bloqueio registrado",
       str(cli3.contador["bloqueios"]))
    restante = cli3.bloqueio_restante()
    ok(restante > 1.0, "pausa aberta e valendo", f"{restante:.1f}s restantes")

    # outras threads tem de PARAR, nao seguir pedindo
    resultados = []

    def tentar():
        inicio = time.monotonic()
        cli3.bytes_de(f"{base}/ok")
        resultados.append(time.monotonic() - inicio)

    threads = [threading.Thread(target=tentar) for _ in range(6)]
    for t in threads:
        t.start()
    time.sleep(0.5)
    ok(contagem("/ok") == antes,
       "durante a pausa, 6 threads nao mandaram nenhuma requisicao",
       f"{contagem('/ok') - antes} vazaram")
    for t in threads:
        t.join(timeout=10)
    ok(all(r > 1.0 for r in resultados),
       "todas as 6 esperaram a pausa terminar",
       f"menor espera {min(resultados):.1f}s" if resultados else "sem resultado")
    ok(contagem("/ok") == antes + 6, "e so entao passaram",
       f"{contagem('/ok') - antes} idas")

    # ----------------------------------- punicao nao se renova a cada thread
    # O caso real: as 48 threads do plantao levam 429 quase ao mesmo tempo. A
    # primeira abre a pausa; as outras tem de enxergar a pausa aberta e NAO abrir
    # outra, senao o fim da punicao vai sendo empurrado para frente por cada uma.
    print("\npunicoes simultaneas abrem UMA pausa, nao uma por thread")
    cli4 = Cliente(base=base, tentativas=1)
    partida = threading.Barrier(4)

    def punir_junto():
        partida.wait()
        cli4.bytes_de(f"{base}/punido")

    ts = [threading.Thread(target=punir_junto) for _ in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=10)
    ok(cli4.contador["bloqueios"] == 1,
       "4 punicoes simultaneas contam como um bloqueio so",
       str(cli4.contador["bloqueios"]))
    ok(cli4.bloqueio_restante() <= tse.PAUSA_BLOQUEIO + 0.1,
       "e a pausa nao foi empurrada para frente",
       f"{cli4.bloqueio_restante():.1f}s")

    # E depois que a punicao passa, uma nova punicao e um bloqueio novo — isso e
    # comportamento correto, nao regressao: significa que o TSE ainda esta punindo.
    cli4.bytes_de(f"{base}/punido")
    ok(cli4.contador["bloqueios"] == 2,
       "punicao depois da pausa conta como bloqueio novo",
       str(cli4.contador["bloqueios"]))

    servidor.shutdown()
    print("\n" + (f"{falhas} FALHA(S)" if falhas else "tudo certo"))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
