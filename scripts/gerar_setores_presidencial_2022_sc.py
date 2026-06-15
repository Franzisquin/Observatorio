# -*- coding: utf-8 -*-
"""
Gera a estimativa de votacao presidencial 2022 por SETOR CENSITARIO em SC.

Modelo (desagregacao por gravidade com capacidade):
  - Para cada local de votacao, distribui seus ELEITORES entre os setores
    proximos, ponderando por:
      (1) populacao adulta (16+) do setor          -> capacidade
      (2) proximidade local<->setor                -> kernel gaussiano de distancia
      (3) semelhanca de perfil (idade/sexo + renda) -> setor (IBGE) x eleitorado (TSE)
  - Ajuste iterativo (IPF/RAS com teto por coluna) evita ao maximo que um setor
    receba mais eleitores do que adultos nele residentes.
  - Votos do setor por candidato = soma_l (eleitores_l->s / eleitorado_l) * votos_c(l).

Saida: resultados_geo/Setores 2022/setores_presidente_2022_SC.zip  (1 GeoJSON).
Geometria preservada em resolucao total (sem generalizacao); coordenadas em 6 casas.

Reexecutavel e deterministico. Requer: geopandas, shapely, pandas, openpyxl, pyproj, numpy.
"""

import os, io, csv, json, zipfile, sqlite3, re, unicodedata, math, time
import numpy as np
import geopandas as gpd
from pyproj import Transformer

# ----------------------------------------------------------------------------- paths
PROJ   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IBGE   = r"c:/Users/Francisco/OneDrive/Documentos/Sul Independente/Dados IBGE"
RGEO   = os.path.join(PROJ, "resultados_geo")

GPKG_SETORES = os.path.join(IBGE, "BR_setores_CD2022.gpkg")
DEMO_ZIP     = os.path.join(IBGE, "Agregados_por_setores_demografia_BR.zip")
RENDA_ZIP    = os.path.join(IBGE, "Agregados_por_setores_renda_responsavel_BR_20260508_xlsx.zip")
LOCAIS_GPKG  = os.path.join(PROJ, "scratch/locais_gpkg/locais_votacao_2022.gpkg")
LOCAIS_ZIP   = os.path.join(RGEO, "locais_votacao_2022_gpkg.zip")
CENSO_ZIP    = os.path.join(RGEO, "Censo 2022", "censo_2022_SC.zip")
RES_T1_ZIP   = os.path.join(RGEO, "Majoritarias 2022", "presidente_2022_t1_SC.zip")
RES_T2_ZIP   = os.path.join(RGEO, "Majoritarias 2022", "presidente_2022_t2_SC.zip")

OUT_DIR  = os.path.join(RGEO, "Setores 2022")
OUT_ZIP  = os.path.join(OUT_DIR, "setores_presidente_2022_SC.zip")
OUT_JSON = "setores_presidente_2022_SC.json"

UF_CODE = "42"   # SC

# ----------------------------------------------------------------------------- params (calibraveis)
ADULT_FRAC_15_19 = 0.8     # fracao do grupo 15-19 contada como apta a votar (16-19)
KERNEL_SCALE_KM  = 3.0     # sigma do kernel gaussiano de distancia
MAX_RADIUS_KM    = 12.0    # raio maximo local->setor
MIN_K_SECTORS    = 8       # garante ao menos k setores mais proximos por local
IPF_ITERS        = 40      # iteracoes do ajuste com teto
PROFILE_WEIGHT   = 0.5     # 0 = so proximidade+capacidade ; 1 = perfil domina
COORD_DECIMALS   = 6       # precisao das coordenadas (preserva todos os vertices)

NULO, BRANCO = "96", "95"

def log(*a):
    print(*a, flush=True)

def norm(s):
    s = str(s or "").upper().strip()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s)

# ============================================================ 1) DEMOGRAFIA por setor (idade/sexo)
def load_demografia_sc():
    """Retorna dict CD_SETOR(15) -> {pop, apt16, masc, fem, b16_29,b30_45,b46_59,b60}."""
    log("[1] Lendo demografia IBGE (idade/sexo por setor)...")
    z = zipfile.ZipFile(DEMO_ZIP)
    name = [n for n in z.namelist() if n.endswith(".csv")][0]
    out = {}
    with z.open(name) as f:
        rd = csv.reader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")
        hdr = next(rd)
        idx = {c: i for i, c in enumerate(hdr)}
        cs_i = idx.get("CD_setor", 0)
        def g(row, v):
            try: return float(row[idx[v]] or 0)
            except Exception: return 0.0
        for row in rd:
            cs = row[cs_i]
            if not cs.startswith(UF_CODE):
                continue
            v = {k: g(row, k) for k in (
                "V01006","V01007","V01008",
                "V01034","V01035","V01036","V01037","V01038","V01039","V01040","V01041")}
            a1519 = ADULT_FRAC_15_19 * v["V01034"]
            apt16 = a1519 + v["V01035"]+v["V01036"]+v["V01037"]+v["V01038"]+v["V01039"]+v["V01040"]+v["V01041"]
            b16_29 = a1519 + v["V01035"] + v["V01036"]
            b30_45 = v["V01037"] + 0.6*v["V01038"]
            b46_59 = 0.4*v["V01038"] + v["V01039"]
            b60    = v["V01040"] + v["V01041"]
            out[cs] = dict(pop=v["V01006"], apt16=apt16,
                           masc=v["V01007"], fem=v["V01008"],
                           b16_29=b16_29, b30_45=b30_45, b46_59=b46_59, b60=b60)
    log("    setores SC com demografia:", len(out))
    return out

# ============================================================ 2) RENDA por setor (V06004)
def load_renda_sc():
    log("[2] Lendo renda do responsavel (V06004) por setor...")
    import openpyxl
    z = zipfile.ZipFile(RENDA_ZIP)
    name = [n for n in z.namelist() if n.endswith(".xlsx")][0]
    with z.open(name) as f:
        data = io.BytesIO(f.read())
    wb = openpyxl.load_workbook(data, read_only=True, data_only=True)
    ws = wb.active
    out = {}
    it = ws.iter_rows(values_only=True)
    hdr = next(it)
    idx = {str(c): i for i, c in enumerate(hdr)}
    cs_i = idx.get("CD_setor", idx.get("CD_SETOR", 0))
    r_i  = idx.get("V06004")
    for row in it:
        cs = str(row[cs_i]) if row[cs_i] is not None else ""
        if not cs.startswith(UF_CODE):
            continue
        try: out[cs] = float(row[r_i]) if (r_i is not None and row[r_i] not in (None,"")) else None
        except Exception: out[cs] = None
    log("    setores SC com renda:", len(out))
    return out

# ============================================================ 3) LOCAIS (coords + eleitorado + perfil + votos)
CENSO_AGE_BUCKETS = {
    "16 anos":(1,0,0,0),"17 anos":(1,0,0,0),"18 anos":(1,0,0,0),"19 anos":(1,0,0,0),"20 anos":(1,0,0,0),
    "21 a 24 anos":(1,0,0,0),"25 a 29 anos":(1,0,0,0),
    "30 a 34 anos":(0,1,0,0),"35 a 39 anos":(0,1,0,0),
    "40 a 44 anos":(0,1,0,0),"45 a 49 anos":(0,0.2,0.8,0),
    "50 a 54 anos":(0,0,1,0),"55 a 59 anos":(0,0,1,0),
    "60 a 64 anos":(0,0,0,1),"65 a 69 anos":(0,0,0,1),"70 a 74 anos":(0,0,0,1),
    "75 a 79 anos":(0,0,0,1),"80 a 84 anos":(0,0,0,1),"85 a 89 anos":(0,0,0,1),
    "90 a 94 anos":(0,0,0,1),"95 a 99 anos":(0,0,0,1),"100 anos ou mais":(0,0,0,1),
}

def load_locais_sc():
    """Retorna lista de locais com coords, eleitorado, perfil e local_key + nomes de candidato (t1/t2)."""
    log("[3] Montando locais (coords + eleitorado + perfil + votos)...")
    # 3a censo (perfil do eleitorado + ponte de chaves)
    z = zipfile.ZipFile(CENSO_ZIP)
    censo = json.loads(z.read("censo_2022_SC.json").decode("utf-8"))["RESULTS"]
    cidx = {}  # (zona,loc,munNorm) -> local_key
    for lk, r in censo.items():
        cidx[(int(r["nr_zona"]), int(r["nr_locvot"]), norm(r["nm_localidade"]))] = lk

    # 3b coords do gpkg de locais (extrai do zip canonico se necessario)
    if not os.path.exists(LOCAIS_GPKG):
        os.makedirs(os.path.dirname(LOCAIS_GPKG), exist_ok=True)
        with zipfile.ZipFile(LOCAIS_ZIP) as zl:
            gname = [n for n in zl.namelist() if n.endswith(".gpkg")][0]
            with zl.open(gname) as src, open(LOCAIS_GPKG, "wb") as dst:
                dst.write(src.read())
    con = sqlite3.connect(LOCAIS_GPKG); cur = con.cursor()
    cur.execute("""SELECT nr_zona,nr_locvot,nm_localidade,nm_locvot,lat,long
                   FROM locais_votacao_2022_ENRIQUECIDO WHERE sg_uf='SC'""")
    coords = {}
    for z_, l_, nm, nmloc, la, lo in cur.fetchall():
        lk = cidx.get((int(z_), int(l_), norm(nm)))
        if lk and la and lo:
            coords[lk] = (float(lo), float(la), nm, nmloc)
    con.close()

    # 3c resultados t1 e t2
    def load_res(zp, jn):
        if not os.path.exists(zp): return {}, {}
        zz = zipfile.ZipFile(zp)
        d = json.loads(zz.read(jn).decode("utf-8"))
        return d.get("RESULTS", {}), (d.get("METADATA", {}).get("cand_names", {}) or {})
    res1, meta1 = load_res(RES_T1_ZIP, "presidente_2022_t1_SC.json")
    res2, meta2 = load_res(RES_T2_ZIP, "presidente_2022_t2_SC.json")

    locais = []
    for lk, row in censo.items():
        if lk not in coords:
            continue
        lon, lat, nm, nmloc = coords[lk]
        # eleitorado e perfil etario a partir das idades do censo
        b = [0.0, 0.0, 0.0, 0.0]; elet = 0.0
        for fld, w in CENSO_AGE_BUCKETS.items():
            val = float(row.get(fld, 0) or 0)
            elet += val
            for i in range(4): b[i] += val * w[i]
        masc = float(row.get("MASCULINO", 0) or 0); fem = float(row.get("FEMININO", 0) or 0)
        renda = row.get("Renda Media")
        v1 = res1.get(lk, {}); v2 = res2.get(lk, {})
        if elet <= 0 and not v1 and not v2:
            continue
        locais.append(dict(lk=lk, lon=lon, lat=lat, nm=nm, nmloc=nmloc,
                           elet=elet, b16_29=b[0], b30_45=b[1], b46_59=b[2], b60=b[3],
                           masc=masc, fem=fem, renda=(float(renda) if renda not in (None,"") else None),
                           v1=v1, v2=v2))
    cand_names = {}
    cand_names.update({k: v for k, v in meta1.items()})
    for k, v in meta2.items(): cand_names.setdefault(k, v)
    log("    locais SC utilizaveis:", len(locais))
    return locais, cand_names

# ============================================================ helpers de perfil
def shares(parts):
    t = sum(parts)
    return [p / t for p in parts] if t > 0 else [0.0]*len(parts)

def profile_sim(loc, sec):
    """Semelhanca [0..1] entre eleitorado do local e moradores do setor (idade/sexo + renda)."""
    la = shares([loc["b16_29"], loc["b30_45"], loc["b46_59"], loc["b60"]])
    sa = shares([sec["b16_29"], sec["b30_45"], sec["b46_59"], sec["b60"]])
    d_age = 0.5 * sum(abs(la[i]-sa[i]) for i in range(4))   # 0..1
    lsx = shares([loc["masc"], loc["fem"]]); ssx = shares([sec["masc"], sec["fem"]])
    d_sex = 0.5 * sum(abs(lsx[i]-ssx[i]) for i in range(2))  # 0..1
    if loc["renda"] and sec.get("renda"):
        d_inc = abs(math.log((loc["renda"]+1)/(sec["renda"]+1))) / 1.5
        d_inc = min(d_inc, 1.0)
    else:
        d_inc = 0.5
    dist = 0.5*d_age + 0.2*d_sex + 0.3*d_inc
    return math.exp(-2.0 * dist)   # ~1 quando identicos

# ============================================================ 4) SETORES geometria + agregados
def load_setores_sc(demo, renda):
    log("[4] Lendo geometria dos setores SC (resolucao total)...")
    t = time.time()
    gdf = gpd.read_file(GPKG_SETORES, where=f"CD_UF='{UF_CODE}'", engine="pyogrio")
    log(f"    {len(gdf)} setores em {round(time.time()-t,1)}s")
    # centroides em metros (EPSG:5880 - Brazil Polyconic)
    cent = gdf.geometry.to_crs(5880).centroid
    xs = cent.x.to_numpy(); ys = cent.y.to_numpy()
    secs = []
    for i, r in enumerate(gdf.itertuples(index=False)):
        cs = getattr(r, "CD_SETOR")
        d = demo.get(cs)
        pop  = float(d["pop"])  if d else (float(getattr(r, "v0001") or 0))
        apt  = float(d["apt16"]) if d else pop*0.78
        sec = dict(cs=cs, nm_mun=getattr(r,"NM_MUN"), cd_mun=getattr(r,"CD_MUN"),
                   sit=getattr(r,"SITUACAO"), area=float(getattr(r,"AREA_KM2") or 0),
                   pop=pop, apt16=apt, renda=renda.get(cs),
                   masc=float(d["masc"]) if d else pop*0.49, fem=float(d["fem"]) if d else pop*0.51,
                   b16_29=float(d["b16_29"]) if d else apt*0.3,
                   b30_45=float(d["b30_45"]) if d else apt*0.3,
                   b46_59=float(d["b46_59"]) if d else apt*0.25,
                   b60=float(d["b60"]) if d else apt*0.15,
                   x=xs[i], y=ys[i], geom=gdf.geometry.iloc[i])
        secs.append(sec)
    return secs

# ============================================================ 5) DESAGREGACAO (gravidade + IPF com teto)
def build_weights(locais, secs):
    log("[5] Construindo pesos local->setor (proximidade + capacidade + perfil)...")
    tr = Transformer.from_crs(4326, 5880, always_xy=True)
    sx = np.array([s["x"] for s in secs]); sy = np.array([s["y"] for s in secs])
    apt = np.array([s["apt16"] for s in secs])
    sigma = KERNEL_SCALE_KM*1000.0; rmax = MAX_RADIUS_KM*1000.0
    rows = []  # (local_idx, np.array sector_idx, np.array weight)
    for li, loc in enumerate(locais):
        lx, ly = tr.transform(loc["lon"], loc["lat"])
        d2 = (sx-lx)**2 + (sy-ly)**2
        within = np.where(d2 <= rmax*rmax)[0]
        if within.size < MIN_K_SECTORS:
            within = np.argsort(d2)[:MIN_K_SECTORS]
        dist = np.sqrt(d2[within])
        kern = np.exp(-(dist*dist)/(2*sigma*sigma))
        cap  = apt[within]
        sim  = np.array([(1.0-PROFILE_WEIGHT) + PROFILE_WEIGHT*profile_sim(loc, secs[j]) for j in within])
        w = cap * kern * sim
        if w.sum() <= 0:
            w = cap + 1e-9
        rows.append((li, within, w))
    return rows, apt

def ipf_solve(locais, rows, apt):
    log("[6] Ajuste iterativo com teto de adultos (IPF/RAS)...")
    nS = apt.shape[0]
    elet = np.array([l["elet"] for l in locais])
    # estado: e[row] = vetor de eleitores alocados (mesma ordem de rows[li][1])
    state = []
    for (li, idx, w) in rows:
        s = w / w.sum() * elet[li]
        state.append(s)
    for it in range(IPF_ITERS):
        # coluna: aplica teto
        colsum = np.zeros(nS)
        for (li, idx, w), s in zip(rows, state):
            np.add.at(colsum, idx, s)
        scale = np.ones(nS)
        over = colsum > apt
        scale[over] = apt[over] / np.maximum(colsum[over], 1e-9)
        for k, ((li, idx, w), s) in enumerate(zip(rows, state)):
            state[k] = s * scale[idx]
        # linha: reescala para o eleitorado do local
        for k, ((li, idx, w), s) in enumerate(zip(rows, state)):
            tot = s.sum()
            if tot > 0:
                state[k] = s * (elet[li] / tot)
    # diagnostico final
    colsum = np.zeros(nS)
    for (li, idx, w), s in zip(rows, state):
        np.add.at(colsum, idx, s)
    overflow = np.maximum(0.0, colsum - apt)
    log(f"    eleitores totais alocados: {colsum.sum():,.0f}")
    log(f"    setores com overflow>1: {(overflow>1).sum()} / {nS}  | overflow total: {overflow.sum():,.0f}")
    return state, colsum

# ============================================================ 6) AGREGA VOTOS por setor
def aggregate_votes(locais, rows, state, nS):
    log("[7] Agregando votos por setor (t1/t2)...")
    t1 = [dict() for _ in range(nS)]
    t2 = [dict() for _ in range(nS)]
    for (li, idx, w), s in zip(rows, state):
        loc = locais[li]
        if loc["elet"] <= 0:
            continue
        frac = s / loc["elet"]   # fracao do eleitorado do local -> cada setor
        for tgt, votes in ((t1, loc["v1"]), (t2, loc["v2"])):
            if not votes: continue
            for cand, vv in votes.items():
                vv = float(vv)
                if vv == 0: continue
                contrib = frac * vv
                for j, c in zip(idx, contrib):
                    if c:
                        tgt[j][cand] = tgt[j].get(cand, 0.0) + c
    return t1, t2

def winner_of(votemap, cand_names):
    """Retorna (cand_id, pct_validos, margem) ignorando branco/nulo."""
    val = {k: v for k, v in votemap.items() if k not in (NULO, BRANCO)}
    tot = sum(val.values())
    if tot <= 0:
        return None, 0.0, 0.0
    ordered = sorted(val.items(), key=lambda kv: kv[1], reverse=True)
    win, wv = ordered[0]
    second = ordered[1][1] if len(ordered) > 1 else 0.0
    return win, 100.0*wv/tot, 100.0*(wv-second)/tot

# ============================================================ 7) SAIDA GeoJSON
def round_geom(geom, nd):
    def rc(c): return [round(c[0], nd), round(c[1], nd)]
    gj = geom.__geo_interface__
    def walk(coords):
        if isinstance(coords[0], (float, int)):
            return rc(coords)
        return [walk(c) for c in coords]
    gj = dict(type=gj["type"], coordinates=walk(gj["coordinates"]))
    return gj

def main():
    t0 = time.time()
    demo  = load_demografia_sc()
    renda = load_renda_sc()
    locais, cand_names = load_locais_sc()
    secs  = load_setores_sc(demo, renda)
    rows, apt = build_weights(locais, secs)
    state, colsum = ipf_solve(locais, rows, apt)
    nS = len(secs)
    t1, t2 = aggregate_votes(locais, rows, state, nS)

    log("[8] Escrevendo GeoJSON (geometria completa)...")
    feats = []
    sum_check_t1 = {}; sum_check_t2 = {}
    for i, s in enumerate(secs):
        def pack(vm, acc):
            vm_int = {k: int(round(v)) for k, v in vm.items() if round(v) > 0}
            for k, v in vm_int.items(): acc[k] = acc.get(k, 0) + v
            win, pct, marg = winner_of(vm, cand_names)
            return dict(votos=vm_int, venc=win, pct=round(pct,1), margem=round(marg,1))
        p1 = pack(t1[i], sum_check_t1); p2 = pack(t2[i], sum_check_t2)
        props = dict(
            cd_setor=s["cs"], nm_mun=s["nm_mun"], cd_mun=s["cd_mun"], situacao=s["sit"],
            area_km2=round(s["area"],4), pop=int(round(s["pop"])), apt16=int(round(s["apt16"])),
            elet_estimado=int(round(colsum[i])), overflow=int(round(max(0.0, colsum[i]-s["apt16"]))),
            renda=(round(s["renda"],2) if s.get("renda") else None),
            pct_masc=round(100.0*s["masc"]/s["pop"],1) if s["pop"]>0 else None,
            perfil_idade=[round(s["b16_29"]),round(s["b30_45"]),round(s["b46_59"]),round(s["b60"])],
            t1=p1, t2=p2)
        feats.append(dict(type="Feature", properties=props, geometry=round_geom(s["geom"], COORD_DECIMALS)))

    fc = dict(type="FeatureCollection",
              metadata=dict(uf="SC", cargo="presidente", ano=2022,
                            cand_names=cand_names,
                            params=dict(kernel_km=KERNEL_SCALE_KM, raio_km=MAX_RADIUS_KM,
                                        min_k=MIN_K_SECTORS, ipf_iters=IPF_ITERS,
                                        profile_weight=PROFILE_WEIGHT, adult_frac_15_19=ADULT_FRAC_15_19)),
              features=feats)

    os.makedirs(OUT_DIR, exist_ok=True)
    payload = json.dumps(fc, ensure_ascii=False)
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr(OUT_JSON, payload)
    mb = os.path.getsize(OUT_ZIP)/1e6
    log(f"    {OUT_ZIP}  ({mb:.1f} MB zip, {len(payload)/1e6:.0f} MB json, {len(feats)} setores)")

    # sanidade: totais por turno
    def real_total(res_locais, key):
        acc = {}
        for l in res_locais:
            for k, v in l[key].items():
                acc[k] = acc.get(k, 0) + float(v)
        return acc
    rt1 = real_total(locais, "v1"); rt2 = real_total(locais, "v2")
    def topline(acc, names):
        items = sorted(((k,v) for k,v in acc.items() if k not in (NULO,BRANCO)), key=lambda kv:-kv[1])[:3]
        return ", ".join(f"{(names.get(k) or [k])[0]}={int(v):,}" for k,v in items)
    log("[9] Sanidade (estimado vs real):")
    log("    T1 real     :", topline(rt1, cand_names))
    log("    T1 estimado :", topline(sum_check_t1, cand_names))
    log("    T2 real     :", topline(rt2, cand_names))
    log("    T2 estimado :", topline(sum_check_t2, cand_names))
    log(f"Concluido em {round(time.time()-t0,1)}s")

if __name__ == "__main__":
    main()
