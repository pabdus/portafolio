/* Portafolio · Pablo Duque Marín — lógica del sitio (sin dependencias). El contenido vive en content.js. */
(function () {
  'use strict';
  var D = window.PD;
  var root = document.documentElement;
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var S = { lang: 'es', method: 'F', fault: false, filter: 'all', skillsAll: false, open: null, sel: 0, query: '' };
  var UCL = { F: 16.2, KDE: 14.7, EMP: 13.9 };
  var KIND = { pro: 'var(--lime-ink)', inv: 'var(--blue)', pos: 'var(--violet)' };

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
    if (tr.ready) tr.ready.catch(function () {}); // una transición omitida rechaza «ready»; no es un error
    setTimeout(function () { if (!done) { try { tr.skipTransition(); } catch (e) {} run(); } }, 250);
    return tr;
  }
  function cvHref() { return L(D.links.cv); }
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
    $$('[data-cv]').forEach(function (a) { a.setAttribute('href', cvHref()); });
    document.title = S.lang === 'es' ? 'Pablo Duque Marín · Ingeniero de IA · AWS, Bedrock y estadística' : 'Pablo Duque Marín · AI engineer · AWS, Bedrock and statistics';
    paintTheme(); paintStatus();
  }

  /* ---------- tema claro / oscuro ---------- */
  // /theme.js fija html[data-theme] antes de pintar; aquí, los botones que lo cambian y el redibujado.
  // Los estilos generados usan variables CSS; los lienzos las leen en cada dibujado.
  function isLight() { return root.getAttribute('data-theme') === 'light'; }
  function paintTheme() {
    var t = T(), light = isLight(), lbl = light ? t.themeDark : t.themeLight;
    $$('[data-theme-toggle]').forEach(function (b) {
      var ic = $('.ti', b), tx = $('.tt', b);
      if (ic) ic.textContent = light ? '☾' : '☀';
      if (tx) tx.textContent = lbl; else { b.setAttribute('aria-label', lbl); b.title = lbl; }
    });
    // color de la barra del navegador según el tema elegido, no solo el del sistema
    $$('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', light ? '#f6f7f3' : '#0b0d11'); });
  }
  function setTheme(th, keep) {
    root.setAttribute('data-theme', th);
    if (keep) { try { localStorage.setItem('pd-theme', th); } catch (e) {} }
    paintTheme();
    if (tep) tep.redraw();
    if (mon) mon.repaint();
  }
  function toggleTheme() { setTheme(isLight() ? 'dark' : 'light', true); }
  // Sin elección guardada, el sitio sigue al sistema también si este cambia con la página abierta.
  if (window.matchMedia) {
    var mqLight = matchMedia('(prefers-color-scheme: light)');
    var onScheme = function (e) { var s = null; try { s = localStorage.getItem('pd-theme'); } catch (x) {} if (s !== 'light' && s !== 'dark') setTheme(e.matches ? 'light' : 'dark', false); };
    if (mqLight.addEventListener) mqLight.addEventListener('change', onScheme); else if (mqLight.addListener) mqLight.addListener(onScheme);
  }

  /* ---------- secciones ---------- */
  function renderHeroStats() {
    $('#hero-stats').innerHTML = D.heroStats.map(function (s) {
      return '<button class="hstat" data-open="' + s.c + '"><span class="hstat-v">' + esc(L(s.v)) + '</span><span class="hstat-l">' + esc(L(s.l)) + '</span><span class="hstat-go">' + esc(T().evOpen) + ' →</span></button>';
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
    var all = D.skills.map(function (s) { return { b: s[0], k: s[1], n: L(s[2]), e: L(s[3]), top: !!s[4] }; });
    var nTop = all.filter(function (x) { return x.top; }).length;
    $('#filters').hidden = !S.skillsAll;
    $('#sk-more').textContent = (S.skillsAll ? t.skLess.replace('{n}', nTop) : t.skMore.replace('{n}', all.length)) + (S.skillsAll ? ' ↑' : ' ↓');
    $('#sk-more').setAttribute('aria-expanded', String(S.skillsAll));
    $('#filters').innerHTML = [['all', t.fAll, 'var(--ink)'], ['pro', t.fPro, KIND.pro], ['inv', t.fInv, KIND.inv], ['pos', t.fPos, KIND.pos]].map(function (f) {
      var n = f[0] === 'all' ? all.length : all.filter(function (x) { return x.k === f[0]; }).length;
      return '<button class="chip' + (S.filter === f[0] ? ' on' : '') + '" aria-pressed="' + (S.filter === f[0]) + '" data-filter="' + f[0] + '"><i style="background:' + f[2] + '"></i>' + esc(f[1]) + '<small>' + n + '</small></button>';
    }).join('');
    var vis = all.filter(function (x) { return S.skillsAll ? (S.filter === 'all' || x.k === S.filter) : x.top; });
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
        return '<span class="tool" style="--k:' + KIND[it[1]] + '" title="' + esc(lv[it[1]]) + '"><i></i>' + esc(L(it[0])) + '</span>';
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
  function renderLab() {
    var t = T();
    $('#labs').innerHTML = D.labs.map(function (x) {
      return '<a class="labc" href="' + x.href + '" data-reveal><span class="labc-k">' + esc(L(x.k)) + '</span><span class="labc-t">' + esc(L(x.t)) + '</span>' +
        '<span class="labc-d">' + esc(L(x.d)) + '</span><span class="labc-f"><span><span class="labc-v">' + esc(L(x.v)) + '</span><span class="labc-vl">' + esc(L(x.vl)) + '</span></span>' +
        '<span class="labc-go">' + esc(t.openLab) + ' →</span></span></a>';
    }).join('');
    $('#notes').innerHTML = D.notes.map(function (n) {
      return '<a class="note" href="' + n.href + '"><b>' + esc(L(n.t)) + '</b><span>' + esc(L(n.d)) + '</span><em>' + esc(t.readNote) + ' →</em></a>';
    }).join('');
  }
  function renderServices() {
    var t = T();
    $('#services').innerHTML = D.services.map(function (x) {
      var ci = caseIndex(x.c), subj = encodeURIComponent(t.mailSubject + ' · ' + L(x.t));
      return '<div class="svc-i" role="listitem" data-reveal><h3>' + esc(L(x.t)) + '</h3><p>' + esc(L(x.d)) + '</p><div class="svc-f">' +
        '<a href="mailto:' + D.email + '?subject=' + subj + '">' + esc(t.svcCta) + ' →</a>' +
        (ci >= 0 ? '<button data-case-open="' + ci + '">' + esc(t.svcBased) + ': ' + esc(L(D.cases[ci].title)) + '</button>' : '') + '</div></div>';
    }).join('');
  }
  function renderTimeline() {
    var t = T();
    $('#timeline').innerHTML = D.timeline.map(function (e) {
      var w = e[1] === 'w';
      return '<li data-reveal style="--k:' + (w ? 'var(--lime-ink)' : 'var(--blue)') + '"><span class="tl-dot"></span><div class="tl-y">' + esc(L(e[0])) + '</div><div><div class="tl-h"><h3>' + esc(L(e[2])) + '</h3><em>' + esc(w ? t.kWork : t.kEdu) + '</em></div><div class="tl-o">' + esc(L(e[3])) + '</div></div></li>';
    }).join('');
  }
  function renderAll() {
    applyStatic(); renderHeroStats(); renderCases(); renderSkills(); renderRules(); renderLab(); renderServices(); renderTimeline();
    if (S.open != null) renderCase();
    if (!$('#summary').hidden) renderSummary();
    paintMonitor();
  }

  /* ---------- monitor T² ---------- */
  // Portada: series reales del Tennessee Eastman exportadas con tfmfdd (/data/tep, tools/tep/export_tep.py).
  // Si no se pueden cargar (p. ej. abierto desde file://), queda la simulación ilustrativa como respaldo.
  // Colores del lienzo: variables CSS leídas en cada dibujado, para que el tema claro funcione.
  var colOk = {};
  function monCol(ctx, cs, name, fb) {
    var v = cs.getPropertyValue(name).trim();
    if (!v) return fb;
    if (colOk[v] == null) { ctx.fillStyle = '#010203'; ctx.fillStyle = v; colOk[v] = ctx.fillStyle !== '#010203'; }
    return colOk[v] ? v : fb;
  }
  // --grid, --axis y --tep-line solo existen en el tema claro; en oscuro, la rejilla y el sombreado salen de --ink con
  // transparencia y la serie usa --blue. En claro la serie va en un azul más claro (--tep-line, 4,3:1 sobre --s1) para que
  // los puntos rojos fuera de límite se separen también por luminosidad (1,7:1; con --blue era 1,0:1), como en /lab/tep.html.
  // lt: tema claro (papel). Ahí el relleno bajo la curva y los halos se aligeran; en oscuro no cambia nada.
  function monPal(ctx) {
    var cs = getComputedStyle(root), ink = monCol(ctx, cs, '--ink', '#eceef1'), ink3 = monCol(ctx, cs, '--ink3', '#8f99a3');
    return {
      lt: isLight(),
      line: monCol(ctx, cs, '--tep-line', monCol(ctx, cs, '--blue', '#86b8e8')),
      out: monCol(ctx, cs, '--red', '#ef7a62'),
      ink: ink,
      ink2: monCol(ctx, cs, '--ink2', '#cbd1d7'),
      axis: monCol(ctx, cs, '--axis', ink3),
      grid: monCol(ctx, cs, '--grid', ''),
      ok: monCol(ctx, cs, '--lime-ink', monCol(ctx, cs, '--lime', '#c3e65f')),
      bg: monCol(ctx, cs, '--s1', '#10141a')
    };
  }
  // Rejilla (--grid, o --ink al 6 %) y zona en falla (--ink al 3,5 %).
  function monGrid(ctx, P) { if (P.grid) { ctx.strokeStyle = P.grid; ctx.globalAlpha = 1; } else { ctx.strokeStyle = P.ink; ctx.globalAlpha = 0.06; } }
  function monShade(ctx, P, x, y, w, h) { ctx.globalAlpha = 0.035; ctx.fillStyle = P.ink; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }

  /* simulación (respaldo sin datos y visual del caso TFM) */
  function randn() { var u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function makeMonitor(canvas, o) {
    var ctx = canvas.getContext('2d'), W = o.window || 150;
    var st = { data: [], ic: [], fl: [], t: 0, fault: false, f0: -1, ucl: o.ucl || 16.2, target: o.ucl || 16.2, ymax: 34, last: 0, run: true, paused: false, hold: false, raf: 0, io: null };
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
      var once = st.once; // redibujado único en pausa (cambio de tema): sin avanzar la serie ni pedir otro cuadro
      if (!st.run || (!once && (st.paused || st.hold))) return;
      if (!once) { if (!st.last) st.last = now; if (now - st.last >= o.interval) { st.last = now; push(); } }
      var p = once ? st.lp || 0 : Math.min(1, (now - st.last) / o.interval), dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      st.lp = p;
      if (!w) { if (!once) st.raf = requestAnimationFrame(draw); return; }
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      var P = monPal(ctx);
      st.ucl += (st.target - st.ucl) * 0.12;
      var vis = 0; st.data.forEach(function (d) { if (d.v > vis) vis = d.v; });
      st.ymax += (Math.max(st.ucl * 1.9, vis * 1.12) - st.ymax) * 0.05;
      var pad = { l: 40, r: 14, t: 16, b: 20 }, pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
      function X(i) { return pad.l + ((i - (RM ? 0 : p)) / (W - 2)) * pw; }
      function Y(v) { return pad.t + (1 - Math.min(v, st.ymax) / st.ymax) * ph; }
      ctx.font = '12px "IBM Plex Mono", monospace';
      var step = st.ymax > 60 ? 20 : 10;
      for (var g = 0; g <= st.ymax; g += step) { monGrid(ctx, P); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, Y(g)); ctx.lineTo(w - pad.r, Y(g)); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = P.axis; ctx.fillText(String(g), 8, Y(g) + 4); }
      ctx.save(); ctx.beginPath(); ctx.rect(pad.l, 0, pw, h); ctx.clip();
      var s0 = -1;
      st.data.forEach(function (d, i) { if (d.f && s0 < 0) s0 = i; if ((!d.f || i === st.data.length - 1) && s0 >= 0) { monShade(ctx, P, X(s0), pad.t, X(i) - X(s0), ph); s0 = -1; } });
      st.data.forEach(function (d, i) { if (d.inj) { ctx.globalAlpha = 0.55; ctx.strokeStyle = P.ink; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(i), pad.t); ctx.lineTo(X(i), h - pad.b); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = P.ink2; ctx.fillText(T().fault, X(i) + 5, pad.t + 12); } });
      ctx.beginPath(); st.data.forEach(function (d, i) { if (i) ctx.lineTo(X(i), Y(d.v)); else ctx.moveTo(X(i), Y(d.v)); });
      ctx.lineTo(X(st.data.length - 1), h - pad.b); ctx.lineTo(X(0), h - pad.b); ctx.closePath(); ctx.globalAlpha = P.lt ? 0.06 : 0.14; ctx.fillStyle = P.line; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); st.data.forEach(function (d, i) { if (i) ctx.lineTo(X(i), Y(d.v)); else ctx.moveTo(X(i), Y(d.v)); });
      ctx.strokeStyle = P.line; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = P.lt ? 0.55 : 0.6; ctx.setLineDash([6, 5]); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(pad.l, Y(st.ucl)); ctx.lineTo(w - pad.r, Y(st.ucl)); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 0.85; ctx.fillStyle = P.ink;
      var lab = T().legUcl + ' · ' + (o.methodLabel ? o.methodLabel() : 'F') + ' · ' + dec(st.ucl, 1);
      ctx.fillText(lab, w - pad.r - ctx.measureText(lab).width - 4, Y(st.ucl) - 7); ctx.globalAlpha = 1;
      // fuera de límite: en claro, punto de 2,5 px con halo tenue (la ventana nunca pasa de ~150 puntos)
      var hA = P.lt ? 0.12 : 0.28, hR = P.lt ? 5 : 6, dR = P.lt ? 2.5 : 3;
      st.data.forEach(function (d, i) { if (d.v > st.ucl && X(i) >= pad.l) { ctx.globalAlpha = hA; ctx.fillStyle = P.out; ctx.beginPath(); ctx.arc(X(i), Y(d.v), hR, 0, 7); ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(X(i), Y(d.v), dR, 0, 7); ctx.fill(); } });
      var ld = st.data[st.data.length - 1]; ctx.fillStyle = P.ink; ctx.beginPath(); ctx.arc(X(st.data.length - 1), Y(ld.v), 3.5, 0, 7); ctx.fill();
      if (!once) st.raf = requestAnimationFrame(draw);
    }
    st.raf = requestAnimationFrame(draw);
    // Fuera de pantalla no se redibuja: el bucle se detiene y se reanuda al volver a verse.
    if ('IntersectionObserver' in window) {
      st.io = new IntersectionObserver(function (es) {
        var on = es[es.length - 1].isIntersecting;
        if (!on && !st.paused) { st.paused = true; cancelAnimationFrame(st.raf); }
        else if (on && st.paused && st.run) { st.paused = false; if (!st.hold) { st.last = 0; st.raf = requestAnimationFrame(draw); } }
      });
      st.io.observe(canvas);
    }
    return {
      stop: function () { st.run = false; cancelAnimationFrame(st.raf); if (st.io) st.io.disconnect(); },
      setFault: function (f) { st.fault = f; if (f) { st.f0 = st.t; st.fl = []; } if (o.onStats) o.onStats(stats()); },
      setUcl: function (u) { st.target = u; if (o.onStats) o.onStats(stats()); },
      hold: function (h) { st.hold = h; cancelAnimationFrame(st.raf); if (!h && st.run && !st.paused) { st.last = 0; st.raf = requestAnimationFrame(draw); } },
      held: function () { return st.hold; },
      // en marcha se redibuja solo en el cuadro siguiente; en pausa hace falta un dibujado explícito
      repaint: function () { if (st.run && st.hold) { st.once = true; try { draw(performance.now()); } finally { st.once = false; } } },
      stats: stats
    };
  }

  /* datos reales: reproducción de una corrida de 960 muestras (falla desde la 161) */
  function makeTep(canvas, o) {
    var ctx = canvas.getContext('2d'), W = 160, PRE = 120, IV = RM ? 320 : 140, ON = 160;
    var st = { y: null, fid: 0, n: 0, pos: 0, p: 0, pp: 0, last: 0, mode: 'static', raf: 0, rz: 0, vis: true, lim: o.limit(), limD: o.limit(), ymax: 2.2, top: 2, snap: true, io: null, mo: null };
    function lg(v) { return Math.log(v > 1 ? v : 1) / Math.LN10; }
    function emit() { if (o.onTick) o.onTick(st); }
    function halt() { if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; }
    function kick() { if (!st.raf && st.mode === 'play' && st.vis) st.raf = requestAnimationFrame(frame); }
    function frame(now) {
      st.raf = 0;
      if (st.mode !== 'play' || !st.vis) return;
      if (!st.last) { st.last = now - st.pp * IV; st.pp = 0; }
      var k = Math.floor((now - st.last) / IV);
      if (k > 0) { st.pos = Math.min(st.n, st.pos + k); st.last = k > 3 ? now : st.last + k * IV; emit(); }
      if (st.pos >= st.n) { st.mode = 'end'; st.p = 0; draw(); emit(); return; }
      st.p = RM ? 0 : Math.min(1, (now - st.last) / IV);
      draw();
      st.raf = requestAnimationFrame(frame);
    }
    function draw() {
      var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h || !st.y) return;
      var cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      var P = monPal(ctx), t = T(), y = st.y, mono = '"IBM Plex Mono", monospace', i, j;
      var full = st.mode === 'end' || st.mode === 'static', live = st.mode === 'play';
      var b = full ? st.n : st.pos, a = full ? 0 : Math.max(0, b - W), slide = !full && b >= W, p = full ? 0 : st.p;
      // escala logarítmica: T² va de ~2 a ~22.000 según la falla
      var vmax = 0; for (i = a; i < b; i++) if (y[i] > vmax) vmax = y[i];
      if (!full && b < st.n && y[b] > vmax) vmax = y[b];
      var target = lg(Math.max(st.lim * 2.4, vmax * 1.4));
      if (!live || st.snap) { st.ymax = target; st.limD = st.lim; st.snap = false; }
      else { st.ymax += (target - st.ymax) * 0.08; st.limD += (st.lim - st.limD) * 0.18; }
      var ym = st.ymax, lim = st.limD;
      ctx.font = '12px ' + mono; ctx.textAlign = 'left';
      // margen izquierdo fijo por corrida (la década más alta que llegará a verse), para que el trazo no salte
      var pad = { t: 18, r: 14, b: 22, l: Math.ceil(ctx.measureText(monInt(Math.pow(10, st.top))).width) + 18 };
      var pw = w - pad.l - pad.r, ph = h - pad.t - pad.b, den = full ? st.n - 1 : W - 1, slot = pw / den, x0 = slide ? b - W : 0;
      function X(k) { return pad.l + (k - x0 - (slide ? p : 0)) * slot; }
      function Yl(l) { return pad.t + (1 - Math.min(l, ym) / ym) * ph; }
      function Y(v) { return Yl(lg(v)); }
      function tag(s, x, yy, col) {
        var tw = ctx.measureText(s).width;
        ctx.globalAlpha = 0.82; ctx.fillStyle = P.bg; ctx.fillRect(x - 3, yy - 11, tw + 6, 15); ctx.globalAlpha = 1;
        ctx.fillStyle = col; ctx.fillText(s, x, yy);
      }
      // rejilla por décadas
      ctx.lineWidth = 1;
      for (var g = 0; g <= ym + 1e-9; g++) { var gy = Yl(g); monGrid(ctx, P); ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = P.axis; ctx.fillText(monInt(Math.pow(10, g)), 8, gy + 4); }
      // número de muestra
      ctx.font = '11px ' + mono; ctx.textAlign = 'center';
      for (var s = full ? 160 : 40; s < st.n; s += full ? 160 : 40) {
        var sx = X(s - 1); if (sx < pad.l + 10 || sx > w - pad.r - 10) continue;
        ctx.fillStyle = P.axis; ctx.fillText(String(s), sx, h - 6); ctx.fillRect(sx - 0.5, pad.t + ph, 1, 4);
      }
      ctx.textAlign = 'left'; ctx.font = '12px ' + mono;
      // cabeza: el punto que está entrando, interpolado en escala log entre la última muestra y la siguiente
      var hx = null, hl = 0;
      if (!full && b < st.n) { hx = X(b - 1) + p * slot; hl = lg(y[b - 1]) + (lg(y[b]) - lg(y[b - 1])) * p; }
      var right = hx == null ? X(b - 1) : hx, faulty = st.fid > 0 && b > ON;
      ctx.save(); ctx.beginPath(); ctx.rect(pad.l, 0, pw, h); ctx.clip();
      if (faulty) { var fx = Math.max(pad.l, X(ON)); monShade(ctx, P, fx, pad.t, right - fx, ph); }
      function path() { ctx.beginPath(); for (j = a; j < b; j++) { if (j === a) ctx.moveTo(X(j), Y(y[j])); else ctx.lineTo(X(j), Y(y[j])); } if (hx != null) ctx.lineTo(hx, Yl(hl)); }
      path(); ctx.lineTo(right, pad.t + ph); ctx.lineTo(X(a), pad.t + ph); ctx.closePath();
      ctx.globalAlpha = P.lt ? 0.06 : 0.12; ctx.fillStyle = P.line; ctx.fill(); ctx.globalAlpha = 1;
      path(); ctx.strokeStyle = P.line; ctx.lineWidth = full && !P.lt ? 1.1 : 1.5; ctx.lineJoin = 'round'; ctx.stroke();
      // fuera de límite: estadístico > límite (regla de alarma de tfmfdd)
      // en claro: 2,5 px con halo tenue; si hay muchos (más de 200), puntos finos y sin halo, para que no tapen la curva
      var r = full ? 1.5 : 2.6, halo = !full, hA = 0.25, hR = 5.5;
      if (P.lt) { var nOut = 0; for (i = a; i < b; i++) if (y[i] > lim) nOut++; halo = nOut <= 200; r = halo ? 2.5 : 1.5; hA = 0.12; hR = 5; }
      ctx.fillStyle = P.out;
      if (halo) { ctx.globalAlpha = hA; ctx.beginPath(); for (i = a; i < b; i++) if (y[i] > lim) { ctx.moveTo(X(i) + hR, Y(y[i])); ctx.arc(X(i), Y(y[i]), hR, 0, 7); } ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); for (i = a; i < b; i++) if (y[i] > lim) { ctx.moveTo(X(i) + r, Y(y[i])); ctx.arc(X(i), Y(y[i]), r, 0, 7); } ctx.fill();
      ctx.restore();
      function vline(x, col, alpha, dash, label, ly) {
        if (x < pad.l || x > w - pad.r) return;
        ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        var tw = ctx.measureText(label).width; tag(label, x + 6 + tw > w - pad.r ? x - 6 - tw : x + 6, ly, col);
      }
      if (faulty) vline(X(ON), P.ink2, 0.6, [2, 3], 'IDV ' + st.fid + ' · ' + t.sample + ' 161', pad.t + 12);
      // detección: inicio de la primera racha de 3 alarmas; se marca cuando la racha ya está completa
      var m = o.metric();
      if (faulty && m && m.detected && !m.detected_at_chance) { var j0 = m.first_alarm_sample - 1; if (full || b > j0 + 2) vline(X(j0), P.ok, 0.85, [], t.monDetMark + ' +' + m.delay_samples, pad.t + 30); }
      var ly = Y(lim);
      ctx.globalAlpha = P.lt ? 0.55 : 0.65; ctx.setLineDash([6, 5]); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(pad.l, ly); ctx.lineTo(w - pad.r, ly); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      var lab = t.legUcl + ' · ' + o.method() + ' · ' + dec(st.lim, 2);
      // encima de la línea, salvo que choque con las etiquetas de falla y detección de la franja superior
      tag(lab, w - pad.r - ctx.measureText(lab).width - 4, ly - 18 < pad.t + 34 ? ly + 16 : ly - 7, P.ink);
      if (hx != null) { ctx.fillStyle = Math.pow(10, hl) > lim ? P.out : P.ink; ctx.beginPath(); ctx.arc(hx, Yl(hl), 3.5, 0, 7); ctx.fill(); }
    }
    function restart() { halt(); st.pos = Math.min(PRE, st.n); st.p = 0; st.pp = 0; st.last = 0; st.snap = true; st.mode = 'play'; draw(); emit(); kick(); }
    // Fuera de pantalla no se anima; al volver a verse sigue donde iba.
    if ('IntersectionObserver' in window) {
      st.io = new IntersectionObserver(function (es) {
        var v = es[es.length - 1].isIntersecting; if (v === st.vis) return;
        st.vis = v; if (v) { st.pp = st.p; st.last = 0; kick(); } else halt();
      });
      st.io.observe(canvas);
    }
    function onResize() { if (st.mode === 'play') return; cancelAnimationFrame(st.rz); st.rz = requestAnimationFrame(function () { draw(); }); }
    window.addEventListener('resize', onResize);
    if (window.MutationObserver) { st.mo = new MutationObserver(onResize); st.mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] }); }
    return {
      setRun: function (fid, y, play) {
        var mx = 0; for (var i = 0; i < y.length; i++) if (y[i] > mx) mx = y[i];
        st.fid = fid; st.y = y; st.n = y.length; st.top = Math.floor(lg(Math.max(st.lim * 2.4, mx * 1.4)) + 1e-9);
        if (play) restart(); else { halt(); st.mode = 'static'; st.snap = true; draw(); emit(); } },
      restart: function () { if (st.y) restart(); },
      toggle: function () {
        if (st.mode === 'play') { halt(); st.pp = st.p; st.mode = 'pause'; draw(); }
        else if (st.mode === 'pause') { st.mode = 'play'; st.last = 0; kick(); }
        else if (st.y) return restart();
        emit();
      },
      setLimit: function (u) { st.lim = u; if (st.mode !== 'play') draw(); },
      redraw: function () { if (st.mode !== 'play') draw(); },
      state: function () { return st; },
      stop: function () { halt(); st.mode = 'static'; if (st.io) st.io.disconnect(); if (st.mo) st.mo.disconnect(); window.removeEventListener('resize', onResize); }
    };
  }

  var mon = null, tep = null;            // simulación de respaldo | datos reales
  var MS = { mode: 'idle', fid: 1, req: 0, btn: '', sr: '' };
  var TEP = { meta: null, byId: {}, runs: {} };
  var MKEY = { F: 'f', KDE: 'kde', EMP: 'empirico' };   // método de la portada → clave de meta.json
  function monPct(x) { var s = String(Math.round(x * 1e5) / 1e3); return S.lang === 'es' ? s.replace('.', ',') + ' %' : s + '%'; }
  function monInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, S.lang === 'es' ? '.' : ','); }
  function monMethod() { return S.method === 'EMP' ? T().emp : S.method; }
  // dentro de una frase («límite empírico», «empirical limit») va en minúscula; en el lienzo y el botón, con mayúscula
  function monMethodTxt() { return S.method === 'EMP' ? T().emp.toLowerCase() : S.method; }
  function monLimit() { return TEP.meta.limits[MKEY[S.method]].t2.value; }
  function monM() { var f = TEP.byId[MS.fid]; return f ? f.metrics[MKEY[S.method]].t2 : null; }
  function monName(f) { return f.id ? 'IDV ' + f.id + ' · ' + L({ es: f.name_es, en: f.name_en }) : T().monNormal; }

  function paintStats(s) {
    var t = T(); function pct(x) { return dec(x * 100, 1) + (S.lang === 'es' ? ' %' : '%'); }
    $('#m-far').textContent = s.far == null ? '—' : pct(s.far); $('#m-far-sub').textContent = t.farSub;
    $('#m-det').textContent = !s.fault ? '—' : pct(s.det); $('#m-det').className = 'read lime'; $('#m-det-sub').textContent = t.detSub;
    $('#m-delay').textContent = !s.fault ? '—' : s.delay < 0 ? '…' : s.delay + ' ' + (s.delay === 1 ? t.sample : t.samples); $('#m-delay').className = 'read';
    $('#m-delay-sub').textContent = !s.fault ? t.noFault + ' · ' + t.monScale : s.delay < 0 ? t.detecting : '= ' + (s.delay * 3) + ' min · ' + t.monScale;
  }
  // Lecturas reales: las métricas de meta.json para la falla y el método elegidos (T²).
  function paintReal(say) {
    var t = T(), f = TEP.byId[MS.fid], m = monM(), mk = monMethodTxt(), fault = MS.fid > 0;
    var cnt = function (x, n) { return String(Math.round(x * n)); };
    $('#mon-res-h').textContent = t.monRes + ' · ' + (fault ? 'IDV ' + f.id : t.monNormalShort) + ' · ' + t.monLimTpl.replace('{m}', mk) + ' · T²';
    var far = monPct(m.far), det = '—', delay = '—', detSub = t.monNoFaultRun, delaySub = t.monNoFaultRun, detCls = 'read muted', delCls = 'read';
    $('#m-far').textContent = far;
    $('#m-far-sub').textContent = (fault ? t.monFarSub : t.monFarSub0).replace('{k}', cnt(m.far, m.n_far)).replace('{n}', m.n_far);
    if (fault) {
      det = monPct(m.fdr); detCls = m.detected_at_chance ? 'read muted' : m.detected ? 'read lime' : 'read';
      detSub = t.monDetSub.replace('{k}', cnt(m.fdr, m.n_fdr)).replace('{n}', m.n_fdr) + (m.detected_at_chance ? ' · ' + t.monChance : '');
      if (!m.detected) { delay = t.monNotDet; delaySub = t.monNoRun; delCls = 'read txt'; }
      else if (m.detected_at_chance) { delay = t.monNotDet; delaySub = t.monChanceSub; delCls = 'read txt'; }
      else { delay = m.delay_samples + ' ' + (m.delay_samples === 1 ? t.sample : t.samples); delaySub = t.monDelaySub.replace('{m}', monInt(m.delay_minutes)).replace('{s}', m.first_alarm_sample); }
    }
    $('#m-det').textContent = det; $('#m-det').className = detCls; $('#m-det-sub').textContent = detSub;
    $('#m-delay').textContent = delay; $('#m-delay').className = delCls; $('#m-delay-sub').textContent = delaySub;
    var sr = (fault ? 'IDV ' + f.id : t.monNormalShort) + ', ' + t.monLimTpl.replace('{m}', mk) + ': ' + t.far.toLowerCase() + ' ' + far +
      (fault ? '; ' + t.det.toLowerCase() + ' ' + det + '; ' + (delCls === 'read txt' ? delay.toLowerCase() + ' (' + (m.detected ? t.monChance : t.monNoRun) + ')' : t.delay.toLowerCase() + ' ' + delay) : '') + '.';
    // se anuncia solo tras una acción de quien visita (falla o método), no al cargar
    if (say && sr !== MS.sr) { MS.sr = sr; $('#mon-sr').textContent = sr; }
  }
  function paintMonitor() { if (MS.mode === 'real') paintReal(); else if (MS.mode === 'sim' && mon) paintStats(mon.stats()); }
  function paintDesc() {
    var t = T(), f = TEP.byId[MS.fid];
    var d = MS.fid ? '<b>' + esc(monName(f)) + '</b> · ' + esc(L({ es: f.desc_es, en: f.desc_en })) + (f.id === 21 ? ' (' + esc(t.monIdv21) + ')' : '') + (f.hard ? ' · ' + esc(t.monHardNote) : '')
      : '<b>' + esc(t.monNormal) + '</b> · ' + esc(t.monD00);
    $('#mon-desc').innerHTML = d + '<br>' + esc(t.monLimT2 + ' ' + dec(monLimit(), 2) + ' · ' + { F: t.monLimF, KDE: t.monLimKde, EMP: t.monLimEmp }[S.method]);
  }
  function monAria() {
    var c = $('#mon-canvas'), t = T(); if (!c) return;
    if (MS.mode !== 'real') { c.setAttribute('aria-label', t.monAria); return; }
    var f = TEP.byId[MS.fid];
    c.setAttribute('aria-label', t.monAriaReal.replace('{f}', MS.fid ? 'IDV ' + f.id + ' (' + L({ es: f.name_es, en: f.name_en }) + ')' : t.monNormalShort).replace('{m}', monMethodTxt()).replace('{u}', dec(monLimit(), 2)) + (MS.fid ? ' ' + t.monAriaOnset : ''));
  }
  function monTick(s) {
    var t = T(), full = s.mode === 'end' || s.mode === 'static', faulty = s.fid > 0 && (full || s.pos > 160);
    $('#mon-prog').textContent = full ? t.monFull : t.monProg.replace('{i}', s.pos).replace('{n}', s.n) + ' · ' + (faulty ? t.monInFault : t.monPre) + (s.mode === 'pause' ? ' · ' + t.monPaused : '');
    var dot = $('#live-dot'); dot.classList.toggle('on', faulty); dot.classList.toggle('idle', s.mode !== 'play');
    var lbl = s.mode === 'play' ? '⏸ ' + t.monPause : s.mode === 'pause' ? '▶ ' + t.monResume : '▶ ' + t.monPlay;
    if (lbl !== MS.btn) { MS.btn = lbl; $('#mon-play').textContent = lbl; }
  }
  function syncSeg() {
    $$('#methods [data-method]').forEach(function (b) { var on = b.getAttribute('data-method') === S.method; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); });
  }
  function renderMonitorControls() {
    var t = T(), real = MS.mode === 'real', sim = MS.mode === 'sim';
    $('#methods').innerHTML = [['F', 'F'], ['KDE', 'KDE'], ['EMP', t.emp]].map(function (m) {
      return '<button type="button" role="radio" data-method="' + m[0] + '"' + (m[0] === 'F' && !sim ? ' title="' + esc(t.monFTitle) + '"' : '') + '>' + esc(m[1]) + '</button>';
    }).join('');
    syncSeg();
    var b = $('#fault-btn'); b.hidden = !sim; b.textContent = S.fault ? '↺ ' + t.reset : '⚡ ' + t.inject; b.classList.toggle('on', S.fault);
    ['#mon-fsel', '#mon-restart', '#mon-explore', '#mon-leg-log', '#mon-leg-det', '#mon-res-h'].forEach(function (s) { $(s).hidden = sim; });
    $('#mon-desc').hidden = !real;
    $('#mon-restart').textContent = '↺ ' + t.monRestart;
    $('#mon-note').textContent = sim ? t.monNote : t.monNoteReal;
    $('#mon-live').textContent = sim ? t.monLive : t.monLiveReal;
    // da nombre al grupo de lecturas (aria-labelledby); con datos reales lo completa paintReal, y en la simulación no es un resultado del TFM
    if (!real) $('#mon-res-h').textContent = sim ? t.monLive : t.monRes;
    var sel = $('#mon-fault'), play = $('#mon-play');
    sel.disabled = !real; play.disabled = !real && !sim; $('#mon-restart').disabled = !real;
    MS.btn = '';
    // el aviso para lectores de pantalla queda vacío tras redibujar los controles (p. ej. al cambiar de idioma), para no dejarlo en el idioma anterior
    MS.sr = ''; $('#mon-sr').textContent = '';
    if (real) {
      sel.innerHTML = TEP.meta.faults.map(function (f) {
        var ty = f.type && f.type !== 'unknown' ? ' (' + L({ es: f.type_es, en: f.type_en }).toLowerCase() + ')' : '';
        return '<option value="' + f.id + '"' + (f.id === MS.fid ? ' selected' : '') + '>' + esc(monName(f) + ty + (f.hard ? ' · ' + t.monHard : '')) + '</option>';
      }).join('');
      sel.value = String(MS.fid);
      paintDesc(); monTick(tep.state()); tep.redraw();
    } else if (sim) {
      $('#live-dot').classList.toggle('on', S.fault); $('#live-dot').classList.toggle('idle', !!(mon && mon.held()));
      $('#mon-prog').textContent = '';
      play.textContent = mon && mon.held() ? '▶ ' + t.monResume : '⏸ ' + t.monPause;
    } else {
      $('#mon-prog').textContent = t.monLoading; play.textContent = '⏸ ' + t.monPause;
    }
    monAria();
  }
  function setMethod(k, focus) {
    if (!UCL[k]) return;
    S.method = k; syncSeg();
    if (MS.mode === 'real') { tep.setLimit(monLimit()); paintReal(true); paintDesc(); monAria(); }
    else if (mon) mon.setUcl(UCL[k]);
    if (focus) { var b = $('#methods [aria-checked="true"]'); if (b) b.focus(); }
  }
  function monToggle() {
    if (MS.mode === 'real') tep.toggle();
    else if (MS.mode === 'sim' && mon) { mon.hold(!mon.held()); renderMonitorControls(); }
  }
  function monJSON(u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); }); }
  function monSeries(d) { if (!d || !Array.isArray(d.t2) || d.t2.length !== TEP.meta.config.n_samples) throw new Error('serie con otro formato'); return d.t2; }
  function loadRun(fid) {
    if (TEP.runs[fid]) return Promise.resolve(TEP.runs[fid]);
    return monJSON('/data/tep/' + TEP.byId[fid].file).then(function (d) { return (TEP.runs[fid] = monSeries(d)); });
  }
  function pickFault(fid) {
    if (MS.mode !== 'real' || !TEP.byId[fid]) return;
    var req = ++MS.req;
    loadRun(fid).then(function (y) {
      if (req !== MS.req) return;
      MS.fid = fid; tep.setRun(fid, y, !RM); paintReal(true); paintDesc(); monAria();
    }, function () {
      if (req !== MS.req) return;
      $('#mon-fault').value = String(MS.fid); $('#mon-prog').textContent = T().monLoadErr;
    });
  }
  function startSim() {
    if (tep) { tep.stop(); tep = null; }
    if (mon) return;
    MS.mode = 'sim';
    mon = makeMonitor($('#mon-canvas'), { interval: RM ? 420 : 230, onStats: paintStats, methodLabel: monMethod });
    mon.setUcl(UCL[S.method]);
    renderMonitorControls();
  }
  function startReal(meta, d1) {
    TEP.meta = meta; meta.faults.forEach(function (f) { TEP.byId[f.id] = f; });
    if (!TEP.byId[1] || !meta.limits.f || !meta.limits.kde || !meta.limits.empirico) throw new Error('meta.json con otro formato');
    var y = monSeries(d1); TEP.runs[1] = y;
    MS.mode = 'real'; MS.fid = 1;
    tep = makeTep($('#mon-canvas'), { limit: monLimit, method: monMethod, metric: monM, onTick: monTick });
    tep.setRun(1, y, !RM);
    renderMonitorControls(); paintReal();
  }
  function loadMonitor() {
    if (MS.mode !== 'idle') return;
    MS.mode = 'load';
    if (location.protocol === 'file:' || !window.fetch || !window.Promise) return startSim();
    Promise.all([monJSON('/data/tep/meta.json'), monJSON('/data/tep/idv01.json')]).then(function (r) { startReal(r[0], r[1]); })
      .catch(function (e) { if (window.console) console.warn('Monitor T²: sin datos reales, se muestra la simulación.', e); startSim(); });
  }
  function startMonitor() {
    var sec = $('#mon'); if (!sec || MS.mode !== 'idle') return;
    $('#mon-fault').addEventListener('change', function (e) { pickFault(+e.target.value); });
    $('#methods').addEventListener('keydown', function (e) {
      var ks = ['F', 'KDE', 'EMP'], d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return; e.preventDefault(); setMethod(ks[(ks.indexOf(S.method) + d + 3) % 3], true);
    });
    // Los datos se piden al acercarse a la sección; las corridas quedan en memoria.
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); loadMonitor(); } }, { rootMargin: '400px 0px' });
      io.observe(sec);
    } else loadMonitor();
  }

  /* ---------- visuales de cada caso ---------- */
  // Pestañas ARIA (facturas, dane): tabindex móvil (solo la activa entra en el orden de Tab; ←/→/Inicio/Fin cambian
  // de pestaña, ver onTabKey) y un panel etiquetado por la pestaña activa.
  function vizTabs(id, labels, tab, body) {
    return '<div class="tabs" role="tablist">' + labels.map(function (l, i) {
      var on = tab === i;
      return '<button type="button" role="tab" id="tab-' + id + '-' + i + '" aria-controls="panel-' + id + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" class="' + (on ? 'on' : '') + '" data-tab="' + i + '">' + l + '</button>';
    }).join('') + '</div><div role="tabpanel" id="panel-' + id + '" aria-labelledby="tab-' + id + '-' + tab + '" tabindex="0">' + body + '</div>';
  }
  var VIZ = {
    soat: {
      html: function () {
        var es = S.lang === 'es';
        var n = function (k, a, b, wide) { return '<div class="node' + (wide ? ' wide' : '') + '" data-step="' + k + '"><b>' + a + '</b><small>' + b + '</small></div>'; };
        // 28 s: mediana de 18 corridas de prueba, de la asignación del caso al abogado al análisis listo (no es el dictamen)
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big" id="soat-clock">0 s</span><span class="mono-s">' + (es ? 'mediana de la asignación del caso al análisis listo para el abogado' : 'median from case assignment to an analysis ready for the lawyer') + '</span>' +
          '<span class="mono-s viz-sub">' + (es ? '18 corridas de prueba · ramas en paralelo' : '18 test runs · branches in parallel') + '</span></div><button class="ghost" data-act="soat">↻ ' + esc(T().replay) + '</button></div>' +
          '<div class="flow">' + n(0, es ? 'Asignación' : 'Assignment', es ? 'caso al abogado' : 'case to lawyer') + '<span class="arr" data-step="1">→</span>' + n(1, 'EventBridge', 'SQS · DynamoDB') + '<span class="arr" data-step="2">→</span>' +
          '<div class="branch">' + n(2, es ? 'Rama póliza' : 'Policy branch', 'Textract · ' + (es ? 'reglas' : 'rules') + ' · ≈ 10 s') + n(2, es ? 'Rama médica' : 'Medical branch', 'Claude · Bedrock · ≈ 28 s') + '</div>' +
          '<span class="arr" data-step="3">→</span>' + n(3, es ? 'Regla de nexo' : 'Link rule', es ? 'sin nexo → revisión humana' : 'no link → human review') +
          '<span class="arr" data-step="4">→</span>' + n(4, es ? 'Análisis' : 'Analysis', '28 s') + '</div></div>';
      },
      init: function (el) {
        cancelAnimationFrame(VIZ.soat.raf);
        var t0 = performance.now(), dur = RM ? 1 : 4200, th = [0, 0.12, 0.35, 0.7, 0.92];
        function tick(now) {
          var p = Math.min(1, (now - t0) / dur), step = 0; th.forEach(function (v, i) { if (p >= v) step = i; });
          var c = $('#soat-clock', el); if (c) c.textContent = Math.round(p * 28) + ' s';
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
        var body;
        if (tab === 0) {
          // Claude Opus 5.5 en Bedrock: 240 / 240 como el LLM local (README de facturas-a-excel)
          body = [[es ? 'Reglas' : 'Rules', 67.1, 'var(--red)'], [es ? 'LLM local' : 'Local LLM', 100, 'var(--lime-ink)'], ['Claude Opus 5.5', 100, 'var(--lime-ink)'], [es ? 'Solo imagen' : 'Image only', 99.6, 'var(--blue)']].map(function (b) {
            return '<div class="hbar"><span>' + b[0] + '</span><div class="hbar-t"><div style="width:' + b[1] + '%;background:' + b[2] + '"></div></div><b>' + dec(b[1], 1) + ' %</b></div>';
          }).join('') + '<div class="viz-note">' + (es ? '20 facturas sintéticas · 240 campos · intervalos al 95 %: reglas 61–73 %; LLM local y Claude Opus 5.5, 98–100 %' : '20 synthetic invoices · 240 fields · 95% intervals: rules 61–73%; local LLM and Claude Opus 5.5, 98–100%') + '</div>';
        } else {
          var R = [[120, 99.6, 2], [85, 97.9, 6], [70, 90.0, 3], [55, 63.3, 0], [45, 37.9, 0], [38, 23.3, 0]];
          body = '<div class="stress"><div class="stress-h"><span>' + (es ? 'Resolución' : 'Resolution') + '</span><span>' + (es ? 'Campos exactos' : 'Exact fields') + '</span><span>' + (es ? 'Errores sin aviso' : 'Unflagged errors') + '</span></div>' +
            R.map(function (r) { return '<div class="stress-r' + (r[2] >= 5 ? ' hot' : '') + '"><span>' + r[0] + ' ppp</span><div class="hbar-t"><div style="width:' + r[1] + '%"></div></div><b>' + dec(r[1], 1) + ' %</b><em>' + r[2] + '</em></div>'; }).join('') + '</div>' +
            '<div class="viz-note">' + (es ? 'El riesgo está en la zona media: a 85 ppp pasaron 6 facturas con errores sin aviso; de 55 ppp hacia abajo todo se envía a revisión.' : 'The risk is in the middle: at 85 dpi, 6 invoices with errors passed unflagged; at 55 dpi and below everything goes to review.') + '</div>';
        }
        return '<div class="viz-pad">' + vizTabs('facturas', [es ? 'Campos exactos' : 'Exact fields', es ? 'Prueba de estrés' : 'Stress test'], tab, body) + '</div>';
      },
      init: function () {}
    },
    tfm: {
      html: function () {
        var es = S.lang === 'es', ids = [1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21];
        return '<div><canvas id="tfm-canvas" class="mini" role="img" aria-label="' + (es ? 'Simulación ilustrativa de una carta T² con una falla periódica; no son datos del TFM' : 'Illustrative T² chart simulation with a periodic fault; not thesis data') + '"></canvas><div class="viz-pad tight"><div class="verify"><div class="verify-h"><span class="big">17 / 18</span><span class="mono-s">' + (es ? 'verificación ciega contra Yin (2012) · tolerancia |ΔFDR| ≤ 0,5 pp fijada antes' : 'blind check against Yin (2012) · tolerance |ΔFDR| ≤ 0.5 pp fixed in advance') + '</span></div>' +
          '<div class="faults">' + ids.map(function (i) { return '<span class="' + (i === 19 ? 'miss' : 'hit') + '" title="IDV ' + i + '">' + i + '</span>'; }).join('') + '</div>' +
          // sobre el artículo de Yin et al. (2012), la misma cautela que la nota: un conteo posterior, no un error demostrado
          '<div class="viz-note">' + (es ? 'IDV 19: +1,00 pp, el doble de la tolerancia → veredicto «no verificado». Según un conteo posterior de la Figura 5, la cifra de la Tabla 4 para IDV 19 no es compatible con ella (<a href="/notas/17-de-18-no-verificado.html">ver la nota</a>).'
            : 'IDV 19: +1.00 pp, twice the tolerance → verdict “not verified”. According to a later count of Figure 5, the Table 4 value for IDV 19 is not compatible with it (<a href="/notas/17-de-18-no-verificado.html">see the note</a>).') + '</div></div></div></div>';
      },
      init: function (el) { if (VIZ.tfm.m) VIZ.tfm.m.stop(); var c = $('#tfm-canvas', el); if (c) VIZ.tfm.m = makeMonitor(c, { interval: RM ? 380 : 140, auto: true, window: 120, methodLabel: function () { return 'F'; } }); },
      stop: function () { if (VIZ.tfm.m) { VIZ.tfm.m.stop(); VIZ.tfm.m = null; } }
    },
    rgpd: {
      html: function () {
        var es = S.lang === 'es';
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big" id="rgpd-count">0</span><span class="mono-s">' + (es ? 'recursos Terraform' : 'Terraform resources') + '</span></div><button class="ghost" data-act="rgpd">↻ ' + esc(T().replay) + '</button></div>' +
          // colores por clase (.arc-*): salen de las variables CSS y cambian con el tema sin redibujar
          '<svg viewBox="0 0 600 210" class="arc" role="img" aria-label="us-east-1 → eu-central-1"><path class="arc-base" d="M80 170 Q300 -30 520 170" fill="none" stroke-width="2" stroke-dasharray="4 6"></path>' +
          '<path id="rgpd-path" class="arc-go" d="M80 170 Q300 -30 520 170" fill="none" stroke-width="2.5" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"></path>' +
          '<circle id="rgpd-dot" class="arc-dot" cx="80" cy="170" r="6"></circle><circle class="arc-from" cx="80" cy="170" r="9" fill="none"></circle><circle class="arc-to" cx="520" cy="170" r="9" fill="none"></circle>' +
          '<text class="arc-t1" x="80" y="200" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="13">us-east-1</text><text class="arc-t2" x="520" y="200" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="13">eu-central-1 · Frankfurt</text></svg>' +
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
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big">79</span><span class="mono-s">' + (es ? 'pruebas en verde del incremento 0 · el LLM nunca calcula una cifra declarable' : 'passing tests in increment 0 · the LLM never calculates a declarable figure') + '</span></div><button class="ghost" data-act="contable">▶ ' + (es ? 'Recorrer el flujo' : 'Walk the flow') + '</button></div>' +
          '<div class="flow">' + n(0, es ? 'Balance de prueba' : 'Trial balance', 'PUC') + '<span class="arr" data-step="1">→</span>' + n(1, es ? 'Motor de renta' : 'Tax engine', 'Python · Decimal · ' + (es ? 'redondeo a 1.000' : 'round to 1,000')) + '<span class="arr" data-step="2">→</span>' +
          n(2, es ? 'Borrador F-110 y 2516' : 'F-110 and 2516 draft', es ? 'cifras del motor' : 'engine figures') + '<span class="arr" data-step="3">→</span>' + n(3, es ? 'Aprobación humana' : 'Human approval', es ? 'obligatoria' : 'mandatory') + '</div>' +
          '<div class="side">' + n(2, es ? 'LLM + RAG normativo' : 'LLM + regulations RAG', es ? 'redacta y explica · nunca calcula' : 'drafts and explains · never calculates', 'llm') + n(3, es ? 'Bitácora de solo anexar' : 'Append-only audit log', es ? 'IAM · escritura condicional · hashes (aún sin construir)' : 'IAM · conditional writes · hashes (not yet built)', 'audit') + '</div>' +
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
        var hs = bars.map(function (v, i) { var h = on ? (i < 7 ? 0 : i === 7 ? v + neg : v) : v; return '<div style="height:' + (h / max * 100) + '%;background:' + (i < 7 ? 'var(--red)' : on && i === 7 ? 'var(--lime-ink)' : 'var(--blue-bar)') + '"></div>'; }).join('');
        return '<div class="viz-pad"><div class="viz-top"><div><span class="big" style="color:' + (on ? 'var(--lime-ink)' : 'var(--red-ink)') + '">' + (on ? '0 %' : '62 %') + '</span><span class="mono-s">' + (es ? 'valores imposibles' : 'impossible values') + '</span></div>' +
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
          // con scroll horizontal en pantallas estrechas: enfocable y con nombre, para desplazarla con el teclado
          '<div class="scroll-x" tabindex="0" role="region" aria-label="' + (es ? 'Matriz de F1-macro por modelo y método de balanceo' : 'Macro-F1 matrix by model and balancing method') + '"><div class="matrix">' + g + '</div></div><div class="viz-note">' + (es ? 'F1-macro · 289.693 registros · referencia de clase mayoritaria 0,13 · en lima, la mejor celda' : 'Macro-F1 · 289,693 records · majority-class baseline 0.13 · lime marks the best cell') + '</div></div>';
      },
      init: function () {}
    },
    dane: {
      html: function () {
        var es = S.lang === 'es', tab = VIZ.dane.tab || 0;
        var bars = tab === 0 ? [['Bogotá', 99.5, dec(99.5, 1) + ' %', 'var(--blue)'], ['Chocó', 28.5, dec(28.5, 1) + ' %', 'var(--red)']] : [[es ? 'Urbano' : 'Urban', 100 * 2.3 / 14.9, dec(2.3, 1) + ' %', 'var(--blue)'], ['Rural', 100, dec(14.9, 1) + ' %', 'var(--red)']];
        var body = bars.map(function (b) { return '<div class="hbar"><span>' + b[0] + '</span><div class="hbar-t"><div style="width:' + b[1] + '%;background:' + b[3] + '"></div></div><b>' + b[2] + '</b></div>'; }).join('') +
          '<div class="viz-note">' + (tab === 0 ? (es ? 'Cobertura de acueducto · censo DANE 2018' : 'Piped-water coverage · DANE 2018 census') : (es ? 'No saben leer ni escribir · 15 años o más · 6,6 veces más en zona rural' : 'Cannot read or write · aged 15+ · 6.6 times as many in rural areas')) + '</div>';
        return '<div class="viz-pad">' + vizTabs('dane', [es ? 'Acueducto' : 'Piped water', es ? 'Analfabetismo' : 'Illiteracy'], tab, body) + '</div>';
      },
      init: function () {}
    }
  };

  /* ---------- estado de las demos ---------- */
  // /data/estado.json lo escribe cada 15 min una Lambda (infra/estado.tf). Una demo con dos chequeos fallidos
  // seguidos se considera caída y su botón se cambia por un enlace a /estado.html. Si el archivo falta o tiene
  // más de 45 min, no se oculta nada: ante la duda, el botón se muestra.
  // El estado se dice también con texto (no solo con el color del punto): «todas operativas», «una demo caída»…
  var STATUS = null;
  function paintStatus() {
    var dot = $('#status-dot'), tx = $('#status-text'), t = T(); if (!dot || !tx) return;
    if (!STATUS) { dot.className = ''; tx.textContent = ''; return; }   // todavía sin respuesta
    var n = Object.keys(STATUS.down).length;
    dot.className = !STATUS.fresh ? '' : n ? 'down' : 'ok';
    tx.textContent = ' · ' + (!STATUS.fresh ? t.stNone : !n ? t.stOk : n === 1 ? t.stDown1 : t.stDownN.replace('{n}', n));
  }
  function loadStatus() {
    if (!window.fetch) return;
    var none = function () { STATUS = { down: {}, fresh: false }; paintStatus(); };
    fetch('/data/estado.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.historial || !j.demos) return none();
      var h = j.historial.slice(-2), down = {}, age = (Date.now() - Date.parse(j.actualizado)) / 60000;
      if (age <= 45 && h.length === 2) j.demos.forEach(function (d) {
        if (h.every(function (e) { return e.r && e.r[d.id] && e.r[d.id][0] === 0; })) down[d.id] = true;
      });
      STATUS = { down: down, fresh: age <= 45 };
      paintStatus();
      // Con un caso abierto no se repinta el diálogo (perdería el foco y reiniciaría su animación):
      // solo se cambia el botón de la demo si esa demo está caída.
      var c = S.open != null && D.cases[S.open];
      if (c && c.demo && demoDown(c)) {
        var a = $('#case .dlg-nav a[href="' + c.demo + '"]');
        if (a) {
          var nb = document.createElement('a'), had = document.activeElement === a;
          nb.className = 'tagbox'; nb.href = '/estado.html'; nb.textContent = T().demoDown;
          a.parentNode.replaceChild(nb, a);
          if (had) nb.focus({ preventScroll: true });
        }
      }
    }).catch(none);
  }
  function demoDown(c) { return !!(STATUS && STATUS.down[c.id]); }

  /* ---------- diálogos modales: pila, inert y foco ---------- */
  // Con un diálogo abierto, el resto de la página (y los diálogos de debajo) queda inert: Tab no sale del diálogo
  // y un lector de pantalla no lee lo de detrás. Cada diálogo recuerda qué tenía el foco al abrirse y se lo devuelve
  // al cerrarse. El orden de la pila decide qué cierra Esc.
  var MODALS = [];   // [{ el, ret }]; el último está encima
  function syncModals() {
    var top = MODALS.length ? MODALS[MODALS.length - 1].el : null;
    Array.prototype.forEach.call(document.body.children, function (c) {
      if (c.tagName === 'SCRIPT' || c.id === 'toast') return;   // el aviso (role=status) sigue anunciándose
      if (top && c !== top) c.setAttribute('inert', ''); else c.removeAttribute('inert');
    });
    // el bloqueo del scroll, como antes: con el caso o el resumen abiertos, no con la paleta
    document.body.classList.toggle('lock', MODALS.some(function (m) { return m.el.id !== 'palette'; }));
  }
  // Qué tenía el foco y, por si se vuelve a pintar (p. ej. al cambiar de idioma), cómo encontrarlo otra vez.
  var RET_ATTR = ['data-case', 'data-open', 'data-case-open', 'data-close', 'data-nav', 'data-close-summary', 'data-copy', 'data-tab', 'data-act', 'data-filter', 'data-method', 'data-theme-toggle'];
  function focusRef() {
    var a = document.activeElement, sel = null;
    if (!a || a === document.body || a === root) return null;
    if (a.id) sel = '#' + a.id;
    else for (var i = 0; i < RET_ATTR.length && !sel; i++) if (a.hasAttribute(RET_ATTR[i])) { var v = a.getAttribute(RET_ATTR[i]); sel = '[' + RET_ATTR[i] + (v ? '="' + v + '"' : '') + ']'; }
    return { el: a, sel: sel, nth: sel ? $$(sel).indexOf(a) : -1 };
  }
  function usable(el) { return !!el && document.contains(el) && el.getClientRects().length > 0 && !el.closest('[inert]'); }
  function restoreFocus(r) {
    if (!r) return;
    var el = usable(r.el) ? r.el : r.sel ? $$(r.sel)[Math.max(0, r.nth)] : null;
    if (usable(el)) el.focus({ preventScroll: true });
  }
  function modalOn(el, ret) { MODALS = MODALS.filter(function (m) { return m.el !== el; }); MODALS.push({ el: el, ret: ret }); syncModals(); }
  function modalOff(el) {
    var ret = null;
    MODALS = MODALS.filter(function (m) { if (m.el === el) { ret = m.ret; return false; } return true; });
    syncModals(); return ret;
  }
  function topModal() { return MODALS.length ? MODALS[MODALS.length - 1].el.id : null; }

  /* ---------- diálogo de caso ---------- */
  function stopViz() { if (VIZ.tfm.stop) VIZ.tfm.stop(); cancelAnimationFrame(VIZ.soat.raf); cancelAnimationFrame(VIZ.rgpd.raf); clearTimeout(VIZ.cotejo.t); clearTimeout(VIZ.contable.t); }
  function renderCase() {
    var t = T(), c = D.cases[S.open], v = VIZ[c.id];
    var status = c.status ? '<span class="badge">' + esc(c.status === 'building' ? t.building : t.ongoing) + '</span>' : '';
    var foot = (c.demo ? (demoDown(c) ? '<a class="tagbox" href="/estado.html">' + esc(t.demoDown) + '</a>' : '<a class="btn-lime sm" href="' + c.demo + '" target="_blank" rel="noopener">' + esc(t.demo) + ' ↗</a>') : '') +
      (c.lab ? '<a class="ghost lab-link" href="' + c.lab.href + '">' + esc(L(c.lab.l)) + ' →</a>' : '') +
      (c.repo ? '<a class="' + (c.demo ? 'ghost' : 'btn-lime sm') + '" href="' + c.repo + '" target="_blank" rel="noopener">' + esc(t.repo) + ' ↗</a>' : '') +
      (c.priv ? '<span class="tagbox">' + esc(t.private) + '</span>' : '') + (c.local ? '<span class="tagbox">' + esc(t.local) + '</span>' : '');
    $('#case-body').innerHTML =
      '<div class="dlg-bar"><span>' + String(S.open + 1).padStart(2, '0') + ' · ' + esc(L(c.kicker)) + '</span><button class="ghost" data-close>' + esc(t.close) + ' · Esc</button></div>' +
      '<div class="dlg-in">' + status + '<h2 id="case-title">' + esc(L(c.title)) + '</h2>' +
      '<div class="viz" id="viz">' + v.html() + '</div>' +
      '<div class="kpis">' + c.metrics.map(function (m) { return '<div><b>' + esc(L(m[0])) + '</b><span>' + esc(L(m[1])) + '</span></div>'; }).join('') + '</div>' +
      '<div class="cols"><div><h3>' + esc(t.problem) + '</h3><p>' + esc(L(c.problem)) + '</p></div><div><h3>' + esc(t.did) + '</h3><p>' + esc(L(c.did)) + '</p></div>' +
      '<div><h3>' + esc(t.decisions) + '</h3><ul class="dash">' + L(c.decisions).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h3>' + esc(t.result) + '</h3><ul class="dot">' + L(c.results).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div></div>' +
      '<div class="dlg-foot"><div class="tags">' + c.tags.map(function (g) { return '<span>' + esc(L(g)) + '</span>'; }).join('') + '</div>' +
      '<div class="dlg-nav">' + foot + '<button class="ghost" data-nav="-1" aria-label="' + esc(t.prev) + '">←</button><button class="ghost" data-nav="1" aria-label="' + esc(t.next) + '">→</button></div></div></div>';
    stopViz(); v.init($('#viz'));
  }
  function caseFromHash() { var m = /^#caso-([a-z0-9-]+)$/.exec(location.hash); return m ? caseIndex(m[1]) : -1; }
  // al cerrar solo se quita un #caso-*; cualquier otro fragmento se deja como está
  function setCaseHash(i) {
    try {
      if (i != null) history.replaceState(null, '', '#caso-' + D.cases[i].id);
      else if (/^#caso-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {}
  }
  function focusClose() { var b = $('#case [data-close]'); if (b) b.focus({ preventScroll: true }); }
  // Cambiar de caso con el diálogo abierto (flechas, ← →, hash o paleta): estado del visual a cero y el foco
  // en el mismo control si estaba en ← → (si estaba en otro sitio del diálogo, en Cerrar), para que no se pierda al repintar.
  function showCase(i) {
    var a = document.activeElement, keep = a && a.closest && a.closest('#case') ? (a.hasAttribute('data-nav') ? '[data-nav="' + a.getAttribute('data-nav') + '"]' : '[data-close]') : null;
    S.open = (i + D.cases.length) % D.cases.length; VIZ.facturas.tab = 0; VIZ.dane.tab = 0; VIZ.ctgan.clip = false; VIZ.smote.cmp = false;
    renderCase(); setCaseHash(S.open);
    if (keep) { var b = $('#case ' + keep); if (b) b.focus({ preventScroll: true }); }
  }
  function openCase(i) {
    if (i < 0 || i >= D.cases.length) return;
    if (S.open != null) { showCase(i); if (!$('#case').contains(document.activeElement)) focusClose(); return; }
    var ret = focusRef();
    if (!$('#summary').hidden) ret = closeSummary(true);   // el caso sustituye al resumen (si no, quedaría debajo de él)
    // la tarjeta solo da forma a la transición; el foco vuelve a quien abrió el caso
    var card = $('[data-case="' + i + '"]');
    if (card) card.style.viewTransitionName = 'case-hero';
    vt(function () {
      if (card) card.style.viewTransitionName = '';
      S.open = i; renderCase(); setCaseHash(i); $('#case').hidden = false; modalOn($('#case'), ret);
      $('#case-dialog').style.viewTransitionName = 'case-hero';
    });
    setTimeout(focusClose, 60);
  }
  // keep: no devolver el foco (otra acción decide dónde va)
  function closeCase(keep) {
    if (S.open == null) return;
    var card = $('[data-case="' + S.open + '"]'), ret = null;
    setCaseHash(null);
    var tr = vt(function () { stopViz(); $('#case').hidden = true; S.open = null; ret = modalOff($('#case')); $('#case-dialog').style.viewTransitionName = ''; if (card) card.style.viewTransitionName = 'case-hero'; });
    function clear() { if (card) card.style.viewTransitionName = ''; if (!keep) restoreFocus(ret); }
    if (tr && tr.finished) tr.finished.then(clear, clear); else clear();
  }
  function navCase(d) { showCase(S.open + d); }

  /* ---------- resumen de una página ---------- */
  function renderSummary() {
    var t = T(), tl = D.timeline.map(function (e) { return { y: L(e[0]), k: e[1], r: L(e[2]), o: L(e[3]) }; });
    var item = function (e) { return '<div class="rc-i"><div><b>' + esc(e.r) + '</b><span>' + esc(e.y) + '</span></div><small>' + esc(e.o) + '</small></div>'; };
    $('#summary-body').innerHTML =
      '<div class="rc-top"><div><h2>Pablo Alberto Duque Marín</h2><p class="rc-role">' + esc(t.rcHead) + '</p><p class="rc-meta">Caldas, Colombia · ' + esc(t.remote) + ' (UTC−5) · ' + D.email + ' · github.com/pabdus · linkedin.com/in/pablo-alberto-duque-marin</p></div>' +
      '<div class="rc-actions"><a class="btn-dark" href="' + cvHref() + '" download>' + esc(t.cvLong) + '</a><button class="btn-line" data-copy>' + esc(t.aCopy) + '</button><button class="btn-line" data-close-summary>' + esc(t.close) + '</button></div></div>' +
      '<div class="rc-stats">' + D.heroStats.map(function (s) { return '<div><b>' + esc(L(s.v)) + '</b><span>' + esc(L(s.l)) + '</span></div>'; }).join('') + '</div>' +
      '<div class="rc-cols"><div><h3>' + t.rcExp + '</h3>' + tl.filter(function (e) { return e.k === 'w'; }).map(item).join('') + '<h3>' + t.rcEdu + '</h3>' + tl.filter(function (e) { return e.k === 'e'; }).map(item).join('') + '</div>' +
      '<div><h3>' + t.rcCases + '</h3>' + D.cases.map(function (c) { return '<div class="rc-c"><span>' + esc(L(c.title)) + '</span><b>' + esc(L(c.mv)) + '</b></div>'; }).join('') +
      '<h3>' + t.rcStack + '</h3><div class="rc-stack">' + D.summaryStack.map(function (k) { return '<span>' + esc(k) + '</span>'; }).join('') + '</div><h3>' + t.rcLang + '</h3><p>' + esc(t.rcLangs) + '</p></div></div>';
  }
  function openSummary() {
    var s = $('#summary');
    if (s.hidden) { var ret = focusRef(); renderSummary(); s.hidden = false; modalOn(s, ret); } else renderSummary();
    setTimeout(function () { var b = $('[data-close-summary]'); if (b) b.focus({ preventScroll: true }); }, 30);
  }
  // keep: no devolver el foco; devuelve a quién había que devolvérselo
  function closeSummary(keep) { var s = $('#summary'); if (s.hidden) return null; s.hidden = true; var r = modalOff(s); if (!keep) restoreFocus(r); return r; }

  /* ---------- paleta de comandos ---------- */
  function go(id, focus) {
    var el = document.getElementById(id); if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: RM ? 'auto' : 'smooth' });
    // desde la paleta, el foco pasa a la sección (sin anillo: no es un control) y Tab sigue desde ahí
    if (focus) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
  }
  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function paletteItems() {
    var t = T(), q = norm(S.query);
    var items = [['trabajo', t.navWork], ['competencias', t.navSkills], ['metodo', t.navMethod], ['laboratorio', t.navLab], ['trayectoria', t.navPath], ['contacto', t.navContact]].map(function (s) {
      return { l: s[1], g: t.gSec, run: function () { var was = S.open != null; closePalette(true); closeCase(true); closeSummary(true); setTimeout(function () { go(s[0], true); }, was ? 120 : 30); } };
    })
      // los casos se encuentran también por su antetítulo y su id («tfm», «soat»…), como en /#caso-tfm
      .concat(D.cases.map(function (c, i) { return { l: L(c.title), g: t.gCase, s: L(c.kicker) + ' ' + c.id, run: function () { closePalette(); setTimeout(function () { openCase(i); }, 30); } }; }))
      .concat([
        { l: t.aSummary, g: t.gAct, run: function () { closePalette(); openSummary(); } },
        { l: t.aLang, g: t.gAct, run: function () { closePalette(); toggleLang(); } },
        { l: t.themeAria + ' · ' + (isLight() ? t.themeDark : t.themeLight), g: t.gAct, run: function () { closePalette(); toggleTheme(); } },
        { l: t.aCopy, g: t.gAct, run: function () { closePalette(); copyEmail(); } },
        { l: t.aCv, g: t.gAct, run: function () { closePalette(); var a = document.createElement('a'); a.href = cvHref(); a.download = ''; a.click(); } },
        { l: 'GitHub · pabdus', g: t.gAct, run: function () { closePalette(); window.open(D.links.github, '_blank', 'noopener'); } },
        { l: 'LinkedIn', g: t.gAct, run: function () { closePalette(); window.open(D.links.linkedin, '_blank', 'noopener'); } }
      ]);
    return q ? items.filter(function (it) { return norm(it.l + ' ' + it.g + ' ' + (it.s || '')).indexOf(q) >= 0; }) : items;
  }
  // Combobox: el foco se queda en el campo y aria-activedescendant dice qué opción está resaltada.
  var palList = [];
  function renderPalette() {
    var t = T(), inp = $('#pal-input'); palList = paletteItems(); S.sel = Math.min(S.sel, Math.max(0, palList.length - 1));
    $('#pal-list').innerHTML = palList.length ? palList.map(function (p, i) { return '<button type="button" role="option" tabindex="-1" id="pal-opt-' + i + '" aria-selected="' + (i === S.sel) + '" class="' + (i === S.sel ? 'on' : '') + '" data-pi="' + i + '"><span>' + esc(p.l) + '</span><small>' + esc(p.g) + '</small></button>'; }).join('') : '<div class="pal-empty">' + esc(t.palEmpty) + '</div>';
    inp.setAttribute('aria-expanded', String(palList.length > 0));
    if (palList.length) { inp.setAttribute('aria-activedescendant', 'pal-opt-' + S.sel); var o = $('#pal-opt-' + S.sel); if (o) o.scrollIntoView({ block: 'nearest' }); }
    else inp.removeAttribute('aria-activedescendant');
  }
  function openPalette() {
    var p = $('#palette'); if (!p.hidden) return;
    var ret = focusRef(); S.query = ''; S.sel = 0; var inp = $('#pal-input'); inp.value = ''; inp.placeholder = T().palPh; renderPalette();
    p.hidden = false; modalOn(p, ret); setTimeout(function () { inp.focus(); }, 20);
  }
  function closePalette(keep) { var p = $('#palette'); if (p.hidden) return null; p.hidden = true; var r = modalOff(p); if (!keep) restoreFocus(r); return r; }

  /* ---------- menú móvil ---------- */
  function setMenu(open) { $('#mnav').hidden = !open; $('#menu-btn').setAttribute('aria-expanded', String(open)); }

  /* ---------- acciones ---------- */
  function copyEmail() {
    function ok() { toast(T().toastCopied); $$('[data-copy]').forEach(function (b) { b.classList.add('done'); }); setTimeout(function () { $$('[data-copy]').forEach(function (b) { b.classList.remove('done'); }); }, 1800); }
    function fb() { var a = document.createElement('textarea'); a.value = D.email; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); ok(); }
    if (navigator.clipboard) navigator.clipboard.writeText(D.email).then(ok, fb); else fb();
  }
  // al repintar en el otro idioma, el control que tenía el foco se recupera (si no, el foco caería en <body>)
  function toggleLang() {
    var r = focusRef(); S.lang = S.lang === 'es' ? 'en' : 'es'; try { localStorage.setItem('pd-lang', S.lang); } catch (e) {}
    vt(function () { renderAll(); renderMonitorControls(); var a = document.activeElement; if (!a || a === document.body) restoreFocus(r); });
  }

  /* ---------- eventos ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button, a');
    // el menú se cierra al elegir algo, salvo el cambio de tema (así se ve el resultado y el foco no se pierde)
    if (!$('#mnav').hidden && (!el || (el.id !== 'menu-btn' && !el.hasAttribute('data-theme-toggle')))) { setMenu(false); if (el && el.hasAttribute('data-palette')) { $('#menu-btn').focus({ preventScroll: true }); return openPalette(); } }
    if (!el) { if (e.target.id === 'case') closeCase(); if (e.target.id === 'summary') closeSummary(); if (e.target.id === 'palette') closePalette(); return; }
    if (el.id === 'menu-btn') return setMenu($('#mnav').hidden);
    if (el.id === 'sk-more') { S.skillsAll = !S.skillsAll; if (!S.skillsAll) { S.filter = 'all'; go('competencias'); } return vt(renderSkills); }
    if (el.hasAttribute('data-case')) return openCase(+el.getAttribute('data-case'));
    if (el.hasAttribute('data-case-open')) return openCase(+el.getAttribute('data-case-open'));
    if (el.hasAttribute('data-open')) return openCase(caseIndex(el.getAttribute('data-open')));
    if (el.hasAttribute('data-close')) return closeCase();
    if (el.hasAttribute('data-nav')) return navCase(+el.getAttribute('data-nav'));
    if (el.hasAttribute('data-filter')) { S.filter = el.getAttribute('data-filter'); return vt(renderSkills); }
    if (el.hasAttribute('data-method')) return setMethod(el.getAttribute('data-method'));
    if (el.id === 'fault-btn') { if (!mon) return; S.fault = !S.fault; mon.setFault(S.fault); return renderMonitorControls(); }
    if (el.id === 'mon-play') return monToggle();
    if (el.id === 'mon-restart') { if (tep) tep.restart(); return; }
    if (el.id === 'lang-btn') return toggleLang();
    if (el.hasAttribute('data-theme-toggle')) return toggleTheme();
    if (el.id === 'summary-btn') return openSummary();
    if (el.hasAttribute('data-close-summary')) return closeSummary();
    if (el.hasAttribute('data-copy')) return copyEmail();
    if (el.hasAttribute('data-pi')) return palList[+el.getAttribute('data-pi')].run();
    if (el.hasAttribute('data-tab')) return setVizTab(+el.getAttribute('data-tab'));
    var act = el.getAttribute('data-act');
    if (act) {
      var v = $('#viz');
      if (act === 'soat' || act === 'rgpd' || act === 'cotejo' || act === 'contable') VIZ[act].init(v);
      // el visual se repinta: el foco vuelve al mismo interruptor
      if (act === 'clip') { VIZ.ctgan.clip = !VIZ.ctgan.clip; v.innerHTML = VIZ.ctgan.html(); refocus('[data-act="clip"]'); }
      if (act === 'cmp') { VIZ.smote.cmp = !VIZ.smote.cmp; v.innerHTML = VIZ.smote.html(); refocus('[data-act="cmp"]'); }
    }
  });
  function refocus(sel) { var b = $('#viz ' + sel); if (b) b.focus({ preventScroll: true }); }
  function setVizTab(n) { var id = D.cases[S.open].id; VIZ[id].tab = n; $('#viz').innerHTML = VIZ[id].html(); refocus('[data-tab="' + n + '"]'); }
  // pestañas de los visuales: ←/→ (en círculo), Inicio y Fin; la pestaña elegida se activa al llegar a ella
  document.addEventListener('keydown', function (e) {
    var tab = e.target && e.target.closest && e.target.closest('#viz [role="tab"]'); if (!tab || S.open == null || e.altKey || e.ctrlKey || e.metaKey) return;
    var tabs = $$('#viz [role="tab"]'), i = tabs.indexOf(tab), k = e.key, n = -1;
    if (k === 'ArrowRight') n = (i + 1) % tabs.length; else if (k === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length; else if (k === 'Home') n = 0; else if (k === 'End') n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault(); setVizTab(n);
  });
  $('#pal-input').addEventListener('input', function (e) { S.query = e.target.value; S.sel = 0; renderPalette(); });
  $('#pal-input').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); S.sel = (S.sel + 1) % Math.max(1, palList.length); renderPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.sel = (S.sel - 1 + palList.length) % Math.max(1, palList.length); renderPalette(); }
    else if (e.key === 'Enter' && palList[S.sel]) { e.preventDefault(); palList[S.sel].run(); }
  });
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('#palette').hidden) openPalette(); else closePalette(); return; }
    // Esc cierra el diálogo que está encima (la paleta puede estar sobre un caso, y el resumen también)
    if (e.key === 'Escape') {
      if (!$('#mnav').hidden) { setMenu(false); $('#menu-btn').focus(); return; }
      var top = topModal(); if (top === 'palette') closePalette(); else if (top === 'case') closeCase(); else if (top === 'summary') closeSummary();
      return;
    }
    // ←/→ cambian de caso solo si el caso está encima y el foco no está en un control que use las flechas
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && topModal() === 'case' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      var t = e.target;
      if (t && t.closest && t.closest('[role=tablist],[role=tabpanel],[role=radiogroup],[role=switch],[role=listbox],[role=slider],.scroll-x,input,select,textarea,[contenteditable]')) return;
      navCase(e.key === 'ArrowRight' ? 1 : -1);
    }
  });

  /* sección activa en la navegación */
  if ('IntersectionObserver' in window) {
    // Servicios no tiene enlace propio en la barra: mientras se ve, no se marca ninguno
    var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { var id = en.target.id; $$('.nav-links a, .mnav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + id); }); } }); }, { rootMargin: '-40% 0px -55% 0px' });
    ['trabajo', 'competencias', 'metodo', 'laboratorio', 'trayectoria', 'servicios', 'contacto'].forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  // Atrás/Adelante: si el fragmento deja de ser #caso-*, el caso se cierra; si es otro caso, se cambia con el estado a cero
  window.addEventListener('hashchange', function () {
    var i = caseFromHash();
    if (i < 0) { if (S.open != null && !/^#caso-/.test(location.hash)) closeCase(); return; }
    if (i === S.open) return;
    if (S.open != null) showCase(i); else openCase(i);
  });

  renderAll(); renderMonitorControls(); startMonitor(); loadStatus();
  if (caseFromHash() >= 0) openCase(caseFromHash());
})();
