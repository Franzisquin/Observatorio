"""Ponte local para colher o DivulgaCandContas quando o cliente HTTP e barrado.

O TSE poe o DivulgaCandContas atras de Akamai, que recusa cliente por impressao
digital de TLS: `curl`, `urllib` e afins levam 403 mesmo com cabecalho de
navegador e endpoint valido. Um navegador de verdade passa.

Esta ponte fecha esse vao: sobe um servidor local, voce cola um trecho no
console do navegador ja aberto em divulgacandcontas.tse.jus.br, e o proprio
navegador despeja o JSON aqui, que grava em disco.

O transporte e o FRAGMENTO da URL, e nao postMessage nem fetch direto. Foi o
unico que passou: o Chrome barra por Private Network Access qualquer requisicao
de pagina https para 127.0.0.1, inclusive de dentro de iframe. Ja navegar para
uma URL local carregando os dados depois do "#" nao e requisicao de rede
privada — e a pagina de destino, sendo http, fala com esta ponte a vontade.
O fragmento nem chega ao servidor: quem o le e o JavaScript da pagina.

    python scripts/apuracao/ponte_divulgacand.py
    # abra https://divulgacandcontas.tse.jus.br/divulga/ e rode o JS que ele imprime

Grava em resultados_geo/candidatos_2026/. Nada e transformado: o que o TSE
devolve e o que vai para o arquivo, so normalizado nos campos que a pagina usa.

Se `scripts/apuracao/candidatos.py --probe` passar na sua rede, prefira aquele:
e um caminho direto, sem navegador no meio.
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

RAIZ = Path(__file__).resolve().parent.parent.parent
DESTINO = RAIZ / "resultados_geo" / "candidatos_2026"
PORTA = 5599


class Manipulador(BaseHTTPRequestHandler):

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chrome exige isto para uma pagina publica alcancar a rede local.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    RECEPTOR = """<!DOCTYPE html><meta charset="utf-8"><title>receptor</title>
<body><pre id="log">lendo fragmento...</pre>
<script>
(async () => {
  const log = (m) => document.getElementById('log').textContent += '
' + m;
  const bruto = location.hash.slice(1);
  if (!bruto) { log('sem fragmento'); return; }
  let pacote;
  try { pacote = JSON.parse(decodeURIComponent(bruto)); }
  catch (e) { log('fragmento ilegivel: ' + e.message); return; }
  for (const [nome, conteudo] of Object.entries(pacote)) {
    const corpo = JSON.stringify(conteudo);
    const r = await fetch('/salvar?nome=' + encodeURIComponent(nome),
      {method:'POST', headers:{'Content-Type':'application/json'}, body: corpo});
    log(`${nome}: ${Object.keys(conteudo).length} registros -> ${r.status}`);
  }
  log('pronto. pode fechar.');
})();
</script>"""

    def do_GET(self):
        """Serve o receptor. Ele roda em http, entao fala com esta ponte sem
        esbarrar no Private Network Access do Chrome."""
        corpo = self.RECEPTOR.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        rota = urlparse(self.path)
        nome = (parse_qs(rota.query).get("nome") or ["dados"])[0]
        # Nome de arquivo vem da rede: nao deixe escapar da pasta de destino.
        nome = Path(nome).name
        if not nome.endswith(".json"):
            nome += ".json"

        tamanho = int(self.headers.get("Content-Length") or 0)
        corpo = self.rfile.read(tamanho)

        try:
            dados = json.loads(corpo.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(f"JSON invalido: {e}".encode())
            return

        DESTINO.mkdir(parents=True, exist_ok=True)
        alvo = DESTINO / nome
        alvo.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")

        n = len(dados) if isinstance(dados, (list, dict)) else 1
        print(f"  gravado {alvo.name}: {n} registros, {alvo.stat().st_size / 1024:.0f} KB",
              flush=True)

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "arquivo": alvo.name}).encode())

    def log_message(self, *_):
        pass          # o print acima ja diz o que interessa


def main() -> int:
    servidor = ThreadingHTTPServer(("127.0.0.1", PORTA), Manipulador)
    print(f"Ponte ouvindo em http://127.0.0.1:{PORTA}  ->  {DESTINO}")
    print("Abra https://divulgacandcontas.tse.jus.br/divulga/ e rode no console:\n")
    print(f"""  const ID='20322002026', UFS=['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG',
    'MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
  const col={{}};
  const puxa=async(ue,cargo)=>{{
    const r=await fetch(`${{location.origin}}/divulga/rest/v1/candidatura/listar/2026/${{ue}}/${{ID}}/${{cargo}}/candidatos`);
    if(!r.ok) return []; const d=await r.json();
    return (d.candidatos||[]).map(c=>({{sq:String(c.id), urna:c.nomeUrna||'',
      nome:c.nomeCompleto||'', numero:String(c.numero||''),
      partido:(c.partido&&c.partido.sigla)||'', situacao:c.descricaoSituacao||'',
      coligacao:c.nomeColigacao||'', uf:ue, cargo:String(cargo).padStart(4,'0'),
      foto:c.fotoUrl||null}}));
  }};
  for (const [cargo,alvos] of [[1,['BR']],[3,UFS],[5,UFS]]) {{
    const acc={{}};
    for (let i=0;i<alvos.length;i+=6) {{
      const lote = await Promise.all(alvos.slice(i,i+6).map(ue=>puxa(ue,cargo)));
      lote.flat().forEach(c=>acc[c.sq]=c);
    }}
    col['cargo-'+String(cargo).padStart(4,'0')]=acc;
  }}
  location.href='http://127.0.0.1:{PORTA}/receptor.html#'+encodeURIComponent(JSON.stringify(col));""")
    print("\nCtrl+C para encerrar.\n")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nencerrada.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
