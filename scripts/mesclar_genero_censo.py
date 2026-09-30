"""Traz os cruzamentos por genero (idade e escolaridade) para os censos locais.

Os censos do acervo so tem as marginais: MASCULINO/FEMININO de um lado, as
faixas de idade e os niveis de escolaridade do outro. O cruzamento por local
existe no repositorio MedeirosLD/Polling-Stations-Results-Brazil-2006-2024
(2008 em diante), como vetores {"M": [...], "F": [...]}:

  IDADE_GENERO          na ordem de METADATA.parquet_fields.age_gender_order
  ESCOLARIDADE_GENERO   na ordem de METADATA.parquet_fields.education_gender_order

Os censos daqui foram corrigidos depois (renda/raca, CNEFE, eleitorado), entao
o arquivo do repo NAO substitui o local: so esses dois campos sao copiados,
casando por local_key e ja no formato que o painel soma:

  IDADE_GENERO          faixas do ElectoMaps (FAIXAS_ETARIAS, com o rateio
                        proporcional de aggregateAgeBucketsFromProps)
  ESCOLARIDADE_GENERO   os 8 niveis do TSE nas chaves curtas de
                        getEscolaridadeGroupedTotals (js/globals.js)

O cruzamento do TSE deixa de fora o genero "nao informado", e o eleitorado de
alguns locais foi reescalado aqui; por isso cada cruzamento e reescalado para
fechar com a marginal do proprio local.

Baixa um zip por vez via `gh api` e apaga em seguida (pouco disco).

Uso:  py scripts/mesclar_genero_censo.py [--dry-run] [ano ...] [--uf AC SP ...]
"""

import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gerar_perfil_nacional import FAIXAS_ETARIAS, UFS, faixa_da_chave, faixas_do_local, num, sobreposicao

RAIZ = Path(__file__).resolve().parent.parent
REPO = "repos/MedeirosLD/Polling-Stations-Results-Brazil-2006-2024/contents/resultados_geo"

# Trecho do rotulo do TSE -> chave de getEscolaridadeGroupedTotals. Nenhum trecho
# e substring de outro rotulo ("FUNDAMENTAL INCOMPLETO" nao contem "FUNDAMENTAL COMPLETO").
NIVEIS = [
    ("ANALFABETO", "ana"), ("ESCREVE", "le"),
    ("FUNDAMENTAL INCOMPLETO", "fi"), ("FUNDAMENTAL COMPLETO", "fc"),
    ("DIO INCOMPLETO", "mi"), ("DIO COMPLETO", "mc"),
    ("SUPERIOR INCOMPLETO", "si"), ("SUPERIOR COMPLETO", "sc"),
]


def nivel_escolar(rotulo):
    if not rotulo.isupper():
        return None
    return next((k for trecho, k in NIVEIS if trecho in rotulo), None)


def baixar_do_repo(ano, uf, destino):
    caminho = f"{REPO}/Censo%20{ano}/censo_{ano}_{uf}.zip"
    with open(destino, "wb") as fh:
        r = subprocess.run(["gh", "api", "-H", "Accept: application/vnd.github.raw", caminho],
                           stdout=fh, stderr=subprocess.PIPE)
    return r.returncode == 0


def para_faixas(valores, ordem):
    """Vetor nas faixas do TSE -> {chave ElectoMaps: valor}."""
    baldes = {k: 0.0 for k, _, _ in FAIXAS_ETARIAS}
    for rotulo, v in zip(ordem, valores):
        faixa = faixa_da_chave(rotulo)
        if not faixa or not v:
            continue
        for chave, minimo, maximo in FAIXAS_ETARIAS:
            baldes[chave] += v * sobreposicao(faixa, (minimo, maximo))
    return baldes


def para_niveis(valores, ordem):
    """Vetor nos niveis do TSE -> {ana, le, fi, fc, mi, mc, si, sc}."""
    niveis = {k: 0.0 for _, k in NIVEIS}
    for rotulo, v in zip(ordem, valores):
        k = nivel_escolar(rotulo)
        if k:
            niveis[k] += v
    return niveis


def fechar_com(m, f, total_local):
    """Reescala o cruzamento para somar total_local. Devolve (campo, reescalou)."""
    total = sum(m.values()) + sum(f.values())
    fator = 1.0
    if total > 0 and total_local > 0 and abs(total_local - total) > 0.5:
        fator = total_local / total

    def valor(v):
        v = round(v * fator, 1)
        return int(v) if v == int(v) else v

    return {"M": {k: valor(v) for k, v in m.items()},
            "F": {k: valor(v) for k, v in f.items()}}, fator != 1.0


def ler_cruzamentos(ano, uf, tmpdir):
    """{local_key: (IDADE_GENERO, ESCOLARIDADE_GENERO)} ja convertidos, do repo."""
    remoto = Path(tmpdir) / f"{ano}_{uf}.zip"
    if not baixar_do_repo(ano, uf, remoto):
        return None
    try:
        with zipfile.ZipFile(remoto) as z:
            fonte = json.loads(z.read(f"censo_{ano}_{uf}.json").decode("utf-8", errors="replace"))
    finally:
        remoto.unlink()

    campos = (fonte.get("METADATA") or {}).get("parquet_fields") or {}
    ordem_idade = campos.get("age_gender_order")
    ordem_esc = campos.get("education_gender_order")
    cruzado = {}
    for chave, row in (fonte.get("RESULTS") or {}).items():
        ig, eg = row.get("IDADE_GENERO"), row.get("ESCOLARIDADE_GENERO")
        idade = esc = None
        if ordem_idade and ig and len(ig.get("M", [])) == len(ordem_idade):
            idade = (para_faixas(ig["M"], ordem_idade), para_faixas(ig["F"], ordem_idade))
        if ordem_esc and eg and len(eg.get("M", [])) == len(ordem_esc):
            esc = (para_niveis(eg["M"], ordem_esc), para_niveis(eg["F"], ordem_esc))
        if idade or esc:
            cruzado[str(row.get("local_key") or chave)] = (idade, esc)
    return cruzado


def mesclar(ano, uf, tmpdir, dry):
    local = RAIZ / "resultados_geo" / f"Censo {ano}" / f"censo_{ano}_{uf}.zip"
    if not local.exists():
        return
    cruzado = ler_cruzamentos(ano, uf, tmpdir)
    if cruzado is None:
        print(f"  [{ano}] {uf}: nao existe no repo", flush=True)
        return

    with zipfile.ZipFile(local) as z:
        arquivos = {n: z.read(n) for n in z.namelist()}
    nome = f"censo_{ano}_{uf}.json"
    dados = json.loads(arquivos[nome].decode("utf-8", errors="replace"))

    conta = {"idade": 0, "esc": 0, "sem_par": 0, "reesc_idade": 0, "reesc_esc": 0}
    for chave, row in dados["RESULTS"].items():
        idade, esc = cruzado.get(str(row.get("local_key") or chave), (None, None))
        row.pop("IDADE_GENERO", None)
        row.pop("ESCOLARIDADE_GENERO", None)
        if not idade and not esc:
            conta["sem_par"] += 1
        if idade:
            total_local = sum(faixas_do_local(row).values())
            row["IDADE_GENERO"], mudou = fechar_com(*idade, total_local)
            conta["idade"] += 1
            conta["reesc_idade"] += mudou
        if esc:
            total_local = sum(num(v) for k, v in row.items() if nivel_escolar(k))
            row["ESCOLARIDADE_GENERO"], mudou = fechar_com(*esc, total_local)
            conta["esc"] += 1
            conta["reesc_esc"] += mudou

    print(f"  [{ano}] {uf}: piramide {conta['idade']} ({conta['reesc_idade']} reescalados), "
          f"escolaridade {conta['esc']} ({conta['reesc_esc']} reescalados), "
          f"{conta['sem_par']} sem par no repo", flush=True)
    if dry or not (conta["idade"] or conta["esc"]):
        return

    arquivos[nome] = json.dumps(dados, ensure_ascii=False).encode("utf-8")
    tmp = str(local) + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as saida:
        for n, conteudo in arquivos.items():
            saida.writestr(n, conteudo)
    shutil.move(tmp, local)


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]
    ufs = UFS
    if "--uf" in args:
        i = args.index("--uf")
        ufs, args = args[i + 1:], args[:i]
    anos = args or ["2008", "2010", "2012", "2014", "2016", "2018", "2020", "2022", "2024"]

    with tempfile.TemporaryDirectory() as tmpdir:
        for ano in anos:
            print(f"== Censo {ano}", flush=True)
            for uf in ufs:
                mesclar(ano, uf, tmpdir, dry)
    if dry:
        print("(dry-run: nada foi gravado)")


if __name__ == "__main__":
    main()
