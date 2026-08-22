"""Cliente do CDN de divulgacao de resultados do TSE (Eleicoes 2026).

Le a configuracao de eleicoes (EA11) e monta as URLs a partir dos templates que
o proprio arquivo publica no campo `arq` — nada de caminho chumbado no codigo,
porque os codigos de eleicao de 2026 so sao divulgados as vesperas do pleito
(03/10/2026, conforme a apresentacao aos interessados).

Regras do TSE que este modulo respeita (apresentacao de julho/2026, slide 14):

  - maximo de 100 requisicoes por IP por segundo, com bloqueio de 10 minutos
    renovavel. O limitador aqui trabalha com folga (80/s por padrao).
  - 404 tambem pode gerar bloqueio: nunca varrer caminhos. So se pede o que
    EA11/EA12/EA16/EA18 declararam existir.
  - nao e possivel listar diretorios.

Documentacao das especificacoes: EA10 a EA20, em
https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados
"""

from __future__ import annotations

import html
import json
import threading
import time
import urllib.error
import urllib.request

BASE = "https://resultados.tse.jus.br"

# O CDN do TSE rejeita o user-agent padrao do urllib em alguns pontos de presenca.
CABECALHOS = {"User-Agent": "Mozilla/5.0 (compativel; observatorio-eleitoral/1.0)"}

# Codigos de cargo (EA20, secao 2). Sao fixos e conhecidos.
CARGOS = {
    "presidente": "0001",
    "governador": "0003",
    "senador": "0005",
    "deputado_federal": "0006",
    "deputado_estadual": "0007",
    "deputado_distrital": "0008",
    "prefeito": "0011",
    "vereador": "0013",
}

# Cargos que existem em arquivo de abrangencia UF (EA20, tabela da secao 2).
# Prefeito e vereador so existem em municipio e zona.
CARGOS_COM_UF = {"0001", "0003", "0005", "0006", "0007", "0008"}

# So Presidente tem arquivo de abrangencia Brasil. Pedir br-c0006 (deputado
# federal) devolveria 404 — e 404 repetido tambem derruba o acesso ao CDN.
CARGOS_COM_BR = {"0001"}

# Cargos proporcionais: a disputa e por partido/federacao, com quociente
# eleitoral e vagas. Guardar candidato a candidato em cada municipio nao cabe —
# o arquivo de vereador de uma capital sozinho passa de 200 KB.
CARGOS_PROPORCIONAIS = {"0006", "0007", "0008", "0013"}

UFS = [
    "ac", "al", "am", "ap", "ba", "ce", "df", "es", "go", "ma", "mg", "ms", "mt",
    "pa", "pb", "pe", "pi", "pr", "rj", "rn", "ro", "rr", "rs", "sc", "se", "sp", "to",
]


def num(bruto) -> float:
    """Converte numero do TSE para float. Vem como string, com virgula decimal.

    Exemplos reais: "100,00" (percentual), "1234" (contagem), "" (ausente).
    """
    if bruto is None or bruto == "":
        return 0.0
    if isinstance(bruto, (int, float)):
        return float(bruto)
    return float(str(bruto).replace(".", "").replace(",", "."))


def inteiro(bruto) -> int:
    return int(num(bruto))


def texto(bruto) -> str:
    """Texto do TSE com as entidades HTML resolvidas.

    Os JSON do TSE trazem entidades dentro das strings: "FELIPE D&apos;AVILA",
    "1&#186; Turno". Sem desfazer isso, o nome sai literal na tela — e escapar de
    novo na hora de montar o HTML transforma em "D&amp;apos;AVILA".
    """
    return html.unescape(str(bruto or "")).strip()


class Limitador:
    """Espaca as requisicoes para nao passar de `por_segundo` no total.

    Nao e um token bucket: e o intervalo minimo entre saidas, o que da um fluxo
    constante em vez de rajadas de 100 seguidas de silencio. Rajada e justamente
    o que dispara o bloqueio de 10 minutos.
    """

    def __init__(self, por_segundo: float = 80.0):
        self._intervalo = 1.0 / max(por_segundo, 0.1)
        self._trava = threading.Lock()
        self._proxima = 0.0

    def esperar(self) -> None:
        with self._trava:
            agora = time.monotonic()
            espera = self._proxima - agora
            if espera > 0:
                time.sleep(espera)
                agora = self._proxima
            self._proxima = agora + self._intervalo


class Cliente:
    """Sessao de leitura do CDN, com limite de taxa e cache de ETag.

    O CDN devolve ETag e aceita If-None-Match: no regime de atualizacao continua
    da noite de apuracao, a maioria dos municipios responde 304 sem corpo, o que
    derruba o trafego de gigabytes para dezenas de megabytes por passada.
    """

    def __init__(self, ambiente: str = "oficial", por_segundo: float = 80.0,
                 tentativas: int = 4, base: str = BASE):
        self.ambiente = ambiente
        self.base = base
        self.tentativas = tentativas
        self._limitador = Limitador(por_segundo)
        self._etags: dict[str, str] = {}
        self._corpos: dict[str, bytes] = {}
        self.contador = {"get": 0, "304": 0, "404": 0, "bytes": 0}

    # ---- transporte ----------------------------------------------------

    def bytes_de(self, url: str, cache: bool = True) -> bytes | None:
        """GET com limite de taxa. None em 404 (o chamador decide se e erro).

        Em 304 devolve o corpo memorizado da ultima leitura da mesma URL.
        """
        req = urllib.request.Request(url, headers=dict(CABECALHOS))
        etag = self._etags.get(url) if cache else None
        if etag:
            req.add_header("If-None-Match", etag)

        for tentativa in range(1, self.tentativas + 1):
            self._limitador.esperar()
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    corpo = resp.read()
                    self.contador["get"] += 1
                    self.contador["bytes"] += len(corpo)
                    if cache:
                        novo = resp.headers.get("ETag")
                        if novo:
                            self._etags[url] = novo
                            self._corpos[url] = corpo
                    return corpo
            except urllib.error.HTTPError as err:
                if err.code == 304:
                    self.contador["304"] += 1
                    return self._corpos.get(url)
                if err.code == 404:
                    self.contador["404"] += 1
                    return None
                # 403/429 = provavel bloqueio por excesso. Recuar de verdade,
                # nao insistir: o bloqueio e de 10 minutos e renovavel.
                if err.code in (403, 429):
                    espera = min(120, 15 * tentativa)
                    print(f"  ! HTTP {err.code} em {url} — recuando {espera}s", flush=True)
                    time.sleep(espera)
                    continue
                if tentativa == self.tentativas:
                    raise
                time.sleep(min(30, 2 ** tentativa))
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as err:
                if tentativa == self.tentativas:
                    raise
                espera = min(30, 2 ** tentativa)
                print(f"  ! {type(err).__name__} em {url} — tentativa {tentativa}, "
                      f"aguardando {espera}s", flush=True)
                time.sleep(espera)
        return None

    def json_de(self, url: str, cache: bool = True) -> dict | None:
        corpo = self.bytes_de(url, cache=cache)
        if corpo is None:
            return None
        return json.loads(corpo.decode("utf-8"))

    # ---- montagem de URL -----------------------------------------------

    def config_eleicoes(self) -> dict:
        """EA11 — a raiz de tudo. Traz ciclo, pleitos, eleicoes e os diretorios."""
        url = f"{self.base}/{self.ambiente}/comum/config/ele-c.json"
        dados = self.json_de(url, cache=False)
        if dados is None:
            raise RuntimeError(f"EA11 nao encontrado em {url}")
        return dados

    def diretorio(self, config: dict, tipo: str, **tokens) -> str:
        """Resolve o template de diretorio do campo `arq` do EA11.

        Os templates vem como "<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>".
        Resolver a partir daqui (em vez de chumbar o caminho) e o que faz o
        coletor sobreviver a uma mudanca de estrutura do TSE.
        """
        for entrada in config.get("arq", []):
            if entrada.get("tp") == tipo:
                modelo = entrada["dir"]
                break
        else:
            raise KeyError(f"tipo de arquivo '{tipo}' ausente do campo arq do EA11")

        valores = {
            "base": self.base,
            "ambiente": self.ambiente,
            "ciclo": config.get("c", ""),
            **tokens,
        }
        for chave, valor in valores.items():
            modelo = modelo.replace(f"<{chave}>", str(valor))
        return modelo


def e6(codigo) -> str:
    """Formata codigo de eleicao no padrao e<ELEICA>: 6 digitos com zeros."""
    return f"e{int(codigo):06d}"


def p6(codigo) -> str:
    """Formata codigo de pleito no padrao p<PLEITO>: 6 digitos com zeros."""
    return f"p{int(codigo):06d}"
