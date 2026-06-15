import json

with open(r"c:\mapas\Observatorio\lista_municipios.json", "r", encoding="utf-8-sig") as f:
    official_cities = json.load(f)

print("Keys of official_cities:", list(official_cities.keys()))

print("\nBA containing 'Lomanto' or 'Barro' or 'Governador':")
for c in official_cities.get("BA", []):
    if any(x in c.upper() for x in ["LOMANTO", "BARRO", "GOVERNADOR"]):
        print("  -", c)

print("\nPB containing 'Tacima' or 'Joca' or 'Santarem':")
for c in official_cities.get("PB", []):
    if any(x in c.upper() for x in ["TACIMA", "JOCA", "SANTAREM"]):
        print("  -", c)

print("\nPR containing 'Vila' or 'Alto' or 'Paraiso':")
for c in official_cities.get("PR", []):
    if any(x in c.upper() for x in ["VILA", "ALTO", "PARAISO"]):
        print("  -", c)

print("\nPE containing 'Noronha':")
for c in official_cities.get("PE", []):
    if "NORONHA" in c.upper():
        print("  -", c)

print("\nDF cities:")
print(official_cities.get("DF", "Not present"))

print("\nTO containing 'Tabocao' or 'Fortaleza':")
for c in official_cities.get("TO", []):
    if any(x in c.upper() for x in ["TABOCAO", "FORTALEZA", "TABOCÃO"]):
        print("  -", c)
