import json

# Simulate JS logic in Python to verify
with open("resultados_geo/regioes_ibge.json", "r", encoding="utf-8") as f:
    reg_data = json.load(f)

muniCodeToNameMap = {}
for code7, info in reg_data.get("muni_to_region", {}).items():
    name = info["nome"]
    muniCodeToNameMap[code7] = name
    if len(code7) >= 6:
        muniCodeToNameMap[code7[:6]] = name

# Test case 1: Pilão Arcado (2924801 or 292480) with corrupted nm_localidade "PILO ARCADO"
feature_props = {
    'cod_localidade_ibge': 2924801,
    'nm_localidade': 'PILO ARCADO',
    'nm_locvot': 'ESCOLA MUNICIPAL'
}

def get_clean_name(props):
    code = str(props.get('cod_localidade_ibge') or props.get('CD_MUN') or '').strip()
    code6 = code[:6]
    if code in muniCodeToNameMap:
        return muniCodeToNameMap[code]
    if code6 in muniCodeToNameMap:
        return muniCodeToNameMap[code6]
    return props.get('nm_localidade')

resolved = get_clean_name(feature_props)
print(f"Input corrupted string: {repr(feature_props['nm_localidade'])}")
print(f"Resolved clean name:   {repr(resolved)}")

assert resolved == "Pilão Arcado", f"Expected 'Pilão Arcado', got {repr(resolved)}"
print("VERIFICATION SUCCESS: Corrupted string resolved to clean IBGE name!")
