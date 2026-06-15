import json
import unicodedata
from difflib import get_close_matches

with open(r"c:\mapas\Observatorio\lista_municipios.json", "r", encoding="utf-8-sig") as f:
    official_cities = json.load(f)

unresolved = [
    ("AL", "SENADOR TEOTONIO VILELA"),
    ("BA", "GOVERNADOR LOMANTO JUNIOR"),
    ("CE", "SENADOR CATUNDA"),
    ("CE", "TEJUSSUOCA"),
    ("DF", "BRASILIA"),
    ("MS", "BATAGUACU"),
    ("PA", "VIZEU"),
    ("PB", "CAMPO DE SANTANA"),
    ("PB", "SANTAREM"),
    ("PE", "FERNANDO DE NORONHA"),
    ("PE", "ITAMARACA"),
    ("PR", "LUISIANIA"),
    ("PR", "VILA ALTA"),
    ("RN", "ARES"),
    ("SC", "PICARRAS"),
    ("SP", "IPAUCU"),
    ("TO", "FORTALEZA DO TABOCAO"),
]

def clean_str(s):
    if not s:
        return ""
    s = unicodedata.normalize('NFD', s)
    s = "".join([c for c in s if unicodedata.category(c) != 'Mn'])
    s = s.upper().replace("-", " ").replace("'", " ").replace("`", " ")
    return " ".join(s.split())

for uf, name in unresolved:
    if uf not in official_cities:
        print(f"UF {uf} not found in official_cities")
        continue
    state_cities = official_cities[uf]
    
    # Show top 5 closest matches using difflib
    matches = get_close_matches(name, state_cities, n=5, cutoff=0.1)
    # Also clean and print clean matches
    cleaned_name = clean_str(name)
    clean_state_matches = []
    for c in state_cities:
        cc = clean_str(c)
        if cleaned_name in cc or cc in cleaned_name:
            clean_state_matches.append(c)
            
    print(f"\n{uf}: '{name}'")
    print(f"  Close matches: {matches}")
    if clean_state_matches:
        print(f"  Sub/Super string matches: {clean_state_matches}")
