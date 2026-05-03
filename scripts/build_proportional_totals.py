from __future__ import annotations

import argparse
import json
import re
import unicodedata
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


STATIC_PARTY_FALLBACK = {
    "10": "REPUBLICANOS",
    "11": "PP",
    "12": "PDT",
    "13": "PT",
    "14": "PTB",
    "15": "MDB",
    "16": "PSTU",
    "17": "PSL",
    "18": "REDE",
    "19": "PODEMOS",
    "20": "PSC",
    "21": "PCB",
    "22": "PL",
    "23": "CIDADANIA",
    "25": "DEM",
    "27": "DC",
    "28": "PRTB",
    "29": "PCO",
    "30": "NOVO",
    "31": "PHS",
    "33": "PMN",
    "35": "PMB",
    "36": "AGIR",
    "40": "PSB",
    "43": "PV",
    "44": "UNIÃO",
    "45": "PSDB",
    "50": "PSOL",
    "51": "PATRIOTA",
    "55": "PSD",
    "65": "PC DO B",
    "70": "AVANTE",
    "77": "SOLIDARIEDADE",
    "80": "UP",
    "90": "PROS",
}

DEPUTY_YEARS = ["2006", "2010", "2014", "2018", "2022"]
VEREADOR_YEARS = ["2008", "2012", "2016", "2020", "2024"]
ALL_UFS = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS",
    "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC",
    "SE", "SP", "TO",
]


def strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def normalize_slug(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", strip_accents(value).upper()).strip("_")


def norm(value: str) -> str:
    return strip_accents(value).upper().strip()


def ensure_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def normalize_party_alias(value: str) -> str:
    party = str(value or "").upper().strip()
    if not party:
        return ""
    if "BRASIL DA ESPERAN" in party or "(FE BRASIL)" in party or "PT/PC DO B/PV" in party:
        return "FE Brasil (PT/PCdoB/PV)"
    if "PSDB CIDADANIA" in party or "PSDB/CIDADANIA" in party:
        return "PSDB/CIDADANIA"
    if "PSOL REDE" in party or "PSOL/REDE" in party:
        return "PSOL/REDE"
    party = party.replace("FEDERAÇÃO ", "").replace("FEDERACAO ", "")
    if party == "PATRI":
        return "PATRIOTA"
    if party == "PODE":
        return "PODEMOS"
    if party == "SD":
        return "SOLIDARIEDADE"
    if party in {"PC DO B", "PCDOB"}:
        return "PC DO B"
    return party


def is_generic_group_label(value: str) -> bool:
    normalized = norm(value).replace(" ", "")
    return not normalized or normalized in {"PARTIDOISOLADO", "FEDERACAO", "COLIGACAO"}


def normalize_party_token(value: str, prefix_cache: dict[str, str]) -> str:
    token = str(value or "").strip()
    if not token:
        return ""
    token = re.sub(r"[()\[\]]", " ", token)
    token = re.sub(r"\s+", " ", token).strip()
    token = re.sub(r"^[\s\-\u2013\u2014]+|[\s\-\u2013\u2014]+$", "", token).strip()
    token = re.sub(r"^FEDERA[CÇ][AÃ]O\s+", "", token, flags=re.IGNORECASE).strip()
    token = re.sub(r"^COLIGA[CÇ][AÃ]O\s+", "", token, flags=re.IGNORECASE).strip()

    generic_match = re.match(r"^PARTIDO\s+(\d{1,2})$", token, flags=re.IGNORECASE)
    if generic_match:
        return normalize_party_alias(prefix_cache.get(generic_match.group(1), token))
    if re.match(r"^\d{1,2}$", token):
        return normalize_party_alias(prefix_cache.get(token, token))
    if is_generic_group_label(token):
        return ""
    return normalize_party_alias(token)


def extract_composition_parts(raw_composition: str, raw_group_name: str, prefix_cache: dict[str, str]) -> dict[str, object]:
    composition_source = ""
    for candidate in (raw_composition, raw_group_name):
        text = str(candidate or "").strip()
        if not text:
            continue
        matches = [m.strip() for m in re.findall(r"\(([^()]+)\)", text) if "/" in m]
        if matches:
            composition_source = matches[-1]
            break
        if "/" in text:
            composition_source = text
            break

    members = [
        normalize_party_token(part, prefix_cache)
        for part in (composition_source or raw_composition or "").split("/")
    ]
    members = [member for member in members if member]
    unique_members = list(dict.fromkeys(members))
    composition_display = "/".join(unique_members)
    composition_key = "/".join(sorted(unique_members))
    return {
        "members": unique_members,
        "compositionDisplay": composition_display,
        "compositionKey": composition_key,
        "isGroup": len(unique_members) > 1,
    }


def get_preferred_group_name(raw_group_name: str, raw_composition: str, composition_display: str) -> str:
    group_name = str(raw_group_name or "").strip()
    composition_text = str(raw_composition or "").strip()
    candidate = group_name if not is_generic_group_label(group_name) else composition_text
    if not candidate:
        return composition_display
    if "(" in candidate:
        candidate = candidate[: candidate.index("(")].strip()
    candidate = re.sub(r"^FEDERA[CÇ][AÃ]O\s+", "", candidate, flags=re.IGNORECASE).strip()
    candidate = re.sub(r"^COLIGA[CÇ][AÃ]O\s+", "", candidate, flags=re.IGNORECASE).strip()
    candidate = re.sub(r"\s*-\s*$", "", candidate).strip()
    candidate_upper = candidate.upper()
    if "BRASIL DA ESPERAN" in candidate_upper:
        return "FE Brasil"
    if "PSDB CIDADANIA" in candidate_upper or "PSDB/CIDADANIA" in candidate_upper:
        return "PSDB/CIDADANIA"
    if "PSOL REDE" in candidate_upper or "PSOL/REDE" in candidate_upper:
        return "PSOL/REDE"
    if not candidate or is_generic_group_label(candidate) or "/" in candidate:
        return composition_display
    return candidate


def build_prefix_cache(meta_store: dict[str, list]) -> dict[str, str]:
    prefix_cache = dict(STATIC_PARTY_FALLBACK)
    for candidate_id, meta in meta_store.items():
        if len(candidate_id) <= 2 or not meta:
            continue
        party_name = str(meta[1] if len(meta) > 1 else "").upper().strip()
        if party_name and not party_name.startswith("PARTIDO "):
            prefix_cache[candidate_id[:2]] = party_name
    return prefix_cache


def build_group_cache(meta_store: dict[str, list], prefix_cache: dict[str, str]) -> dict[str, dict[str, object]]:
    grouped: dict[str, dict[str, object]] = {}
    for candidate_id, meta in meta_store.items():
        if len(candidate_id) <= 2:
            continue
        raw_composition = str(meta[4] if len(meta) > 4 else "").strip()
        raw_group_name = str(meta[3] if len(meta) > 3 else "").strip()
        composition = extract_composition_parts(raw_composition, raw_group_name, prefix_cache)
        if not composition["isGroup"] or not composition["compositionKey"]:
            continue
        info = {
            "key": f"group:{norm(composition['compositionKey'])}",
            "name": get_preferred_group_name(raw_group_name, raw_composition, composition["compositionDisplay"]),
            "composition": composition["compositionDisplay"],
            "isGroup": True,
        }
        grouped.setdefault(composition["compositionDisplay"], info)
        grouped.setdefault(composition["compositionKey"], info)
        for sigla in composition["members"]:
            grouped.setdefault(sigla, info)
    return grouped


def resolve_group_info(candidate_id: str, meta_store: dict[str, list], prefix_cache: dict[str, str], group_cache: dict[str, dict[str, object]]) -> dict[str, object]:
    candidate_key = str(candidate_id or "").strip()
    meta = meta_store.get(candidate_key) or []

    def resolve_generic_party(name: str, code: str) -> str:
        party = str(name or "").upper().strip()
        if party.startswith("PARTIDO ") or re.match(r"^PARTIDO\d+$", party):
            return prefix_cache.get(code, party)
        return party

    if len(candidate_key) <= 2:
        raw_legend_name = prefix_cache.get(candidate_key, meta[1] if len(meta) > 1 else candidate_key)
        legend_party = normalize_party_token(resolve_generic_party(raw_legend_name, candidate_key), prefix_cache) or candidate_key
        grouped_party_info = group_cache.get(legend_party)
        if grouped_party_info:
            return {
                **grouped_party_info,
                "party": legend_party,
            }
        return {
            "key": f"party:{legend_party}",
            "name": legend_party,
            "composition": legend_party,
            "party": legend_party,
            "isGroup": False,
        }

    raw_party = normalize_party_token(
        resolve_generic_party(meta[1] if len(meta) > 1 else candidate_key[:2], candidate_key[:2]),
        prefix_cache,
    ) or candidate_key[:2]
    raw_group_name = str(meta[3] if len(meta) > 3 else "").strip()
    raw_composition = str(meta[4] if len(meta) > 4 else "").strip()
    composition = extract_composition_parts(raw_composition, raw_group_name, prefix_cache)

    if not composition["isGroup"]:
        global_group_info = group_cache.get(raw_party)
        if global_group_info:
            return {
                **global_group_info,
                "party": raw_party,
            }

    if composition["isGroup"]:
        return {
            "key": f"group:{norm(composition['compositionKey'])}",
            "name": get_preferred_group_name(raw_group_name, raw_composition, composition["compositionDisplay"]),
            "composition": composition["compositionDisplay"],
            "party": raw_party,
            "isGroup": True,
        }

    return {
        "key": f"party:{raw_party}",
        "name": raw_party or raw_composition or raw_group_name or candidate_key,
        "composition": raw_party or raw_composition or raw_group_name or candidate_key,
        "party": raw_party,
        "isGroup": False,
    }


def accumulate_votes(target: dict[str, int], vote_map: dict[str, int]) -> None:
    for candidate_id, raw_votes in (vote_map or {}).items():
        votes = ensure_int(raw_votes)
        if votes <= 0:
            continue
        target[str(candidate_id)] = target.get(str(candidate_id), 0) + votes


def sort_vote_map(votes_by_id: dict[str, int]) -> dict[str, int]:
    items = [(candidate_id, votes) for candidate_id, votes in votes_by_id.items() if votes > 0]
    items.sort(key=lambda item: (-item[1], item[0]))
    return {candidate_id: votes for candidate_id, votes in items}


def summarize_scope(votes_by_id: dict[str, int], meta_store: dict[str, list], prefix_cache: dict[str, str], group_cache: dict[str, dict[str, object]]) -> dict[str, object]:
    total_valid = 0
    brancos = 0
    nulos = 0
    groups: dict[str, dict[str, object]] = {}

    for candidate_id, raw_votes in votes_by_id.items():
        votes = ensure_int(raw_votes)
        if votes <= 0:
            continue
        if candidate_id == "95":
            brancos += votes
            continue
        if candidate_id == "96":
            nulos += votes
            continue

        total_valid += votes
        group_info = resolve_group_info(candidate_id, meta_store, prefix_cache, group_cache)
        entry = groups.setdefault(
            group_info["key"],
            {
                "key": group_info["key"],
                "name": group_info["name"],
                "composition": group_info["composition"],
                "party": group_info["party"],
                "isGroup": bool(group_info["isGroup"]),
                "votes": 0,
                "parties": defaultdict(int),
            },
        )
        entry["votes"] += votes
        entry["parties"][group_info["party"]] += votes

    group_items = []
    vote_summary = {}
    color_parties = {}
    for entry in groups.values():
        dominant_party = ""
        dominant_votes = -1
        for party, votes in entry["parties"].items():
            if votes > dominant_votes:
                dominant_votes = votes
                dominant_party = party
        item = {
            "key": entry["key"],
            "name": entry["name"],
            "composition": entry["composition"],
            "party": entry["party"],
            "isGroup": entry["isGroup"],
            "votes": entry["votes"],
            "dominantParty": dominant_party or entry["party"],
        }
        group_items.append(item)
        vote_summary[item["key"]] = item["votes"]
        color_parties[item["key"]] = item["dominantParty"]

    group_items.sort(key=lambda item: (-item["votes"], item["key"]))
    winner = group_items[0] if group_items else None
    second = group_items[1] if len(group_items) > 1 else None
    winner_party = ""
    if winner:
        winner_party = winner["composition"] if winner["isGroup"] else winner["party"]

    return {
        "votesById": sort_vote_map(votes_by_id),
        "groups": group_items,
        "votes": vote_summary,
        "groupColorParties": color_parties,
        "totalValid": total_valid,
        "brancos": brancos,
        "nulos": nulos,
        "comparecimento": total_valid + brancos + nulos,
        "winnerCode": winner["key"] if winner else "",
        "winnerName": winner["name"] if winner else "N/D",
        "winnerParty": winner_party,
        "winnerColorParty": winner["dominantParty"] if winner else "",
        "margin": ((winner["votes"] - (second["votes"] if second else 0)) / total_valid * 100) if winner and total_valid > 0 else 0,
    }


def load_city_name_map(base_dir: Path, year: str, uf: str) -> dict[str, str]:
    census_zip = base_dir / f"Censo {year}" / f"censo_{year}_{uf}.zip"
    if census_zip.exists():
        try:
            full_json = load_first_json_from_zip(census_zip)
            mapping = {}
            for row in (full_json.get("RESULTS") or {}).values():
                if not row:
                    continue
                code = str(row.get("cd_localidade_tse") or "").strip()
                name = str(row.get("nm_localidade") or "").strip()
                if code and name and code not in mapping:
                    mapping[code] = name
            if mapping:
                return mapping
        except Exception:
            pass

    for folder in ("municipios_hd", "municipios"):
        path = base_dir / folder / f"municipios_{uf}.geojson"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        mapping = {}
        for feature in data.get("features", []):
            props = feature.get("properties") or {}
            code = str(props.get("CD_MUN") or props.get("codigo_ibge") or "").strip()
            name = str(props.get("NM_MUN") or props.get("nome") or "").strip()
            if code and name:
                mapping[code] = name
        if mapping:
            return mapping
    return {}


def load_first_json_from_zip(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            lower_name = name.lower()
            if lower_name.endswith(".json") and not lower_name.endswith("_resumo.json"):
                return json.loads(archive.read(name).decode("utf-8"))
    raise FileNotFoundError(f"Nenhum JSON principal encontrado em {path}")


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def process_deputados(base_dir: Path, output_root: Path, year: str, uf: str, office: str) -> tuple[Path, Path]:
    folder = base_dir / f"Legislativas {year}"
    zip_path = folder / f"deputados_{office}_{year}_{uf}.zip"
    if not zip_path.exists():
        raise FileNotFoundError(zip_path)

    full_json = load_first_json_from_zip(zip_path)
    meta_store = full_json.get("METADATA", {}).get("cand_names", {}) or {}
    prefix_cache = build_prefix_cache(meta_store)
    group_cache = build_group_cache(meta_store, prefix_cache)
    city_name_map = load_city_name_map(base_dir, year, uf)

    state_votes: dict[str, int] = {}
    municipal_votes: dict[str, dict[str, int]] = defaultdict(dict)

    for result_key, vote_map in (full_json.get("RESULTS") or {}).items():
        parts = str(result_key or "").split("_")
        muni_code = str(parts[1] if len(parts) > 1 else "").strip()
        accumulate_votes(state_votes, vote_map or {})
        if muni_code:
            accumulate_votes(municipal_votes[muni_code], vote_map or {})

    state_scope = summarize_scope(state_votes, meta_store, prefix_cache, group_cache)
    municipalities_by_code = {}
    municipalities_by_slug = {}

    municipal_zip_path = output_root / f"Legislativas {year}" / f"precomputed_totals_deputados_{office}_{year}_{uf}_municipios.zip"
    municipal_zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(municipal_zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for muni_code, votes_by_id in sorted(municipal_votes.items()):
            city_name = city_name_map.get(muni_code, muni_code)
            slug = normalize_slug(city_name)
            scope = summarize_scope(votes_by_id, meta_store, prefix_cache, group_cache)

            municipalities_by_code[muni_code] = {
                "nome": city_name,
                "slug": slug,
                "muniCode": muni_code,
                "votes": scope["votes"],
                "groupColorParties": scope["groupColorParties"],
                "totalValid": scope["totalValid"],
                "winnerCode": scope["winnerCode"],
                "winnerName": scope["winnerName"],
                "winnerParty": scope["winnerParty"],
                "winnerColorParty": scope["winnerColorParty"],
                "margin": scope["margin"],
                "turno": "1T",
                "turnoLabel": "1º Turno",
            }
            municipalities_by_slug[slug] = muni_code

            municipal_payload = {
                "metadata": {
                    "schema": 1,
                    "kind": "deputados",
                    "office": office,
                    "year": year,
                    "uf": uf,
                    "municipioCode": muni_code,
                    "municipio": city_name,
                    "slug": slug,
                },
                "scope": scope,
            }
            archive.writestr(f"{muni_code}_{slug}.json", json.dumps(municipal_payload, ensure_ascii=False, separators=(",", ":")))

    state_payload = {
        "metadata": {
            "schema": 1,
            "kind": "deputados",
            "office": office,
            "year": year,
            "uf": uf,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "state": state_scope,
        "municipalitiesByCode": municipalities_by_code,
        "municipalitiesBySlug": municipalities_by_slug,
    }
    state_json_path = output_root / f"Legislativas {year}" / f"precomputed_totals_deputados_{office}_{year}_{uf}.json"
    write_json(state_json_path, state_payload)
    return state_json_path, municipal_zip_path


def parse_vereador_entry_name(entry_name: str) -> tuple[str, str]:
    base_name = Path(entry_name).stem
    parts = base_name.split("_")
    if len(parts) < 5:
        return "", ""
    muni_code = parts[-1]
    municipio = "_".join(parts[3:-1])
    return muni_code, municipio


def process_vereadores(base_dir: Path, output_root: Path, year: str, uf: str) -> tuple[Path, Path]:
    folder = base_dir / f"Municipais_Legislativas {year}"
    zip_path = folder / f"vereadores_{year}_{uf}.zip"
    if not zip_path.exists():
        raise FileNotFoundError(zip_path)

    municipalities_by_code = {}
    municipalities_by_slug = {}

    output_zip_path = output_root / f"Municipais_Legislativas {year}" / f"precomputed_totals_vereadores_{year}_{uf}_municipios.zip"
    output_zip_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as archive, zipfile.ZipFile(output_zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as out_archive:
        for entry_name in archive.namelist():
            lower_name = entry_name.lower()
            if not lower_name.endswith(".json") or lower_name.endswith("_resumo.json"):
                continue

            muni_code, municipio_from_name = parse_vereador_entry_name(entry_name)
            full_json = json.loads(archive.read(entry_name).decode("utf-8"))
            meta_store = full_json.get("METADATA", {}).get("cand_names", {}) or {}
            prefix_cache = build_prefix_cache(meta_store)
            group_cache = build_group_cache(meta_store, prefix_cache)

            municipality_votes: dict[str, int] = {}
            for vote_map in (full_json.get("RESULTS") or {}).values():
                accumulate_votes(municipality_votes, vote_map or {})

            municipio = municipio_from_name.replace("_", " ").strip() or muni_code
            slug = normalize_slug(municipio)
            scope = summarize_scope(municipality_votes, meta_store, prefix_cache, group_cache)

            municipalities_by_code[muni_code] = {
                "nome": municipio,
                "slug": slug,
                "muniCode": muni_code,
                "votes": scope["votes"],
                "groupColorParties": scope["groupColorParties"],
                "totalValid": scope["totalValid"],
                "winnerCode": scope["winnerCode"],
                "winnerName": scope["winnerName"],
                "winnerParty": scope["winnerParty"],
                "winnerColorParty": scope["winnerColorParty"],
                "margin": scope["margin"],
                "turno": "1T",
                "turnoLabel": "1º Turno",
            }
            municipalities_by_slug[slug] = muni_code

            municipal_payload = {
                "metadata": {
                    "schema": 1,
                    "kind": "vereadores",
                    "year": year,
                    "uf": uf,
                    "municipioCode": muni_code,
                    "municipio": municipio,
                    "slug": slug,
                    "source": entry_name,
                },
                "scope": scope,
            }
            out_archive.writestr(f"{muni_code}_{slug}.json", json.dumps(municipal_payload, ensure_ascii=False, separators=(",", ":")))

    state_payload = {
        "metadata": {
            "schema": 1,
            "kind": "vereadores",
            "year": year,
            "uf": uf,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "municipalitiesByCode": municipalities_by_code,
        "municipalitiesBySlug": municipalities_by_slug,
    }
    state_json_path = output_root / f"Municipais_Legislativas {year}" / f"precomputed_totals_vereadores_{year}_{uf}.json"
    write_json(state_json_path, state_payload)
    return state_json_path, output_zip_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gera totalizações proporcionais pré-computadas por estado e município.")
    parser.add_argument("--base-dir", default="resultados_geo", help="Diretório raiz dos dados de entrada.")
    parser.add_argument("--output-root", default=None, help="Diretório de saída. Padrão: mesmo valor de --base-dir.")
    parser.add_argument("--kind", choices=["deputados", "vereadores", "all"], default="all")
    parser.add_argument("--year", action="append", dest="years", help="Ano a processar. Pode ser repetido.")
    parser.add_argument("--uf", action="append", dest="ufs", help="UF a processar. Pode ser repetido.")
    parser.add_argument("--office", choices=["federal", "estadual", "all"], default="all", help="Cargo para deputados.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_dir = Path(args.base_dir)
    output_root = Path(args.output_root) if args.output_root else base_dir
    years = [str(year) for year in (args.years or [])]
    ufs = [str(uf).upper() for uf in (args.ufs or ALL_UFS)]

    should_process_deputados = args.kind in {"deputados", "all"}
    should_process_vereadores = args.kind in {"vereadores", "all"}

    if should_process_deputados:
        deputy_years = [year for year in (years or DEPUTY_YEARS) if year in DEPUTY_YEARS]
        deputy_offices = ["federal", "estadual"] if args.office == "all" else [args.office]
        for year in deputy_years:
            for uf in ufs:
                for office in deputy_offices:
                    try:
                        state_json_path, municipal_zip_path = process_deputados(base_dir, output_root, year, uf, office)
                        print(f"[deputados {office} {year}/{uf}] {state_json_path} | {municipal_zip_path}")
                    except FileNotFoundError:
                        print(f"[deputados {office} {year}/{uf}] origem ausente, ignorando")

    if should_process_vereadores:
        vereador_years = [year for year in (years or VEREADOR_YEARS) if year in VEREADOR_YEARS]
        for year in vereador_years:
            for uf in ufs:
                try:
                    state_json_path, municipal_zip_path = process_vereadores(base_dir, output_root, year, uf)
                    print(f"[vereadores {year}/{uf}] {state_json_path} | {municipal_zip_path}")
                except FileNotFoundError:
                    print(f"[vereadores {year}/{uf}] origem ausente, ignorando")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
