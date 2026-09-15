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
import http.client
import json
import threading
import time
import urllib.error
import urllib.request

BASE = "https://resultados.tse.jus.br"

# O bloqueio do TSE dura 10 minutos e e RENOVADO a cada nova tentativa durante a
# punicao. A pausa aqui e maior que isso de proposito, e vale para todas as
# threads: recuar so naquela que levou o 403, enquanto as outras 47 seguem
# pedindo, e exatamente a receita para renovar o bloqueio indefinidamente.
PAUSA_BLOQUEIO = 660.0

# Quanto tempo lembrar de uma URL que devolveu 404. Nao e "nunca mais": um
# arquivo pode passar a existir — o de eleitos so aparece depois da totalizacao
# final, e municipio sem boletim ainda pode nao ter arquivo. Mas re-pedir a cada
# volta transforma um 404 estrutural em centenas, e 404 repetido bloqueia igual a
# excesso de requisicoes.
MEMORIA_404 = 600.0

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

# Cargos com arquivo de eleitos (EA10, secao 2). Presidente nao tem: o eleito
# presidencial sai do proprio EA20, pelo campo `e` do candidato.
CARGOS_COM_ELEITOS = {"0003", "0005", "0006", "0011"}

def ufs_do_cargo(cargo: str, ufs: list[str]) -> list[str]:
    """Filtra as abrangencias em que aquele cargo realmente existe.

    O Distrito Federal tem Camara Legislativa, nao Assembleia: elege deputado
    distrital (0008) e nao elege deputado estadual (0007). Nas outras 26 unidades
    e o contrario. O EA11 declara os cargos da eleicao inteira, nao por UF, entao
    a regra nao sai do arquivo — mas o efeito de ignora-la sai: pedir
    `df-c0007-...` devolve 404 a cada volta, e 404 repetido bloqueia o acesso por
    dez minutos. Pedir 0008 nas 26 UFs dariam 26 por volta.
    """
    if cargo == "0008":
        return [u for u in ufs if u == "df"]
    if cargo == "0007":
        return [u for u in ufs if u != "df"]
    return ufs


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


def ciclo_de(config: dict, eleicao=None) -> str:
    """Ciclo eleitoral do token <ciclo>. Vem do pleito, nao da raiz.

    O EA11 de 2026 passou a listar eleicoes de mais de um ciclo (2024 segue no ar
    ate 04/04/2028), e o ciclo e atributo do pleito — `pl[].c`. O arquivo atual
    ainda repete o valor na raiz; ler o do pleito primeiro e o que mantem a URL
    correta quando a raiz deixar de ter um ciclo unico para publicar.
    """
    if eleicao is not None:
        alvo = str(eleicao)
        for pleito in config.get("pl", []):
            if any(str(e.get("cd")) == alvo for e in pleito.get("e", [])):
                if pleito.get("c"):
                    return str(pleito["c"])
                break
    return str(config.get("c", "") or "")


# Tipos de eleicao do EA11 (`e.tp`). O acompanhamento (EA14/EA15) e o arquivo de
# eleitos (EA10) so existem nas ordinarias — pedi-los numa suplementar ou numa
# consulta popular devolve 404, e 404 repetido bloqueia o acesso por 10 minutos.
TIPOS_ELEICAO = {1: "estadual ordinaria", 2: "estadual suplementar",
                 3: "municipal ordinaria", 4: "municipal suplementar",
                 5: "consulta popular nacional", 6: "consulta popular estadual",
                 7: "consulta popular municipal", 8: "federal ordinaria",
                 9: "federal suplementar"}
TIPOS_ORDINARIAS = {1, 3, 8}


def eleicao_de(config: dict, eleicao) -> dict:
    """O registro da eleicao dentro do EA11, ou {} se ela nao estiver na lista."""
    alvo = str(eleicao)
    for pleito in config.get("pl", []):
        for e in pleito.get("e", []):
            if str(e.get("cd")) == alvo:
                return e
    return {}


def tipo_eleicao(config: dict, eleicao) -> int:
    """Codigo do tipo da eleicao (`e.tp` do EA11). 0 quando desconhecido."""
    try:
        return int(eleicao_de(config, eleicao).get("tp") or 0)
    except (TypeError, ValueError):
        return 0


def pleito_de(config: dict, eleicao) -> str:
    """Codigo do pleito de uma eleicao — token <cd_pleito> (EA16, arquivos de urna)."""
    alvo = str(eleicao)
    for pleito in config.get("pl", []):
        if any(str(e.get("cd")) == alvo for e in pleito.get("e", [])):
            return str(pleito.get("cd", ""))
    return ""


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

    def __init__(self, ambiente: str = "oficial", por_segundo: float = 60.0,
                 tentativas: int = 4, base: str = BASE):
        self.ambiente = ambiente
        self.base = base
        self.tentativas = tentativas
        self._limitador = Limitador(por_segundo)
        self._etags: dict[str, str] = {}
        self._corpos: dict[str, bytes] = {}
        # URLs que ja responderam 200 alguma vez. E o que separa um 403 de "esse
        # arquivo nao existe neste host" de um 403 de "voce foi bloqueado":
        # bloqueio atinge o que funcionava ate agora.
        self._conhecidas: set[str] = set()
        # URL -> instante do 404, para nao repetir o pedido dentro de MEMORIA_404
        self._ausentes: dict[str, float] = {}
        self._bloqueio_ate = 0.0
        self._trava_estado = threading.Lock()
        self.contador = {"get": 0, "304": 0, "404": 0, "bytes": 0,
                         "bloqueios": 0, "evitados": 0}

    # ---- defesas --------------------------------------------------------

    def bloqueio_restante(self) -> float:
        """Segundos que ainda faltam da pausa por bloqueio. 0 se esta liberado."""
        with self._trava_estado:
            return max(0.0, self._bloqueio_ate - time.monotonic())

    def _esperar_bloqueio(self) -> None:
        """Segura a thread enquanto durar a pausa. Todas param juntas."""
        while True:
            falta = self.bloqueio_restante()
            if falta <= 0:
                return
            time.sleep(min(5.0, falta))

    def _abrir_disjuntor(self, codigo: int, url: str) -> None:
        """Pausa o cliente inteiro. Quem chegar depois ve a pausa ja aberta e
        espera, em vez de abrir outra e empurrar o fim para mais longe."""
        with self._trava_estado:
            if self._bloqueio_ate - time.monotonic() > 0:
                return
            self._bloqueio_ate = time.monotonic() + PAUSA_BLOQUEIO
            self.contador["bloqueios"] += 1
            n = self.contador["bloqueios"]
        quanto = (f"{PAUSA_BLOQUEIO / 60:.0f} min" if PAUSA_BLOQUEIO >= 60
                  else f"{PAUSA_BLOQUEIO:.0f}s")
        print(f"  !! HTTP {codigo} — provavel bloqueio do TSE (o {n}o). Parando TODAS "
              f"as requisicoes por {quanto}; insistir renova a punicao."
              f"\n     em {url}", flush=True)

    @staticmethod
    def _e_ausencia(corpo: bytes | None) -> bool:
        """403 com a pagina de erro do Akamai e objeto inexistente, nao punicao.

        O host do simulado responde assim para qualquer caminho que nao exista —
        foi o que apareceu ao sondar `simulado/teste`. Tratar isso como bloqueio
        pararia o plantao por 11 minutos por causa de um caminho errado.
        """
        if not corpo:
            return False
        marca = corpo[:2000].lower()
        return b"edgesuite" in marca or b"access denied" in marca

    # ---- transporte ----------------------------------------------------

    def bytes_de(self, url: str, cache: bool = True) -> bytes | None:
        """GET com limite de taxa. None em 404 (o chamador decide se e erro).

        Em 304 devolve o corpo memorizado da ultima leitura da mesma URL.
        """
        # Ja deu 404 ha pouco: nao pede de novo. 404 repetido bloqueia igual a
        # excesso, e um 404 estrutural se repetiria a cada volta da noite inteira.
        faltou = self._ausentes.get(url)
        if faltou is not None:
            if time.monotonic() - faltou < MEMORIA_404:
                self.contador["evitados"] += 1
                return None
            del self._ausentes[url]

        req = urllib.request.Request(url, headers=dict(CABECALHOS))
        etag = self._etags.get(url) if cache else None
        if etag:
            req.add_header("If-None-Match", etag)

        for tentativa in range(1, self.tentativas + 1):
            self._esperar_bloqueio()
            self._limitador.esperar()
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    corpo = resp.read()
                    self._conhecidas.add(url)
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
                    self._ausentes[url] = time.monotonic()
                    return None
                # 403 e ambiguo neste CDN: tanto a punicao por excesso quanto a
                # resposta para objeto inexistente saem assim. O que separa os
                # dois e se a URL ja funcionou antes — punicao atinge o que
                # funcionava; caminho errado nunca funcionou.
                if err.code == 403 and url not in self._conhecidas \
                        and self._e_ausencia(err.read()):
                    self.contador["404"] += 1
                    self._ausentes[url] = time.monotonic()
                    return None
                if err.code in (403, 429):
                    self._abrir_disjuntor(err.code, url)
                    if tentativa == self.tentativas:
                        return None
                    continue
                if tentativa == self.tentativas:
                    raise
                time.sleep(min(30, 2 ** tentativa))
            # http.client.HTTPException cobre a resposta que chega pela metade
            # (IncompleteRead), a linha de status quebrada e a conexao derrubada no
            # meio do corpo. Nao herda de OSError, entao escapava de todos os
            # except e subia ate matar o processo — foi o que aconteceu na janela
            # de 15/09, depois de duas horas no ar:
            #   IncompleteRead(15573 bytes read, 1 more expected)
            except (urllib.error.URLError, http.client.HTTPException,
                    TimeoutError, ConnectionError, OSError) as err:
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

    def url_config(self) -> str:
        return f"{self.base}/{self.ambiente}/comum/config/ele-c.json"

    def config_eleicoes(self) -> dict:
        """EA11 — a raiz de tudo. Traz ciclo, pleitos, eleicoes e os diretorios."""
        dados = self.json_de(self.url_config(), cache=False)
        if dados is None:
            raise RuntimeError(f"EA11 nao encontrado em {self.url_config()}")
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
            "ciclo": ciclo_de(config, tokens.get("cd_eleicao")),
            "cd_pleito": pleito_de(config, tokens.get("cd_eleicao")),
            **tokens,
        }
        for chave, valor in valores.items():
            modelo = modelo.replace(f"<{chave}>", str(valor))
        return modelo


# Onde procurar, como pares (host, ambiente). O simulado de 2026 nao esta no
# host oficial: fica em resultados-sim.tse.jus.br, e o seu "ambiente" tem DOIS
# segmentos — `simulado/simulado2026`. Foi o proprio aplicativo Resultados do TSE
# que entregou isso: a raiz do host redireciona para
# /simulado/simulado2026/app/index.html, e o bundle do app traz a base e o
# ambiente em claro. No host oficial, `/simulado` responde com conexao cortada,
# nao com 404 — procurar so por la nao acharia nada.
SIM_2026 = "https://resultados-sim.tse.jus.br"

AMBIENTES = [
    (SIM_2026, "simulado/simulado2026"),   # simulados de setembro/2026
    (BASE, "oficial"),                     # a eleicao de verdade
    (SIM_2026, "simulado/teste"),          # ambientes de ensaio do proprio TSE
    (BASE, "simulado"),
]


def descobrir_ambiente(candidatos: list[tuple[str, str]] | None = None,
                       por_segundo: float = 80.0, preferir_simulado: bool = True
                       ) -> tuple[str, str, dict] | tuple[None, None, None]:
    """Sonda os pares (host, ambiente) conhecidos e devolve o escolhido com o EA11.

    Sondagem curta e de uma vez so: cada candidato custa UMA requisicao a
    `comum/config/ele-c.json`. Nao e varredura de diretorio — e a lista fechada de
    lugares que o TSE ja usou ou documentou. Ainda assim, 404 conta para o
    bloqueio, entao isto nunca deve entrar no laco do plantao: roda na abertura e
    o que for encontrado vale para a sessao inteira.

    Sonda todos antes de escolher, em vez de parar no primeiro que responde: o
    `oficial` existe sempre, e parar nele faria a descoberta nunca achar o
    simulado — que e justamente o que se quer numa janela de teste. Com
    `preferir_simulado`, ganha o primeiro cuja fase seja `s`.
    """
    achados: list[tuple[str, str, dict]] = []
    for base, ambiente in (candidatos or AMBIENTES):
        rotulo = f"{base.split('//')[-1]}/{ambiente}"
        cli = Cliente(ambiente=ambiente, por_segundo=por_segundo, tentativas=1, base=base)
        try:
            dados = cli.json_de(cli.url_config(), cache=False)
        except Exception as err:  # conexao recusada/cortada tambem e "nao existe"
            print(f"  {rotulo:48s} {type(err).__name__}", flush=True)
            continue
        if not dados:
            print(f"  {rotulo:48s} ausente", flush=True)
            continue
        fase = "simulada" if dados.get("f") == "s" else "oficial"
        print(f"  {rotulo:48s} OK — fase {dados.get('f')} ({fase}), gerado "
              f"{dados.get('dg')} {dados.get('hg')} idg {dados.get('idg') or '-'}",
              flush=True)
        achados.append((base, ambiente, dados))

    if not achados:
        return None, None, None
    if preferir_simulado:
        for achado in achados:
            if achado[2].get("f") == "s":
                return achado
    return achados[0]


def e6(codigo) -> str:
    """Formata codigo de eleicao no padrao e<ELEICA>: 6 digitos com zeros."""
    return f"e{int(codigo):06d}"


def p6(codigo) -> str:
    """Formata codigo de pleito no padrao p<PLEITO>: 6 digitos com zeros."""
    return f"p{int(codigo):06d}"
