/**
 * Baixa a malha municipal do IBGE Servicodados (resolucao=5, topologicamente correta)
 * e salva em resultados_geo/municipios_hd/municipios_<UF>.geojson
 *
 * Uso: node scripts/baixar_malha_ibge.mjs
 * Precisa de Node >= 18 (fetch nativo)
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'resultados_geo', 'municipios_hd');

// Tabela UF -> código IBGE do estado
const ESTADOS = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35,
  PR: 41, SC: 42, RS: 43,
  MS: 50, MT: 51, GO: 52, DF: 53
};

const BASE = 'https://servicodados.ibge.gov.br/api/v3/malhas/estados';
const FMT  = 'application/vnd.geo+json';
const RES  = 5; // máxima resolução

async function baixarEstado(uf, cod) {
  const url = `${BASE}/${cod}?intrarregiao=municipio&formato=${encodeURIComponent(FMT)}&resolucao=${RES}`;
  console.log(`[${uf}] Baixando de ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const geojson = await resp.json();

  // Renomeia codarea -> CD_MUN para compatibilidade com o simulador
  if (geojson.features) {
    for (const f of geojson.features) {
      if (f.properties && f.properties.codarea && !f.properties.CD_MUN) {
        f.properties.CD_MUN = Number(f.properties.codarea);
      }
    }
  }

  const dest = join(OUT_DIR, `municipios_${uf}.geojson`);
  await writeFile(dest, JSON.stringify(geojson));
  const kb = Math.round(JSON.stringify(geojson).length / 1024);
  console.log(`[${uf}] OK -> ${kb} KB  (${geojson.features?.length ?? '?'} feições)`);
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  const ufs = Object.keys(ESTADOS);
  // Baixa em lotes de 4 para não sobrecarregar o servidor
  const LOTE = 4;
  for (let i = 0; i < ufs.length; i += LOTE) {
    const lote = ufs.slice(i, i + LOTE);
    await Promise.all(lote.map(uf => baixarEstado(uf, ESTADOS[uf]).catch(e => {
      console.error(`[${uf}] ERRO: ${e.message}`);
    })));
  }
  console.log('\nPronto! Todos os estados baixados.');
}

main();
