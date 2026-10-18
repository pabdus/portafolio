/* Facturas: mide tú mismo.
   Lee /data/facturas/eval.json una sola vez y dibuja, sin dependencias:
   - por extractor, la matriz factura × campo (acierto o «esperado → leído»), el estado de validación y el resumen;
   - el modo comparar (dos lado a lado o la tabla de todos);
   - el botón de la demo en vivo, que se cambia por un enlace a /estado.html si la demo está caída (LAB.demoDown);
   - la prueba de estrés por resolución, que solo existe para el LLM local con imagen.
   Cifras tal como vienen en eval.json; aquí solo se suman filas para la selección filtrada. */
(function () {
  'use strict';

  var L = window.LAB || { lang: function () { return 'es'; }, onLang: function () {}, theme: function () { return 'dark'; } };
  var D = null, EXT = {}, LV = {}, TIPS = new WeakMap();
  var S = { t: 'ext', m: 'uno', e: 'reglas', a: 'llm', b: 'vision', p: 120, fp: 'all', fs: 'all', fn: 'all', fr: 'all' };
  var touched = false;

  var SHORT = {
    numero: 'Número|Number', fecha_emision: 'Emisión|Issued', fecha_vencimiento: 'Vencimiento|Due',
    emisor_nombre: 'Emisor|Supplier', emisor_nit: 'NIT emisor|Supplier NIT', cliente_nombre: 'Cliente|Customer',
    cliente_nit: 'NIT cliente|Customer NIT', subtotal: 'Subtotal|Subtotal', descuento: 'Descuento|Discount',
    iva: 'IVA|VAT', retencion: 'Retención|Withholding', total: 'Total|Total'
  };
  var GROUP = { emisor_nombre: 1, cliente_nombre: 1, subtotal: 1 };
  var VIA = { 'texto': 'text', 'texto o imagen': 'text or image', 'imagen': 'image', 'pdf': 'PDF' };
  var WHERE = { reglas: 'local|local', llm: 'Ollama, portátil|Ollama, laptop', vision: 'Ollama, portátil|Ollama, laptop', claude: 'Amazon Bedrock|Amazon Bedrock', 'claude-haiku': 'Amazon Bedrock|Amazon Bedrock' };
  var STYLE_EN = { A: 'hardware store e-invoice', B: 'tech, dark header', C: 'professional services letter', D: 'supermarket, monospaced type', E: 'transport and farm supplies' };

  /* ------------------------------------------------------------ utilidades */
  function en() { return L.lang() === 'en'; }
  function tt(es, x) { return en() ? x : es; }
  function lt(s) { var p = String(s).split('|'); return p.length === 2 ? p[en() ? 1 : 0] : s; }
  function nm(o) { return o == null ? '' : (o[L.lang()] != null ? o[L.lang()] : o.es); }
  function $(id) { return document.getElementById(id); }
  var NF = {};
  function fmt(x, d) {
    var k = L.lang() + d;
    if (!NF[k]) NF[k] = new Intl.NumberFormat(en() ? 'en-US' : 'es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
    return NF[k].format(x);
  }
  function pc(v) { var s = v >= 1 ? '100' : fmt(v * 100, 1); return en() ? s + '%' : s + '\u00a0%'; }
  function pk(a) { return pc(a[0] / a[1]); }
  function frac(a) { return a[0] + ' / ' + a[1]; }
  function slim(a, b) { return a + '\u2009/\u2009' + b; }
  function icr(a) {
    var lo = fmt(a[0] * 100, 1), hi = a[1] >= 1 ? '100' : fmt(a[1] * 100, 1);
    return lo + '–\u2060' + hi + (en() ? '%' : '\u00a0%');
  }
  function ic(a) { return tt('IC\u00a095\u00a0%: ', '95%\u00a0CI: ') + icr(a); }
  function num(id) { return String(id).replace(/^factura_/, ''); }
  function list(a) {
    if (a.length < 2) return a.join('');
    return a.slice(0, -1).join(', ') + tt(' y ', ' and ') + a[a.length - 1];
  }
  function ppp(v) { return v + (en() ? ' dpi' : ' ppp'); }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function isSil(x) { return !x.rv && (x.sil || !x.ok); }
  function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function h(tag, at, kids) {
    var e = document.createElement(tag);
    if (at) for (var k in at) {
      var v = at[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : String(v));
    }
    add(e, kids);
    return e;
  }
  function add(e, kids) {
    if (kids == null) return;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c == null || c === false || c === '') return;
      if (Array.isArray(c)) { add(e, c); return; }
      e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
  }
  function sv(tag, at, txt) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in at) if (at[k] != null) e.setAttribute(k, String(at[k]));
    if (txt != null) e.textContent = txt;
    return e;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* ------------------------------------------------------------ estado en la URL (#t=…&e=…) para compartir una vista */
  function readHash() {
    var q = location.hash.replace(/^#/, '');
    if (q.indexOf('=') < 0) return;
    q.split('&').forEach(function (kv) {
      var p = kv.split('='), k = p[0], v = '';
      try { v = decodeURIComponent(p[1] || ''); } catch (e) { return; }
      if (k === 't' && /^(ext|estres)$/.test(v)) S.t = v;
      else if (k === 'm' && /^(uno|comparar|cinco)$/.test(v)) S.m = v;
      else if ((k === 'e' || k === 'a' || k === 'b') && EXT[v]) S[k] = v;
      else if (k === 'p' && LV[+v]) S.p = +v;
      else if (k === 'fp' && /^(all|[A-E])$/.test(v)) S.fp = v;
      else if (k === 'fs' && /^(all|esc|dig)$/.test(v)) S.fs = v;
      else if (k === 'fn' && /^(all|nuevo|conocido)$/.test(v)) S.fn = v;
      else if (k === 'fr' && /^(all|err|sil)$/.test(v)) S.fr = v;
    });
  }
  function writeHash() {
    if (!touched) return;
    var p = ['t=' + S.t];
    if (S.t === 'ext') { p.push('m=' + S.m); if (S.m === 'uno') p.push('e=' + S.e); if (S.m === 'comparar') p.push('a=' + S.a, 'b=' + S.b); }
    else p.push('p=' + S.p);
    ['fp', 'fs', 'fn', 'fr'].forEach(function (k) { if (S[k] !== 'all') p.push(k + '=' + S[k]); });
    try { history.replaceState(null, '', '#' + p.join('&')); } catch (e) {}
  }

  /* ------------------------------------------------------------ controles */
  function radios(cls, label, opts, cur, key, onPick, labelledby) {
    var g = h('div', { class: cls, role: 'radiogroup', 'aria-label': labelledby ? null : label, 'aria-labelledby': labelledby || null });
    opts.forEach(function (o) {
      var on = String(o.v) === String(cur);
      var b = h('button', { type: 'button', class: o.cls || null, role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1', 'data-fk': key + ':' + o.v, 'aria-label': o.aria || null }, o.kids);
      b.addEventListener('click', function () { onPick(o.v); });
      g.appendChild(b);
    });
    g.addEventListener('keydown', radioKeys);
    return g;
  }
  function radioKeys(ev) {
    var k = ev.key;
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].indexOf(k) < 0) return;
    var bs = [].slice.call(ev.currentTarget.querySelectorAll('[role="radio"]'));
    var i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    var n = k === 'Home' ? 0 : k === 'End' ? bs.length - 1 : (i + (k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length;
    bs[n].focus();
    bs[n].click();
  }
  function update(patch) {
    touched = true;
    for (var k in patch) S[k] = patch[k];
    render(true);
  }

  /* ------------------------------------------------------------ textos del globo y de los lectores de pantalla */
  function vExp(v) { return v == null ? tt('vacío (no viene en la factura)', 'empty (not on the invoice)') : String(v); }
  function vGot(v) { return v == null ? tt('no leído', 'not read') : String(v); }
  function seg(t, c) { return [t, c || '']; }

  function tipField(f, x, j) {
    var c = D.campos[j], head = tt('Factura ', 'Invoice ') + num(f.id) + ' · ' + nm(c);
    if (x.f[j] === 1) {
      return { head: head, rows: [[seg(tt('correcto', 'correct'), 'ok')], [seg(vExp(f.v[j]))]],
        aria: head + '. ' + tt('Correcto: ', 'Correct: ') + vExp(f.v[j]) };
    }
    var e = x.e && x.e[c.id], exp = e ? e[0] : f.v[j], got = e ? e[1] : null;
    return { head: head, rows: [[seg(tt('esperado → leído', 'expected → read'), 'k')], [seg(vExp(exp)), seg(' → ', 'k'), seg(vGot(got), 'x')]],
      aria: head + '. ' + tt('Error. Esperado: ', 'Error. Expected: ') + vExp(exp) + '. ' + tt('Leído: ', 'Read: ') + vGot(got) };
  }

  function tipLines(f, x) {
    var l = x.l, head = tt('Factura ', 'Invoice ') + num(f.id) + ' · ' + tt('líneas de detalle', 'line items');
    var vis = slim(l[0], l[2]);
    var rows = [[seg(tt(l[0] + ' de ' + l[2] + ' exactas', l[0] + ' of ' + l[2] + ' exact'), l[0] === l[2] ? 'ok' : 'x'),
      seg(tt(' · leídas ' + l[1] + ' de ' + f.nl + ' esperadas', ' · ' + l[1] + ' read of ' + f.nl + ' expected'), 'k')]];
    if (l[1] === 0 && f.nl > 0) rows.push([seg(tt('No entregó ninguna línea utilizable.', 'It returned no usable line items.'))]);
    (x.le || []).forEach(function (q) {
      var cl = null;
      D.campos_linea.forEach(function (c) { if (c.id === q[1]) cl = c; });
      rows.push([seg(tt('Línea ', 'Line ') + q[0] + ' · ' + nm(cl) + ': ', 'k'), seg(vExp(q[2])), seg(' → ', 'k'), seg(vGot(q[3]), 'x')]);
    });
    var falt = f.nl - l[1], sob = l[1] - f.nl;
    if (l[1] < f.nl && l[1] > 0) rows.push([seg(falt === 1 ? tt('Falta 1 línea.', '1 line missing.') : tt('Faltan ' + falt + ' líneas.', falt + ' lines missing.'), 'x')]);
    if (l[1] > f.nl) rows.push([seg(sob === 1 ? tt('Leyó 1 línea de más.', '1 extra line read.') : tt('Leyó ' + sob + ' líneas de más.', sob + ' extra lines read.'), 'x')]);
    return { head: head, rows: rows, vis: vis };
  }

  function chq(id) {
    var r = id;
    D.chequeos.forEach(function (c) { if (c.id === id) r = nm(c); });
    return r;
  }
  function provErr(f) {
    if (!f.err) return '';
    var e = D.errores_proveedor[f.err];
    return nm(e) + (f.dif_total ? tt(' (diferencia ', ' (difference ') + f.dif_total + ')' : '');
  }

  function tipVal(f, x) {
    var head = tt('Factura ', 'Invoice ') + num(f.id) + ' · ' + tt('validación', 'validation'), rows = [], vis;
    if (x.rv) {
      vis = tt('a revisión', 'to review');
      rows.push([seg(tt('Fue a revisión.', 'Sent to review.'), 'ok')]);
      if (x.mot) rows.push([seg(tt('Chequeos que fallaron: ', 'Failed checks: '), 'k'), seg(x.mot.map(chq).join('; '))]);
      if (x.ok && !f.err) rows.push([seg(tt('Falsa alarma: la factura estaba bien leída.', 'False alarm: the invoice was read correctly.'), 'x')]);
    } else if (isSil(x)) {
      vis = tt('sin aviso', 'no warning');
      rows.push([seg(tt('No fue a revisión: el error llegó al Excel sin aviso.', 'Not sent to review: the error reached the spreadsheet with no warning.'), 'x')]);
    } else {
      vis = tt('pasa', 'passes');
      rows.push([seg(tt('Pasó la validación y estaba bien leída.', 'Passed the validation and was read correctly.'), 'ok')]);
    }
    if (f.err) rows.push([seg(tt('Error del proveedor: ', 'Supplier error: '), 'k'), seg(provErr(f)), seg(x.rv ? tt(' · detectado', ' · caught') : tt(' · no detectado', ' · not caught'), x.rv ? 'ok' : 'x')]);
    if (x.rv16 != null) rows.push([seg('† ' + (x.rv16 ? tt('Con el criterio actual (decisión 16) iría a revisión.', 'Under the current rule (decision 16) it would go to review.') : tt('Con el criterio actual (decisión 16) no iría a revisión.', 'Under the current rule (decision 16) it would not go to review.')), 'k')]);
    return { head: head, rows: rows, vis: vis };
  }

  function tipInv(f, x, stress) {
    var head = tt('Factura ', 'Invoice ') + num(f.id), rows = [];
    rows.push([seg(tt('Plantilla ', 'Template ') + f.p + ' · ' + nm(D.plantillas[f.p]) + ' · ' + (en() ? STYLE_EN[f.p] : String(D.plantillas[f.p].estilo || '').toLowerCase()))]);
    if (stress) rows.push([seg(tt('Escaneada de nuevo a ', 'Rescanned at ') + ppp(S.p), 'k')]);
    else rows.push([seg(f.esc ? tt('Escaneada: sin capa de texto', 'Scanned: no text layer') : tt('Digital: con capa de texto', 'Digital: has a text layer'), 'k')]);
    if (f.nuevo) rows.push([seg(tt('Plantilla nueva: ni las reglas ni el prompt la conocían', 'New template: neither the rules nor the prompt had seen it'), 'k')]);
    if (f.err) rows.push([seg(tt('Error del proveedor: ', 'Supplier error: '), 'k'), seg(provErr(f))]);
    rows.push([seg(x.ok ? tt('Leída 100 % bien', 'Read 100% correctly') : tt('Con errores de lectura', 'Has reading errors'), x.ok ? 'ok' : 'x'),
      seg(isSil(x) ? tt(' · pasó sin aviso', ' · slipped through with no warning') : (x.rv ? tt(' · fue a revisión', ' · sent to review') : ''), isSil(x) ? 'x' : 'k')]);
    if (x.s != null) rows.push([seg(tt('Tiempo: ', 'Time: '), 'k'), seg(fmt(x.s, 2) + ' s'), seg(x.tk ? ' · tokens: ' + fmt(x.tk[0], 0) + tt(' de entrada, ', ' in, ') + fmt(x.tk[1], 0) + tt(' de salida', ' out') : '', 'k')]);
    return { head: head, rows: rows, vis: num(f.id) };
  }

  function tipText(t) {
    if (t.aria) return t.aria;
    var s = t.rows.map(function (r) { return r.map(function (q) { return q[0]; }).join(''); }).join('. ').replace(/ → /g, tt(' leído: ', ' read: '));
    return (t.vis ? t.vis + ' — ' : '') + t.head + '. ' + s;
  }

  /* ------------------------------------------------------------ globo de detalle */
  var tipEl = null, tipAt = null;
  function showTip(b) {
    var t = TIPS.get(b);
    if (!t || !tipEl) return;
    if (tipAt && tipAt !== b) tipAt.classList.remove('is-tip');
    tipAt = b;
    b.classList.add('is-tip');
    tipEl.textContent = '';
    tipEl.appendChild(h('div', { class: 'h' }, t.head));
    t.rows.forEach(function (r) {
      var d = h('div');
      r.forEach(function (q) { if (q[0] !== '') d.appendChild(q[1] ? h('span', { class: q[1] }, q[0]) : document.createTextNode(q[0])); });
      tipEl.appendChild(d);
    });
    tipEl.hidden = false;
    place();
  }
  function hideTip() {
    if (tipAt) tipAt.classList.remove('is-tip');
    tipAt = null;
    if (tipEl) tipEl.hidden = true;
  }
  function place() {
    if (!tipAt || !tipEl || tipEl.hidden) return;
    if (!document.body.contains(tipAt)) { hideTip(); return; }
    var r = tipAt.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) { hideTip(); return; }
    var tw = tipEl.offsetWidth, th = tipEl.offsetHeight, gap = 8;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, vw - tw - 8));
    var top = r.top - th - gap;
    if (top < 60) top = r.bottom + gap;
    if (top + th > vh - 8) top = Math.max(8, vh - th - 8);
    tipEl.style.left = Math.round(left) + 'px';
    tipEl.style.top = Math.round(top) + 'px';
  }
  function tipTarget(e) { var b = e.target && e.target.closest ? e.target.closest('button[data-r]') : null; return b && TIPS.has(b) ? b : null; }

  /* ------------------------------------------------------------ matriz factura × campo */
  function passes(f, rows, stress) {
    if (S.fp !== 'all' && f.p !== S.fp) return false;
    if (!stress && S.fs !== 'all' && (S.fs === 'esc') !== !!f.esc) return false;
    if (S.fn !== 'all' && (S.fn === 'nuevo') !== !!f.nuevo) return false;
    if (S.fr === 'err' && !rows.some(function (x) { return !x.ok; })) return false;
    if (S.fr === 'sil' && !rows.some(isSil)) return false;
    return true;
  }

  function cellBtn(cls, kids, tip, r, c, key) {
    var b = h('button', { type: 'button', class: cls, tabindex: r === 0 && c === 0 ? '0' : '-1', 'data-r': r, 'data-c': c, 'data-fk': key + ':' + r + ':' + c, 'aria-label': tipText(tip) }, kids);
    TIPS.set(b, tip);
    return b;
  }

  function tags(f, stress) {
    var t = [];
    if (f.esc && !stress) t.push(h('span', { class: 'fx-tg' }, tt('escaneada', 'scanned')));
    if (f.nuevo) t.push(h('span', { class: 'fx-tg' }, tt('nueva', 'new')));
    if (f.err) t.push(h('span', { class: 'fx-tg err' }, tt('error prov.', 'supplier err.')));
    return t;
  }

  function valBadge(x) {
    var k = [];
    if (x.rv) k.push(h('span', { class: 'fx-bd rv' }, tt('a revisión', 'to review')));
    else if (isSil(x)) k.push(h('span', { class: 'fx-bd sil' }, tt('sin aviso', 'no warning')));
    else k.push(h('span', { class: 'fx-bd ok' }, tt('pasa', 'passes')));
    if (x.rv16 != null) k.push(h('span', { class: 'fx-dg', 'aria-hidden': 'true' }, '†'));
    return k;
  }

  /* res: las 20 filas del extractor o del nivel; o: {key, compact, stress, rowsFor, caption} */
  function matrix(res, o) {
    var inv = D.facturas, idx = [];
    for (var i = 0; i < inv.length; i++) if (passes(inv[i], o.rowsFor ? o.rowsFor(i) : [res[i]], o.stress)) idx.push(i);
    var box = h('div', { class: 'fx-mxb' });
    if (!idx.length) {
      box.appendChild(h('p', { class: 'note fx-empty' }, tt('Ninguna factura cumple los filtros.', 'No invoice matches the filters.')));
      return box;
    }
    var tb = h('table', { class: 'fx-mx' + (o.compact ? ' compact' : ''), 'data-rows': idx.length });
    tb.appendChild(h('caption', { class: 'fx-sr' }, o.caption));
    var hr = h('tr');
    hr.appendChild(h('th', { scope: 'col', class: 'fx-c0' }, tt('Factura', 'Invoice')));
    if (!o.compact) hr.appendChild(h('th', { scope: 'col', class: 'fx-oh fx-or-a' }, tt('Origen', 'Source')));
    D.campos.forEach(function (c) {
      hr.appendChild(h('th', { scope: 'col', class: 'fx-fh' + (GROUP[c.id] ? ' g' : '') }, [h('span', { 'aria-hidden': 'true' }, lt(SHORT[c.id] || c.id)), h('span', { class: 'fx-sr' }, nm(c))]));
    });
    hr.appendChild(h('th', { scope: 'col', class: 'fx-lh g' }, tt('Líneas', 'Lines')));
    hr.appendChild(h('th', { scope: 'col', class: 'fx-vh' }, tt('Validación', 'Validation')));
    if (!o.compact) {
      hr.appendChild(h('th', { scope: 'col', class: 'fx-th' }, [h('span', { 'aria-hidden': 'true' }, 's'), h('span', { class: 'fx-sr' }, tt('Segundos', 'Seconds'))]));
      hr.appendChild(h('th', { scope: 'col', class: 'fx-oh fx-or-b' }, tt('Origen', 'Source')));
    }
    tb.appendChild(h('thead', null, hr));

    var body = h('tbody');
    idx.forEach(function (i, r) {
      var f = inv[i], x = res[i], c = 0;
      var tr = h('tr', { class: isSil(x) ? 'is-sil' : null });
      tr.appendChild(h('th', { scope: 'row', class: 'fx-c0' }, cellBtn('fx-id', [num(f.id), h('b', { class: 'fx-tpl', 'aria-hidden': 'true' }, f.p)], tipInv(f, x, o.stress), r, c++, o.key)));
      if (!o.compact) tr.appendChild(h('td', { class: 'fx-or fx-or-a' }, tags(f, o.stress)));
      D.campos.forEach(function (cp, j) {
        var ok = x.f[j] === 1, e = x.e && x.e[cp.id], got = e ? e[1] : null;
        tr.appendChild(h('td', { class: GROUP[cp.id] ? 'g' : null },
          cellBtn('fx-b ' + (ok ? 'ok' : 'bad'), ok ? null : h('span', { 'aria-hidden': 'true' }, got == null ? '∅' : '×'), tipField(f, x, j), r, c++, o.key)));
      });
      var lok = x.l[0] === x.l[2];
      tr.appendChild(h('td', { class: 'g' }, cellBtn('fx-lb ' + (lok ? 'ok' : 'bad'), slim(x.l[0], x.l[2]), tipLines(f, x), r, c++, o.key)));
      tr.appendChild(h('td', { class: 'fx-vc' }, cellBtn('fx-vb', valBadge(x), tipVal(f, x), r, c++, o.key)));
      if (!o.compact) {
        tr.appendChild(h('td', { class: 'fx-tc' }, x.s != null ? fmt(x.s, 2) : '—'));
        tr.appendChild(h('td', { class: 'fx-or fx-or-b' }, tags(f, o.stress)));
      }
      body.appendChild(tr);
    });
    tb.appendChild(body);

    var fr = h('tr');
    fr.appendChild(h('th', { scope: 'row', class: 'fx-c0' }, [tt('Aciertos', 'Correct'), h('span', { class: 'fx-sr' }, tt(' de ' + idx.length + ' facturas', ' of ' + idx.length + ' invoices'))]));
    if (!o.compact) fr.appendChild(h('td', { class: 'fx-or fx-or-a' }, tt('de ' + idx.length, 'of ' + idx.length)));
    D.campos.forEach(function (cp, j) {
      var k = sum(idx.map(function (i) { return res[i].f[j]; }));
      fr.appendChild(h('td', { class: (GROUP[cp.id] ? 'g ' : '') + (k < idx.length ? 'low' : '') }, String(k)));
    });
    var le = sum(idx.map(function (i) { return res[i].l[0]; })), ld = sum(idx.map(function (i) { return res[i].l[2]; }));
    fr.appendChild(h('td', { class: 'g' + (le < ld ? ' low' : '') }, slim(le, ld)));
    fr.appendChild(h('td'));
    if (!o.compact) { fr.appendChild(h('td')); fr.appendChild(h('td', { class: 'fx-or fx-or-b' })); }
    tb.appendChild(h('tfoot', null, fr));
    tb.addEventListener('keydown', gridKeys);

    box.appendChild(h('div', { class: 'tbl-wrap fx-mxw' }, tb));
    var k = 0, ok = 0, rv = 0, rvp = 0, sl = 0;
    idx.forEach(function (i) { var x = res[i]; k += sum(x.f); ok += x.ok ? 1 : 0; rv += x.rv ? 1 : 0; rvp += x.rv && inv[i].err ? 1 : 0; sl += isSil(x) ? 1 : 0; });
    var rvTxt = rv + tt(' a revisión', ' sent to review') + (rvp ? tt(' (' + rvp + ' por error del proveedor)', ' (' + rvp + ' for a supplier error)') : '');
    box.appendChild(h('p', { class: 'note fx-selline' }, tt(
      (idx.length === inv.length ? 'Las ' + inv.length + ' facturas' : 'Mostrando ' + idx.length + ' de ' + inv.length + ' facturas') + ': ' + k + ' / ' + (12 * idx.length) + ' campos exactos, ' + ok + (ok === 1 ? ' leída' : ' leídas') + ' 100 % bien, ' + rvTxt + ', ' + sl + ' sin aviso.',
      (idx.length === inv.length ? 'All ' + inv.length + ' invoices' : 'Showing ' + idx.length + ' of ' + inv.length + ' invoices') + ': ' + k + ' / ' + (12 * idx.length) + ' exact fields, ' + ok + ' read 100% correctly, ' + rvTxt + ', ' + sl + ' with no warning.')));
    return box;
  }

  function gridKeys(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('button[data-r]') : null;
    if (!b) return;
    var t = ev.currentTarget, r = +b.getAttribute('data-r'), c = +b.getAttribute('data-c'), nr = r, nc = c;
    var maxR = +t.getAttribute('data-rows') - 1, maxC = 14;
    switch (ev.key) {
      case 'ArrowRight': nc++; break;
      case 'ArrowLeft': nc--; break;
      case 'ArrowDown': nr++; break;
      case 'ArrowUp': nr--; break;
      case 'Home': nc = 0; if (ev.ctrlKey) nr = 0; break;
      case 'End': nc = maxC; if (ev.ctrlKey) nr = maxR; break;
      default: return;
    }
    ev.preventDefault();
    nr = Math.max(0, Math.min(maxR, nr));
    nc = Math.max(0, Math.min(maxC, nc));
    var nb = t.querySelector('button[data-r="' + nr + '"][data-c="' + nc + '"]');
    if (nb && nb !== b) { roving(t, nb); nb.focus(); }
  }
  function roving(t, b) {
    var cur = t.querySelector('button[data-r][tabindex="0"]');
    if (cur) cur.setAttribute('tabindex', '-1');
    b.setAttribute('tabindex', '0');
  }

  /* dagger: solo si alguna de las filas mostradas cambiaría con la decisión 16 */
  function hasRv16(xs) { return xs.some(function (x) { return x.res.some(function (r) { return r.rv16 != null; }); }); }
  function legend(dagger) {
    return h('div', { class: 'note fx-legend' }, [
      h('span', null, [h('i', { class: 'fx-sw ok', 'aria-hidden': 'true' }), tt('correcto', 'correct')]),
      h('span', null, [h('i', { class: 'fx-sw bad', 'aria-hidden': 'true' }, '×'), tt('leído distinto', 'misread')]),
      h('span', null, [h('i', { class: 'fx-sw bad', 'aria-hidden': 'true' }, '∅'), tt('no leído', 'not read')]),
      h('span', null, [h('b', { class: 'fx-bd sil' }, tt('sin aviso', 'no warning')), tt('error que llegó al Excel sin ir a revisión', 'error that reached the spreadsheet without going to review')]),
      dagger ? h('span', null, [h('b', { class: 'fx-dg', 'aria-hidden': 'true' }, '†'), tt('cambiaría con la decisión 16', 'would change under decision 16')]) : null
    ]);
  }
  function hint() {
    return h('p', { class: 'note fx-hint' }, tt(
      'Pasa el puntero, toca o enfoca una celda para ver «esperado → leído». Con el teclado: Tab hasta la matriz y flechas para moverte. En pantallas angostas, desliza la matriz hacia los lados.',
      'Hover, tap or focus a cell to see “expected → read”. With a keyboard: Tab into the matrix and use the arrow keys. On narrow screens, swipe the matrix sideways.'));
  }

  function fgroup(label, opts, cur, key) {
    var id = 'fx-' + key + '-l';
    return h('div', { class: 'fx-fg' }, [h('span', { class: 'lbl', id: id }, label),
      radios('seg', null, opts, cur, key, function (v) { var p = {}; p[key] = v; update(p); }, id)]);
  }
  function filters(stress) {
    var box = h('div', { class: 'fx-flt', role: 'group', 'aria-label': tt('Filtros de la matriz', 'Matrix filters') });
    box.appendChild(fgroup(tt('Plantilla', 'Template'), [{ v: 'all', kids: tt('Todas', 'All') }].concat(['A', 'B', 'C', 'D', 'E'].map(function (p) {
      return { v: p, kids: p, aria: tt('Plantilla ', 'Template ') + p + ', ' + nm(D.plantillas[p]) };
    })), S.fp, 'fp'));
    if (!stress) box.appendChild(fgroup(tt('Escaneo', 'Scan'), [{ v: 'all', kids: tt('Todas', 'All') }, { v: 'esc', kids: tt('Escaneadas', 'Scanned') }, { v: 'dig', kids: tt('Digitales', 'Digital') }], S.fs, 'fs'));
    box.appendChild(fgroup(tt('Plantilla nueva', 'New template'), [{ v: 'all', kids: tt('Todas', 'All') }, { v: 'conocido', kids: tt('Conocidas', 'Known') }, { v: 'nuevo', kids: tt('Nueva (E)', 'New (E)') }], S.fn, 'fn'));
    box.appendChild(fgroup(tt('Resultado', 'Outcome'), [{ v: 'all', kids: tt('Todas', 'All') }, { v: 'err', kids: tt('Con error', 'With errors') }, { v: 'sil', kids: tt('Sin aviso', 'No warning') }], S.fr, 'fr'));
    return box;
  }

  /* ------------------------------------------------------------ resumen */
  function kpis(list) {
    return h('div', { class: 'fx-kpis' }, list.map(function (k) {
      return h('div', { class: 'card fx-kpi' + (k.cls === 'bad' ? ' is-bad' : '') }, [
        h('div', { class: 'lbl' }, k.l),
        h('div', { class: 'read' + (k.cls ? ' ' + k.cls : '') }, k.v),
        (k.sub || []).map(function (s) { return h('p', { class: 'note' }, s); })
      ]);
    }));
  }
  function kpiExt(x) {
    var t = x.tot, sub5 = [];
    if (t.tokens_mediana) sub5.push(tt('tokens (mediana): ', 'tokens (median): ') + fmt(t.tokens_mediana[0], 0) + tt(' de entrada · ', ' in · ') + fmt(t.tokens_mediana[1], 0) + tt(' de salida', ' out'));
    return [
      { l: tt('Campos exactos', 'Exact fields'), v: frac(t.campos), cls: t.campos[0] === t.campos[1] ? 'good' : '',
        sub: [pk(t.campos), ic(t.ic_campos), tt('Líneas de detalle exactas: ', 'Exact line items: ') + frac(t.lineas)] },
      { l: tt('Facturas 100 % correctas', 'Invoices 100% correct'), v: frac(t.facturas_ok), cls: t.facturas_ok[0] === t.facturas_ok[1] ? 'good' : '',
        sub: [tt('escaneadas: ', 'scanned: ') + frac(t.ok_escaneadas), tt('plantilla nueva: ', 'new template: ') + frac(t.ok_nuevo)] },
      { l: tt('Errores del proveedor detectados', 'Supplier errors caught'), v: frac(t.errores_proveedor), cls: t.errores_proveedor[0] === t.errores_proveedor[1] ? 'good' : 'bad',
        sub: [tt('facturas con un error del propio proveedor que fueron a revisión', 'invoices with the supplier’s own error that went to review')] },
      { l: tt('Errores sin aviso', 'Errors with no warning'), v: String(t.sin_aviso), cls: t.sin_aviso ? 'bad' : 'good',
        sub: [tt('facturas con un problema que no fueron a revisión', 'invoices with a problem that did not go to review'),
          tt('problemas a revisión: ', 'problems sent to review: ') + frac(t.problema_a_revision) + ' · ' + tt('correctas a revisión: ', 'correct ones sent to review: ') + frac(t.correctas_a_revision)] },
      { l: tt('Segundos por factura (mediana)', 'Seconds per invoice (median)'), v: fmt(t.mediana_s, 2) + ' s', sub: sub5 }
    ];
  }
  function kpiStress(n) {
    return [
      { l: tt('Campos exactos', 'Exact fields'), v: frac(n.campos), cls: n.campos[0] === n.campos[1] ? 'good' : '', sub: [pk(n.campos), ic(n.ic_campos)] },
      { l: tt('Facturas 100 % correctas', 'Invoices 100% correct'), v: frac(n.facturas_ok), cls: n.facturas_ok[0] === n.facturas_ok[1] ? 'good' : '' },
      { l: tt('Errores del proveedor detectados', 'Supplier errors caught'), v: frac(n.errores_proveedor), cls: n.errores_proveedor[0] === n.errores_proveedor[1] ? 'good' : 'bad' },
      { l: tt('Errores sin aviso', 'Errors with no warning'), v: String(n.sin_aviso), cls: n.sin_aviso ? 'bad' : 'good',
        sub: [tt('con error de lectura: ', 'with a reading error: ') + frac(n.con_error_lectura) + tt(' facturas', ' invoices'),
          tt('de ellas, ' + n.a_revision + ' a revisión y ' + n.sin_aviso + ' sin aviso', 'of those, ' + n.a_revision + ' sent to review and ' + n.sin_aviso + ' with no warning'),
          tt('falsas alarmas: ', 'false alarms: ') + n.falsas_alarmas] },
      { l: tt('Segundos por factura (mediana)', 'Seconds per invoice (median)'), v: fmt(n.mediana_s, 2) + ' s' }
    ];
  }

  function metrics() {
    function g(a) { return a[0] === a[1] ? 'good' : ''; }
    return [
      { l: tt('Campos exactos', 'Exact fields'), f: function (t) { return [frac(t.campos) + ' · ' + pk(t.campos), g(t.campos)]; } },
      { l: tt('IC 95 % (Wilson)', '95% CI (Wilson)'), f: function (t) { return [icr(t.ic_campos), '']; } },
      { l: tt('Líneas de detalle exactas', 'Exact line items'), f: function (t) { return [frac(t.lineas), g(t.lineas)]; } },
      { l: tt('Facturas 100 % correctas', 'Invoices 100% correct'), f: function (t) { return [frac(t.facturas_ok), g(t.facturas_ok)]; } },
      { l: tt('… de ellas, escaneadas', '… of which scanned'), f: function (t) { return [frac(t.ok_escaneadas), g(t.ok_escaneadas)]; } },
      { l: tt('… de ellas, de la plantilla nueva', '… of which new template'), f: function (t) { return [frac(t.ok_nuevo), g(t.ok_nuevo)]; } },
      { l: tt('Errores del proveedor detectados', 'Supplier errors caught'), f: function (t) { return [frac(t.errores_proveedor), g(t.errores_proveedor) || 'bad']; } },
      { l: tt('Errores que pasaron sin aviso', 'Errors with no warning'), f: function (t) { return [String(t.sin_aviso), t.sin_aviso ? 'bad' : 'good']; } },
      { l: tt('Facturas con problema enviadas a revisión', 'Invoices with a problem sent to review'), f: function (t) { return [frac(t.problema_a_revision), g(t.problema_a_revision)]; } },
      { l: tt('Facturas correctas enviadas a revisión', 'Correct invoices sent to review'), f: function (t) { return [frac(t.correctas_a_revision), t.correctas_a_revision[0] ? 'bad' : '']; } },
      { l: tt('Segundos por factura (mediana)', 'Seconds per invoice (median)'), f: function (t) { return [fmt(t.mediana_s, 2), '']; } },
      { l: tt('Tokens por factura (mediana): entrada / salida', 'Tokens per invoice (median): in / out'), f: function (t) { return [t.tokens_mediana ? fmt(t.tokens_mediana[0], 0) + ' / ' + fmt(t.tokens_mediana[1], 0) : '—', '']; } }
    ];
  }
  function sumTable(xs, labels, asButtons, caption) {
    var tb = h('table', { class: 'tbl fx-sum' });
    tb.appendChild(h('caption', { class: 'fx-sr' }, caption));
    var hr = h('tr', null, h('th', { scope: 'col' }, tt('Métrica', 'Metric')));
    xs.forEach(function (x, i) {
      var name = (labels ? labels[i] + ' · ' : '') + nm(x) + (x.en_tabla_readme ? '' : ' †');
      hr.appendChild(h('th', { scope: 'col' }, asButtons
        ? h('button', { type: 'button', class: 'fx-lnk', 'data-fk': 'five:' + x.id, 'aria-label': tt('Ver la matriz de ', 'Open the matrix for ') + nm(x) }, name)
        : name));
    });
    tb.appendChild(h('thead', null, hr));
    var body = h('tbody');
    metrics().forEach(function (m) {
      var tr = h('tr', null, h('td', null, m.l));
      xs.forEach(function (x) { var v = m.f(x.tot); tr.appendChild(h('td', { class: v[1] || null }, v[0])); });
      body.appendChild(tr);
    });
    tb.appendChild(body);
    if (asButtons) tb.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-fk^="five:"]');
      if (!b) return;
      var id = b.getAttribute('data-fk').slice(5);
      update({ m: 'uno', e: id });
      var r = document.querySelector('[data-fk="ext:' + id + '"]');
      if (r) r.focus({ preventScroll: true });
    });
    /* contenedor con desplazamiento horizontal: con tabindex se desplaza con el teclado (Safari no lo hace solo) y se
       anuncia como región; con los nombres como botones, el foco ya entra en la tabla */
    return h('div', { class: 'tbl-wrap fx-tblw', role: 'region', 'aria-label': caption, tabindex: asButtons ? null : '0' }, tb);
  }
  function haikuFoot(xs) {
    var out = xs.filter(function (x) { return !x.en_tabla_readme; });
    if (!out.length) return null;
    return h('p', { class: 'note fx-foot' }, out.map(function (x) {
      return '† ' + nm(x) + tt(' no está en la tabla principal del README.', ' is not in the README’s main table.') + (x.nota_rv16 ? ' ' + rv16Text(x) : '');
    }).join(' '));
  }
  function rv16Text(x) {
    var ids = (x.nota_rv16 || []).map(num);
    return tt('Con el criterio de revisión medido, una factura sin líneas no contaba como falla; con el criterio actual (decisión 16), las facturas ' + list(ids) + ' irían a revisión. Se muestra el criterio medido.',
      'Under the review rule that was measured, an invoice with no lines did not count as a failure; under the current rule (decision 16), invoices ' + list(ids) + ' would go to review. The measured rule is shown.');
  }

  /* ------------------------------------------------------------ pestaña de extractores */
  function picker() {
    return radios('fx-pick', tt('Extractor', 'Extractor'), D.extractores.map(function (x) {
      return { v: x.id, cls: 'fx-pk', kids: [
        h('span', { class: 'n' }, nm(x)),
        h('span', { class: 'v' }, (en() ? (VIA[x.via] || x.via) : x.via) + ' · ' + lt(WHERE[x.id] || '')),
        h('span', { class: 'k' + (x.tot.sin_aviso ? ' bad' : '') }, frac(x.tot.campos) + tt(' campos', ' fields') + ' · ' + x.tot.sin_aviso + tt(' sin aviso', ' no warning')),
        x.en_tabla_readme ? null : h('span', { class: 'fx-out' }, tt('No está en la tabla principal del README', 'Not in the README’s main table'))
      ] };
    }), S.e, 'ext', function (v) { update({ e: v }); });
  }
  function extInfo(x) {
    var d = en() ? x.en_d : x.es_d, n = nm(x);
    return h('div', { class: 'fx-info' }, [
      h('p', null, d.indexOf(n) === 0 ? [h('strong', null, n), d.slice(n.length)] : [h('strong', null, n + '. '), d]),
      x.en_tabla_readme ? null : h('p', { class: 'fx-warn' }, [h('strong', null, tt('No está en la tabla principal del README. ', 'Not in the README’s main table. ')), x.nota_rv16 ? rv16Text(x) + tt(' La marca † señala esas facturas.', ' The † mark flags those invoices.') : ''])
    ]);
  }

  function renderExt(root) {
    root.appendChild(h('div', { class: 'fx-bar' }, [h('span', { class: 'lbl', id: 'fx-mode-l' }, tt('Vista', 'View')),
      radios('seg', null, [{ v: 'uno', kids: tt('Uno a la vez', 'One at a time') }, { v: 'comparar', kids: tt('Comparar dos', 'Compare two') }, { v: 'cinco', kids: tt('Todos', 'All') }], S.m, 'mode', function (v) { update({ m: v }); }, 'fx-mode-l')]));

    if (S.m === 'uno') {
      var x = EXT[S.e];
      root.appendChild(picker());
      root.appendChild(extInfo(x));
      root.appendChild(kpis(kpiExt(x)));
      root.appendChild(filters(false));
      root.appendChild(legend(hasRv16([x])));
      root.appendChild(hint());
      root.appendChild(matrix(x.res, { key: 'mx', caption: tt('Matriz de aciertos de ', 'Accuracy matrix for ') + nm(x) }));
      live(nm(x) + ': ' + frac(x.tot.campos) + tt(' campos exactos, ', ' exact fields, ') + frac(x.tot.facturas_ok) + tt(' facturas 100 % correctas, ', ' invoices 100% correct, ') + x.tot.sin_aviso + tt(' errores sin aviso.', ' errors with no warning.'));
    } else if (S.m === 'comparar') {
      var A = EXT[S.a], B = EXT[S.b];
      var chips = function (key, cur) {
        return radios('fx-chips', tt('Extractor ', 'Extractor ') + key, D.extractores.map(function (x) { return { v: x.id, kids: nm(x) + (x.en_tabla_readme ? '' : ' †') }; }), cur, 'cmp' + key,
          function (v) { var p = {}; p[key === 'A' ? 'a' : 'b'] = v; update(p); });
      };
      root.appendChild(h('div', { class: 'fx-ab' }, [
        h('div', { class: 'fx-abg' }, [h('span', { class: 'lbl', 'aria-hidden': 'true' }, 'A'), chips('A', S.a)]),
        h('div', { class: 'fx-abg' }, [h('span', { class: 'lbl', 'aria-hidden': 'true' }, 'B'), chips('B', S.b)])
      ]));
      root.appendChild(sumTable([A, B], ['A', 'B'], false, tt('Resumen de A y B', 'Summary of A and B')));
      add(root, haikuFoot(A === B ? [A] : [A, B]));
      root.appendChild(filters(false));
      root.appendChild(legend(hasRv16([A, B])));
      root.appendChild(hint());
      var both = function (i) { return [A.res[i], B.res[i]]; };
      root.appendChild(h('div', { class: 'fx-cmp' }, [A, B].map(function (x, k) {
        var tag = k ? 'B' : 'A';
        return h('div', { class: 'fx-cmpc' }, [
          h('h3', { class: 'fx-h3' }, [tag + ' · ' + nm(x), x.en_tabla_readme ? null : h('span', { class: 'fx-out' }, tt('No está en la tabla principal del README', 'Not in the README’s main table'))]),
          matrix(x.res, { key: 'mx' + tag, compact: true, rowsFor: both, caption: tag + ' · ' + nm(x) })
        ]);
      })));
      live(tt('Comparando ', 'Comparing ') + nm(A) + tt(' con ', ' with ') + nm(B) + '.');
    } else {
      root.appendChild(h('p', { class: 'note fx-hint' }, tt('Toca el nombre de un extractor para abrir su matriz.', 'Tap an extractor’s name to open its matrix.')));
      root.appendChild(sumTable(D.extractores, null, true, tt('Resumen de todos los extractores', 'Summary of all the extractors')));
      add(root, haikuFoot(D.extractores));
      live(tt('Resumen de todos los extractores.', 'Summary of all the extractors.'));
    }
  }

  /* ------------------------------------------------------------ pestaña de la prueba de estrés */
  function levelsTable() {
    var tb = h('table', { class: 'tbl fx-sum fx-lv' });
    tb.appendChild(h('caption', { class: 'fx-sr' }, tt('Resultados por resolución', 'Results by resolution')));
    tb.appendChild(h('thead', null, h('tr', null, [
      tt('Resolución', 'Resolution'), tt('Campos exactos', 'Exact fields'), tt('IC 95 %', '95% CI'), tt('Facturas 100 % correctas', 'Invoices 100% correct'),
      tt('Con error de lectura', 'With a reading error'), tt('… a revisión', '… sent to review'), tt('… sin aviso', '… no warning'), tt('Mediana (s)', 'Median (s)')
    ].map(function (t) { return h('th', { scope: 'col' }, t); }))));
    var body = h('tbody');
    D.estres.niveles.forEach(function (n) {
      var sel = n.ppp === S.p;
      body.appendChild(h('tr', { class: sel ? 'is-sel' : null, 'aria-current': sel ? 'true' : null }, [
        h('td', null, ppp(n.ppp)), h('td', null, frac(n.campos) + ' · ' + pk(n.campos)), h('td', null, icr(n.ic_campos)),
        h('td', null, frac(n.facturas_ok)), h('td', null, frac(n.con_error_lectura)), h('td', null, String(n.a_revision)),
        h('td', { class: n.sin_aviso ? 'bad' : 'good' }, String(n.sin_aviso)), h('td', null, fmt(n.mediana_s, 2))
      ]));
    });
    tb.appendChild(body);
    return h('div', { class: 'tbl-wrap fx-tblw', role: 'region', 'aria-label': tt('Resultados por resolución', 'Results by resolution'), tabindex: '0' }, tb);
  }

  function renderStress(root) {
    var E = D.estres, n = LV[S.p], vx = EXT[E.extractor];
    root.appendChild(h('p', null, en() ? E.en_d : E.es_d));
    root.appendChild(h('p', { class: 'note' }, tt(
      'Solo existe para el LLM local con imagen («' + nm(vx) + '», el mismo modelo de la pestaña anterior). Los demás extractores no se corrieron a estas resoluciones.',
      'Run only with the local LLM reading the image (“' + nm(vx) + '”, the same model as in the previous tab). The other extractors were not run at these resolutions.')));

    var x85 = LV[85];
    if (x85) {
      var floor = null;
      E.niveles.forEach(function (q) { if (q.sin_aviso === 0 && q.con_error_lectura[0] === q.con_error_lectura[1] && q.a_revision === q.con_error_lectura[0] && (floor == null || q.ppp > floor)) floor = q.ppp; });
      var go = h('button', { type: 'button', class: 'lab-btn', 'data-fk': 'go85' }, tt('Ver ', 'Show ') + ppp(85));
      go.addEventListener('click', function () {
        update({ p: 85 });
        var r = document.querySelector('[data-fk="ppp:85"]');
        if (r) { r.focus({ preventScroll: true }); r.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); }
      });
      root.appendChild(h('div', { class: 'fx-call' }, [
        h('p', null, en()
          ? ['At 85 dpi the model got ', frac(x85.campos), ' fields right (', pk(x85.campos), '), and still ', h('strong', null, x85.sin_aviso + ' of the ' + x85.con_error_lectura[0] + ' invoices with a reading error'), ' reached the spreadsheet with no warning.', floor ? ' The dangerous scan is not the worst one but the almost-good one: from ' + ppp(floor) + ' down, the validation sends every misread invoice to review.' : '']
          : ['A 85 ppp el modelo acertó ', frac(x85.campos), ' campos (', pk(x85.campos), '), y aun así ', h('strong', null, x85.sin_aviso + ' de las ' + x85.con_error_lectura[0] + ' facturas con error de lectura'), ' llegaron al Excel sin aviso.', floor ? ' El escaneo peligroso no es el peor, es el casi bueno: de ' + ppp(floor) + ' hacia abajo, la validación manda a revisión todas las facturas mal leídas.' : '']),
        S.p === 85 ? null : go
      ]));
    }

    root.appendChild(h('h3', { class: 'fx-h3' }, tt('Las seis resoluciones', 'All six resolutions')));
    root.appendChild(h('div', { class: 'fx-charts' }, [
      h('figure', { class: 'card fx-fig' }, [h('figcaption', null, tt('Campos exactos, % con IC 95 %', 'Exact fields, % with 95% CI')), h('div', { class: 'fx-ch', id: 'fx-ch-acc' })]),
      h('figure', { class: 'card fx-fig' }, [h('figcaption', null, tt('Facturas con error de lectura, de ', 'Invoices with a reading error, out of ') + E.niveles[0].con_error_lectura[1]),
        h('div', { class: 'fx-ch', id: 'fx-ch-err' }),
        h('p', { class: 'note fx-leg' }, [h('span', null, [h('i', { class: 'fx-sw rv', 'aria-hidden': 'true' }), tt('a revisión', 'sent to review')]), h('span', null, [h('i', { class: 'fx-sw sil', 'aria-hidden': 'true' }), tt('sin aviso', 'no warning')])])])
    ]));
    root.appendChild(levelsTable());
    root.appendChild(h('p', { class: 'note fx-foot' }, tt(
      'Las columnas de error de lectura, revisión y sin aviso excluyen las 2 facturas con error del proveedor, como en el README. Giro, ruido, desenfoque y JPEG quedan fijos en todos los niveles.',
      'The reading-error, review and no-warning columns exclude the 2 invoices with a supplier error, as in the README. Skew, noise, blur and JPEG stay fixed at every level.')));

    root.appendChild(h('h3', { class: 'fx-h3', id: 'fx-st-sel' }, tt('Una resolución, factura por factura', 'One resolution, invoice by invoice')));
    root.appendChild(h('div', { class: 'fx-bar' }, [h('span', { class: 'lbl', id: 'fx-ppp-l' }, tt('Resolución del escaneo (ppp)', 'Scan resolution (dpi)')),
      radios('seg fx-ppp', null, E.niveles.map(function (q) { return { v: q.ppp, kids: String(q.ppp), aria: ppp(q.ppp) }; }), S.p, 'ppp', function (v) { update({ p: +v }); }, 'fx-ppp-l')]));
    root.appendChild(kpis(kpiStress(n)));
    root.appendChild(filters(true));
    root.appendChild(legend(false));
    root.appendChild(hint());
    root.appendChild(matrix(n.res, { key: 'mxs', stress: true, caption: nm(vx) + tt(' a ', ' at ') + ppp(n.ppp) }));
    live(ppp(n.ppp) + ': ' + frac(n.campos) + tt(' campos exactos, ', ' exact fields, ') + n.sin_aviso + tt(' errores sin aviso.', ' errors with no warning.'));
  }

  /* gráficos SVG: se dibujan al ancho real del contenedor, con los colores del tema vigente */
  function palette() {
    return { ink: css('--ink'), ink2: css('--ink2'), ink3: css('--ink3'), grid: css('--grid'), axis: css('--axis'), line: css('--line2'),
      lime: css('--lime-ink'), red: css('--red'), blue: css('--blue'), s3: css('--s3'), onRed: css('--fx-on-red'),
      // solo en claro: franja de selección con resaltador y punto elegido con relleno lima; en oscuro, lo de siempre
      light: L.theme() === 'light', band: css('--fx-band') || css('--s3'), fill: css('--lime') };
  }
  function frame(box, label) {
    var W = Math.max(260, Math.round(box.clientWidth || 340)), H = 220;
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': label });
    box.textContent = '';
    box.appendChild(svg);
    return { svg: svg, W: W, H: H };
  }
  function hits(svg, NV, m, step, H) {
    NV.forEach(function (q, i) {
      var r = sv('rect', { x: m.l + step * i, y: 0, width: step, height: H, fill: 'transparent', class: 'fx-hit', 'data-ppp': q.ppp });
      r.addEventListener('click', function () { update({ p: q.ppp }); });
      svg.appendChild(r);
    });
  }
  function drawAcc(box) {
    var NV = D.estres.niveles, C = palette();
    var label = tt('Campos exactos por resolución: ', 'Exact fields by resolution: ') + NV.map(function (q) { return ppp(q.ppp) + ' ' + pk(q.campos) + ' (' + icr(q.ic_campos) + ')'; }).join('; ');
    var F = frame(box, label), svg = F.svg, W = F.W, H = F.H, m = { l: 40, r: 8, t: 26, b: 42 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, step = iw / NV.length;
    function X(i) { return m.l + step * (i + 0.5); }
    function Y(v) { return m.t + (1 - v) * ih; }
    NV.forEach(function (q, i) { if (q.ppp === S.p) svg.appendChild(sv('rect', { x: m.l + step * i + 2, y: 4, width: step - 4, height: ih + m.t + 22, rx: 6, fill: C.band })); });
    [0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
      svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: Y(g), y2: Y(g), stroke: g === 0 ? C.axis : C.grid, 'stroke-width': 1 }));
      svg.appendChild(sv('text', { x: m.l - 6, y: Y(g) + 4, 'text-anchor': 'end', fill: C.ink3, class: 'fx-svgt' }, fmt(g * 100, 0)));
    });
    svg.appendChild(sv('path', { d: NV.map(function (q, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(q.campos[0] / q.campos[1]).toFixed(1); }).join(' '), fill: 'none', stroke: C.ink3, 'stroke-width': 1.5 }));
    NV.forEach(function (q, i) {
      var x = X(i), lo = Y(q.ic_campos[0]), hi = Y(q.ic_campos[1]), sel = q.ppp === S.p;
      svg.appendChild(sv('line', { x1: x, x2: x, y1: lo, y2: hi, stroke: C.ink2, 'stroke-width': 1.5 }));
      svg.appendChild(sv('line', { x1: x - 4, x2: x + 4, y1: lo, y2: lo, stroke: C.ink2, 'stroke-width': 1.5 }));
      svg.appendChild(sv('line', { x1: x - 4, x2: x + 4, y1: hi, y2: hi, stroke: C.ink2, 'stroke-width': 1.5 }));
      svg.appendChild(sv('circle', { cx: x, cy: Y(q.campos[0] / q.campos[1]), r: sel ? 5.5 : 4, fill: sel ? (C.light ? C.fill : C.lime) : C.ink, stroke: sel ? C.ink : 'none', 'stroke-width': sel && C.light ? 1.5 : 1 }));
      if (sel) svg.appendChild(sv('text', { x: x, y: hi - 8, 'text-anchor': 'middle', fill: C.ink, class: 'fx-svgt', 'font-weight': 600 }, pk(q.campos)));
      svg.appendChild(sv('text', { x: x, y: H - m.b + 18, 'text-anchor': 'middle', fill: sel ? C.ink : C.ink3, class: 'fx-svgt', 'font-weight': sel ? 600 : 400 }, String(q.ppp)));
    });
    svg.appendChild(sv('text', { x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle', fill: C.ink3, class: 'fx-svgt' }, tt('resolución (ppp)', 'resolution (dpi)')));
    hits(svg, NV, m, step, H);
  }
  function drawErr(box) {
    var NV = D.estres.niveles, C = palette(), max = NV[0].con_error_lectura[1];
    var label = tt('Facturas con error de lectura, de ' + max + ', por resolución: ', 'Invoices with a reading error, out of ' + max + ', by resolution: ') + NV.map(function (q) {
      return ppp(q.ppp) + ' ' + q.con_error_lectura[0] + tt(' (' + q.a_revision + ' a revisión, ' + q.sin_aviso + ' sin aviso)', ' (' + q.a_revision + ' to review, ' + q.sin_aviso + ' no warning)');
    }).join('; ');
    var F = frame(box, label), svg = F.svg, W = F.W, H = F.H, m = { l: 40, r: 8, t: 26, b: 42 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, step = iw / NV.length, bw = Math.min(30, step * 0.56);
    function X(i) { return m.l + step * (i + 0.5); }
    function Y(v) { return m.t + (1 - v / max) * ih; }
    NV.forEach(function (q, i) { if (q.ppp === S.p) svg.appendChild(sv('rect', { x: m.l + step * i + 2, y: 4, width: step - 4, height: ih + m.t + 22, rx: 6, fill: C.band })); });
    var ticks = [0, Math.round(max / 3), Math.round(2 * max / 3), max];
    ticks.forEach(function (g) {
      svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: Y(g), y2: Y(g), stroke: g === 0 ? C.axis : C.grid, 'stroke-width': 1 }));
      svg.appendChild(sv('text', { x: m.l - 6, y: Y(g) + 4, 'text-anchor': 'end', fill: C.ink3, class: 'fx-svgt' }, String(g)));
    });
    NV.forEach(function (q, i) {
      var x = X(i) - bw / 2, a = q.a_revision, s = q.sin_aviso, sel = q.ppp === S.p;
      if (a) svg.appendChild(sv('rect', { x: x, y: Y(a), width: bw, height: Y(0) - Y(a), fill: C.blue }));
      if (s) {
        svg.appendChild(sv('rect', { x: x, y: Y(a + s), width: bw, height: Y(a) - Y(a + s), fill: C.red }));
        if (Y(a) - Y(a + s) >= 16) svg.appendChild(sv('text', { x: X(i), y: (Y(a) + Y(a + s)) / 2 + 4, 'text-anchor': 'middle', fill: C.onRed, class: 'fx-svgt', 'font-weight': 600 }, String(s)));
      }
      svg.appendChild(sv('text', { x: X(i), y: Y(a + s) - 7, 'text-anchor': 'middle', fill: C.ink, class: 'fx-svgt', 'font-weight': sel ? 600 : 400 }, String(q.con_error_lectura[0])));
      svg.appendChild(sv('text', { x: X(i), y: H - m.b + 18, 'text-anchor': 'middle', fill: sel ? C.ink : C.ink3, class: 'fx-svgt', 'font-weight': sel ? 600 : 400 }, String(q.ppp)));
    });
    svg.appendChild(sv('text', { x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle', fill: C.ink3, class: 'fx-svgt' }, tt('resolución (ppp)', 'resolution (dpi)')));
    hits(svg, NV, m, step, H);
  }
  function drawCharts() {
    var a = $('fx-ch-acc'), b = $('fx-ch-err');
    if (a) drawAcc(a);
    if (b) drawErr(b);
  }

  /* ------------------------------------------------------------ armado */
  var liveMsg = '';
  function live(s) { liveMsg = s; }

  function render(fromUser) {
    if (!D) return;
    var a = document.activeElement, fk = a && a.getAttribute ? a.getAttribute('data-fk') : null;
    hideTip();
    document.querySelectorAll('.fx-tabs [role="tab"]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === S.t;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    $('fx-p-ext').hidden = S.t !== 'ext';
    $('fx-p-estres').hidden = S.t !== 'estres';
    var ex = $('fx-ext'), es = $('fx-estres');
    ex.textContent = '';
    es.textContent = '';
    if (S.t === 'ext') renderExt(ex); else { renderStress(es); drawCharts(); }
    if (fk) {
      var n = document.querySelector('[data-fk="' + fk + '"]');
      if (n && n !== document.activeElement) {
        if (n.closest('table')) roving(n.closest('table'), n);
        n.focus({ preventScroll: true });
      }
    }
    var src = $('fx-src');
    if (src && D.fuente) {
      src.textContent = '';
      add(src, [tt('Datos: ', 'Data: '), h('a', { href: '/data/facturas/eval.json' }, 'eval.json'),
        tt(', exportado del commit ', ', exported from commit '), h('a', { href: 'https://github.com/pabdus/facturas-a-excel/commit/' + D.fuente.commit, target: '_blank', rel: 'noopener' }, D.fuente.commit),
        tt(' de facturas-a-excel' + (D.fuente.cambios_sin_commit === false ? ', sin cambios locales,' : '') + ' y contrastado antes de escribirlo con ' + (D.fuente.contrastado || []).length + ' fuentes del propio repositorio: README, métricas e informes.',
          ' of facturas-a-excel' + (D.fuente.cambios_sin_commit === false ? ', with no local changes,' : '') + ' and checked before writing against ' + (D.fuente.contrastado || []).length + ' sources in the repository itself: README, metrics and reports.')]);
    }
    if (fromUser && liveMsg) { var lv = $('fx-live'); if (lv) lv.textContent = liveMsg; }
    writeHash();
  }

  function initTabs() {
    var tabs = [].slice.call(document.querySelectorAll('.fx-tabs [role="tab"]'));
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { if (S.t !== b.getAttribute('data-tab')) update({ t: b.getAttribute('data-tab') }); });
      b.addEventListener('keydown', function (ev) {
        var k = ev.key, j = -1;
        if (k === 'ArrowRight') j = (i + 1) % tabs.length;
        else if (k === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        else if (k === 'Home') j = 0;
        else if (k === 'End') j = tabs.length - 1;
        if (j < 0) return;
        ev.preventDefault();
        tabs[j].focus();
        tabs[j].click();
      });
    });
  }

  function initTip() {
    tipEl = $('fx-tip');
    document.addEventListener('mouseover', function (e) { var b = tipTarget(e); if (b) showTip(b); });
    document.addEventListener('mouseout', function (e) {
      var b = tipTarget(e);
      if (b && b === tipAt && !(e.relatedTarget && b.contains(e.relatedTarget)) && document.activeElement !== b) hideTip();
    });
    document.addEventListener('focusin', function (e) {
      var b = tipTarget(e);
      if (b) showTip(b); else if (tipAt) hideTip();
    });
    document.addEventListener('click', function (e) {
      var b = tipTarget(e);
      if (b) { var t = b.closest('table'); if (t) roving(t, b); showTip(b); return; }
      if (tipAt) hideTip();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && tipAt) hideTip(); });
    document.addEventListener('scroll', place, true);
    var rt = 0;
    window.addEventListener('resize', function () {
      place();
      clearTimeout(rt);
      rt = setTimeout(function () { if (D && S.t === 'estres') drawCharts(); }, 150);
    });
  }

  function fail() {
    var st = $('fx-status');
    if (st) {
      st.textContent = '';
      add(st, [tt('No se pudieron cargar los datos. Recarga la página o abre ', 'The data could not be loaded. Reload the page or open '), h('a', { href: '/data/facturas/eval.json' }, 'eval.json'), '.']);
    }
  }

  /* Si /data/estado.json dice que la demo está caída (misma regla que la portada), el botón pasa a ser un enlace a /estado.html */
  function initDemo() {
    var a = $('fx-demo');
    if (!a || !L.demoDown) return;
    L.demoDown(a.getAttribute('data-demo'), function (down) {
      if (!down || !a.parentNode) return;
      var n = h('a', { class: 'lab-btn fx-down', href: '/estado.html' }, [
        h('span', { 'data-l': 'es' }, 'Demo fuera de servicio ahora · ver estado'),
        h('span', { 'data-l': 'en' }, 'Demo down right now · see status')
      ]);
      var hadFocus = document.activeElement === a;
      a.parentNode.replaceChild(n, a);
      if (hadFocus) n.focus({ preventScroll: true });
    });
  }

  function start() {
    initTabs();
    initTip();
    initDemo();
    L.onLang(function () { render(false); });
    /* un reintento si la red falla, antes de mostrar el aviso */
    function load(n) {
      return fetch('/data/facturas/eval.json', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function (e) {
          if (n > 0) return new Promise(function (ok) { setTimeout(ok, 1200); }).then(function () { return load(n - 1); });
          throw e;
        });
    }
    load(1)
      .then(function (d) {
        D = d;
        D.extractores.forEach(function (x) { EXT[x.id] = x; });
        D.estres.niveles.forEach(function (n) { LV[n.ppp] = n; });
        if (!EXT[S.e]) S.e = D.extractores[0].id;
        if (!LV[S.p]) S.p = D.estres.niveles[0].ppp;
        readHash();
        render(false);
      })
      .catch(function (e) { if (window.console) console.error(e); fail(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
