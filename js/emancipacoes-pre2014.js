// =====================================================================
// EMANCIPACOES PRE-2014 — reatribuicao de votos a cidades que ainda nao
// existiam nas eleicoes nacionais de 1998/2002/2006/2010.
// =====================================================================
// Nessas eleicoes varias cidades de hoje eram distritos de um municipio-pai;
// seus votos ficaram sob o codigo TSE do pai. A tabela
// resultados_geo/emancipacoes_pre2014.json (gerada por
// scripts/gerar_emancipacoes_pre2014.py) lista, por ano, os locais de votacao
// (zona + nr_locvot) que pertenciam a cada cidade nova e sob qual codigo-pai a
// eleicao os guardou.
//
// Aqui aplicamos a reatribuicao EM TEMPO DE CARGA, sem mexer nos ZIPs: para cada
// local casado, trocamos o codigo do meio da chave ``zona_CODIGO_local`` (tanto
// nos RESULTS quanto nas features do mapa) do pai para o codigo TSE moderno da
// cidade, e injetamos o nome/IBGE no mapa de nomes. Como dots, coropletico e
// totais agrupam por esse codigo, tudo passa a contar para a cidade certa. A
// soma por UF/turno e preservada (apenas redistribui entre municipios).

(function (global) {
  'use strict';

  var URL = (typeof DATA_BASE_URL !== 'undefined' ? DATA_BASE_URL : 'resultados_geo/')
    + 'emancipacoes_pre2014.json';

  var _tablePromise = null;
  var _remapByYear = null; // { year: Map(origKey -> {code,name,ibge}) }

  function ensureLoaded() {
    if (_tablePromise) return _tablePromise;
    _tablePromise = fetch(URL)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { _remapByYear = buildIndex(data); return _remapByYear; })
      .catch(function () { _remapByYear = {}; return _remapByYear; });
    return _tablePromise;
  }

  function buildIndex(data) {
    var byYear = {};
    var anos = (data && data.anos) || {};
    Object.keys(anos).forEach(function (year) {
      var m = new Map();
      var perUf = anos[year] || {};
      Object.keys(perUf).forEach(function (uf) {
        (perUf[uf] || []).forEach(function (city) {
          var info = { code: String(city.cd_tse), name: city.nome,
                       ibge: city.cd_ibge != null ? String(city.cd_ibge) : null };
          (city.locais || []).forEach(function (L) {
            // chave original na eleicao: zona_PARENT_local
            m.set(L.zona + '_' + L.parent + '_' + L.local, info);
          });
        });
      });
      byYear[year] = m;
    });
    return byYear;
  }

  // Reatribui RESULTS + features e enriquece muniNameMap/muniIbgeMap.
  // year: 1998|2002|2006|2010 (numero ou string). Mutating in place.
  function apply(year, opts) {
    if (!_remapByYear) return 0;
    var remap = _remapByYear[String(year)];
    if (!remap || !remap.size) return 0;
    var moved = 0;

    // 1) Nomes/IBGE para os codigos novos (senao o agrupamento descarta os votos).
    if (opts.muniNameMap) {
      remap.forEach(function (info) {
        if (info.name) opts.muniNameMap.set(info.code, info.name);
      });
    }
    if (opts.muniIbgeMap) {
      remap.forEach(function (info) {
        if (info.ibge) opts.muniIbgeMap.set(info.code, info.ibge);
      });
    }

    // 2) RESULTS: troca o codigo do meio da chave (pai -> cidade).
    (opts.resultsObjects || []).forEach(function (results) {
      if (!results) return;
      remap.forEach(function (info, origKey) {
        var votes = results[origKey];
        if (votes === undefined) return;
        var parts = origKey.split('_');
        var newKey = parts[0] + '_' + info.code + '_' + parts[2];
        if (results[newKey]) {
          var dst = results[newKey];
          Object.keys(votes).forEach(function (cid) {
            dst[cid] = (dst[cid] || 0) + votes[cid];
          });
        } else {
          results[newKey] = votes;
        }
        delete results[origKey];
        moved++;
      });
    });

    // 3) Features do mapa: reescreve id_unico/local_key (pai -> cidade) e nm_localidade.
    (opts.features || []).forEach(function (feat) {
      var p = feat && feat.properties;
      if (!p) return;
      var key = String(p.id_unico || p.local_key || '');
      if (!key) return;
      var info = remap.get(key);
      if (!info) return;
      var parts = key.split('_');
      var newKey = parts[0] + '_' + info.code + '_' + parts[2];
      if (p.id_unico) p.id_unico = newKey;
      if (p.local_key) p.local_key = newKey;
      if (info.name) p.nm_localidade = info.name;
      // 2010/2022 agrupam por cd_localidade_tse da feature; aponta para a cidade.
      p.cd_localidade_tse = info.code;
      // 2006/2010 derivam o IBGE do municipio a partir do proprio ponto; aponta
      // para o IBGE da cidade nova para casar o poligono certo.
      if (info.ibge) p.cod_localidade_ibge = info.ibge;
    });

    return moved;
  }

  global.EMANC = { ensureLoaded: ensureLoaded, apply: apply };
})(typeof window !== 'undefined' ? window : this);
