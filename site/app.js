/* Portafolio · Pablo Duque Marín — lógica del sitio (sin dependencias). El contenido vive en content.js. */
(function () {
  'use strict';
  var D = window.PD;
  var root = document.documentElement;
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var S = { lang: 'es', method: 'F', fault: false, filter: 'all', open: null, sel: 0, query: '' };
  var UCL = { F: 16.2, KDE: 14.7, EMP: 13.9 };
  var KIND = { pro: 'var(--lime)', inv: 'var(--blue)', pos: 'var(--violet)' };

  try { var saved = localStorage.getItem('pd-lang'); if (saved === 'es' || saved === 'en') S.lang = saved; else if (navigator.language && !/^es\b/i.test(navigator.language)) S.lang = 'en'; } catch (e) {}

  /* ---------- utilidades ---------- */
  function T() { return D.ui[S.lang]; }
  function L(x) {
    if (x == null) return '';
    if (typeof x === 'string') return x.indexOf('|') >= 0 ? x.split('|')[S.lang === 'en' ? 1 : 0] : x;
    if (Array.isArray(x)) return x;
    return x[S.lang];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function caseIndex(id) { for (var i = 0; i < D.cases.length; i++) if (D.cases[i].id === id) return i; return -1; }
  function dec(x, d) { var s = x.toFixed(d); return S.lang === 'es' ? s.replace('.', ',') : s; }
  // Transición de vista con salvaguarda: si el navegador no pinta (pestaña oculta o en segundo plano),
  // la transición espera un cuadro que no llega; tras 250 ms se aplica el cambio directo.
  function vt(fn) {
    if (!document.startViewTransition || RM || document.hidden) { fn(); return null; }
    var done = false;
    function run() { if (!done) { done = true; fn(); } }
    var tr = document.startViewTransition(run);
    setTimeout(function () { if (!done) { try { tr.skipTransition(); } catch (e) {} run(); } }, 250);
    return tr;
  }
  function toast(msg) { var el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 1800); }

  /* ---------- textos estáticos ---------- */
  function applyStatic() {
    var t = T();
    root.lang = S.lang;
    $$('[data-k]').forEach(function (el) { var v = t[el.getAttribute('data-k')]; if (v != null) el.textContent = v; });
    $$('[data-k-aria]').forEach(function (el) { var v = t[el.getAttribute('data-k-aria')]; if (v != null) el.setAttribute('aria-label', v); });
    $('#lead').innerHTML = t.lead.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    $$('[data-lang-opt]').forEach(function (el) { el.classList.toggle('on', el.getAttribute('data-lang-opt') === S.lang); });
    $('#updated').textContent = t.updated + ' ' + L(D.updated);
    document.title = S.lang === 'es' ? 'Pablo Duque Marín · Ingeniero de IA en AWS' : 'Pablo Duque Marín · AI engineer on AWS';
  }

  /* ---------- secciones ---------- */
  function renderHeroStats() {
    $('#hero-stats').innerHTML = D.heroStats.map(function (s) {
      return '<div class="hstat"><div class="hstat-v">' + esc(L(s.v)) + '</div><div class="hstat-l">' + esc(L(s.l)) + '</div></div>';
    }).join('');
  }
  function renderEvidence() {
    var t = T();
    $('#evidence-list').innerHTML = D.evidence.map(function (e) {
      return '<button class="ev" data-open="' + e.c + '" data-reveal><span class="ev-v">' + esc(L(e.v)) + '</span>' +
        '<span class="ev-r">' + esc(L(e.r)) + '</span><span class="ev-d">' + esc(L(e.d)) + '</span>' +
        '<span class="ev-go">' + esc(t.evOpen) + ' →</span></button>';
    }).join('');
  }
  function renderCases() {
    var t = T();
    $('#case-grid').innerHTML = D.cases.map(function (c, i) {
      var badge = c.status ? '<span class="badge">' + esc(c.status === 'building' ? t.building : t.ongoing) + '</span>' : '';
      return '<button class="card" data-case="' + i + '" data-reveal>' +
        '<span class="card-meta"><span>' + esc(L(c.kicker)) + '</span><span>' + String(i + 1).padStart(2, '0') + '</span></span>' +
        badge + '<span class="card-title">' + esc(L(c.title)) + '</span>' +
        '<span class="card-sum">' + esc(L(c.sum)) + '</span>' +
        '<span class="card-foot"><span><span class="card-mv">' + esc(L(c.mv)) + '</span><span class="card-ml">' + esc(L(c.ml)) + '</span></span>' +
        '<span class="card-go">' + esc(t.openCase) + ' →</span></span></button>';
    }).join('');
  }
  function renderSkills() {
    var t = T();
    var labels = { pro: t.fPro, inv: t.fInv, pos: t.fPos };
    var all = D.skills.map(function (s) { return { b: s[0], k: s[1], n: L(s[2]), e: L(s[3]) }; });
    $('#filters').innerHTML = [['all', t.fAll, 'var(--ink)'], ['pro', t.fPro, KIND.pro], ['inv', t.fInv, KIND.inv], ['pos', t.fPos, KIND.pos]].map(function (f) {
      var n = f[0] === 'all' ? all.length : all.filter(function (x) { return x.k === f[0]; }).length;
      return '<button class="chip' + (S.filter === f[0] ? ' on' : '') + '" aria-pressed="' + (S.filter === f[0]) + '" data-filter="' + f[0] + '"><i style="background:' + f[2] + '"></i>' + esc(f[1]) + '<small>' + n + '</small></button>';
    }).join('');
    var vis = all.filter(function (x) { return S.filter === 'all' || x.k === S.filter; });
    var blocks = [['ia', S.lang === 'es' ? 'Inteligencia artificial' : 'Artificial intelligence'], ['est', S.lang === 'es' ? 'Estadística avanzada' : 'Advanced statistics'], ['nube', S.lang === 'es' ? 'Nube e ingeniería' : 'Cloud and engineering']];
    $('#skill-blocks').innerHTML = blocks.map(function (b) {
      var items = vis.filter(function (x) { return x.b === b[0]; });
      if (!items.length) return '';
      return '<div class="sblock" data-reveal><div class="sblock-h"><h3>' + esc(b[1]) + '</h3><span>' + items.length + ' ' + esc(t.items) + '</span></div><div class="sgrid">' +
        items.map(function (s) {
          return '<div class="skill"><div class="skill-h"><span>' + esc(s.n) + '</span><em style="--k:' + KIND[s.k] + '">' + esc(labels[s.k].toUpperCase()) + '</em></div><div class="skill-e">' + esc(s.e) + '</div></div>';
        }).join('') + '</div></div>';
    }).join('');
    var lv = { pro: t.lvPro, inv: t.lvInv, pos: t.lvPos };
    $('#stack').innerHTML = D.stack.map(function (row) {
      return '<div class="srow"><div class="srow-h">' + esc(L(row[0])) + '</div><div class="srow-t">' + row[1].map(function (it) {
        return '<span class="tool" style="--k:' + KIND[it[1]] + '" title="' + esc(lv[it[1]]) + '"><i></i>' + esc(it[0]) + '</span>';
      }).join('') + '</div></div>';
    }).join('');
    $('#stack-legend').innerHTML = ['pro', 'inv', 'pos'].map(function (k) { return '<span style="--k:' + KIND[k] + '"><i></i>' + esc(lv[k]) + '</span>'; }).join('');
  }
  function renderRules() {
    $('#rules').innerHTML = D.rules.map(function (r, i) {
      var ci = caseIndex(r.c);
      return '<div class="rule" data-reveal><div class="rule-h"><span class="rule-n">' + ['i.', 'ii.', 'iii.', 'iv.'][i] + '</span><h3>' + esc(L(r.t)) + '</h3></div>' +
        '<div class="rule-b"><p>' + esc(L(r.e)) + '</p><button class="link" data-case-open="' + ci + '">' + esc(L(D.cases[ci].title)) + ' →</button></div></div>';
    }).join('');
  }
  function renderTimeline() {
    var t = T();
    $('#timeline').innerHTML = D.timeline.map(function (e) {
      var w = e[1] === 'w';
      return '<li data-reveal style="--k:' + (w ? 'var(--lime)' : 'var(--blue)') + '"><span class="tl-dot"></span><div class="tl-y">' + esc(L(e[0])) + '</div><div><div class="tl-h"><h3>' + esc(L(e[2])) + '</h3><em>' + esc(w ? t.kWork : t.kEdu) + '</em></div><div class="tl-o">' + esc(L(e[3])) + '</div></div></li>';
    }).join('');
  }
  function renderAll() {
    applyStatic(); renderHeroStats(); renderEvidence(); renderCases(); renderSkills(); renderRules(); renderTimeline();
    if (S.open != null) renderCase();
    if (!$('#summary').hidden) renderSummary();
    if (mon) paintStats(mon.stats());
  }

  /* ---------- monitor T² ---------- */
  function randn() { var u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function makeMonitor(canvas, o) {
    var ctx = canvas.getContext('2d'), W = o.window || 150;
    var st = { data: [], ic: [], fl: [], t: 0, fault: false, f0: -1, ucl: o.ucl || 16.2, target: o.ucl || 16.2, ymax: 34, last: 0, run: true, raf: 0 };
    function sample() { var k = st.fault ? Math.min(1, (st.t - st.f0 + 1) / 5) * 3.3 : 0, s = 0; for (var i = 0; i < 5; i++) { var z = randn() + (i < 2 ? k : 0); s += z * z; } return s; }
    function stats() {
      var u = st.target, far = st.ic.length ? st.ic.filter(function (v) { return v > u; }).length / st.ic.length : null, det = null, delay = null;
      if (st.fault && st.fl.length) { det = st.fl.filter(function (v) { return v > u; }).length / st.fl.length; var i = st.fl.findIndex(function (v) { return v > u; }); delay = i < 0 ? -1 : i + 1; }
      return { far: far, det: det, delay: delay, fault: st.fault };
    }
    function push() {
      if (o.auto) { var ph = st.t % 110; if (ph === 55 && !st.fault) { st.fault = true; st.f0 = st.t; } if (ph === 0 && st.fault) st.fault = false; }
      var v = sample(); st.data.push({ v: v, f: st.fault, inj: st.fault && st.t === st.f0 }); if (st.data.length > W) st.data.shift();
      if (st.fault) st.fl.push(v); else { st.ic.push(v); if (st.ic.length > 4000) st.ic.shift(); }
      st.t++; if (o.onStats) o.onStats(stats());
    }
    for (var i = 0; i < W; i++) push();
    function draw(now) {
      if (!st.run) return;
      if (!st.last) st.last = now;
      if (now - st.last >= o.interval) { st.last = now; push(); }
      var p = Math.min(1, (now - st.last) / o.interval), dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w) { st.raf = requestAnimationFrame(draw); return; }
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      st.ucl += (st.target - st.ucl) * 0.12;
      var vis = 0; st.data.forEach(function (d) { if (d.v > vis) vis = d.v; });
      st.ymax += (Math.max(st.ucl * 1.9, vis * 1.12) - st.ymax) * 0.05;
      var pad = { l: 40, r: 14, t: 16, b: 20 }, pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
      function X(i) { return pad.l + ((i - (RM ? 0 : p)) / (W - 2)) * pw; }
      function Y(v) { return pad.t + (1 - Math.min(v, st.ymax) / st.ymax) * ph; }
      ctx.font = '11px "IBM Plex Mono", monospace';
      var step = st.ymax > 60 ? 20 : 10;
      for (var g = 0; g <= st.ymax; g += step) { ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, Y(g)); ctx.lineTo(w - pad.r, Y(g)); ctx.stroke(); ctx.fillStyle = '#76818c'; ctx.fillText(String(g), 8, Y(g) + 4); }
      ctx.save(); ctx.beginPath(); ctx.rect(pad.l, 0, pw, h); ctx.clip();
      var s0 = -1;
      st.data.forEach(function (d, i) { if (d.f && s0 < 0) s0 = i; if ((!d.f || i === st.data.length - 1) && s0 >= 0) { ctx.fillStyle = 'rgba(195,230,95,.06)'; ctx.fillRect(X(s0), pad.t, X(i) - X(s0), ph); s0 = -1; } });
      st.data.forEach(function (d, i) { if (d.inj) { ctx.strokeStyle = 'rgba(195,230,95,.7)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(i), pad.t); ctx.lineTo(X(i), h - pad.b); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#c3e65f'; ctx.fillText(T().fault, X(i) + 5, pad.t + 12); } });
      var grd = ctx.createLinearGradient(0, pad.t, 0, h); grd.addColorStop(0, 'rgba(120,170,225,.22)'); grd.addColorStop(1, 'rgba(120,170,225,0)');
      ctx.beginPath(); st.data.forEach(function (d, i) { if (i) ctx.lineTo(X(i), Y(d.v)); else ctx.moveTo(X(i), Y(d.v)); });
      ctx.lineTo(X(st.data.length - 1), h - pad.b); ctx.lineTo(X(0), h - pad.b); ctx.closePath(); ctx.fillStyle = grd; ctx.fill();
      ctx.beginPath(); st.data.forEach(function (d, i) { if (i) ctx.lineTo(X(i), Y(d.v)); else ctx.moveTo(X(i), Y(d.v)); });
      ctx.strokeStyle = '#86b3e3'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
      ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(236,238,241,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(pad.l, Y(st.ucl)); ctx.lineTo(w - pad.r, Y(st.ucl)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(236,238,241,.85)';
      var lab = 'UCL 99 % · ' + (o.methodLabel ? o.methodLabel() : 'F') + ' · ' + dec(st.ucl, 1);
      ctx.fillText(lab, w - pad.r - ctx.measureText(lab).width - 4, Y(st.ucl) - 7);
      st.data.forEach(function (d, i) { if (d.v > st.ucl && X(i) >= pad.l) { ctx.fillStyle = 'rgba(195,230,95,.25)'; ctx.beginPath(); ctx.arc(X(i), Y(d.v), 6, 0, 7); ctx.fill(); ctx.fillStyle = '#c3e65f'; ctx.beginPath(); ctx.arc(X(i), Y(d.v), 3, 0, 7); ctx.fill(); } });
      var ld = st.data[st.data.length - 1]; ctx.fillStyle = '#eceef1'; ctx.beginPath(); ctx.arc(X(st.data.length - 1), Y(ld.v), 3.5, 0, 7); ctx.fill();
      st.raf = requestAnimationFrame(draw);
    }
    st.raf = requestAnimationFrame(draw);
    return {
      stop: function () { st.run = false; cancelAnimationFrame(st.raf); },
      setFault: function (f) { st.fault = f; if (f) { st.f0 = st.t; st.fl = []; } if (o.onStats) o.onStats(stats()); },
      setUcl: function (u) { st.target = u; if (o.onStats) o.onStats(stats()); },
      stats: stats
    };
  }
  var mon = null;
  function paintStats(s) {
    var t = T(); function pct(x) { return dec(x * 100, 1) + ' %'; }
    $('#m-far').textContent = s.far == null ? '—' : pct(s.far);
    $('#m-det').textContent = !s.fault ? '—' : pct(s.det);
    $('#m-delay').textContent = !s.fault ? '—' : s.delay < 0 ? '…' : s.delay + ' ' + (s.delay === 1 ? t.sample : t.samples);
    $('#m-delay-sub').textContent = !s.fault ? t.noFault + ' · ' + t.monScale : s.delay < 0 ? t.detecting : '= ' + (s.delay * 3) + ' min · ' + t.monScale;
  }
  function renderMonitorControls() {
    var t = T();
    var b = $('#fault-btn'); b.textContent = S.fault ? '↺ ' + t.reset : '⚡ ' + t.inject; b.classList.toggle('on', S.fault);
    $('#live-dot').classList.toggle('on', S.fault);
    $('#methods').innerHTML = [['F', 'F'], ['KDE', 'KDE'], ['EMP', t.emp]].map(function (m) {
      return '<button role="radio" aria-checked="' + (S.method === m[0]) + '" data-method="' + m[0] + '" class="' + (S.method === m[0] ? 'on' : '') + '">' + esc(m[1]) + '</button>';
    }).join('');
  }
  function startMonitor() {
    var c = $('#hero-canvas'); if (!c || mon) return;
    mon = makeMonitor(c, { interval: RM ? 420 : 230, onStats: paintStats, methodLabel: function () { return S.method === 'EMP' ? T().emp : S.method; } });
    mon.setUcl(UCL[S.method]);
  }

  /* ---------- visuales de cada caso ---------- */
  var VIZ = {
    soat: {
      html: function () {
        var es = S.lang === 'es';
        var n = function (k, a, b, wide) { return '<div class="node' + (wide ? ' wide' : '') + '" data-step="' + k + '"><b>' + a + '</b><small>' + b + '</small></div>'; };
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big" id="soat-clock">0 s</span><span class="mono-s">' + (es ? 'del documento al dictamen' : 'from document to ruling') + '</span></div><button class="ghost" data-act="soat">↻ ' + esc(T().replay) + '</button></div>' +
          '<div class="flow">' + n(0, es ? 'Subida' : 'Upload', 'PDF') + '<span class="arr" data-step="1">→</span>' + n(1, 'EventBridge', 'SQS · DynamoDB') + '<span class="arr" data-step="2">→</span>' +
          '<div class="branch">' + n(2, es ? 'Rama póliza' : 'Policy branch', 'Textract · ' + (es ? 'reglas' : 'rules')) + n(2, es ? 'Rama médica' : 'Medical branch', 'Claude · Bedrock Converse') + '</div>' +
          '<span class="arr" data-step="3">→</span>' + n(3, es ? 'Regla de nexo' : 'Link rule', es ? 'sin nexo → revisión humana' : 'no link → human review') +
          '<span class="arr" data-step="4">→</span>' + n(4, es ? 'Dictamen' : 'Ruling', '53 s') + '</div></div>';
      },
      init: function (el) {
        cancelAnimationFrame(VIZ.soat.raf);
        var t0 = performance.now(), dur = RM ? 1 : 4200, th = [0, 0.12, 0.35, 0.7, 0.92];
        function tick(now) {
          var p = Math.min(1, (now - t0) / dur), step = 0; th.forEach(function (v, i) { if (p >= v) step = i; });
          var c = $('#soat-clock', el); if (c) c.textContent = Math.round(p * 53) + ' s';
          $$('[data-step]', el).forEach(function (x) { var k = +x.getAttribute('data-step'); x.classList.toggle('lit', k <= step); x.classList.toggle('cur', k === step && p < 1); x.classList.toggle('done', p >= 1 && k === 4); });
          if (p < 1) VIZ.soat.raf = requestAnimationFrame(tick);
        }
        VIZ.soat.raf = requestAnimationFrame(tick);
      }
    },
    cotejo: {
      rows: function () {
        var es = S.lang === 'es';
        return [
          ['ok', es ? 'Cita 1 · Corte Constitucional' : 'Citation 1 · Constitutional Court', es ? 'Existe · ponente correcto · pasaje literal' : 'Exists · correct judge · verbatim passage'],
          ['bad', es ? 'Cita 2 · Corte Constitucional' : 'Citation 2 · Constitutional Court', es ? 'No existe en el índice de 29.474 sentencias' : 'Not in the 29,474-ruling index'],
          ['warn', es ? 'Cita 3 · Corte Constitucional' : 'Citation 3 · Constitutional Court', es ? 'Existe · pasaje alterado: se insertó «no»' : 'Exists · altered passage: “not” was inserted'],
          ['info', es ? 'Cita 4 · Corte Suprema' : 'Citation 4 · Supreme Court', es ? 'No encontrada en el buscador: se reporta así, nunca como «no existe»' : 'Not found by the search engine: reported as such, never “does not exist”']
        ];
      },
      html: function () {
        var es = S.lang === 'es';
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big">0 / 500</span><span class="mono-s">' + (es ? 'sentencias reales marcadas como inexistentes' : 'real rulings flagged as non-existent') + '</span></div><button class="ghost" data-act="cotejo">▶ ' + (es ? 'Verificar escrito' : 'Check brief') + '</button></div>' +
          '<div class="cites">' + VIZ.cotejo.rows().map(function (r, i) { return '<div class="cite" data-i="' + i + '" data-s="' + r[0] + '"><span>' + esc(r[1]) + '</span><span class="cite-st">' + (es ? 'en cola' : 'queued') + '</span></div>'; }).join('') + '</div>' +
          '<div class="viz-note">' + esc(T().schematic) + (es ? ' · citas ficticias; los resultados del caso son reales' : ' · fictitious citations; the case results are real') + '</div></div>';
      },
      init: function (el) {
        clearTimeout(VIZ.cotejo.t); var rows = VIZ.cotejo.rows(), i = 0;
        $$('.cite', el).forEach(function (c) { c.classList.remove('done'); $('.cite-st', c).textContent = S.lang === 'es' ? 'en cola' : 'queued'; });
        (function next() {
          var c = $('.cite[data-i="' + i + '"]', el); if (!c) return;
          $('.cite-st', c).textContent = S.lang === 'es' ? 'verificando…' : 'checking…';
          VIZ.cotejo.t = setTimeout(function () { c.classList.add('done'); $('.cite-st', c).textContent = rows[i][2]; i++; next(); }, RM ? 0 : 650);
        })();
      }
    },
    facturas: {
      html: function () {
        var es = S.lang === 'es', tab = VIZ.facturas.tab || 0;
        var tabs = '<div class="tabs" role="tablist">' + [es ? 'Campos exactos' : 'Exact fields', es ? 'Prueba de estrés' : 'Stress test'].map(function (l, i) { return '<button role="tab" aria-selected="' + (tab === i) + '" class="' + (tab === i ? 'on' : '') + '" data-tab="' + i + '">' + l + '</button>'; }).join('') + '</div>';
        var body;
        if (tab === 0) {
          body = [[es ? 'Reglas' : 'Rules', 67.1, 'var(--red)'], [es ? 'LLM local' : 'Local LLM', 100, 'var(--lime)'], [es ? 'Solo imagen' : 'Image only', 99.6, 'var(--blue)']].map(function (b) {
            return '<div class="hbar"><span>' + b[0] + '</span><div class="hbar-t"><div style="width:' + b[1] + '%;background:' + b[2] + '"></div></div><b>' + dec(b[1], 1) + ' %</b></div>';
          }).join('') + '<div class="viz-note">' + (es ? '20 facturas sintéticas · 240 campos · intervalos al 95 %: reglas 61–73 %, LLM local 98–100 %' : '20 synthetic invoices · 240 fields · 95% intervals: rules 61–73%, local LLM 98–100%') + '</div>';
        } else {
          var R = [[120, 99.6, 2], [85, 97.9, 6], [70, 90.0, 3], [55, 63.3, 0], [45, 37.9, 0], [38, 23.3, 0]];
          body = '<div class="stress"><div class="stress-h"><span>' + (es ? 'Resolución' : 'Resolution') + '</span><span>' + (es ? 'Campos exactos' : 'Exact fields') + '</span><span>' + (es ? 'Errores sin aviso' : 'Unflagged errors') + '</span></div>' +
            R.map(function (r) { return '<div class="stress-r' + (r[2] >= 5 ? ' hot' : '') + '"><span>' + r[0] + ' ppp</span><div class="hbar-t"><div style="width:' + r[1] + '%"></div></div><b>' + dec(r[1], 1) + ' %</b><em>' + r[2] + '</em></div>'; }).join('') + '</div>' +
            '<div class="viz-note">' + (es ? 'El riesgo está en la zona media: a 85 ppp pasaron 6 facturas con errores sin aviso; por debajo de 55 ppp todo se envía a revisión.' : 'The risk is in the middle: at 85 dpi, 6 invoices with errors passed unflagged; below 55 dpi everything goes to review.') + '</div>';
        }
        return '<div class="viz-pad">' + tabs + body + '</div>';
      },
      init: function () {}
    },
    tfm: {
      html: function () {
        var es = S.lang === 'es', ids = [1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21];
        return '<div><canvas id="tfm-canvas" class="mini"></canvas><div class="viz-pad tight"><div class="verify"><div class="verify-h"><span class="big">17 / 18</span><span class="mono-s">' + (es ? 'verificación ciega contra Yin (2012) · tolerancia |ΔFDR| ≤ 0,5 pp fijada antes' : 'blind check against Yin (2012) · tolerance |ΔFDR| ≤ 0.5 pp fixed in advance') + '</span></div>' +
          '<div class="faults">' + ids.map(function (i) { return '<span class="' + (i === 19 ? 'miss' : 'hit') + '" title="IDV ' + i + '">' + i + '</span>'; }).join('') + '</div>' +
          '<div class="viz-note">' + (es ? 'IDV 19: +1,00 pp, el doble de la tolerancia → veredicto «no verificado». El valor impreso en el artículo no coincide con su propia figura.' : 'IDV 19: +1.00 pp, twice the tolerance → verdict “not verified”. The value printed in the paper does not match its own figure.') + '</div></div></div></div>';
      },
      init: function (el) { if (VIZ.tfm.m) VIZ.tfm.m.stop(); var c = $('#tfm-canvas', el); if (c) VIZ.tfm.m = makeMonitor(c, { interval: RM ? 380 : 140, auto: true, window: 120, methodLabel: function () { return 'F'; } }); },
      stop: function () { if (VIZ.tfm.m) { VIZ.tfm.m.stop(); VIZ.tfm.m = null; } }
    },
    rgpd: {
      html: function () {
        var es = S.lang === 'es';
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big" id="rgpd-count">0</span><span class="mono-s">' + (es ? 'recursos Terraform' : 'Terraform resources') + '</span></div><button class="ghost" data-act="rgpd">↻ ' + esc(T().replay) + '</button></div>' +
          '<svg viewBox="0 0 600 210" class="arc" role="img" aria-label="us-east-1 → eu-central-1"><path d="M80 170 Q300 -30 520 170" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2" stroke-dasharray="4 6"></path>' +
          '<path id="rgpd-path" d="M80 170 Q300 -30 520 170" fill="none" stroke="#c3e65f" stroke-width="2.5" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"></path>' +
          '<circle id="rgpd-dot" cx="80" cy="170" r="6" fill="#c3e65f"></circle><circle cx="80" cy="170" r="9" fill="none" stroke="rgba(255,255,255,.5)"></circle><circle cx="520" cy="170" r="9" fill="none" stroke="#c3e65f"></circle>' +
          '<text x="80" y="200" text-anchor="middle" fill="#a9b1ba" font-family="IBM Plex Mono, monospace" font-size="13">us-east-1</text><text x="520" y="200" text-anchor="middle" fill="#eceef1" font-family="IBM Plex Mono, monospace" font-size="13">eu-central-1 · Frankfurt</text></svg>' +
          '<div id="rgpd-done" class="term">$ terraform plan → ' + (es ? 'sin diferencias' : 'no changes') + '</div></div>';
      },
      init: function (el) {
        cancelAnimationFrame(VIZ.rgpd.raf);
        var t0 = performance.now(), dur = RM ? 1 : 2600, done = $('#rgpd-done', el); done.style.opacity = 0;
        function tick(now) {
          var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3), path = $('#rgpd-path', el), dot = $('#rgpd-dot', el);
          if (path) { path.setAttribute('stroke-dashoffset', String(1 - e)); var Lp = path.getTotalLength(), pt = path.getPointAtLength(Lp * e); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); }
          var c = $('#rgpd-count', el); if (c) c.textContent = String(Math.round(131 * e));
          if (p < 1) VIZ.rgpd.raf = requestAnimationFrame(tick); else done.style.opacity = 1;
        }
        VIZ.rgpd.raf = requestAnimationFrame(tick);
      }
    },
    contable: {
      html: function () {
        var es = S.lang === 'es';
        var n = function (k, a, b, cls) { return '<div class="node ' + (cls || '') + '" data-step="' + k + '"><b>' + a + '</b><small>' + b + '</small></div>'; };
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big">0</span><span class="mono-s">' + (es ? 'cifras declarables calculadas por el LLM' : 'declarable figures calculated by the LLM') + '</span></div><button class="ghost" data-act="contable">▶ ' + (es ? 'Recorrer el flujo' : 'Walk the flow') + '</button></div>' +
          '<div class="flow">' + n(0, es ? 'Balance de prueba' : 'Trial balance', 'PUC') + '<span class="arr" data-step="1">→</span>' + n(1, es ? 'Motor de renta' : 'Tax engine', 'Python · Decimal · ' + (es ? 'redondeo a 1.000' : 'round to 1,000')) + '<span class="arr" data-step="2">→</span>' +
          n(2, es ? 'Borrador F-110 y 2516' : 'F-110 and 2516 draft', es ? 'cifras del motor' : 'engine figures') + '<span class="arr" data-step="3">→</span>' + n(3, es ? 'Aprobación humana' : 'Human approval', es ? 'obligatoria' : 'mandatory') + '</div>' +
          '<div class="side">' + n(2, es ? 'LLM + RAG normativo' : 'LLM + regulations RAG', es ? 'redacta y explica · nunca calcula' : 'drafts and explains · never calculates', 'llm') + n(3, es ? 'Bitácora de solo anexar' : 'Append-only audit log', 'IAM · ' + (es ? 'pruebas sobre Terraform' : 'tests on Terraform'), 'audit') + '</div>' +
          '<div class="viz-note">' + (es ? 'MVP en construcción · diseño: 27 historias de usuario, 20 decisiones, 11 diagramas' : 'MVP under construction · design: 27 user stories, 20 decisions, 11 diagrams') + '</div></div>';
      },
      init: function (el) {
        clearTimeout(VIZ.contable.t); var step = -1;
        (function next() { step++; $$('[data-step]', el).forEach(function (x) { var k = +x.getAttribute('data-step'); x.classList.toggle('lit', k <= step); x.classList.toggle('cur', k === step); }); if (step < 3) VIZ.contable.t = setTimeout(next, RM ? 0 : 700); })();
      }
    },
    ctgan: {
      html: function () {
        var es = S.lang === 'es', on = !!VIZ.ctgan.clip, bars = [4, 7, 10, 12, 11, 9, 6, 5, 6, 7, 6, 5, 4, 3, 2, 1], neg = 0;
        for (var i = 0; i < 7; i++) neg += bars[i];
        var max = on ? bars[7] + neg : 12;
        var hs = bars.map(function (v, i) { var h = on ? (i < 7 ? 0 : i === 7 ? v + neg : v) : v; return '<div style="height:' + (h / max * 100) + '%;background:' + (i < 7 ? 'var(--red)' : on && i === 7 ? 'var(--lime)' : '#86b3e3') + '"></div>'; }).join('');
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big" style="color:' + (on ? 'var(--lime)' : 'var(--red)') + '">' + (on ? '0 %' : '62 %') + '</span><span class="mono-s">' + (es ? 'valores imposibles' : 'impossible values') + '</span></div>' +
          '<button class="switch" role="switch" aria-checked="' + on + '" data-act="clip"><i class="' + (on ? 'on' : '') + '"></i>' + (es ? 'Aplicar recorte' : 'Apply clipping') + '</button></div>' +
          '<div class="hist">' + hs + '</div><div class="hist-ax"><span>' + (es ? 'valores < 0 (imposibles)' : 'values < 0 (impossible)') + '</span><span>0</span><span>' + (es ? 'valores válidos' : 'valid values') + '</span></div>' +
          '<div class="pills"><span>Wasserstein · ' + (es ? 'favorable' : 'good') + '</span><span>JSD · ' + (es ? 'favorable' : 'good') + '</span><span class="muted">' + esc(T().schematic) + '</span></div></div>';
      },
      init: function () {}
    },
    smote: {
      html: function () {
        var es = S.lang === 'es', cmp = !!VIZ.smote.cmp;
        var M = [[es ? 'Regresión logística' : 'Logistic regression', [0.30, 0.29, 0.31, 0.29]], ['Random Forest', [0.30, 0.31, 0.31, 0.31]], ['XGBoost', [0.33, 0.34, 0.34, 0.35]]];
        var heads = [es ? 'Sin balanceo' : 'No balancing', 'SMOTE', 'CTGAN', es ? 'CTGAN + pesos' : 'CTGAN + weights'];
        var g = '<span></span>' + heads.map(function (h, j) { return '<span class="mh' + (cmp && (j === 1 || j === 2) ? ' hl' : '') + '">' + h + '</span>'; }).join('') + '<span class="mh">CTGAN − SMOTE</span>';
        M.forEach(function (row, r) {
          g += '<span class="mrow">' + row[0] + '</span>' + row[1].map(function (x, j) {
            var best = r === 2 && j === 3, hl = cmp && (j === 1 || j === 2);
            return '<span class="mc' + (best ? ' best' : hl ? ' hl' : cmp ? ' dim' : '') + '">' + dec(x, 2) + '</span>';
          }).join('') + '<span class="md' + (cmp ? ' hl' : '') + '">' + (row[1][2] - row[1][1] >= 0 ? '+' : '') + dec(row[1][2] - row[1][1] + 1e-9, 2) + '</span>';
        });
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big">' + (es ? '≤ 0,02' : '≤ 0.02') + '</span><span class="mono-s">' + (es ? 'diferencia CTGAN − SMOTE: sin ganancia real' : 'CTGAN − SMOTE difference: no real gain') + '</span></div>' +
          '<button class="ghost' + (cmp ? ' on' : '') + '" aria-pressed="' + cmp + '" data-act="cmp">' + (es ? 'Comparar SMOTE y CTGAN' : 'Compare SMOTE and CTGAN') + '</button></div>' +
          '<div class="scroll-x"><div class="matrix">' + g + '</div></div><div class="viz-note">' + (es ? 'F1-macro · 289.693 registros · referencia de clase mayoritaria 0,13 · en lima, la mejor celda' : 'Macro-F1 · 289,693 records · majority-class baseline 0.13 · lime marks the best cell') + '</div></div>';
      },
      init: function () {}
    },
    dane: {
      html: function () {
        var es = S.lang === 'es', tab = VIZ.dane.tab || 0;
        var tabs = '<div class="tabs" role="tablist">' + [es ? 'Acueducto' : 'Piped water', es ? 'Analfabetismo' : 'Illiteracy'].map(function (l, i) { return '<button role="tab" aria-selected="' + (tab === i) + '" class="' + (tab === i ? 'on' : '') + '" data-tab="' + i + '">' + l + '</button>'; }).join('') + '</div>';
        var bars = tab === 0 ? [['Bogotá', 99.5, dec(99.5, 1) + ' %', 'var(--blue)'], ['Chocó', 28.5, dec(28.5, 1) + ' %', 'var(--red)']] : [[es ? 'Urbano' : 'Urban', 100 / 5.39, '1×', 'var(--blue)'], ['Rural', 100, dec(5.39, 2) + '×', 'var(--red)']];
        return '<div class="viz-pad">' + tabs + bars.map(function (b) { return '<div class="hbar"><span>' + b[0] + '</span><div class="hbar-t"><div style="width:' + b[1] + '%;background:' + b[3] + '"></div></div><b>' + b[2] + '</b></div>'; }).join('') +
          '<div class="viz-note">' + (tab === 0 ? (es ? 'Cobertura de acueducto · censo DANE 2018' : 'Piped-water coverage · DANE 2018 census') : (es ? 'Odds de analfabetismo, regresión logística (urbano = 1)' : 'Odds of illiteracy, logistic regression (urban = 1)')) + '</div></div>';
      },
      init: function () {}
    }
  };

  /* ---------- diálogo de caso ---------- */
  var lastFocus = null;
  function stopViz() { if (VIZ.tfm.stop) VIZ.tfm.stop(); cancelAnimationFrame(VIZ.soat.raf); cancelAnimationFrame(VIZ.rgpd.raf); clearTimeout(VIZ.cotejo.t); clearTimeout(VIZ.contable.t); }
  function renderCase() {
    var t = T(), c = D.cases[S.open], v = VIZ[c.id];
    var status = c.status ? '<span class="badge">' + esc(c.status === 'building' ? t.building : t.ongoing) + '</span>' : '';
    var foot = (c.demo ? '<a class="btn-lime sm" href="' + c.demo + '" target="_blank" rel="noopener">' + esc(t.demo) + ' ↗</a>' : '') +
      (c.repo ? '<a class="' + (c.demo ? 'ghost' : 'btn-lime sm') + '" href="' + c.repo + '" target="_blank" rel="noopener">' + esc(t.repo) + ' ↗</a>' : '') +
      (c.priv ? '<span class="tagbox">' + esc(t.private) + '</span>' : '') + (c.local ? '<span class="tagbox">' + esc(t.local) + '</span>' : '');
    $('#case-body').innerHTML =
      '<div class="dlg-bar"><span>' + String(S.open + 1).padStart(2, '0') + ' · ' + esc(L(c.kicker)) + '</span><button class="ghost" data-close>' + esc(t.close) + ' · Esc</button></div>' +
      '<div class="dlg-in">' + status + '<h2 id="case-title">' + esc(L(c.title)) + '</h2>' +
      '<div class="viz" id="viz">' + v.html() + '</div>' +
      '<div class="kpis">' + c.metrics.map(function (m) { return '<div><b>' + esc(L(m[0])) + '</b><span>' + esc(L(m[1])) + '</span></div>'; }).join('') + '</div>' +
      '<div class="cols"><div><h4>' + esc(t.problem) + '</h4><p>' + esc(L(c.problem)) + '</p></div><div><h4>' + esc(t.did) + '</h4><p>' + esc(L(c.did)) + '</p></div>' +
      '<div><h4>' + esc(t.decisions) + '</h4><ul class="dash">' + L(c.decisions).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h4>' + esc(t.result) + '</h4><ul class="dot">' + L(c.results).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div></div>' +
      '<div class="dlg-foot"><div class="tags">' + c.tags.map(function (g) { return '<span>' + esc(L(g)) + '</span>'; }).join('') + '</div>' +
      '<div class="dlg-nav">' + foot + '<button class="ghost" data-nav="-1" aria-label="' + esc(t.prev) + '">←</button><button class="ghost" data-nav="1" aria-label="' + esc(t.next) + '">→</button></div></div></div>';
    stopViz(); v.init($('#viz'));
  }
  function openCase(i) {
    var card = $('[data-case="' + i + '"]'); lastFocus = card || document.activeElement;
    if (card) card.style.viewTransitionName = 'case-hero';
    vt(function () {
      if (card) card.style.viewTransitionName = '';
      S.open = i; renderCase(); $('#case').hidden = false; document.body.classList.add('lock');
      $('#case-dialog').style.viewTransitionName = 'case-hero';
    });
    setTimeout(function () { var b = $('#case [data-close]'); if (b) b.focus({ preventScroll: true }); }, 60);
  }
  function closeCase() {
    if (S.open == null) return;
    var card = $('[data-case="' + S.open + '"]');
    var tr = vt(function () { stopViz(); $('#case').hidden = true; S.open = null; document.body.classList.remove('lock'); $('#case-dialog').style.viewTransitionName = ''; if (card) card.style.viewTransitionName = 'case-hero'; });
    function clear() { if (card) card.style.viewTransitionName = ''; if (lastFocus) lastFocus.focus({ preventScroll: true }); }
    if (tr && tr.finished) tr.finished.then(clear, clear); else clear();
  }
  function navCase(d) { S.open = (S.open + d + D.cases.length) % D.cases.length; VIZ.facturas.tab = 0; VIZ.dane.tab = 0; VIZ.ctgan.clip = false; VIZ.smote.cmp = false; renderCase(); }

  /* ---------- resumen de una página ---------- */
  function renderSummary() {
    var t = T(), tl = D.timeline.map(function (e) { return { y: L(e[0]), k: e[1], r: L(e[2]), o: L(e[3]) }; });
    var item = function (e) { return '<div class="rc-i"><div><b>' + esc(e.r) + '</b><span>' + esc(e.y) + '</span></div><small>' + esc(e.o) + '</small></div>'; };
    $('#summary-body').innerHTML =
      '<div class="rc-top"><div><h2>Pablo Alberto Duque Marín</h2><p class="rc-role">' + esc(t.rcHead) + '</p><p class="rc-meta">Caldas, Colombia · ' + esc(t.remote) + ' (UTC−5) · ' + D.email + ' · github.com/pabdus · linkedin.com/in/pablo-alberto-duque-marin</p></div>' +
      '<div class="rc-actions"><a class="btn-dark" href="' + D.links.cv + '" download>' + esc(t.cvLong) + '</a><button class="btn-line" data-copy>' + esc(t.aCopy) + '</button><button class="btn-line" data-close-summary>' + esc(t.close) + '</button></div></div>' +
      '<div class="rc-stats">' + D.heroStats.concat([{ v: '17 / 18', l: { es: 'fallas idénticas en la verificación ciega del TFM', en: 'faults identical in the thesis blind check' } }]).map(function (s) { return '<div><b>' + esc(L(s.v)) + '</b><span>' + esc(L(s.l)) + '</span></div>'; }).join('') + '</div>' +
      '<div class="rc-cols"><div><h4>' + t.rcExp + '</h4>' + tl.filter(function (e) { return e.k === 'w'; }).map(item).join('') + '<h4>' + t.rcEdu + '</h4>' + tl.filter(function (e) { return e.k === 'e'; }).map(item).join('') + '</div>' +
      '<div><h4>' + t.rcCases + '</h4>' + D.cases.map(function (c) { return '<div class="rc-c"><span>' + esc(L(c.title)) + '</span><b>' + esc(L(c.mv)) + '</b></div>'; }).join('') +
      '<h4>' + t.rcStack + '</h4><div class="rc-stack">' + D.summaryStack.map(function (k) { return '<span>' + esc(k) + '</span>'; }).join('') + '</div><h4>' + t.rcLang + '</h4><p>' + esc(t.rcLangs) + '</p></div></div>';
  }
  function openSummary() { renderSummary(); $('#summary').hidden = false; document.body.classList.add('lock'); setTimeout(function () { var b = $('[data-close-summary]'); if (b) b.focus({ preventScroll: true }); }, 30); }
  function closeSummary() { $('#summary').hidden = true; if (S.open == null) document.body.classList.remove('lock'); }

  /* ---------- paleta de comandos ---------- */
  function go(id) { var el = document.getElementById(id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: RM ? 'auto' : 'smooth' }); }
  function paletteItems() {
    var t = T(), q = S.query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    var items = [['trabajo', t.navWork], ['competencias', t.navSkills], ['metodo', t.navMethod], ['trayectoria', t.navPath], ['contacto', t.navContact]].map(function (s) { return { l: s[1], g: t.gSec, run: function () { closePalette(); setTimeout(function () { go(s[0]); }, 30); } }; })
      .concat(D.cases.map(function (c, i) { return { l: L(c.title), g: t.gCase, run: function () { closePalette(); setTimeout(function () { openCase(i); }, 30); } }; }))
      .concat([
        { l: t.aSummary, g: t.gAct, run: function () { closePalette(); openSummary(); } },
        { l: t.aLang, g: t.gAct, run: function () { closePalette(); toggleLang(); } },
        { l: t.aCopy, g: t.gAct, run: function () { closePalette(); copyEmail(); } },
        { l: t.aCv, g: t.gAct, run: function () { closePalette(); var a = document.createElement('a'); a.href = D.links.cv; a.download = ''; a.click(); } },
        { l: 'GitHub · pabdus', g: t.gAct, run: function () { closePalette(); window.open(D.links.github, '_blank', 'noopener'); } },
        { l: 'LinkedIn', g: t.gAct, run: function () { closePalette(); window.open(D.links.linkedin, '_blank', 'noopener'); } }
      ]);
    return q ? items.filter(function (it) { return (it.l + ' ' + it.g).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').indexOf(q) >= 0; }) : items;
  }
  var palList = [];
  function renderPalette() {
    var t = T(); palList = paletteItems(); S.sel = Math.min(S.sel, Math.max(0, palList.length - 1));
    $('#pal-list').innerHTML = palList.length ? palList.map(function (p, i) { return '<button role="option" aria-selected="' + (i === S.sel) + '" class="' + (i === S.sel ? 'on' : '') + '" data-pi="' + i + '"><span>' + esc(p.l) + '</span><small>' + esc(p.g) + '</small></button>'; }).join('') : '<div class="pal-empty">' + esc(t.palEmpty) + '</div>';
  }
  function openPalette() { S.query = ''; S.sel = 0; var inp = $('#pal-input'); inp.value = ''; inp.placeholder = T().palPh; renderPalette(); $('#palette').hidden = false; setTimeout(function () { inp.focus(); }, 20); }
  function closePalette() { $('#palette').hidden = true; }

  /* ---------- acciones ---------- */
  function copyEmail() {
    function ok() { toast(T().toastCopied); $$('[data-copy]').forEach(function (b) { b.classList.add('done'); }); setTimeout(function () { $$('[data-copy]').forEach(function (b) { b.classList.remove('done'); }); }, 1800); }
    function fb() { var a = document.createElement('textarea'); a.value = D.email; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); ok(); }
    if (navigator.clipboard) navigator.clipboard.writeText(D.email).then(ok, fb); else fb();
  }
  function toggleLang() { S.lang = S.lang === 'es' ? 'en' : 'es'; try { localStorage.setItem('pd-lang', S.lang); } catch (e) {} vt(function () { renderAll(); renderMonitorControls(); }); }

  /* ---------- eventos ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button, a'); if (!el) { if (e.target.id === 'case') closeCase(); if (e.target.id === 'summary') closeSummary(); if (e.target.id === 'palette') closePalette(); return; }
    if (el.hasAttribute('data-case')) return openCase(+el.getAttribute('data-case'));
    if (el.hasAttribute('data-case-open')) return openCase(+el.getAttribute('data-case-open'));
    if (el.hasAttribute('data-open')) return openCase(caseIndex(el.getAttribute('data-open')));
    if (el.hasAttribute('data-close')) return closeCase();
    if (el.hasAttribute('data-nav')) return navCase(+el.getAttribute('data-nav'));
    if (el.hasAttribute('data-filter')) { S.filter = el.getAttribute('data-filter'); return vt(renderSkills); }
    if (el.hasAttribute('data-method')) { S.method = el.getAttribute('data-method'); if (mon) mon.setUcl(UCL[S.method]); return renderMonitorControls(); }
    if (el.id === 'fault-btn') { S.fault = !S.fault; if (!mon) startMonitor(); mon.setFault(S.fault); return renderMonitorControls(); }
    if (el.id === 'lang-btn') return toggleLang();
    if (el.id === 'summary-btn') return openSummary();
    if (el.hasAttribute('data-close-summary')) return closeSummary();
    if (el.hasAttribute('data-copy')) return copyEmail();
    if (el.hasAttribute('data-pi')) return palList[+el.getAttribute('data-pi')].run();
    if (el.hasAttribute('data-tab')) { var id = D.cases[S.open].id; VIZ[id].tab = +el.getAttribute('data-tab'); $('#viz').innerHTML = VIZ[id].html(); return; }
    var act = el.getAttribute('data-act');
    if (act) {
      var v = $('#viz');
      if (act === 'soat' || act === 'rgpd' || act === 'cotejo' || act === 'contable') VIZ[act].init(v);
      if (act === 'clip') { VIZ.ctgan.clip = !VIZ.ctgan.clip; v.innerHTML = VIZ.ctgan.html(); }
      if (act === 'cmp') { VIZ.smote.cmp = !VIZ.smote.cmp; v.innerHTML = VIZ.smote.html(); }
    }
  });
  $('#pal-input').addEventListener('input', function (e) { S.query = e.target.value; S.sel = 0; renderPalette(); });
  $('#pal-input').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); S.sel = (S.sel + 1) % Math.max(1, palList.length); renderPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.sel = (S.sel - 1 + palList.length) % Math.max(1, palList.length); renderPalette(); }
    else if (e.key === 'Enter' && palList[S.sel]) { e.preventDefault(); palList[S.sel].run(); }
  });
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('#palette').hidden) openPalette(); else closePalette(); return; }
    if (e.key === 'Escape') { if (!$('#palette').hidden) closePalette(); else if (S.open != null) closeCase(); else if (!$('#summary').hidden) closeSummary(); return; }
    if (S.open != null && $('#palette').hidden && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) navCase(e.key === 'ArrowRight' ? 1 : -1);
  });

  /* sección activa en la navegación */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) $$('.nav-links a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id); }); }); }, { rootMargin: '-40% 0px -55% 0px' });
    ['trabajo', 'competencias', 'metodo', 'trayectoria', 'contacto'].forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  renderAll(); renderMonitorControls(); startMonitor();
})();
