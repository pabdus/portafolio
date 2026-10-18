/* Monitor de fallas con datos reales del Tennessee Eastman (lab/tep.html).
   Lee /data/tep/meta.json (configuración, límites y métricas que exportó tools/tep/export_tep.py con tfmfdd)
   y las series /data/tep/d00.json, idv01.json … idv21.json ({"t2":[960], "spe":[960]}, muestra 1 en el índice 0).
   Dibuja T² y SPE en canvas, muestra las métricas de meta.json y las recalcula desde las series con las
   reglas de tfmfdd.metrics.evaluate_run (alarma = estadístico > límite; racha de k alarmas; FDR < min_fdr = azar)
   para comprobar que coinciden. Sin dependencias; los colores salen de las variables CSS en cada dibujado. */
(function () {
  'use strict';
  var LAB = window.LAB;
  if (!LAB) return;

  var root = document.documentElement;
  var DATA = '/data/tep/';
  var STATS = ['t2', 'spe'];
  var METHODS = ['f', 'kde', 'empirico'];
  var MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
  var SPEED = 120;            // muestras por segundo al reproducir (960 muestras ≈ 8 s)
  var STEP = 160;             // muestras por paso con movimiento reducido (8 h)
  var DEFAULTS = { run: 4, stat: 'both', method: 'f', scale: 'lin' };

  var meta = null, byId = {}, cache = {}, pending = {}, checks = {}, geo = {};
  var st = { run: DEFAULTS.run, stat: DEFAULTS.stat, method: DEFAULTS.method, scale: DEFAULTS.scale,
             cursor: null, playing: false, hover: null, hoverIn: null };
  var verify = { done: 0, ok: 0, total: 0, bad: [], running: false, finished: false, error: null };
  var lastLang = null, raf = 0, lastTs = 0, sched = 0, liveTimer = 0;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function reduced() { return !!(mq && mq.matches); }
  function $(id) { return document.getElementById(id); }
  function es(lang) { return (lang || LAB.lang()) === 'es'; }
  function tr(a, b, lang) { return es(lang) ? a : b; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------------------------------------------------------------- formato de números */
  var nfc = {};
  function num(v, maxF, lang, minF) {          // minF: decimales fijos (tablas y límites, para que se alineen)
    var lg = lang || LAB.lang(), mx = maxF == null ? 2 : maxF, k = lg + ':' + mx + ':' + (minF || 0);
    if (!nfc[k]) nfc[k] = new Intl.NumberFormat(lg === 'es' ? 'es-CO' : 'en-US', { minimumFractionDigits: minF || 0, maximumFractionDigits: mx });
    return nfc[k].format(v);
  }
  function pctP(p, lang, fixed) { return num(p, 2, lang, fixed ? 2 : 0) + (es(lang) ? ' %' : '%'); }       // p ya en puntos porcentuales
  function pct(x, lang, fixed) { return x == null ? '—' : pctP(x * 100, lang, fixed); }
  function pctCount(c, n, fixed) { return pctP(c * 100 / n, null, fixed); }                 // exacto desde el conteo
  function limTxt(v) { return num(v, 2, null, 2); }                                         // límite con 2 decimales fijos
  function val(v) { return num(v, 6); }
  function clock(sample) {
    var m = sample * meta.config.sample_minutes, h = Math.floor(m / 60), mm = Math.round(m - h * 60);
    return h + ' h' + (mm ? ' ' + mm + ' min' : '');
  }
  function minutes(min) {
    return num(min, 0) + ' min' + (min >= 60 ? ' ≈ ' + num(min / 60, 1) + ' h' : '');
  }
  function samplesTxt(d) { return num(d, 0) + ' ' + (d === 1 ? tr('muestra', 'sample') : tr('muestras', 'samples')); }

  /* ---------------------------------------------------------------- nombres */
  function fault() { return byId[st.run]; }
  function fname(f) { return es() ? f.name_es : f.name_en; }
  function runTag(f) { return f.id === 0 ? 'd00' : 'IDV ' + f.id; }
  function statName(sk) { return sk === 't2' ? 'T²' : 'SPE'; }
  function methName(m) {
    return { f: tr('F / Box', 'F / Box'), kde: 'KDE', empirico: tr('Empírico', 'Empirical') }[m || st.method];
  }
  function limitName(m, sk) {
    var c = meta.config;
    if (m === 'f' && sk === 't2') return tr('F de fase II, paramétrico (n = ' + c.n_fit + ')', 'phase II F, parametric (n = ' + c.n_fit + ')');
    if (m === 'f') return tr('Box, con las ' + c.n_cal + ' filas reservadas', 'Box, from the ' + c.n_cal + ' held-out rows');
    if (m === 'kde') return tr('KDE, con las ' + c.n_cal + ' filas reservadas', 'KDE, from the ' + c.n_cal + ' held-out rows');
    return tr('percentil 99 de las ' + c.n_cal + ' filas reservadas', '99th percentile of the ' + c.n_cal + ' held-out rows');
  }
  function limitOf(sk, m) { return meta.limits[m || st.method][sk].value; }
  function metricsOf(f, sk, m) { return f.metrics[m || st.method][sk]; }
  function shownStats() { return st.stat === 'both' ? STATS : [st.stat]; }

  /* ---------------------------------------------------------------- métricas (como tfmfdd.metrics) */
  function rate(s, lim, a, b) {
    var c = 0;
    for (var i = a; i < b; i++) if (s[i] > lim) c++;
    return { r: c / (b - a), n: b - a, c: c };
  }
  function evaluate(s, lim, onset) {
    var cfg = meta.config, k = cfg.k_alarms, n = s.length, i, j, all;
    var r = { far: null, n_far: 0, fdr: null, n_fdr: 0, delay_samples: null, delay_minutes: null,
              first_alarm_sample: null, detected: false, detected_at_chance: false };
    if (onset == null) {                       // operación normal: FAR en la serie entera
      var w = rate(s, lim, 0, n), o = cfg.fault_onset_index;
      r.far = w.r; r.n_far = w.n;
      var a1 = rate(s, lim, 0, o), a2 = rate(s, lim, o, n);
      r.far_1_160 = a1.r; r.n_far_1_160 = a1.n; r.far_161_960 = a2.r; r.n_far_161_960 = a2.n;
      return r;
    }
    var pre = rate(s, lim, 0, onset), post = rate(s, lim, onset, n);
    r.far = pre.r; r.n_far = pre.n; r.fdr = post.r; r.n_fdr = post.n;
    for (i = onset; i + k <= n; i++) {
      all = true;
      for (j = 0; j < k; j++) if (!(s[i + j] > lim)) { all = false; break; }
      if (all) break;
    }
    if (i + k <= n) {
      var d = i - onset;
      r.detected = true; r.delay_samples = d; r.delay_minutes = d * cfg.sample_minutes; r.first_alarm_sample = onset + d + 1;
    }
    r.detected_at_chance = r.detected && r.fdr < cfg.min_fdr_at_chance;
    return r;
  }
  var FIELDS = ['far', 'n_far', 'fdr', 'n_fdr', 'delay_samples', 'delay_minutes', 'first_alarm_sample', 'detected', 'detected_at_chance'];
  var FIELDS_D00 = ['far_1_160', 'n_far_1_160', 'far_161_960', 'n_far_161_960'];
  function same(a, b) {
    if (a == null || b == null) return a == null && b == null;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-12;
    return a === b;
  }
  function checkRun(id) {
    if (checks[id] || !cache[id]) return checks[id];
    var d = cache[id], f = byId[id], out = {};
    METHODS.forEach(function (m) {
      out[m] = {};
      STATS.forEach(function (sk) {
        var calc = evaluate(d[sk], limitOf(sk, m), id === 0 ? null : meta.config.fault_onset_index);
        var ref = f.metrics[m][sk], diffs = [];
        (id === 0 ? FIELDS.concat(FIELDS_D00) : FIELDS).forEach(function (k) {
          if (!same(calc[k], ref[k])) diffs.push(k + ': ' + calc[k] + ' ≠ ' + ref[k]);
        });
        out[m][sk] = { ok: diffs.length === 0, diffs: diffs };
      });
    });
    checks[id] = out;
    return out;
  }

  /* ---------------------------------------------------------------- datos */
  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }
  function loadRun(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    if (pending[id]) return pending[id];
    var info = meta.series.files[String(id)], file = info && info.file;
    if (!file || !/^[a-z0-9_]+\.json$/.test(file)) return Promise.reject(new Error(tr('meta.json no trae la serie ', 'meta.json has no series for run ') + id));
    pending[id] = getJSON(DATA + file).then(function (d) {
      var n = meta.config.n_samples;
      if (!d || !Array.isArray(d.t2) || !Array.isArray(d.spe) || d.t2.length !== n || d.spe.length !== n) {
        throw new Error(file + ': ' + tr('formato inesperado', 'unexpected format'));
      }
      cache[id] = d; delete pending[id];
      return d;
    }, function (e) { delete pending[id]; throw e; });
    return pending[id];
  }

  /* ---------------------------------------------------------------- controles */
  function bindRadio(box, set, grid) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[role="radio"]');
      if (b && box.contains(b)) set(b.getAttribute('data-v'));
    });
    box.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(box.querySelectorAll('[role="radio"]'));
      var i = items.indexOf(document.activeElement), j;
      if (i < 0) return;
      if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = items.length - 1;
      else if (grid && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        j = vertical(items, i, e.key === 'ArrowDown' ? 1 : -1);
        // sin fila arriba o abajo (p. ej., todas en una fila en pantalla ancha): anterior o siguiente, como en un radiogroup normal
        if (j === i) j = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
      else return;
      e.preventDefault();
      items[j].focus();
      set(items[j].getAttribute('data-v'));
    });
  }
  function vertical(items, i, dir) {               // el botón de la fila de arriba o de abajo más cercano en x
    var a = items[i].getBoundingClientRect(), cx = a.left + a.width / 2, best = i, bdy = Infinity, bdx = Infinity;
    items.forEach(function (b, k) {
      var r = b.getBoundingClientRect(), dy = (r.top - a.top) * dir;
      if (dy < 4) return;
      var dx = Math.abs(r.left + r.width / 2 - cx);
      if (dy < bdy - 4 || (Math.abs(dy - bdy) <= 4 && dx < bdx)) { best = k; bdy = dy; bdx = dx; }
    });
    return best;
  }
  function syncRadio(box, v) {
    box.querySelectorAll('[role="radio"]').forEach(function (b) {
      var on = b.getAttribute('data-v') === String(v);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }

  function buildRuns() {
    var box = $('runs');
    box.textContent = '';
    meta.faults.forEach(function (f) {
      var b = el('button', 'run' + (f.id === 0 ? ' n0' : '') + (f.hard ? ' hard' : ''));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-v', String(f.id));
      box.appendChild(b);
    });
  }
  function labelRuns() {
    $('runs').querySelectorAll('.run').forEach(function (b) {
      var f = byId[+b.getAttribute('data-v')];
      b.textContent = f.id === 0 ? 'Normal' : String(f.id);
      var name = f.id === 0 ? tr('Operación normal (d00), sin falla', 'Normal operation (d00), no fault')
        : 'IDV ' + f.id + ': ' + fname(f) + (f.hard ? tr(' (casi indetectable)', ' (nearly undetectable)') : '');
      b.setAttribute('aria-label', name);
      b.title = name;
    });
  }

  function selectRun(id) {
    if (!byId[id]) return;
    var restart = st.playing;
    stopPlay();
    st.run = id; st.cursor = null; st.hover = null;
    renderAll(true);
    updateURL();
    loadRun(id).then(function () {
      if (st.run !== id) return;
      checkRun(id);
      renderStatBlocks();
      if (restart) startPlay(true); else drawAll();
    }, showLoadError);
  }
  function setStat(v) {
    if (v !== 't2' && v !== 'spe' && v !== 'both') return;
    st.stat = v; st.hover = null;
    if (!meta) { syncRadio($('stat-seg'), v); return; }   // antes de cargar: al menos el botón queda marcado
    renderControls(); renderStatBlocks(); drawAll(); renderTips(); updateURL();
  }
  function setMethod(v) {
    if (METHODS.indexOf(v) < 0) return;
    st.method = v;
    if (!meta) { syncRadio($('meth-seg'), v); return; }
    renderControls(); renderRunInfo(); renderStatBlocks(); renderTable(); renderLimits(); drawAll(); renderTips(); updateURL();
  }
  function setScale(v) {
    if (v !== 'lin' && v !== 'log') return;
    st.scale = v;
    if (!meta) { syncRadio($('scale-seg'), v); return; }
    renderControls(); drawAll(); renderTips(); updateURL();
  }

  function readURL() {
    var p;
    try { p = new URLSearchParams(location.search); } catch (e) { return; }
    var r = p.get('corrida') || p.get('idv');
    if (r != null && /^\d{1,2}$/.test(r)) st.run = +r;
    var s = p.get('est');
    if (s === 't2' || s === 'spe') st.stat = s; else if (s === 'ambos' || s === 'both') st.stat = 'both';
    var m = p.get('limite');
    if (METHODS.indexOf(m) >= 0) st.method = m;
    if (p.get('escala') === 'log') st.scale = 'log';
  }
  function updateURL() {
    if (!window.history || !history.replaceState) return;
    var q = [];
    if (st.run !== DEFAULTS.run) q.push('corrida=' + st.run);
    if (st.stat !== DEFAULTS.stat) q.push('est=' + (st.stat === 'both' ? 'ambos' : st.stat));
    if (st.method !== DEFAULTS.method) q.push('limite=' + st.method);
    if (st.scale !== DEFAULTS.scale) q.push('escala=' + st.scale);
    try { history.replaceState(null, '', location.pathname + (q.length ? '?' + q.join('&') : '') + location.hash); } catch (e) { /* sin historial */ }
  }

  /* ---------------------------------------------------------------- render: panel */
  function renderControls() {
    syncRadio($('runs'), st.run);
    syncRadio($('stat-seg'), st.stat);
    syncRadio($('meth-seg'), st.method);
    syncRadio($('scale-seg'), st.scale);
    var L = meta.limits[st.method];
    $('meth-note').textContent = es() ? L.label_es : L.label_en;
  }

  function renderRunInfo() {
    var f = fault(), box = $('run-info'), c = meta.config;
    box.textContent = '';
    var top = el('div', 'ri-top');
    top.appendChild(el('span', 'ri-id', runTag(f) + ' · ' + f.source_file));
    box.appendChild(top);
    box.appendChild(el('p', 'ri-name', fname(f)));
    box.appendChild(el('p', 'ri-desc', (es() ? f.desc_es : f.desc_en) + '.'));
    var chips = el('div', 'ri-chips');
    chips.appendChild(el('span', 'chip', f.id === 0 ? tr('Sin falla', 'No fault') : (es() ? f.type_es : f.type_en)));
    if (f.hard) chips.appendChild(el('span', 'chip hard', tr('Casi indetectable · se promedia aparte', 'Nearly undetectable · averaged separately')));
    if (f.id > 0) {
      chips.appendChild(el('span', 'note', f.id === 21
        ? tr('Descripción: Russell, Chiang y Braatz (2000)', 'Description: Russell, Chiang and Braatz (2000)')
        : tr('Descripción: Downs y Vogel (1993)', 'Description: Downs and Vogel (1993)')));
    }
    box.appendChild(chips);
    if (f.hard) {
      var s = meta.summary[st.method], below = s.t2.fdr_mean_3_9_15 < c.min_fdr_at_chance && s.spe.fdr_mean_3_9_15 < c.min_fdr_at_chance;
      box.appendChild(el('p', 'note ri-note', tr(
        'IDV 3, 9 y 15 casi no se distinguen de la operación normal: con ' + methName() + ', su FDR media es ' + pct(s.t2.fdr_mean_3_9_15) +
          ' en T² y ' + pct(s.spe.fdr_mean_3_9_15) + ' en SPE' + (below ? ', por debajo del ' + pct(c.min_fdr_at_chance) + ' que separa una detección del azar' : '') +
          '. tfmfdd los promedia aparte.',
        'IDV 3, 9 and 15 are barely distinguishable from normal operation: with ' + methName() + ', their mean FDR is ' + pct(s.t2.fdr_mean_3_9_15) +
          ' for T² and ' + pct(s.spe.fdr_mean_3_9_15) + ' for SPE' + (below ? ', below the ' + pct(c.min_fdr_at_chance) + ' that separates a detection from chance' : '') +
          '. tfmfdd averages them separately.')));
    }
  }

  function met(label, value, cls, note) {
    var d = el('div', 'met');
    d.appendChild(el('div', 'lbl', label));
    d.appendChild(el('div', 'read' + (cls ? ' ' + cls : ''), value));
    if (note) d.appendChild(el('div', 'note', note));
    return d;
  }
  function renderMets(sk) {
    var box = $('mets-' + sk), f = fault(), m = metricsOf(f, sk), c = meta.config, d00 = f.id === 0;
    box.textContent = '';
    var farC = Math.round(m.far * m.n_far), w = d00 ? c.far_window_d00 : c.far_window_faults;
    var farNote = tr(farC + ' de ' + m.n_far + ' muestras sanas (' + w[0] + '–' + w[1] + ')',
      farC + ' of ' + m.n_far + ' healthy samples (' + w[0] + '–' + w[1] + ')');
    if (d00) farNote += tr('. Por tramos: 1–160, ', '. By segment: 1–160, ') + pct(m.far_1_160) + '; 161–960, ' + pct(m.far_161_960);
    box.appendChild(met(tr('Falsas alarmas (FAR)', 'False alarms (FAR)'), pctCount(farC, m.n_far), '', farNote));

    var na = tr('no aplica: corrida sin falla', 'n/a: no fault in this run');
    if (d00) {
      box.appendChild(met(tr('Detección (FDR)', 'Detection (FDR)'), '—', 'muted', na));
      box.appendChild(met(tr('Retardo', 'Delay'), '—', 'muted', na));
    } else {
      var dc = Math.round(m.fdr * m.n_fdr), fw = c.fdr_window;
      var fdrNote = tr(dc + ' de ' + m.n_fdr + ' muestras con falla (' + fw[0] + '–' + fw[1] + ')',
        dc + ' of ' + m.n_fdr + ' faulty samples (' + fw[0] + '–' + fw[1] + ')');
      if (m.fdr < c.min_fdr_at_chance) fdrNote += tr('; bajo el ' + pct(c.min_fdr_at_chance) + ': nivel del azar', '; below ' + pct(c.min_fdr_at_chance) + ': chance level');
      box.appendChild(met(tr('Detección (FDR)', 'Detection (FDR)'), pctCount(dc, m.n_fdr), '', fdrNote));

      var k = c.k_alarms;
      if (m.detected && !m.detected_at_chance) {
        box.appendChild(met(tr('Retardo', 'Delay'), samplesTxt(m.delay_samples), 'good', minutes(m.delay_minutes) + ' · ' + (m.delay_samples === 0
          ? tr('la racha de ' + k + ' alarmas empieza en la ' + c.fault_first_sample, 'the run of ' + k + ' alarms starts at ' + c.fault_first_sample)
          : tr('racha de ' + k + ' alarmas desde la muestra ' + m.first_alarm_sample, 'run of ' + k + ' alarms from sample ' + m.first_alarm_sample))));
      } else if (m.detected) {
        box.appendChild(met(tr('Retardo', 'Delay'), tr('No detectada', 'Not detected'), 'txt', tr(
          'Alarmas al nivel del azar: la FDR (' + pctCount(dc, m.n_fdr) + ') queda bajo el ' + pct(c.min_fdr_at_chance) + '. La racha de ' + k + ' de la muestra ' + m.first_alarm_sample + ' no cuenta como detección.',
          'Alarms at chance level: the FDR (' + pctCount(dc, m.n_fdr) + ') is below ' + pct(c.min_fdr_at_chance) + '. The run of ' + k + ' at sample ' + m.first_alarm_sample + ' does not count as a detection.')));
      } else {
        box.appendChild(met(tr('Retardo', 'Delay'), tr('No detectada', 'Not detected'), 'txt',
          tr('ninguna racha de ' + k + ' alarmas seguidas en 161–960', 'no run of ' + k + ' consecutive alarms in 161–960')));
      }
    }
    box.appendChild(checkBadge(sk));
  }
  function checkBadge(sk) {
    var c = checks[st.run], b = el('div', 'chk');
    if (!c) { b.className = 'chk wait'; b.textContent = tr('recalculando en tu navegador…', 'recomputing in your browser…'); return b; }
    var r = c[st.method][sk];
    if (r.ok) {
      b.textContent = tr('coincide con tfmfdd ✓', 'matches tfmfdd ✓');
      b.title = tr('FAR, FDR y retardo recalculados en tu navegador desde las ' + meta.config.n_samples + ' muestras: iguales a los de meta.json (tfmfdd ' + meta.tfmfdd.version + ').',
        'FAR, FDR and delay recomputed in your browser from the ' + meta.config.n_samples + ' samples: identical to meta.json (tfmfdd ' + meta.tfmfdd.version + ').');
    } else {
      b.className = 'chk bad';
      b.textContent = tr('no coincide con tfmfdd ✗', 'does not match tfmfdd ✗');
      b.title = r.diffs.join('; ');
    }
    return b;
  }

  function renderStatBlocks() {
    var show = shownStats(), f = fault(), d = cache[st.run];
    $('sbs').classList.toggle('two', show.length === 2);
    STATS.forEach(function (sk) {
      $('sb-' + sk).hidden = show.indexOf(sk) < 0;
      var lim = limitOf(sk);
      $('lim-' + sk).textContent = tr('límite ', 'limit ') + limTxt(lim) + ' · ' + limitName(st.method, sk);
      renderMets(sk);
      var cv = $('cv-' + sk), label;
      if (!d) label = statName(sk) + ' · ' + tr('cargando…', 'loading…');
      else {
        var over = 0, s = d[sk];
        for (var i = 0; i < s.length; i++) if (s[i] > lim) over++;
        label = tr('Gráfico de ' + statName(sk) + ' para ' + runTag(f) + ' (' + fname(f) + '): ' + s.length + ' muestras, límite ' + limTxt(lim) +
          (f.id ? ', la falla entra en la muestra ' + meta.config.fault_first_sample : '') + '; ' + over + ' muestras superan el límite.',
          statName(sk) + ' chart for ' + runTag(f) + ' (' + fname(f) + '): ' + s.length + ' samples, limit ' + limTxt(lim) +
          (f.id ? ', the fault enters at sample ' + meta.config.fault_first_sample : '') + '; ' + over + ' samples exceed the limit.');
      }
      cv.setAttribute('aria-label', label);
    });
  }

  /* ---------------------------------------------------------------- gráficos */
  function niceStep(x) {
    var p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function yScale(sk, s, top, ph) {
    var lims = METHODS.map(function (m) { return limitOf(sk, m); });
    var Lref = Math.max.apply(null, lims), mx = -Infinity, mn = Infinity, i;
    for (i = 0; i < s.length; i++) { if (s[i] > mx) mx = s[i]; if (s[i] > 0 && s[i] < mn) mn = s[i]; }
    if (st.scale === 'log') {
      var lo = Math.pow(10, Math.floor(Math.log10(Math.min(mn, Lref)))), hi = Math.pow(10, Math.ceil(Math.log10(Math.max(mx, Lref) * 1.02)));
      var e0 = Math.round(Math.log10(lo)), e1 = Math.round(Math.log10(hi)), ticks = [];
      for (var e = e0; e <= e1; e++) {
        var p = Math.pow(10, e);
        ticks.push(p);
        if (e1 - e0 <= 2 && e < e1) ticks.push(2 * p, 5 * p);
      }
      ticks.sort(function (a, b) { return a - b; });
      var l0 = Math.log10(lo), span = Math.log10(hi) - l0;
      return { ticks: ticks, top: hi, clip: 0, y: function (v) { return top + ph * (1 - (Math.log10(Math.max(v, lo)) - l0) / span); } };
    }
    var want = Math.max(Lref * 1.5, Math.min(mx, Lref * 5) * 1.06), step = niceStep(want / 5), yTop = Math.ceil(want / step - 1e-9) * step, tk = [], clip = 0;
    for (var v = 0; v <= yTop + step / 1e6; v += step) tk.push(Math.round(v * 1e6) / 1e6);
    for (i = 0; i < s.length; i++) if (s[i] > yTop) clip++;
    return { ticks: tk, top: yTop, clip: clip, y: function (v) { return top + ph * (1 - Math.min(Math.max(v, 0), yTop) / yTop); } };
  }
  function colors() {
    var cs = getComputedStyle(root);
    function c(n, fb) { return (cs.getPropertyValue(n) || '').trim() || fb; }
    var C = { grid: c('--grid', 'rgba(255,255,255,.05)'), axis: c('--axis', '#76818c'), line2: c('--line2', 'rgba(255,255,255,.15)'),
             ink: c('--ink', '#eceef1'), ink2: c('--ink2', '#cbd1d7'), ink3: c('--ink3', '#8f99a3'), blue: c('--blue', '#86b8e8'),
             red: c('--red', '#ef7a62'), lime: c('--lime-ink', '#c3e65f'), s1: c('--s1', '#10141a') };
    // solo el tema claro define --tep-*: en oscuro quedan vacías y el gráfico se dibuja como siempre
    C.light = root.getAttribute('data-theme') === 'light';
    C.fault = c('--tep-fault', C.grid); C.lim = c('--tep-lim', C.ink2); C.halo = C.light ? c('--tep-halo', '') : '';
    C.line = c('--tep-line', C.blue);              // claro: serie más clara que los puntos rojos; oscuro: --blue
    return C;
  }
  function pill(ctx, text, x, y, align, col, bg) {   // texto con fondo para que se lea sobre la serie
    var w = ctx.measureText(text).width, px = align === 'right' ? x - w : x;
    ctx.fillStyle = bg; ctx.globalAlpha = 0.88;
    ctx.fillRect(px - 4, y - 8, w + 8, 16);
    ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.textAlign = 'left';
    ctx.fillText(text, px, y);
  }
  function chartFont(w) { return (w < 560 ? '10.5px ' : '11px ') + MONO; }
  function labelWidth(sk) {                      // ancho de la etiqueta más larga del eje y de ese estadístico
    var d = cache[st.run], cv = $('cv-' + sk);
    if (!d || !cv.clientWidth) return 0;
    var ctx = cv.getContext('2d'), w = 0;
    ctx.font = chartFont(cv.clientWidth);
    yScale(sk, d[sk], 0, 100).ticks.forEach(function (v) { w = Math.max(w, ctx.measureText(num(v, 2)).width); });
    return Math.ceil(w) + 12;
  }
  function drawAll() {
    if (!meta) return;
    var shown = STATS.filter(function (sk) { return !$('sb-' + sk).hidden; }), left = 0;
    shown.forEach(function (sk) { left = Math.max(left, labelWidth(sk)); });   // mismo margen: los ejes x quedan alineados
    shown.forEach(function (sk) { drawChart(sk, left); });
  }
  function drawChart(sk, left) {
    var cv = $('cv-' + sk), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var C = colors(), d = cache[st.run], narrow = w < 560;
    ctx.font = chartFont(w);
    ctx.textBaseline = 'middle';
    if (!d) {
      ctx.fillStyle = C.ink3; ctx.textAlign = 'left';
      ctx.fillText(tr('cargando la serie…', 'loading the series…'), 12, 22);
      setClip(sk, '');
      return;
    }
    var s = d[sk], n = s.length, lim = limitOf(sk), f = fault(), cfg = meta.config;
    var m = { l: Math.max(narrow ? 30 : 38, left || 0), r: narrow ? 8 : 14, t: 22, b: 24 };
    var pw = w - m.l - m.r, ph = h - m.t - m.b;
    var ys = yScale(sk, s, m.t, ph);
    geo[sk] = { l: m.l, t: m.t, pw: pw, ph: ph, n: n };
    var X = function (i) { return m.l + (i + 0.5) * pw / n; };
    var end = st.cursor == null ? n : clamp(Math.floor(st.cursor), 0, n);
    var onset = cfg.fault_onset_index, xf = m.l + onset * pw / n;

    // tramo con falla
    if (f.id) { ctx.fillStyle = C.fault; ctx.fillRect(xf, m.t, m.l + pw - xf, ph); }
    // cuadrícula y eje y
    ctx.lineWidth = 1;
    ys.ticks.forEach(function (v) {
      var y = Math.round(ys.y(v)) + 0.5;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
      ctx.fillStyle = C.axis; ctx.textAlign = 'right'; ctx.fillText(num(v, 2), m.l - 6, y);
    });
    ctx.strokeStyle = C.line2; ctx.beginPath(); ctx.moveTo(m.l, m.t + ph + 0.5); ctx.lineTo(m.l + pw, m.t + ph + 0.5); ctx.stroke();
    // eje x: cada 160 muestras (8 h)
    ctx.fillStyle = C.axis; ctx.textBaseline = 'top';
    for (var k = 160; k <= n; k += 160) {
      var xt = Math.round(m.l + k * pw / n) + 0.5;
      ctx.strokeStyle = C.line2; ctx.beginPath(); ctx.moveTo(xt, m.t + ph); ctx.lineTo(xt, m.t + ph + 4); ctx.stroke();
      ctx.textAlign = k === n ? 'right' : 'center';
      ctx.fillText(String(k), k === n ? m.l + pw : xt, m.t + ph + 7);
    }
    ctx.textBaseline = 'middle';
    // entrada de la falla
    if (f.id) {
      ctx.strokeStyle = C.ink3; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(Math.round(xf) + 0.5, m.t - 4); ctx.lineTo(Math.round(xf) + 0.5, m.t + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.ink2; ctx.textAlign = 'left';
      ctx.fillText(tr('falla → ', 'fault → ') + cfg.fault_first_sample, xf + 6, m.t - 10);
    }
    // serie
    var Y = function (v) { return ys.y(v); };
    ctx.strokeStyle = C.line; ctx.lineWidth = C.light ? (narrow ? 1.3 : 1.5) : (narrow ? 1.2 : 1.4); ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i < end; i++) { if (i) ctx.lineTo(X(i), Y(s[i])); else ctx.moveTo(X(i), Y(s[i])); }
    ctx.stroke();
    // límite
    var yl = Math.round(Y(lim)) + 0.5;
    ctx.strokeStyle = C.lim; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(m.l, yl); ctx.lineTo(m.l + pw, yl); ctx.stroke();
    ctx.setLineDash([]);
    // fuera de límite
    var r = narrow ? 1.7 : 2.2;
    if (C.light) {                                 // claro: punto de 2,5 px con halo suave; si ya forman una masa, más chicos y sin halo
      var nOut = 0;
      for (i = 0; i < end; i++) if (s[i] > lim) nOut++;
      r = nOut > 200 ? (narrow ? 1.3 : 1.5) : (narrow ? 2 : 2.5);   // 1,5 px, como el monitor de la portada
      if (C.halo && nOut && nOut <= 200) {
        ctx.fillStyle = C.halo; ctx.beginPath();
        for (i = 0; i < end; i++) if (s[i] > lim) { var hx = X(i), hy = Y(s[i]); ctx.moveTo(hx + r + 2.5, hy); ctx.arc(hx, hy, r + 2.5, 0, 2 * Math.PI); }
        ctx.fill();
      }
    }
    ctx.fillStyle = C.red; ctx.beginPath();
    for (i = 0; i < end; i++) if (s[i] > lim) { var px = X(i), py = Y(s[i]); ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, 2 * Math.PI); }
    ctx.fill();
    // etiqueta del límite
    var ly = yl - 11 < m.t + 4 ? yl + 11 : yl - 11;
    pill(ctx, tr('límite ', 'limit ') + limTxt(lim), m.l + pw - 4, ly, 'right', C.ink2, C.s1);
    // alarma confirmada (solo si no es una racha al azar)
    var mt = metricsOf(f, sk);
    if (f.id && mt.detected && !mt.detected_at_chance && end >= mt.first_alarm_sample + cfg.k_alarms - 1) {
      var xd = Math.round(X(mt.first_alarm_sample - 1)) + 0.5;
      ctx.strokeStyle = C.lime; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xd, m.t); ctx.lineTo(xd, m.t + ph); ctx.stroke();
      var txt = tr('alarma confirmada · ', 'confirmed alarm · ') + mt.first_alarm_sample, tw = ctx.measureText(txt).width;
      var right = xd + 8 + tw + 4 <= m.l + pw;
      pill(ctx, txt, right ? xd + 8 : xd - 8, m.t + ph - 12, right ? 'left' : 'right', C.ink, C.s1);
    }
    // avance de la reproducción
    if (st.cursor != null && end < n) {
      var xc = Math.round(m.l + end * pw / n) + 0.5;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xc, m.t); ctx.lineTo(xc, m.t + ph); ctx.stroke();
    }
    // cursor de lectura
    if (st.hover != null && st.hover < end) {
      var xh = Math.round(X(st.hover)) + 0.5, vh = s[st.hover];
      ctx.strokeStyle = C.ink3; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xh, m.t); ctx.lineTo(xh, m.t + ph); ctx.stroke();
      ctx.beginPath(); ctx.arc(xh, Y(vh), 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = vh > lim ? C.red : C.line; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.s1; ctx.stroke();
    }
    setClip(sk, ys.clip ? tr('Eje recortado en ' + num(ys.top, 2) + ': ' + ys.clip + ' de ' + n + ' muestras quedan por encima y se dibujan en el borde superior. La escala log las muestra todas.',
      'Axis clipped at ' + num(ys.top, 2) + ': ' + ys.clip + ' of ' + n + ' samples are above it and are drawn at the top edge. The log scale shows them all.')
      : st.scale === 'log' ? tr('Escala logarítmica.', 'Logarithmic scale.') : '');
  }
  function setClip(sk, text) { var p = $('clip-' + sk); if (p.textContent !== text) p.textContent = text; }
  function schedDraw() {
    if (sched) return;
    sched = requestAnimationFrame(function () { sched = 0; drawAll(); renderTips(); });
  }

  /* ---------------------------------------------------------------- lectura con puntero y teclado */
  function maxIndex() {
    var n = meta.config.n_samples;
    return (st.cursor == null ? n : Math.max(1, Math.floor(st.cursor))) - 1;
  }
  function setHover(i, sk) {
    st.hover = i; st.hoverIn = sk;
    drawAll(); renderTips();
  }
  function clearHover() {
    if (st.hover == null) return;
    st.hover = null; st.hoverIn = null;
    drawAll(); renderTips();
  }
  function hoverFromEvent(sk, e) {
    var g = geo[sk];
    if (!g || !cache[st.run] || st.playing) return;
    var x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (x < g.l - 8 || x > g.l + g.pw + 8) { clearHover(); return; }
    var i = clamp(Math.floor((x - g.l) / g.pw * g.n), 0, maxIndex());
    if (i !== st.hover || st.hoverIn !== sk) setHover(i, sk);
  }
  function bindCanvas(sk) {
    var cv = $('cv-' + sk);
    cv.addEventListener('pointermove', function (e) { hoverFromEvent(sk, e); });
    cv.addEventListener('pointerdown', function (e) { hoverFromEvent(sk, e); });
    cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && document.activeElement !== cv) clearHover(); });
    function startIndex() { return Math.min(fault().id ? meta.config.fault_onset_index : 0, maxIndex()); }
    cv.addEventListener('focus', function () {
      if (!meta || !cache[st.run] || st.playing) return;
      setHover(st.hover != null ? Math.min(st.hover, maxIndex()) : startIndex(), sk);
    });
    cv.addEventListener('blur', clearHover);
    cv.addEventListener('keydown', function (e) {
      // sin lectura activa (el foco llegó durante la reproducción o antes de cargar la serie): empieza donde lo haría al enfocar
      if (!meta || !cache[st.run] || st.playing) return;
      var i = st.hover != null ? st.hover : startIndex(), mx = maxIndex(), big = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowRight') i += big;
      else if (e.key === 'ArrowLeft') i -= big;
      else if (e.key === 'PageDown') i += 80;
      else if (e.key === 'PageUp') i -= 80;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = mx;
      else if (e.key === 'Escape') { cv.blur(); return; }
      else return;
      e.preventDefault();
      setHover(clamp(i, 0, mx), sk);
      clearTimeout(liveTimer);
      liveTimer = setTimeout(function () { announce(liveText()); }, 250);
    });
  }
  function readout(i) {
    var d = cache[st.run], f = fault(), smp = i + 1, rows = [];
    shownStats().forEach(function (sk) {
      var v = d[sk][i], lim = limitOf(sk);
      rows.push({ sk: sk, v: v, lim: lim, over: v > lim });
    });
    var head = tr('muestra ', 'sample ') + smp + ' · ' + clock(smp);
    if (f.id) head += smp >= meta.config.fault_first_sample ? tr(' · con falla', ' · faulty') : tr(' · antes de la falla', ' · before the fault');
    return { head: head, rows: rows };
  }
  function liveText() {
    if (st.hover == null) return '';
    var r = readout(st.hover);
    return r.head + '. ' + r.rows.map(function (x) {
      return statName(x.sk) + ' ' + val(x.v) + ', ' + (x.over ? tr('alarma', 'alarm') : tr('sin alarma', 'no alarm'));
    }).join('; ') + '.';
  }
  function renderTips() {
    STATS.forEach(function (sk) {
      var tip = $('tip-' + sk);
      if (!meta || st.hover == null || st.hoverIn !== sk || $('sb-' + sk).hidden || !cache[st.run] || !geo[sk]) { tip.hidden = true; return; }
      var r = readout(st.hover);
      tip.textContent = '';
      tip.appendChild(el('div', 't-h', r.head));
      r.rows.forEach(function (x) {
        var row = el('div', 't-r');
        row.appendChild(document.createElement('i'));
        row.appendChild(el('b', '', val(x.v)));
        row.appendChild(el('span', '', statName(x.sk)));
        tip.appendChild(row);
        tip.appendChild(el('div', x.over ? 't-o' : '', (x.over ? tr('alarma: supera el límite ', 'alarm: above the limit ') : tr('sin alarma: límite ', 'no alarm: limit ')) + limTxt(x.lim)));
      });
      tip.hidden = false;
      var g = geo[sk], x = g.l + (st.hover + 0.5) * g.pw / g.n, wrapW = $('wrap-' + sk).clientWidth, tw = tip.offsetWidth;
      var left = x + 14 + tw <= wrapW ? x + 14 : x - 14 - tw;
      tip.style.left = Math.round(clamp(left, 0, Math.max(0, wrapW - tw))) + 'px';
    });
  }
  function announce(text) { var p = $('cv-live'); if (p) p.textContent = text; }

  /* ---------------------------------------------------------------- reproducción */
  function startPlay(fromStart) {
    if (!cache[st.run]) return;
    var n = meta.config.n_samples;
    if (fromStart || st.cursor == null || st.cursor >= n) st.cursor = 0;
    st.playing = true; st.hover = null; lastTs = 0;
    renderTips();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    renderPlay();
  }
  function stopPlay() { st.playing = false; cancelAnimationFrame(raf); }
  function tick(ts) {
    if (!st.playing) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    st.cursor += dt * SPEED;
    if (st.cursor >= meta.config.n_samples) {
      st.cursor = null; st.playing = false;
      drawAll(); renderPlay();
      var n = meta.config.n_samples;
      announce(tr('Reproducción terminada: las ' + n + ' muestras.', 'Playback finished: all ' + n + ' samples.'));
      return;
    }
    drawAll(); renderPlayPos();
    raf = requestAnimationFrame(tick);
  }
  function onPlay() {
    if (!meta || !cache[st.run]) return;
    var n = meta.config.n_samples;
    if (reduced()) {                            // sin animación: avanza de 8 h en 8 h
      stopPlay();
      var next = st.cursor == null || st.cursor >= n ? STEP : Math.floor(st.cursor) + STEP;
      st.cursor = next >= n ? null : next;
      st.hover = null;
      drawAll(); renderTips(); renderPlay();
      announce(st.cursor == null ? tr('Serie completa.', 'Full series.') : $('play-pos').textContent);
      return;
    }
    if (st.playing) { stopPlay(); renderPlay(); announce($('play-pos').textContent); }
    else startPlay(false);
  }
  function renderPlay() {
    if (!meta) return;
    var txt = reduced() ? tr('Avanzar 8 h', 'Advance 8 h')
      : st.playing ? tr('Pausa', 'Pause') : st.cursor != null ? tr('Continuar', 'Resume') : tr('Reproducir', 'Play');
    $('play-txt').textContent = txt;
    $('play-ic').textContent = st.playing ? '❚❚' : '▸';
    $('all-btn').hidden = st.cursor == null;
    renderPlayPos();
  }
  function renderPlayPos() {
    var p = $('play-pos'), n = meta.config.n_samples;
    if (st.cursor == null) { p.textContent = ''; return; }
    var c = clamp(Math.floor(st.cursor), 0, n);
    p.textContent = tr('muestra ', 'sample ') + c + ' / ' + n + (c ? ' · ' + clock(c) : '');
  }
  function onMotion() {
    if (reduced() && st.playing) stopPlay();
    renderPlay(); drawAll();
  }

  /* ---------------------------------------------------------------- tabla resumen */
  function delayCell(m) {
    if (m.detected && !m.detected_at_chance) {
      return { text: num(m.delay_samples, 0) + ' · ' + num(m.delay_minutes, 0) + ' min', cls: '',
               title: samplesTxt(m.delay_samples) + ' (' + minutes(m.delay_minutes) + ')' };
    }
    if (m.detected) {
      return { text: tr('no detectada (azar)', 'not detected (chance)'), cls: 'nd',
               title: tr('Alarmas al nivel del azar: hay una racha en la muestra ' + m.first_alarm_sample + ', pero la FDR queda bajo el ' + pct(meta.config.min_fdr_at_chance),
                 'Alarms at chance level: there is a run at sample ' + m.first_alarm_sample + ', but the FDR is below ' + pct(meta.config.min_fdr_at_chance)) };
    }
    return { text: tr('no detectada', 'not detected'), cls: 'nd', title: '' };
  }
  function td(text, cls, title) {
    var c = el('td', cls || '', text);
    if (title) c.title = title;
    return c;
  }
  function faultRow(f) {
    var row = el('tr', (f.hard ? 'hard' : '') + (f.id === st.run ? ' sel' : ''));
    row.setAttribute('data-run', String(f.id));
    var th = el('th');
    th.scope = 'row';
    var b = el('button', 'rowbtn', 'IDV ' + f.id);
    b.type = 'button';
    b.setAttribute('aria-label', tr('Ver IDV ' + f.id + ' en el gráfico', 'Show IDV ' + f.id + ' in the chart') + (f.hard ? tr(' (casi indetectable)', ' (nearly undetectable)') : ''));
    if (f.id === st.run) b.setAttribute('aria-current', 'true');
    th.appendChild(b);
    row.appendChild(th);
    var nm = td(fname(f), 'name');
    // IDV 16–20: nombre y tipo dicen lo mismo («Desconocida» / «Desconocido»); basta una vez
    if (f.type !== 'unknown') nm.appendChild(el('span', 'type', es() ? f.type_es : f.type_en));
    row.appendChild(nm);
    STATS.forEach(function (sk) {
      var m = metricsOf(f, sk), c = Math.round(m.fdr * m.n_fdr), dc = delayCell(m);
      row.appendChild(td(pctCount(c, m.n_fdr, true), 'g1' + (m.fdr < meta.config.min_fdr_at_chance ? ' low' : ''), c + ' / ' + m.n_fdr));
      row.appendChild(td(dc.text, dc.cls, dc.title));
    });
    return row;
  }
  function footRow(label, fdrKey, withDelay) {
    var row = el('tr'), th = el('th', '', label), s = meta.summary[st.method];
    th.scope = 'row'; th.colSpan = 2;
    row.appendChild(th);
    STATS.forEach(function (sk) {
      var x = s[sk];
      row.appendChild(td(pct(x[fdrKey], null, true), 'g1'));
      row.appendChild(withDelay
        ? td(tr('mediana ', 'median ') + num(x.delay_median_samples_valid, 1) + ' · n = ' + x.delay_median_samples_valid_n, '',
          tr('Mediana del retardo, en muestras, entre las fallas con detección válida (sin rachas al azar)', 'Median delay, in samples, over the faults with a valid detection (no chance runs)'))
        : td('—', 'nd'));
    });
    return row;
  }
  function renderTable() {
    var body = $('sum-body'), hard = $('sum-hard'), foot = $('sum-foot'), s = meta.summary[st.method], hf = meta.hard_faults;
    body.textContent = ''; hard.textContent = ''; foot.textContent = '';
    var g = el('tr', 'grp'), gh = el('th', '', tr('IDV ' + hf.join(', ').replace(/, (\d+)$/, ' y $1') + ': casi indetectables; tfmfdd los promedia aparte',
      'IDV ' + hf.join(', ').replace(/, (\d+)$/, ' and $1') + ': nearly undetectable; tfmfdd averages them separately'));
    gh.colSpan = 6; gh.scope = 'rowgroup';
    g.appendChild(gh);
    hard.appendChild(g);
    meta.faults.forEach(function (f) { if (f.id) (f.hard ? hard : body).appendChild(faultRow(f)); });
    var list = hf.join(', ').replace(/, (\d+)$/, tr(' y $1', ' and $1'));
    foot.appendChild(footRow(tr('Media 1–21', 'Mean 1–21'), 'fdr_mean_1_21', true));
    foot.appendChild(footRow(tr('Media sin ', 'Mean without ') + list, 'fdr_mean_without_3_9_15', false));
    foot.appendChild(footRow(tr('Media de ', 'Mean of ') + list, 'fdr_mean_3_9_15', false));
    $('sum-cap').textContent = tr('FDR y retardo por falla con el límite ' + methName(), 'FDR and delay by fault with the ' + methName() + ' limit');
    $('sum-intro').textContent = tr(
      'FDR y retardo de cada falla con el límite ' + methName() + ' (cámbialo arriba); el retardo va en muestras y en minutos. Haz clic en una fila para verla en el gráfico. «No detectada (azar)» marca las fallas con una racha de ' + meta.config.k_alarms + ' alarmas pero FDR bajo el ' + pct(meta.config.min_fdr_at_chance) + '.',
      'FDR and delay for each fault with the ' + methName() + ' limit (change it above); the delay is given in samples and minutes. Click a row to see it in the chart. “Not detected (chance)” marks faults with a run of ' + meta.config.k_alarms + ' alarms but an FDR below ' + pct(meta.config.min_fdr_at_chance) + '.');
    $('sum-far').textContent = tr(
      'FAR en operación normal (d00, muestras 1–960): T² ' + pct(s.t2.far_d00) + ', SPE ' + pct(s.spe.far_d00) + '. FAR media antes de la falla (muestras 1–160 de IDV 1–21): T² ' + pct(s.t2.far_prefault_mean_1_21) + ', SPE ' + pct(s.spe.far_prefault_mean_1_21) + '.',
      'FAR in normal operation (d00, samples 1–960): T² ' + pct(s.t2.far_d00) + ', SPE ' + pct(s.spe.far_d00) + '. Mean FAR before the fault (samples 1–160 of IDV 1–21): T² ' + pct(s.t2.far_prefault_mean_1_21) + ', SPE ' + pct(s.spe.far_prefault_mean_1_21) + '.');
  }
  function onTableClick(e) {
    var row = e.target.closest('tr[data-run]');
    if (!row || !meta) return;
    var id = +row.getAttribute('data-run'), keyboard = e.detail === 0;
    selectRun(id);
    $('panel').scrollIntoView({ block: 'start' });   // salto directo: el gráfico queda a la vista sin animación
    if (keyboard) {
      var b = $('runs').querySelector('[aria-checked="true"]');
      if (b) b.focus({ preventScroll: true });
    }
  }

  /* ---------------------------------------------------------------- textos que dependen de meta.json */
  function renderLimits() {
    var body = $('lim-body');
    body.textContent = '';
    METHODS.forEach(function (m) {
      var row = el('tr', m === st.method ? 'sel' : ''), th = el('th', '', m === 'f' ? 'F (T²) / Box (SPE)' : methName(m));
      th.scope = 'row';
      row.appendChild(th);
      row.appendChild(td(num(limitOf('t2', m), 4)));
      row.appendChild(td(num(limitOf('spe', m), 4)));
      body.appendChild(row);
    });
  }
  function renderTexts() {
    var c = meta.config;
    var vals = {
      n_vars: function (lg) { return num(c.n_vars, 0, lg); },
      sample_minutes: function (lg) { return num(c.sample_minutes, 2, lg); },
      n_samples: function (lg) { return num(c.n_samples, 0, lg); },
      fault_first_sample: function () { return String(c.fault_first_sample); },
      n_components: function (lg) { return num(c.n_components, 0, lg); },
      variance_explained: function (lg) { return pct(c.variance_explained, lg); },
      n_fit: function (lg) { return num(c.n_fit, 0, lg); },
      n_cal: function (lg) { return num(c.n_cal, 0, lg); },
      k_alarms: function (lg) { return num(c.k_alarms, 0, lg); },
      min_fdr: function (lg) { return pct(c.min_fdr_at_chance, lg); },
      more_digits: function (lg) { return num(meta.series.values_with_more_digits, 0, lg); },
      tfmfdd_version: function () { return meta.tfmfdd.version; }
    };
    document.querySelectorAll('[data-m]').forEach(function (s) {
      var fn = vals[s.getAttribute('data-m')];
      if (!fn) return;
      var host = s.closest('[data-l]'), lg = host ? host.getAttribute('data-l') : LAB.lang();
      s.textContent = fn(lg);
    });
    var refs = $('refs');
    refs.textContent = '';
    (meta.dataset.references || []).forEach(function (r) {
      refs.appendChild(el('li', '', es() ? r : r.replace(/ y (?=[A-Z][a-z]+, [A-Z]\.)/g, ' and ')));
    });
    $('license').textContent = tr('Licencia de los datos: ', 'Data licence: ') + String(meta.dataset.license || '').split(';')[0] + '.';
    var s = meta.summary.f, v = meta.validation || {};
    $('a1-text').textContent = v.matches_A1_baseline
      ? tr('La exportación reproduce exactamente las cifras de A1: FAR en operación normal T² ' + pct(s.t2.far_d00) + ' y SPE ' + pct(s.spe.far_d00) +
          '; FDR media 1–21 T² ' + pct(s.t2.fdr_mean_1_21) + ' y SPE ' + pct(s.spe.fdr_mean_1_21) + '. KDE y Empírico usan el mismo modelo; solo cambia el límite.',
        'The export reproduces the A1 figures exactly: FAR in normal operation T² ' + pct(s.t2.far_d00) + ' and SPE ' + pct(s.spe.far_d00) +
          '; mean FDR 1–21 T² ' + pct(s.t2.fdr_mean_1_21) + ' and SPE ' + pct(s.spe.fdr_mean_1_21) + '. KDE and Empirical use the same model; only the limit changes.')
      : tr('Aviso: la exportación no coincide con A1 (', 'Warning: the export does not match A1 (') + (v.problems || []).join('; ') + ').';
    var day = String(meta.generated_utc || '').slice(0, 10);
    $('foot-data').textContent = tr('Datos: tfmfdd ' + meta.tfmfdd.version + ' · meta.json del ' + day, 'Data: tfmfdd ' + meta.tfmfdd.version + ' · meta.json of ' + day);
  }

  /* ---------------------------------------------------------------- comprobación de las 132 combinaciones */
  function renderVerify() {
    var p = $('verify');
    if (!meta) return;
    var combos = meta.faults.length + ' × ' + METHODS.length + ' × ' + STATS.length;
    p.classList.toggle('err', !!verify.error || verify.bad.length > 0);
    if (verify.error) {
      p.textContent = tr('No se pudo completar la comprobación en el navegador: ', 'The in-browser check could not finish: ') + verify.error;
    } else if (!verify.finished) {
      p.textContent = verify.total
        ? tr('Recalculando en tu navegador las ' + verify.total + ' combinaciones (' + combos + '): ' + verify.done + '/' + verify.total + '…',
          'Recomputing the ' + verify.total + ' combinations (' + combos + ') in your browser: ' + verify.done + '/' + verify.total + '…')
        : '';
    } else {
      p.textContent = tr('Tu navegador recalculó FAR, FDR y retardo desde las series para las ' + verify.total + ' combinaciones (' + meta.faults.length + ' corridas × ' + METHODS.length + ' límites × ' + STATS.length + ' estadísticos): ',
        'Your browser recomputed FAR, FDR and delay from the series for all ' + verify.total + ' combinations (' + meta.faults.length + ' runs × ' + METHODS.length + ' limits × ' + STATS.length + ' statistics): ') +
        verify.ok + '/' + verify.total + tr(' coinciden con tfmfdd', ' match tfmfdd') + (verify.bad.length ? tr('. Distintas: ', '. Different: ') + verify.bad.join(', ') : ' ✓');
    }
  }
  function verifyAll() {
    if (verify.running || verify.finished || !meta) return;
    verify.running = true;
    verify.total = meta.faults.length * METHODS.length * STATS.length;
    var ids = meta.faults.map(function (f) { return f.id; }), i = 0;
    (function next() {
      if (i >= ids.length) { verify.running = false; verify.finished = true; renderVerify(); return; }
      var id = ids[i++];
      loadRun(id).then(function () {
        var c = checkRun(id);
        METHODS.forEach(function (m) {
          STATS.forEach(function (sk) {
            verify.done++;
            if (c[m][sk].ok) verify.ok++; else verify.bad.push(runTag(byId[id]) + ' ' + m + ' ' + statName(sk));
          });
        });
        if (id === st.run) renderStatBlocks();
        renderVerify();
        setTimeout(next, 0);
      }, function (e) { verify.running = false; verify.error = String((e && e.message) || e); renderVerify(); });
    })();
  }

  /* ---------------------------------------------------------------- arranque */
  function renderAll() {
    if (!meta) return;
    labelRuns();
    renderControls();
    renderRunInfo();
    renderStatBlocks();
    renderTable();
    renderLimits();
    drawAll();
    renderTips();
    renderPlay();
    renderVerify();
  }
  function showLoadError(e) {
    if (window.console) console.error(e);
    var box = $('run-info');
    box.textContent = '';
    box.appendChild(el('p', 'err', tr('No se pudieron cargar los datos: ', 'Could not load the data: ') + String((e && e.message) || e)));
  }
  function setup(m) {
    if (!m || !Array.isArray(m.faults) || !m.limits || !m.config || !m.summary || !m.series) throw new Error('meta.json: ' + tr('formato inesperado', 'unexpected format'));
    meta = m;
    m.faults.forEach(function (f) { byId[f.id] = f; });
    if (!byId[st.run]) st.run = DEFAULTS.run;
    lastLang = LAB.lang();
    buildRuns();
    bindRadio($('runs'), function (v) { if (+v !== st.run) selectRun(+v); }, true);
    renderTexts();
    renderAll();
  }

  LAB.onLang(function (lang) {
    if (!meta) return;
    if (lang !== lastLang) { lastLang = lang; renderTexts(); renderAll(); }
    else { drawAll(); renderTips(); }          // cambio de tema: solo recolorear
  });

  function init() {
    readURL();
    bindRadio($('stat-seg'), setStat);
    bindRadio($('meth-seg'), setMethod);
    bindRadio($('scale-seg'), setScale);
    syncRadio($('stat-seg'), st.stat);
    syncRadio($('meth-seg'), st.method);
    syncRadio($('scale-seg'), st.scale);
    $('play-btn').addEventListener('click', onPlay);
    $('all-btn').addEventListener('click', function () { stopPlay(); st.cursor = null; drawAll(); renderPlay(); });
    $('sum-tbl').addEventListener('click', onTableClick);
    STATS.forEach(bindCanvas);
    document.addEventListener('pointerdown', function (e) { if (st.hover != null && !(e.target.closest && e.target.closest('canvas'))) clearHover(); });
    if (window.ResizeObserver) new ResizeObserver(schedDraw).observe($('sbs'));
    else window.addEventListener('resize', schedDraw);
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', onMotion); else if (mq.addListener) mq.addListener(onMotion); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedDraw);

    getJSON(DATA + 'meta.json')
      .then(function (m) { setup(m); return loadRun(st.run); })
      .then(function () { checkRun(st.run); renderStatBlocks(); drawAll(); setTimeout(verifyAll, 300); })
      .catch(showLoadError);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
