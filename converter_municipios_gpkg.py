"""
Converte o GeoPackage de Municípios do Brasil em GeoJSONs individuais por UF,
com simplificação mínima preservando detalhes, para uso no Simulador Eleitoral.

Saída: resultados_geo/municipios_hd/municipios_{UF}.geojson
"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
import json

# ===== CONFIGURAÇÃO =====
GPKG_PATH = r'E:\Mapas\Brasil Municipios.gpkg'
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'resultados_geo', 'municipios_hd')

# Simplificação mínima: ~50m de tolerância (preserva detalhes, reduz tamanho)
# 0.0005 grau ≈ 55m no equador
SIMPLIFY_TOLERANCE = 0.0005

# Mapeamento CD_UF → Sigla UF
UF_CODE_TO_SIGLA = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
    '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS',
    '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'
}


def main():
    import geopandas as gpd
    import warnings
    warnings.filterwarnings('ignore')

    print("=" * 60)
    print("CONVERSÃO DE GPKG MUNICIPIOS → GeoJSON por UF (com simplificação mínima)")
    print("=" * 60)
    print(f"\nFonte: {GPKG_PATH}")
    print(f"Destino: {OUTPUT_DIR}")
    print(f"Tolerância de simplificação: {SIMPLIFY_TOLERANCE} graus (~{SIMPLIFY_TOLERANCE * 111320:.0f}m)\n")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Carregando GeoPackage...")
    gdf = gpd.read_file(GPKG_PATH)
    print(f"  {len(gdf)} municípios carregados")
    print(f"  CRS original: {gdf.crs}")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        print("  Reprojetando para EPSG:4326...")
        gdf = gdf.to_crs('EPSG:4326')

    # Simplificação mínima preservando topologia
    print(f"  Aplicando simplificação (tolerance={SIMPLIFY_TOLERANCE})...")
    gdf['geometry'] = gdf['geometry'].simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)

    # Manter apenas colunas essenciais
    cols_to_keep = ['CD_MUN', 'NM_MUN', 'AREA_KM2', 'geometry']
    available_cols = [c for c in cols_to_keep if c in gdf.columns]
    gdf_slim = gdf[available_cols].copy()
    gdf_slim['_uf_code'] = gdf_slim['CD_MUN'].astype(str).str[:2]

    # Comparar com os arquivos antigos (simplificados)
    old_dir = os.path.join(os.path.dirname(OUTPUT_DIR), 'municipios')

    total_exported = 0
    total_new_size = 0
    total_old_size = 0

    for uf_code, sigla in sorted(UF_CODE_TO_SIGLA.items(), key=lambda x: x[1]):
        uf_data = gdf_slim[gdf_slim['_uf_code'] == uf_code].copy()
        if len(uf_data) == 0:
            print(f"  {sigla}: nenhum município encontrado")
            continue

        export_cols = [c for c in uf_data.columns if c != '_uf_code']
        uf_data = uf_data[export_cols]

        # Truncar coordenadas para 5 casas decimais (~1.1m de precisão) para reduzir tamanho
        output_path = os.path.join(OUTPUT_DIR, f'municipios_{sigla}.geojson')
        uf_data.to_file(output_path, driver='GeoJSON', coordinate_precision=5)

        size_kb = os.path.getsize(output_path) / 1024
        total_new_size += size_kb

        # Comparar com o antigo
        old_path = os.path.join(old_dir, f'municipios_{sigla}.geojson')
        old_size_kb = os.path.getsize(old_path) / 1024 if os.path.exists(old_path) else 0
        total_old_size += old_size_kb

        ratio = f"{size_kb/old_size_kb:.1f}x" if old_size_kb > 0 else "N/A"
        print(f"  {sigla}: {len(uf_data):>4} munis → {size_kb:>7.0f} KB  (antigo: {old_size_kb:>6.0f} KB, {ratio} mais detalhado)")
        total_exported += len(uf_data)

    print(f"\n{'=' * 60}")
    print(f"Total exportado: {total_exported} municípios em {len(UF_CODE_TO_SIGLA)} arquivos")
    print(f"Tamanho total novo: {total_new_size/1024:.1f} MB")
    print(f"Tamanho total antigo: {total_old_size/1024:.1f} MB")
    print(f"Ratio médio: {total_new_size/total_old_size:.1f}x mais detalhado" if total_old_size > 0 else "")
    print(f"Diretório: {OUTPUT_DIR}")


if __name__ == '__main__':
    main()
