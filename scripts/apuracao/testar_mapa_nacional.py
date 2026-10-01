# -*- coding: utf-8 -*-
"""
Check do mapa da apuracao presidencial (apuracao-presidente.html), num Chromium
de verdade: o MapLibre so existe com WebGL, e nada disso roda num DOM falso
como o de testar_front.js.

Contra o simulado do TSE de 15/09 (scratch/apuracao/simulado) e os tiles de
scripts/gerar_tiles_apuracao.py, confere o que quebraria em silencio: clicar
num estado abre os municipios dele na mesma tela, pintados pelo boletim
municipal; o municipio escolhido vai para o painel; voltar sobe um nivel de cada
vez; a camada "Municipios" mostra o pais inteiro sem baixar malha nova; e nenhum
tile falta (404) no caminho.

    py scripts/apuracao/testar_mapa_nacional.py

Precisa do Playwright para Python com o Chromium instalado.
"""

import functools
import http.server
import json
import os
import re
import sys
import threading

from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# O MapLibre nao pendura a instancia no DOM. Isto a guarda em window.__mapa
# antes de a pagina rodar, para o teste converter coordenada em pixel.
ESPIAO = """
(() => {
  let real;
  Object.defineProperty(window, 'maplibregl', {
    configurable: true,
    get() { return real; },
    set(v) {
      const Orig = v.Map;
      class Espiao extends Orig { constructor(o) { super(o); window.__mapa = this; } }
      real = new Proxy(v, { get(t, k) { return k === 'Map' ? Espiao : t[k]; } });
    }
  });
})();
"""

SAO_PAULO, CAMPINAS, BH, BOA_ESPERANCA = 3550308, 3509502, 3106200, 5101837

falhas = 0


def ok(condicao, rotulo, detalhe=''):
    global falhas
    if condicao:
        print('  [ok ] ' + rotulo)
    else:
        falhas += 1
        print('  [ERRO] ' + rotulo + (f'  -> {detalhe}' if detalhe else ''))


def servidor():
    class Calado(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    # O MapLibre pede muitos tiles de uma vez; com a fila padrao (5), o Windows
    # recusa a conexao em vez de esperar, e o teste quebra no meio.
    class Servidor(http.server.ThreadingHTTPServer):
        request_queue_size = 128
    srv = Servidor(('127.0.0.1', 0), functools.partial(Calado, directory=RAIZ))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    srv = servidor()
    url = (f'http://127.0.0.1:{srv.server_address[1]}/apuracao-presidente.html'
           '?dados=scratch/apuracao/simulado/')

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pg = nav.new_page(viewport={'width': 1600, 'height': 900}, color_scheme='dark')
        erros, faltando, malha = [], [], []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        def resposta(r):
            if '/malha_apuracao/' in r.url:
                malha.append(r.url)
                if r.status == 404:
                    faltando.append(r.url)
        pg.on('response', resposta)
        pg.add_init_script(ESPIAO)

        # O simulado em scratch foi coletado antes de coleta.py tirar o IBGE da
        # ponte do site; aqui ele passa pela mesma correcao, sem mexer no disco.
        with open(os.path.join(RAIZ, 'resultados_geo', 'tse_para_ibge.json'), encoding='utf-8') as f:
            ponte = json.load(f)

        def corrigir(rota):
            resposta = rota.fetch()
            # a pagina tambem pede a projecao, que o simulado nao tem: 404 passa
            if resposta.status != 200:
                rota.fulfill(response=resposta)
                return
            dados = json.loads(resposta.text())
            for cd, m in (dados.get('mun') or {}).items():
                m['ibge'] = ponte.get(cd.lstrip('0') or cd, m.get('ibge'))
            rota.fulfill(json=dados)

        # so os snapshots municipais (UF de duas letras); no glob do Playwright
        # "?" e o da URL, nao um caractere qualquer
        pg.route(re.compile(r'/scratch/apuracao/simulado/\d+-0001-[a-z]{2}\.json'), corrigir)
        pg.goto(url)

        # A CSP da pagina proibe eval: wait_for_function so na forma de funcao.
        def ocioso(t=60000):
            pg.wait_for_function('() => window.__mapa.loaded() && !window.__mapa.isMoving()',
                                 timeout=t)

        def clicar(lng, lat):
            x, y = pg.evaluate("""([lng, lat]) => {
              const p = window.__mapa.project([lng, lat]);
              const r = window.__mapa.getContainer().getBoundingClientRect();
              return [p.x + r.left, p.y + r.top]; }""", [lng, lat])
            pg.mouse.click(x, y)

        def fs(camada, fid):
            return pg.evaluate('([l, id]) => window.__mapa.getFeatureState('
                               '{source: "malha", sourceLayer: l, id})', [camada, fid])

        pg.wait_for_function("() => window.__mapa && window.__mapa.getSource('malha')"
                             " && window.__mapa.loaded()", timeout=30000)
        ocioso()
        if pg.get_by_role('button', name='Recusar').is_visible():
            pg.get_by_role('button', name='Recusar').click()

        print('\nmapa nacional')
        ok(fs('estados', 35).get('cor'), 'Sao Paulo pintado pelo boletim de UF', fs('estados', 35))
        ok(pg.inner_text('#subtitulo') == 'Brasil', 'painel no Brasil')
        ok(not fs('municipios', SAO_PAULO).get('mostra'), 'municipios ainda escondidos')

        print('\nclique num estado abre os municipios dele aqui')
        clicar(-48.6, -22.3)
        ocioso()
        pg.wait_for_function(f"""() => window.__mapa.getFeatureState({{source: 'malha',
            sourceLayer: 'municipios', id: {SAO_PAULO}}}).cor""", timeout=30000)
        ok(pg.url.endswith('dados=scratch/apuracao/simulado/'), 'sem sair da pagina', pg.url)
        ok(pg.inner_text('#subtitulo') == 'São Paulo', 'painel em Sao Paulo', pg.inner_text('#subtitulo'))
        ok(fs('municipios', SAO_PAULO).get('mostra') is True, 'municipios de SP a mostra')
        ok(fs('estados', 35).get('oculto') is True, 'o estadual sai de baixo dos municipios')
        ok(fs('estados', 31).get('fora') is True, 'Minas esmaecida')
        ok(not fs('municipios', BH).get('mostra'), 'Minas continua por estado')

        print('\nmunicipio escolhido')
        clicar(-47.06, -22.85)
        pg.wait_for_timeout(300)
        ok(pg.inner_text('#subtitulo') == 'Campinas — São Paulo', 'Campinas no painel',
           pg.inner_text('#subtitulo'))
        ok(fs('municipios', CAMPINAS).get('sel') is True, 'contorno em Campinas')

        print('\nvoltar sobe um nivel por vez')
        pg.click('#voltar')
        ok(pg.inner_text('#subtitulo') == 'São Paulo', 'municipio -> estado')
        ok(not fs('municipios', CAMPINAS).get('sel'), 'contorno apagado')
        pg.click('#voltar')
        ocioso()
        ok(pg.inner_text('#subtitulo') == 'Brasil', 'estado -> Brasil')
        ok(not fs('municipios', SAO_PAULO).get('mostra'), 'municipios de SP recolhidos')
        ok(pg.is_hidden('#voltar'), 'sem botao de voltar no Brasil')

        print('\ncamada Municipios: o pais inteiro, sem baixar malha')
        antes = len(malha)
        # Medido dentro da pagina, do clique ao mapa ocioso: por fora, o
        # intervalo de consulta do Playwright entraria na conta.
        gasto = pg.evaluate("""() => new Promise((ok) => {
          const t0 = performance.now();
          window.__mapa.once('idle', () => ok((performance.now() - t0) / 1000));
          document.querySelector('#camadas [data-camada=mun]').click();
        })""")
        ok(len(malha) == antes, 'nenhum tile novo pedido', f'{len(malha) - antes} pedidos')
        # A malha em GeoJSON levava 12 s aqui; o teto so pega essa volta.
        ok(gasto < 1.5, f'troca em {gasto:.2f} s (WebGL por software, sem GPU)', f'{gasto:.2f} s')
        visiveis = pg.evaluate("""() => new Set(window.__mapa.queryRenderedFeatures({layers: ['mun-fill']})
          .filter((f) => window.__mapa.getFeatureState({source: 'malha', sourceLayer: 'municipios',
            id: f.id}).mostra).map((f) => f.id)).size""")
        ok(visiveis > 5500, 'municipios do pais inteiro na tela', visiveis)
        pg.wait_for_function("() => document.getElementById('mapaNota').textContent.startsWith('5.571')",
                             timeout=60000)
        ok(True, 'todos os municipios com boletim')

        print('\nmunicipio novo, recortado de onde veio')
        pg.evaluate('() => window.__mapa.jumpTo({center: [-55.017, -13.477], zoom: 8})')
        ocioso()
        x, y = pg.evaluate("""() => { const p = window.__mapa.project([-55.017, -13.477]);
          return [p.x, p.y]; }""")
        cds = pg.evaluate("""([x, y]) => window.__mapa.queryRenderedFeatures([x, y],
          {layers: ['mun-fill']}).map((f) => f.id)""", [x, y])
        ok(cds == [BOA_ESPERANCA], 'so Boa Esperanca do Norte naquele ponto, sem Nova Ubirata por baixo', cds)
        ok(fs('municipios', BOA_ESPERANCA).get('cor'), 'pintada pelo boletim')

        ok(not faltando, 'nenhum tile 404', faltando[:3])
        ok(not erros, 'sem erro de JavaScript na pagina', '; '.join(erros))
        # A pagina segue pedindo boletim; fechar com a correcao no meio de uma
        # dessas leituras enchia a saida de TargetClosedError.
        pg.unroute_all(behavior='ignoreErrors')
        nav.close()
    srv.shutdown()

    print('\n' + (f'{falhas} FALHA(S)' if falhas else 'tudo certo'))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
