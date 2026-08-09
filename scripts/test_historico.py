"""Confere os arquivos Historico * reconstruidos, contra o estado anterior do git.

Roda depois de scripts/gerar_historico.py. Tres perguntas:

  1. O painel continua resolvendo? Simula o resolvePresidentHistoryIdentity do JS
     sobre os locais reais do GPKG e mede a taxa de resolucao e por qual chave.
  2. O caso de Manaus ficou certo? Clicar no Candido Honorio em 2006 e em 2022 tem
     de cair na MESMA identidade, e o CMEI nao pode levar o 2022 junto.
  3. Perdeu resultado? A contagem de registros (ano x local) nao pode cair em
     relacao ao arquivo que estava no git.

    python scripts/test_historico.py          # amostra de UFs
    python scripts/test_historico.py AM,SP,RJ
"""

import collections
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scratch"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_histories as G  # noqa: E402
import gerar_historico as GH  # noqa: E402

CONF = dict(G.CONFIDENCE_BY_MATCH, hist_id=1.2)
AMOSTRA = ["AM", "SP", "RJ", "MG", "BA", "RS"]


def resolver(hist, props):
    """Replica js/historico-presidente.js: monta os aliases e fica com o de maior
    confianca. Se isto e o resolver do JS divergirem, o painel mente."""
    aliases = list(G.build_president_history_aliases(props))
    if props.get("hist_id") is not None:
        aliases.insert(0, f"hist_id:{props['hist_id']}")
    melhor = None
    for alias in aliases:
        achado = hist["aliases"].get(alias)
        if not achado:
            continue
        tipo = hist["match_types"][achado[1]]
        conf = CONF.get(tipo, 0.4)
        if melhor is None or conf > melhor[0]:
            melhor = (conf, achado[0], tipo)
    return melhor


def props_do_gpkg(con, tabela, uf, zona=None, local=None, limite=None):
    sql = (f"SELECT sg_uf, nm_localidade, nm_locvot, ds_endereco, ds_bairro, "
           f"nr_zona, nr_locvot, long, lat, hist_id FROM {tabela} WHERE sg_uf = ?")
    args = [uf]
    if zona is not None:
        sql += " AND nr_zona = ? AND nr_locvot = ?"
        args += [str(zona), str(local)]
    if limite:
        sql += f" LIMIT {limite}"
    saida = []
    for r in con.execute(sql, args):
        try:
            z, l = int(r[5]), int(r[6])
        except (TypeError, ValueError):
            continue
        saida.append({"sg_uf": r[0], "nm_localidade": r[1], "nm_locvot": r[2],
                      "ds_endereco": r[3], "ds_bairro": r[4], "nr_zona": z,
                      "nr_locvot": l, "long": r[7], "lat": r[8], "hist_id": r[9],
                      "id_unico": ""})
    return saida


def abrir_hist(uf):
    p = f"resultados_geo/Historico Presidente/historico_presidente_{uf}.zip"
    with zipfile.ZipFile(p) as z:
        return json.loads(z.read(f"historico_presidente_{uf}.json"))


def urnas_distintas(d):
    """(ano, municipio, zona, local) distintos num arquivo de historico.

    Contar REGISTROS nao serve de comparacao: o arquivo antigo repetia a mesma
    urna em ate 5 identidades (12.248 registros duplicados so em MG), entao um
    total menor pode ser deduplicacao e nao perda. O que nao pode cair e a
    cobertura de urnas.

    Municipio entra normalizado porque (ano, zona, local) sozinho COLIDE -- a zona
    atravessa municipios -- e porque o arquivo antigo grava "BUJARI" onde o GPKG
    grava "Bujari".
    """
    from historico_texto import normalize_history_text as N
    return {(r[0], N(r[1]), r[4], r[5])
            for ident in d["identities"]
            for r in (ident["records"] if isinstance(ident, dict) else ident)}


def antes(uf):
    """O arquivo que estava no git, para comparar."""
    import io
    caminho = f"resultados_geo/Historico Presidente/historico_presidente_{uf}.zip"
    try:
        blob = subprocess.run(["git", "show", f"HEAD:{caminho}"], capture_output=True,
                              check=True).stdout
    except subprocess.CalledProcessError:
        return None
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        return json.loads(z.read(z.namelist()[0]))


def main():
    ufs = AMOSTRA
    if len(sys.argv) > 1:
        ufs = [u.strip().upper() for u in sys.argv[1].split(",") if u.strip()]

    tmp = tempfile.mkdtemp()
    falhas = []

    # ---- 1) o caso que motivou tudo
    hist = abrir_hist("AM")
    nome_zip, tabela = GH.GPKG[2022]
    z = zipfile.ZipFile("resultados_geo/" + nome_zip)
    entrada = z.namelist()[0]
    p22 = os.path.join(tmp, entrada)
    open(p22, "wb").write(z.read(entrada))
    con22 = sqlite3.connect(p22)

    nome6, tab6 = GH.GPKG[2006]
    z6 = zipfile.ZipFile("resultados_geo/" + nome6)
    e6 = z6.namelist()[0]
    p06 = os.path.join(tmp, e6)
    open(p06, "wb").write(z6.read(e6))
    con06 = sqlite3.connect(p06)

    ch22 = resolver(hist, props_do_gpkg(con22, tabela, "AM", 40, 1775)[0])
    ch06 = resolver(hist, props_do_gpkg(con06, tab6, "AM", 40, 1252)[0])
    assert ch22 and ch06, "Candido Honorio nao resolveu"
    assert ch22[1] == ch06[1], (
        f"Candido Honorio 2022 caiu na identidade {ch22[1]} e 2006 na {ch06[1]}")
    assert ch22[2] == "hist_id" and ch06[2] == "hist_id", (ch22[2], ch06[2])
    anos_ch = [r[0] for r in hist["identities"][ch22[1]]]
    print(f"  ok  Candido Honorio: 2006 e 2022 na identidade {ch22[1]}, anos {anos_ch}")

    nome18, tab18 = GH.GPKG[2018]
    z18 = zipfile.ZipFile("resultados_geo/" + nome18)
    e18 = z18.namelist()[0]
    p18 = os.path.join(tmp, e18)
    open(p18, "wb").write(z18.read(e18))
    con18 = sqlite3.connect(p18)
    cmei = resolver(hist, props_do_gpkg(con18, tab18, "AM", 40, 1775)[0])
    assert cmei[1] != ch22[1], "o CMEI de 2018 ficou na identidade do Candido Honorio"
    anos_cmei = [r[0] for r in hist["identities"][cmei[1]]]
    assert 2022 not in anos_cmei, anos_cmei
    print(f"  ok  CMEI (slot 1775 ate 2020): identidade {cmei[1]}, anos {anos_cmei}, sem 2022")
    for c in (con22, con06, con18):
        c.close()

    # ---- 2) taxa de resolucao e 3) nao perdeu registro
    print()
    print(f"  {'uf':<4}{'locais':>8}{'resolvidos':>12}{'por hist_id':>13}"
          f"{'urnas':>11}{'antes':>9}{'perdidas':>9}")
    for uf in ufs:
        hist = abrir_hist(uf)
        tipos = collections.Counter()
        total = 0
        for ano in (2006, 2014, 2022):
            nome_zip, tabela = GH.GPKG[ano]
            zz = zipfile.ZipFile("resultados_geo/" + nome_zip)
            ent = zz.namelist()[0]
            cam = os.path.join(tmp, ent)
            if not os.path.exists(cam):
                open(cam, "wb").write(zz.read(ent))
            con = sqlite3.connect(cam)
            # So urnas que TEM resultado naquele ano: local recem-criado ou ja
            # fechado nao aparece em eleicao nenhuma, e nao ter historico e o
            # comportamento certo, nao uma falha.
            com_resultado = GH.carregar_resultados("presidente", ano, uf)
            ponte = GH.tse_para_ibge()
            chaves = {(z, ponte.get(str(cd)), l) for z, cd, l in com_resultado}
            por_ibge, _ = GH.locais(uf, ano, tmp)
            ibge_de = {(p["nr_zona"], p["nr_locvot"]): k[1]
                       for k, p in por_ibge.items()}
            for props in props_do_gpkg(con, tabela, uf, limite=400):
                zl = (props["nr_zona"], props["nr_locvot"])
                if (zl[0], ibge_de.get(zl), zl[1]) not in chaves:
                    continue
                total += 1
                m = resolver(hist, props)
                tipos[m[2] if m else "NAO RESOLVEU"] += 1
            con.close()

        agora = urnas_distintas(hist)
        velho = antes(uf)
        antigas = urnas_distintas(velho) if velho else set()
        resolvidos = total - tipos["NAO RESOLVEU"]
        # A checagem de perda ignora o nome do municipio: emancipacao e grafia
        # fazem a mesma urna trocar de rotulo (MACUCO/CORDEIRO, CAMACA/CAMACAN)
        # sem que nada tenha sumido. O que importa e a urna continuar coberta.
        sem_nome = {(a, z, l) for a, _, z, l in agora}
        perdidas = len({(a, z, l) for a, _, z, l in antigas} - sem_nome)
        print(f"  {uf:<4}{total:>8}{resolvidos:>9} {100.0*resolvidos/total:>4.0f}%"
              f"{tipos['hist_id']:>10} {100.0*tipos['hist_id']/total:>4.0f}%"
              f"{len(agora):>11}{len(antigas):>9}{perdidas:>9}")
        # Cobertura de urnas nao pode encolher: deduplicar identidade e o objetivo,
        # perder urna nao.
        if antigas and perdidas > len(antigas) * 0.01:
            falhas.append(f"{uf}: {perdidas} urnas do arquivo antigo sumiram")
        if resolvidos < total * 0.99:
            falhas.append(f"{uf}: so {resolvidos}/{total} locais resolveram")

    print()
    if falhas:
        raise SystemExit("FALHAS:\n  " + "\n  ".join(falhas))
    print("  ok")


if __name__ == "__main__":
    sys.exit(main())
