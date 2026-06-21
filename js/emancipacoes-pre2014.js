// =====================================================================
// EMANCIPACOES PRE-2014 — reatribuicao por SECAO ELEITORAL.
// =====================================================================
// Nas eleicoes nacionais de 1998/2002/2006/2010, cidades que ainda nao existiam
// tinham os votos sob o municipio-pai. A tabela
// resultados_geo/emancipacoes_pre2014.json (gerada por
// scripts/gerar_emancipacoes_pre2014.py) traz, por ano/UF/cidade, o RESULTADO
// (votos por candidato, por cargo e turno) obtido somando as SECOES ELEITORAIS
// da cidade -- identificadas na eleicao mais antiga em que ela existiu e puxadas
// do arquivo bruto do ano-alvo -- e o detalhamento por pai (`por_pai`).
//
// Aqui ajustamos os TOTAIS POR MUNICIPIO em tempo de carga: adicionamos a cidade
// nova (com seu resultado) e subtraimos esses votos do(s) municipio(s)-pai. A
// soma por UF/turno e preservada (apenas redistribui). Os pontos do mapa
// permanecem como estao (o numero do local nao e usado nesta correcao).

(function (global) {
  'use strict';

  var URL = (typeof DATA_BASE_URL !== 'undefined' ? DATA_BASE_URL : 'resultados_geo/')
    + 'emancipacoes_pre2014.json';

  var _promise = null;
  var _table = null;

  function ensureLoaded() {
    if (_promise) return _promise;
    _promise = fetch(URL)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { _table = (data && data.anos) || {}; return _table; })
      .catch(function () { _table = {}; return _table; });
    return _promise;
  }

  function _norm(s) {
    if (typeof norm === 'function') return norm(s);
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().trim();
  }

  function _citiesFor(year, uf) {
    if (!_table) return [];
    var per = _table[String(year)];
    return (per && per[String(uf).toUpperCase()]) || [];
  }

  function _subtract(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) {
      out[k] = (out[k] || 0) - b[k];
      if (out[k] <= 0) delete out[k];
    });
    return out;
  }

  function _add(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { out[k] = (out[k] || 0) + b[k]; });
    return out;
  }

  function _setSummary(summaries, name, summary) {
    summaries[name] = summary;
    summaries[_norm(name)] = summary;
  }

  function _getSummary(summaries, name) {
    return summaries[name] || summaries[_norm(name)] || null;
  }

  // Ajusta o mapa de totais por cidade (cityName -> summary) para um (ano, uf,
  // cargo, turno). `summaries` e mutado no lugar.
  //   cargo: 'presidente' | 'governador' | 'senador' | 'deputado_federal' | 'deputado_estadual'
  //   turnoKey: '1T' | '2T'
  function adjustCityTotals(opts) {
    if (!_table) return 0;
    if (typeof buildGeneralOfficialSummaryFromRawTotals !== 'function') return 0;
    var cities = _citiesFor(opts.year, opts.uf);
    if (!cities.length) return 0;
    var turno = String(opts.turnoKey || '1T').charAt(0); // '1' | '2'
    var cargo = opts.cargo;
    var summaries = opts.summaries;
    var meta = opts.metadata || {};
    var nameByCode = opts.muniNameMap; // Map(codeTSE -> nome) p/ achar o pai
    var affected = opts.affected;      // Set opcional: nomes tocados (cidade+pais)
    var n = 0;

    cities.forEach(function (c) {
      var rawCity = c.resultados && c.resultados[cargo] && c.resultados[cargo][turno];
      if (!rawCity) return;

      // 1) subtrai do(s) pai(s)
      var porPai = c.por_pai || {};
      Object.keys(porPai).forEach(function (code) {
        var rawP = porPai[code] && porPai[code][cargo] && porPai[code][cargo][turno];
        if (!rawP) return;
        var parentName = nameByCode && nameByCode.get ? nameByCode.get(String(code)) : null;
        if (!parentName) return;
        var target = _getSummary(summaries, parentName);
        if (!target || !target.rawTotals) return;
        var newRaw = _subtract(target.rawTotals, rawP);
        var s = buildGeneralOfficialSummaryFromRawTotals(newRaw, meta, opts.turnoKey);
        if (target.ibge) s.ibge = target.ibge;
        _setSummary(summaries, parentName, s);
        if (affected) affected.add(parentName);
      });

      // 2) adiciona a cidade nova (acumula se ja houver entrada)
      var existing = _getSummary(summaries, c.nome);
      var base = existing && existing.rawTotals ? existing.rawTotals : {};
      var s = buildGeneralOfficialSummaryFromRawTotals(_add(base, rawCity), meta, opts.turnoKey);
      if (c.cd_ibge) s.ibge = String(c.cd_ibge);
      _setSummary(summaries, c.nome, s);
      if (affected) affected.add(c.nome);
      n++;
    });
    return n;
  }

  // Deputados: ajusta o Map(cityName -> {candId:votos}) usado no coropletico de
  // deputados (add cidade nova, subtrai do pai). cargo: deputado_federal|estadual.
  function adjustDeputyCityTotals(opts) {
    if (!_table) return 0;
    var cities = _citiesFor(opts.year, opts.uf);
    if (!cities.length) return 0;
    var cargo = opts.cargo;
    var turno = '1';
    var map = opts.rawCityTotals;
    var nameByCode = opts.muniNameMap;
    var affected = opts.affected;
    var n = 0;
    cities.forEach(function (c) {
      var rawCity = c.resultados && c.resultados[cargo] && c.resultados[cargo][turno];
      if (!rawCity) return;
      var porPai = c.por_pai || {};
      Object.keys(porPai).forEach(function (code) {
        var rawP = porPai[code] && porPai[code][cargo] && porPai[code][cargo][turno];
        if (!rawP) return;
        var pName = nameByCode && nameByCode.get ? nameByCode.get(String(code)) : null;
        if (!pName) return;
        var pv = map.get(pName);
        if (!pv) return;
        Object.keys(rawP).forEach(function (cid) {
          pv[cid] = (pv[cid] || 0) - rawP[cid];
          if (pv[cid] <= 0) delete pv[cid];
        });
        if (affected) affected.add(pName);
      });
      var cv = map.get(c.nome);
      if (!cv) { cv = {}; map.set(c.nome, cv); }
      Object.keys(rawCity).forEach(function (cid) { cv[cid] = (cv[cid] || 0) + rawCity[cid]; });
      if (affected) affected.add(c.nome);
      n++;
    });
    return n;
  }

  global.EMANC = {
    ensureLoaded: ensureLoaded,
    adjustCityTotals: adjustCityTotals,
    adjustDeputyCityTotals: adjustDeputyCityTotals,
    // compat: chamadas antigas de remap viram no-op (tabela mudou p/ secoes).
    apply: function () { return 0; },
  };
})(typeof window !== 'undefined' ? window : this);
