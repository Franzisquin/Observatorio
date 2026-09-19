/*
 * maplibre-compat.js
 * --------------------------------------------------------------------------
 * Camada de renderização baseada em MapLibre GL JS que substitui o Leaflet.
 *
 * O restante do código (map-render.js, simulador.js, data-*.js, etc.) foi
 * escrito em torno do modelo "objeto-por-feature" do Leaflet (L.geoJSON +
 * eachLayer + layer.setStyle/getBounds...). Em vez de reescrever centenas de
 * call-sites espalhados por ~10 arquivos, expomos a mesma API por meio de um
 * "GeoLayer" focado nas DUAS camadas usadas pelo site (pontos e polígonos),
 * porém renderizando de forma nativa no MapLibre: uma source GeoJSON + layers
 * circle/fill/line, com cor/opacidade/raio pré-computados nas properties e
 * atualização via source.setData(). Tooltips usam um Popup compartilhado e a
 * seleção/hover de municípios usa feature-state.
 *
 * As funções de estilo, tooltip e dados existentes são reaproveitadas sem
 * alteração (getFeatureStyle, getMunicipalPolygonStyle, buildLocationTooltip…).
 */

(function (global) {
  'use strict';

  // ====== CORES (resolve var(--accent) etc. para valores concretos) ======
  let _accentColor = '#ff5252';
  const _cssVarCache = new Map();

  function refreshThemeColors() {
    try {
      const cs = getComputedStyle(document.body);
      const accent = cs.getPropertyValue('--accent').trim();
      if (accent) _accentColor = accent;
    } catch (_) { /* noop */ }
    _cssVarCache.clear();
  }

  function resolveCssColor(color) {
    if (color == null) return '#888888';
    const str = String(color).trim();
    if (!str) return '#888888';
    if (str.indexOf('var(') === -1) return str;
    if (str === 'var(--accent)') return _accentColor;
    if (_cssVarCache.has(str)) return _cssVarCache.get(str);
    // Resolve genérico var(--x[, fallback])
    const match = str.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
    let resolved = str;
    if (match) {
      try {
        const v = getComputedStyle(document.body).getPropertyValue(match[1]).trim();
        resolved = v || (match[2] ? match[2].trim() : '#888888');
      } catch (_) {
        resolved = match[2] ? match[2].trim() : '#888888';
      }
    }
    _cssVarCache.set(str, resolved);
    return resolved;
  }

  // ====== ESTILO BASE (vetorial, gratuito, sem chave de API) ======
  // Estilos vetoriais do OpenFreeMap (https://openfreemap.org) — compatíveis
  // nativamente com o MapLibre, sem registro/token/cookies. Substituem os tiles
  // raster do CARTO. São style.json válidos (version 8), então carregam direto.
  const BASEMAP_STYLES = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark'
  };

  function buildBasemapStyle(theme) {
    return theme === 'light' ? BASEMAP_STYLES.light : BASEMAP_STYLES.dark;
  }

  // Executa cb assim que o estilo estiver pronto para MUTAÇÃO (addSource/addLayer),
  // imediatamente se já estiver, senão no próximo 'styledata' em que ficar.
  //
  // IMPORTANTE: para mutar o estilo basta o *spec* estar carregado — NÃO é preciso
  // esperar os tiles. Num basemap VETORIAL, map.isStyleLoaded() fica false enquanto
  // os tiles carregam (quase sempre após um fitBounds/flyTo, como ao aplicar um
  // filtro), o que adiava — às vezes indefinidamente — a criação das camadas de
  // pontos, fazendo os locais "sumirem". Por isso aceitamos também o flag de spec
  // carregado (map.style._loaded), que independe dos tiles.
  function styleReadyForMutation(map) {
    if (map.__styleChangeInProgress) return false;
    if (map.isStyleLoaded && map.isStyleLoaded()) return true;
    return !!(map.style && map.style._loaded);
  }

  function whenStyleReady(map, cb) {
    if (!map) return;
    if (styleReadyForMutation(map)) { cb(); return; }
    // Escuta tanto 'styledata' (verifica _loaded) quanto 'style.load' (sempre
    // sinaliza pronto). Em MapLibre 4.x, isStyleLoaded() fica false enquanto tiles
    // carregam, então sem 'style.load' os callbacks nunca disparariam após setStyle.
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      map.off('styledata', onData);
      map.off('style.load', fire);
      cb();
    };
    const onData = () => {
      if (styleReadyForMutation(map)) fire();
    };
    map.on('styledata', onData);
    map.on('style.load', fire);
  }

  function reattachGeoLayers(map) {
    const layers = map.__geoLayers ? Array.from(map.__geoLayers) : [];
    layers.forEach((layer) => {
      try { layer.reattachToStyle(); } catch (_) { /* noop */ }
    });
  }

  function setBasemapTheme(map, theme) {
    if (!map) return;
    map.__styleChangeInProgress = true;

    let resolved = false;
    const resolveChange = () => {
      if (resolved) return;
      resolved = true;

      map.off('style.load', resolveChange);
      map.off('styledata', onStyleData);

      map.__styleChangeInProgress = false;
      refreshThemeColors();
      reattachGeoLayers(map);
    };

    const onStyleData = () => {
      const ready = (map.isStyleLoaded && map.isStyleLoaded()) || !!(map.style && map.style._loaded);
      if (ready) {
        resolveChange();
      }
    };

    map.on('style.load', resolveChange);
    map.on('styledata', onStyleData);

    // Fallback de segurança de 800ms para garantir a liberação e renderização
    setTimeout(resolveChange, 800);

    map.setStyle(buildBasemapStyle(theme));
  }

  // ====== BOUNDS / GEOMETRIA ======
  function walkCoords(geom, cb) {
    if (!geom) return;
    const t = geom.type;
    const c = geom.coordinates;
    if (!c) return;
    if (t === 'Point') {
      cb(c);
    } else if (t === 'MultiPoint' || t === 'LineString') {
      c.forEach(cb);
    } else if (t === 'MultiLineString' || t === 'Polygon') {
      c.forEach((ring) => ring.forEach(cb));
    } else if (t === 'MultiPolygon') {
      c.forEach((poly) => poly.forEach((ring) => ring.forEach(cb)));
    } else if (t === 'GeometryCollection' && Array.isArray(geom.geometries)) {
      geom.geometries.forEach((g) => walkCoords(g, cb));
    }
  }

  // Retorna um maplibregl.LngLatBounds com .isValid() (compatível com o uso
  // herdado do Leaflet) ou null se não houver coordenadas.
  function featureCollectionBounds(features) {
    const list = Array.isArray(features) ? features : (features && features.features) || [];
    let bounds = null;
    list.forEach((f) => {
      walkCoords(f && f.geometry, (coord) => {
        if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return;
        if (!bounds) bounds = new global.maplibregl.LngLatBounds(coord, coord);
        else bounds.extend(coord);
      });
    });
    return augmentBounds(bounds);
  }

  function featureBounds(feature) {
    return featureCollectionBounds(feature ? [feature] : []);
  }

  function featureCenter(feature) {
    const b = featureBounds(feature);
    if (!b || !b.isValid()) return null;
    const c = b.getCenter();
    return [c.lng, c.lat];
  }

  function augmentBounds(bounds) {
    if (!bounds) return null;
    if (typeof bounds.isValid !== 'function') {
      bounds.isValid = function () { return !this.isEmpty(); };
    }
    if (typeof bounds.intersects !== 'function') {
      bounds.intersects = function (other) {
        if (!other) return false;
        const sw = this.getSouthWest(), ne = this.getNorthEast();
        const osw = other.getSouthWest(), one = other.getNorthEast();
        return !(osw.lng > ne.lng || one.lng < sw.lng || osw.lat > ne.lat || one.lat < sw.lat);
      };
    }
    return bounds;
  }

  // Converte padding herdado do Leaflet ([x, y] px) para o formato MapLibre.
  function normalizePadding(padding) {
    if (padding == null) return 20;
    if (typeof padding === 'number') return padding;
    if (Array.isArray(padding)) {
      const x = padding[0] || 0;
      const y = padding[1] != null ? padding[1] : x;
      return { top: y, bottom: y, left: x, right: x };
    }
    return padding;
  }

  function fitMapToBounds(map, bounds, opts) {
    if (!map || !bounds || !bounds.isValid || !bounds.isValid()) return false;
    const o = opts || {};
    const fitOpts = {
      padding: normalizePadding(o.padding != null ? o.padding : 20),
      duration: o.animate === false ? 0 : (o.duration != null ? o.duration * 1000 : 600),
      animate: o.animate !== false,
      essential: true
    };
    // IMPORTANTE: o MapLibre faz Object.assign sobre seus defaults
    // ({ maxZoom: transform.maxZoom, ... }, options). Passar maxZoom: undefined
    // sobrescreve o default e leva a Math.min(zoom, undefined) === NaN, gerando
    // "Invalid LngLat object: (NaN, NaN)" no cameraForBounds. Só incluímos a
    // chave quando há um valor real.
    if (o.maxZoom != null) fitOpts.maxZoom = o.maxZoom;
    map.fitBounds(bounds, fitOpts);
    return true;
  }

  // ====== AUGMENT DO MAP (métodos esperados pelo código herdado) ======
  function augmentMap(map) {
    // Registro de GeoLayers gerenciados (para hasLayer/removeLayer por handle).
    map.__geoLayers = map.__geoLayers || new Set();

    map.hasLayer = function (handle) {
      return !!(handle && handle.__added && map.__geoLayers.has(handle));
    };

    // removeLayer polimórfico: string => remove layer nativa (MapLibre);
    // GeoLayer handle => remove a camada gerenciada inteira.
    if (!map.__removeLayerPatched) {
      const origRemoveLayer = map.removeLayer.bind(map);
      map.removeLayer = function (arg) {
        if (typeof arg === 'string') {
          if (map.getLayer(arg)) return origRemoveLayer(arg);
          return undefined;
        }
        if (arg && typeof arg.remove === 'function') return arg.remove();
        return undefined;
      };
      map.__removeLayerPatched = true;
    }

    // fitBounds: aceita padding no formato herdado do Leaflet ([x, y] px).
    if (!map.__fitBoundsPatched) {
      const origFitBounds = map.fitBounds.bind(map);
      map.fitBounds = function (bounds, options) {
        const o = Object.assign({}, options);
        if (o.padding != null) o.padding = normalizePadding(o.padding);
        return origFitBounds(bounds, o);
      };
      map.__fitBoundsPatched = true;
    }
    return map;
  }

  // ====== GEOLAYER ======
  // opts: {
  //   id, type:'point'|'polygon',
  //   styleFn(feature)->leafletStyle,
  //   radiusFn(feature)->number          (apenas pontos)
  //   tooltipFn(feature)->html|null,
  //   onClick(feature, originalEvent),
  //   hover:boolean                       (destaque de borda em polígonos)
  //   tooltipClass:string,
  //   sticky:boolean                      (tooltip segue o cursor)
  // }
  class GeoLayer {
    constructor(map, opts) {
      this.map = map;
      this.id = opts.id;
      this.sourceId = opts.id + '-src';
      this.type = opts.type || 'point';
      this.styleFn = opts.styleFn || (() => ({}));
      this.radiusFn = opts.radiusFn || null;
      this.tooltipFn = opts.tooltipFn || null;
      this.onClickFn = opts.onClick || null;
      this.hover = !!opts.hover;
      this.tooltipClass = opts.tooltipClass || 'district-nyt-tooltip';
      this.sticky = opts.sticky !== false;
      this.fc = { type: 'FeatureCollection', features: [] };
      this.layerIds = [];
      this.__added = false;
      this._eventsWired = false;
      this._handlers = [];
      this._popup = null;
      this._popupOpen = false;
      this._popupHtml = null;
      this._hoveredId = null;
      this.extrusionEnabled = false;
      this._rawFeatures = [];
    }

    setFeatures(features) {
      this._rawFeatures = features || [];
      this.fc = { type: 'FeatureCollection', features: features || [] };
      this._computeProps();
      return this;
    }

    _computeProps() {
      const isPoint = this.type === 'point';
      
      this.fc.features.forEach((f, i) => {
        const p = f.properties || (f.properties = {});
        p.__id = i;
        const s = this.styleFn(f) || {};
        p.__fill = resolveCssColor(s.fillColor != null ? s.fillColor : '#888888');
        
        if (isPoint) {
          p.__opacity = s.fillOpacity != null ? s.fillOpacity : 0.8;
          p.__radius = this.radiusFn ? this.radiusFn(f) : (s.radius != null ? s.radius : 6);
        } else {
          p.__fillOpacity = s.fillOpacity != null ? s.fillOpacity : 0.7;
          p.__line = resolveCssColor(s.color != null ? s.color : '#ffffff');
          p.__weight = s.weight != null ? s.weight : 0.6;
          p.__lineOpacity = s.opacity != null ? s.opacity : 1;
          p.__height = s.height != null ? s.height : 0;
        }
      });
    }

    addTo(map) {
      this.map = map || this.map;
      const m = this.map;
      // __added precisa estar marcado ANTES de _doAdd, pois quando o style já
      // está carregado doAdd() roda de forma síncrona e _doAdd() aborta caso
      // __added ainda seja false (guarda contra remoção antes do load).
      this.__added = true;
      m.__geoLayers && m.__geoLayers.add(this);
      // whenStyleReady executa síncrono se o estilo já estiver carregado, ou
      // aguarda o próximo 'styledata' pronto — funciona após um setStyle (troca
      // de tema), ao contrário de once('load') que só dispara uma vez.
      whenStyleReady(m, () => this._doAdd());
      return this;
    }

    _doAdd() {
      if (!this.__added) return; // removido antes do style carregar
      this._addSourceAndLayers();
      if (!this._eventsWired) {
        this._wireEvents();
        this._eventsWired = true;
      }
    }

    // Re-adiciona source/layers após uma troca de estilo (setStyle), sem
    // re-vincular eventos: os listeners delegados sobrevivem ao setStyle.
    reattachToStyle() {
      if (!this.__added) return;
      this._computeProps();
      this._addSourceAndLayers();
    }

    _addSourceAndLayers() {
      const m = this.map;
      if (!m || m.getSource(this.sourceId)) return; // já adicionado
      m.addSource(this.sourceId, { type: 'geojson', data: this.fc, promoteId: '__id' });

      if (this.type === 'point') {
        const lid = this.id + '-circle';
        m.addLayer({
          id: lid, type: 'circle', source: this.sourceId,
          paint: {
            'circle-radius': ['coalesce', ['get', '__radius'], 6],
            'circle-color': ['coalesce', ['get', '__fill'], '#888888'],
            'circle-opacity': ['coalesce', ['get', '__opacity'], 0.8],
            'circle-stroke-width': 0
          }
        });
        this.layerIds = [lid];
      } else {
        const fid = this.id + '-fill';
        const fidPat = this.id + '-fill-pattern';
        const linid = this.id + '-line';
        const extid = this.id + '-extrusion';
        const extidPat = this.id + '-extrusion-pattern';

        m.addLayer({
          id: fid, type: 'fill', source: this.sourceId,
          filter: ['!', ['has', '__pattern']],
          layout: {
            'visibility': this.extrusionEnabled ? 'none' : 'visible'
          },
          paint: {
            'fill-color': ['coalesce', ['get', '__fill'], '#888888'],
            'fill-opacity': ['coalesce', ['get', '__fillOpacity'], 0.7]
          }
        });
        m.addLayer({
          id: fidPat, type: 'fill', source: this.sourceId,
          filter: ['has', '__pattern'],
          layout: {
            'visibility': this.extrusionEnabled ? 'none' : 'visible'
          },
          paint: {
            'fill-pattern': ['get', '__pattern'],
            'fill-opacity': ['coalesce', ['get', '__fillOpacity'], 0.7]
          }
        });
        m.addLayer({
          id: linid, type: 'line', source: this.sourceId,
          layout: {
            'visibility': this.extrusionEnabled ? 'none' : 'visible'
          },
          paint: {
            'line-color': this.hover
              ? ['case', ['boolean', ['feature-state', 'hover'], false],
                'rgba(255,255,255,0.96)', ['coalesce', ['get', '__line'], '#ffffff']]
              : ['coalesce', ['get', '__line'], '#ffffff'],
            'line-width': this.hover
              ? ['max', ['coalesce', ['get', '__weight'], 0.6],
                ['case', ['boolean', ['feature-state', 'hover'], false], 1.4, 0]]
              : ['coalesce', ['get', '__weight'], 0.6],
            'line-opacity': ['coalesce', ['get', '__lineOpacity'], 1]
          }
        });
        m.addLayer({
          id: extid, type: 'fill-extrusion', source: this.sourceId,
          filter: ['!', ['has', '__pattern']],
          layout: {
            'visibility': this.extrusionEnabled ? 'visible' : 'none'
          },
          paint: {
            'fill-extrusion-color': ['coalesce', ['get', '__fill'], '#888888'],
            'fill-extrusion-height': ['coalesce', ['get', '__height'], 0],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.85
          }
        });
        m.addLayer({
          id: extidPat, type: 'fill-extrusion', source: this.sourceId,
          filter: ['has', '__pattern'],
          layout: {
            'visibility': this.extrusionEnabled ? 'visible' : 'none'
          },
          paint: {
            'fill-extrusion-pattern': ['get', '__pattern'],
            'fill-extrusion-height': ['coalesce', ['get', '__height'], 0],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.85
          }
        });
        this.layerIds = [fid, fidPat, linid, extid, extidPat];
      }
    }

    setExtrusionEnabled(enabled) {
      this.extrusionEnabled = !!enabled;
      const m = this.map;
      if (!m) return this;
      const fid = this.id + '-fill';
      const fidPat = this.id + '-fill-pattern';
      const linid = this.id + '-line';
      const extid = this.id + '-extrusion';
      const extidPat = this.id + '-extrusion-pattern';
      if (m.getLayer(fid) && m.getLayer(linid) && m.getLayer(extid)) {
        if (enabled) {
          m.setLayoutProperty(fid, 'visibility', 'none');
          if (m.getLayer(fidPat)) m.setLayoutProperty(fidPat, 'visibility', 'none');
          m.setLayoutProperty(linid, 'visibility', 'none');
          m.setLayoutProperty(extid, 'visibility', 'visible');
          if (m.getLayer(extidPat)) m.setLayoutProperty(extidPat, 'visibility', 'visible');
        } else {
          m.setLayoutProperty(fid, 'visibility', 'visible');
          if (m.getLayer(fidPat)) m.setLayoutProperty(fidPat, 'visibility', 'visible');
          m.setLayoutProperty(linid, 'visibility', 'visible');
          m.setLayoutProperty(extid, 'visibility', 'none');
          if (m.getLayer(extidPat)) m.setLayoutProperty(extidPat, 'visibility', 'none');
        }
      }
      return this;
    }

    _interactiveLayerId() {
      return this.type === 'point' ? this.id + '-circle' : this.id + '-fill';
    }

    _ensurePopup() {
      if (this._popup) return this._popup;
      this._popup = new global.maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: this.tooltipClass,
        maxWidth: 'none'
      });
      return this._popup;
    }

    _closePopup() {
      if (this._popup && this._popupOpen) this._popup.remove();
      this._popupOpen = false;
      this._popupHtml = null;
    }

    // Resolve a feature ORIGINAL (geometria/props completas) a partir do __id,
    // pois o MapLibre entrega cópias possivelmente recortadas por tile.
    _resolveOriginal(feat) {
      const id = feat && feat.properties && feat.properties.__id;
      if (id != null && this.fc.features[id]) return this.fc.features[id];
      return feat;
    }

    _wireEvents() {
      const m = this.map;
      const layers = this.type === 'point' 
        ? [this.id + '-circle']
        : [this.id + '-fill', this.id + '-fill-pattern', this.id + '-extrusion', this.id + '-extrusion-pattern'];

      const onMove = (e) => {
        const raw = e.features && e.features[0];
        if (!raw) {
          m.getCanvas().style.cursor = '';
          return;
        }
        const feat = this._resolveOriginal(raw);
        
        let cursor = 'pointer';
        if (typeof window.isFeatureDisabled === 'function' && window.isFeatureDisabled(this.id, feat)) {
          cursor = '';
        }
        m.getCanvas().style.cursor = cursor;

        if (this.hover) {
          const fid = raw.id != null ? raw.id : (raw.properties && raw.properties.__id);
          if (this._hoveredId !== null && this._hoveredId !== fid) {
            m.setFeatureState({ source: this.sourceId, id: this._hoveredId }, { hover: false });
          }
          this._hoveredId = fid;
          if (fid != null) m.setFeatureState({ source: this.sourceId, id: fid }, { hover: true });
        }

        if (this.tooltipFn) {
          const html = this.tooltipFn(feat);
          if (html) {
            const popup = this._ensurePopup();
            popup.setLngLat(e.lngLat);
            if (html !== this._popupHtml) {
              popup.setHTML(html);
              this._popupHtml = html;
            }
            if (!this._popupOpen) {
              popup.addTo(m);
              this._popupOpen = true;
            }
          } else {
            this._closePopup();
          }
        }
      };

      const onLeave = () => {
        m.getCanvas().style.cursor = '';
        if (this.hover && this._hoveredId !== null) {
          m.setFeatureState({ source: this.sourceId, id: this._hoveredId }, { hover: false });
          this._hoveredId = null;
        }
        this._closePopup();
      };

      layers.forEach(lid => {
        m.on('mousemove', lid, onMove);
        m.on('mouseleave', lid, onLeave);
        this._handlers.push(['mousemove', lid, onMove], ['mouseleave', lid, onLeave]);

        if (this.onClickFn) {
          const onClick = (e) => {
            const raw = e.features && e.features[0];
            if (raw) this.onClickFn(this._resolveOriginal(raw), e);
          };
          m.on('click', lid, onClick);
          this._handlers.push(['click', lid, onClick]);
        }
      });
    }

    _flush() {
      const src = this.map.getSource(this.sourceId);
      if (src) src.setData(this.fc);
    }

    // --- API compatível com o uso herdado do Leaflet ---
    refresh() { this._computeProps(); this._flush(); return this; }
    setData(features) { this.setFeatures(features); this._flush(); return this; }
    setStyle(fn) { if (typeof fn === 'function') this.styleFn = fn; this.refresh(); return this; }
    resetStyle() { this.refresh(); return this; }
    off() { return this; }
    clearLayers() { return this; }

    eachLayer(cb) {
      let dirty = false;
      const markDirty = () => { dirty = true; };
      this.fc.features.forEach((f, i) => cb(this._pseudo(f, i, markDirty)));
      if (dirty) this._flush();
      return this;
    }

    _pseudo(feature, index, markDirty) {
      const self = this;
      const isPoint = self.type === 'point';
      return {
        feature,
        getLatLng() {
          const c = featureCenter(feature);
          return c ? { lat: c[1], lng: c[0] } : null;
        },
        getBounds() { return featureBounds(feature); },
        setStyle(s) {
          if (!s) return;
          const p = feature.properties || (feature.properties = {});
          if (s.fillColor != null) p.__fill = resolveCssColor(s.fillColor);
          if (s.pattern != null) p.__pattern = s.pattern;
          else delete p.__pattern;
          if (isPoint) {
            if (s.fillOpacity != null) p.__opacity = s.fillOpacity;
            if (s.radius != null) p.__radius = s.radius;
          } else {
            if (s.fillOpacity != null) p.__fillOpacity = s.fillOpacity;
            if (s.color != null) p.__line = resolveCssColor(s.color);
            if (s.weight != null) p.__weight = s.weight;
            if (s.opacity != null) p.__lineOpacity = s.opacity;
          }
          markDirty();
        },
        setRadius(r) {
          (feature.properties || (feature.properties = {})).__radius = r;
          markDirty();
        },
        getTooltip() { return self.tooltipFn ? {} : null; },
        setTooltipContent() { /* tooltips são dinâmicas (popup compartilhado) */ },
        openTooltip() {
          if (!self.tooltipFn) return;
          const c = featureCenter(feature);
          const html = self.tooltipFn(feature);
          if (c && html) {
            self._ensurePopup().setLngLat(c).setHTML(html).addTo(self.map);
            self._popupOpen = true;
            self._popupHtml = html;
          }
        },
        on() { /* eventos são tratados no nível da layer */ }
      };
    }

    getBounds() { return featureCollectionBounds(this.fc.features); }

    remove() {
      const m = this.map;
      this._handlers.forEach(([t, l, h]) => m.off(t, l, h));
      this._handlers = [];
      this._eventsWired = false;
      if (this._popup) { this._popup.remove(); this._popup = null; }
      this._popupOpen = false;
      this._popupHtml = null;
      this.layerIds.forEach((id) => { if (m.getLayer(id)) m.removeLayer(id); });
      if (m.getSource(this.sourceId)) m.removeSource(this.sourceId);
      this.layerIds = [];
      this.__added = false;
      this._hoveredId = null;
      m.__geoLayers && m.__geoLayers.delete(this);
    }
  }

  // ====== EXPORTS ======
  global.MLCompat = {
    refreshThemeColors,
    resolveCssColor,
    buildBasemapStyle,
    setBasemapTheme,
    whenStyleReady,
    featureBounds,
    featureCollectionBounds,
    featureCenter,
    fitMapToBounds,
    normalizePadding,
    augmentMap,
    GeoLayer
  };
})(typeof window !== 'undefined' ? window : this);
