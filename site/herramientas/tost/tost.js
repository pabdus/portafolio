/* Calculadora de equivalencia TOST · Pablo Duque Marín · pabloduque.dev
 *
 * Todo se calcula en el navegador: este archivo no hace ninguna petición de red.
 *
 * El núcleo (TOST.*) reproduce el procedimiento prerregistrado del TFM, implementado en
 * tfmfdd/stats.py (effect_test, compare_arms, hodges_lehmann, holm_correction):
 *  - Wilcoxon de rangos con signo con rangos medios y los ceros repartidos (zero_method="zsplit").
 *  - p exacto condicional: todos los signos posibles de las diferencias no nulas, por programación
 *    dinámica, también con empates y ceros, hasta 500 diferencias no nulas; por encima, aproximación
 *    normal con la varianza condicional (suma de rangos² / 4 de las no nulas) y corrección de
 *    continuidad de 0,5.
 *  - Antes de asignar signos y rangos, las diferencias se redondean a 10 cifras significativas
 *    relativas a la mayor magnitud, para que 0,03 − 0,01 − 0,02 cuente como cero.
 *  - Hodges-Lehmann (mediana de los promedios de Walsh) con intervalo al 1 − 2α invirtiendo el
 *    contraste (distribución exacta de W+ sin empates hasta n = 500; normal por encima).
 *  - Dos unilaterales, cada uno al α; equivalencia si los dos p son ≤ α (intersección-unión).
 *  - Varias comparaciones: Holm por separado sobre el p de equivalencia y el de diferencia relevante;
 *    las no contrastables cuentan en la familia con p = 1. «Todas equivalentes»: intersección-unión.
 * Validación: tools/tost/test_tost.mjs (scipy.stats.wilcoxon y, si está disponible, tfmfdd).
 */
(function (root) {
  'use strict';

  /* ================================================================ núcleo estadístico */

  var MIN_PAIRS = 5;              // tfmfdd.stats.MIN_PAIRS: con 4 pares o menos no se contrasta
  var EXACT_MAX_N = 500;          // tfmfdd.stats.EXACT_MAX_N: p exacto hasta 500 diferencias no nulas
  var EXACT_MAX_SIZE = 5000000;   // topes de la programación dinámica (tfmfdd.stats._EXACT_MAX_*)
  var EXACT_MAX_WORK = 250000000;
  var DIGITS = 10;                // tfmfdd.stats._DIGITS
  var MAX_PER_BLOCK = 2000;       // tope de esta calculadora: n(n+1)/2 promedios de Walsh en memoria
  var MAX_BLOCKS = 50;

  // numpy.round(x, decimales) = rint(x * 10^dec) / 10^dec, con la potencia de 10 de numpy.
  function powerOfTen(n) {
    var p10 = [1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8];
    if (n < 9) return p10[n];
    var r = 1e9;
    while (n-- > 9) r *= 10;
    return r;
  }
  // Redondeo al par más cercano (numpy.rint).
  function rint(x) {
    var r = Math.round(x);
    if (r - x === 0.5 && r % 2 !== 0) r -= 1;
    return r;
  }
  function maxAbs() {
    var m = 0;
    for (var a = 0; a < arguments.length; a++) {
      var arr = arguments[a];
      for (var i = 0; i < arr.length; i++) { var v = Math.abs(arr[i]); if (v > m) m = v; }
    }
    return m;
  }
  // tfmfdd.stats._round_noise: 10 cifras significativas relativas a `scale`.
  function roundNoise(x, scale) {
    var out = Float64Array.from(x);
    if (!(isFinite(scale) && scale > 0)) return out;
    var dec = DIGITS - 1 - Math.floor(Math.log10(scale));
    if (dec > 300) return out;
    var i, f;
    if (dec >= 0) { f = powerOfTen(dec); for (i = 0; i < out.length; i++) out[i] = rint(out[i] * f) / f; }
    else { f = powerOfTen(-dec); for (i = 0; i < out.length; i++) out[i] = rint(out[i] / f) * f; }
    return out;
  }
  // Suma compensada (Neumaier).
  function fsum(a, from, to) {
    var s = 0, c = 0;
    for (var i = from; i < to; i++) {
      var v = a[i], t = s + v;
      c += Math.abs(s) >= Math.abs(v) ? (s - t) + v : (v - t) + s;
      s = t;
    }
    return s + c;
  }
  // Rangos medios de |x| (scipy.stats.rankdata(..., "average")).
  function rankAbs(x) {
    var n = x.length, idx = new Array(n), a = new Float64Array(n), r = new Float64Array(n), i, j, k;
    for (i = 0; i < n; i++) { a[i] = Math.abs(x[i]); idx[i] = i; }
    idx.sort(function (p, q) { return a[p] - a[q]; });
    for (i = 0; i < n; i = j + 1) {
      j = i;
      while (j + 1 < n && a[idx[j + 1]] === a[idx[i]]) j++;
      var avg = (i + j + 2) / 2;
      for (k = i; k <= j; k++) r[idx[k]] = avg;
    }
    return r;
  }
  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  // Distribución de S = suma de B_i w_i, B_i ~ Bernoulli(1/2): la nula condicional de W+
  // (tfmfdd.stats._pmf_sign_sum). Pesos = 2 x rango (enteros aunque haya rangos medios).
  function pmfSignSum(weights) {
    var w = Array.prototype.slice.call(weights).sort(function (a, b) { return a - b; });
    if (!w.length) return { pmf: new Float64Array([1]), g: 1 };
    var g = 0, total = 0, i, k;
    for (i = 0; i < w.length; i++) g = gcd(g, w[i]);
    for (i = 0; i < w.length; i++) { w[i] = w[i] / g; total += w[i]; }
    var c = new Float64Array(total + 1), hi = 0, pend = 0, SC = Math.pow(2, -512);
    c[0] = 1;
    for (i = 0; i < w.length; i++) {
      var wi = w[i];
      for (k = hi + wi; k >= wi; k--) c[k] += c[k - wi];
      hi += wi;
      if (++pend === 512) { for (k = 0; k <= hi; k++) c[k] *= SC; pend = 0; }
    }
    var f = Math.pow(2, -pend);
    for (k = 0; k < c.length; k++) c[k] *= f;
    return { pmf: c, g: g };
  }

  var cdfCache = {};
  function nullCdfNoTies(n) {
    if (cdfCache[n]) return cdfCache[n];
    var wts = new Array(n);
    for (var i = 0; i < n; i++) wts[i] = i + 1;
    var pmf = pmfSignSum(wts).pmf, cdf = new Float64Array(pmf.length), s = 0;
    for (var k = 0; k < pmf.length; k++) { s += pmf[k]; cdf[k] = s; }
    cdfCache[n] = cdf;
    return cdf;
  }

  /* Normal estándar sin constantes mágicas: serie de términos positivos para erf y fracción
     continua de Laplace (evaluada con Lentz) para erfc en la cola. */
  var SQRTPI = Math.sqrt(Math.PI);
  function erfSeries(x) { // x >= 0, x < 2
    var x2 = x * x, term = x, s = x;
    for (var n = 1; n < 200; n++) { term *= 2 * x2 / (2 * n + 1); s += term; if (term < 1e-17 * s) break; }
    return 2 / SQRTPI * Math.exp(-x2) * s;
  }
  function erfcCF(x) { // x >= 2
    var tiny = 1e-300, f = x, C = f, D = 0;
    for (var k = 1; k < 5000; k++) {
      var a = k / 2;
      D = x + a * D; if (D === 0) D = tiny;
      C = x + a / C; if (C === 0) C = tiny;
      D = 1 / D;
      var dl = C * D;
      f *= dl;
      if (Math.abs(dl - 1) < 1e-16) break;
    }
    return Math.exp(-x * x) / SQRTPI / f;
  }
  function erfc(x) {
    if (x < 0) return 2 - erfc(-x);
    if (x < 2) return 1 - erfSeries(x);
    if (x > 27.3) return 0;
    return erfcCF(x);
  }
  function normCdf(z) {
    if (isNaN(z)) return NaN;
    return z < 0 ? 0.5 * erfc(-z * Math.SQRT1_2) : 1 - 0.5 * erfc(z * Math.SQRT1_2);
  }
  function normSf(z) { return normCdf(-z); }
  function normPpf(q) { // bisección: sin aproximaciones racionales que verificar
    if (!(q > 0 && q < 1)) return q === 0 ? -Infinity : q === 1 ? Infinity : NaN;
    var lo = -40, hi = 40;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (mid === lo || mid === hi) break;
      if (normCdf(mid) < q) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Estadístico de rangos con signo con zsplit y sus dos p unilaterales (tfmfdd.stats._signed_rank).
  // method: 'auto' (exacto mientras quepa) o 'normal' (forzar la aproximación).
  function signedRank(x, method) {
    var n = x.length, r = rankAbs(x), rPos = 0, rNeg = 0, rZero = 0, sq = 0, wts = [], i;
    for (i = 0; i < n; i++) {
      if (x[i] > 0) { rPos += r[i]; wts.push(rint(2 * r[i])); sq += r[i] * r[i]; }
      else if (x[i] < 0) { rNeg += r[i]; wts.push(rint(2 * r[i])); sq += r[i] * r[i]; }
      else rZero += r[i];
    }
    var half = rZero / 2, wPlus = rPos + half, wMinus = rNeg + half, nn = wts.length, sw = 0;
    for (i = 0; i < nn; i++) sw += wts[i];
    var pLess, pGreater, how;
    if (nn === 0) { pLess = pGreater = 1; how = 'exact'; }
    else if (method !== 'normal' && nn <= EXACT_MAX_N && sw <= EXACT_MAX_SIZE && sw * nn <= EXACT_MAX_WORK) {
      var pm = pmfSignSum(wts), s = rint(2 * rPos) / pm.g;
      pLess = Math.min(1, fsum(pm.pmf, 0, s + 1));
      pGreater = Math.min(1, fsum(pm.pmf, s, pm.pmf.length));
      how = 'exact';
    } else {
      var mean = n * (n + 1) / 4, sd = Math.sqrt(sq / 4);
      pLess = normCdf((wPlus - mean + 0.5) / sd);
      pGreater = normSf((wPlus - mean - 0.5) / sd);
      how = 'normal';
    }
    return {
      n: n, n_nonzero: nn, n_zero: n - nn, w_plus: wPlus, w_minus: wMinus,
      rank_biserial: n ? (wPlus - wMinus) / (n * (n + 1) / 2) : NaN,
      p_less: pLess, p_greater: pGreater, p_two_sided: Math.min(1, 2 * Math.min(pLess, pGreater)),
      p_method: how
    };
  }

  // x = d − umbral, redondeado otra vez para que una diferencia igual al umbral sea un cero.
  function shift(d, u) {
    var x = new Float64Array(d.length);
    for (var i = 0; i < d.length; i++) x[i] = d[i] - u;
    return roundNoise(x, Math.max(maxAbs(d), Math.abs(u)));
  }
  // tfmfdd.stats._frente_a: Wilcoxon de d frente a un umbral.
  function frenteA(d, u, method) {
    var sr = signedRank(shift(d, u), method);
    return { p_below: sr.p_less, p_above: sr.p_greater, w_plus: sr.w_plus, n_nonzero: sr.n_nonzero,
             n_zero: sr.n_zero, p_method: sr.p_method };
  }

  function walshSorted(d) {
    var n = d.length, w = new Float64Array(n * (n + 1) / 2), k = 0;
    for (var i = 0; i < n; i++) for (var j = i; j < n; j++) w[k++] = (d[i] + d[j]) / 2;
    w.sort();
    return w;
  }
  function median(w) {
    var M = w.length;
    return M % 2 ? w[(M - 1) / 2] : (w[M / 2 - 1] + w[M / 2]) / 2;
  }
  // Intervalo de Hodges-Lehmann al nivel `level` (tfmfdd.stats.hodges_lehmann).
  function hlInterval(w, n, level) {
    var M = w.length, tail = (1 - level) / 2, c;
    if (n <= EXACT_MAX_N) {
      var cdf = nullCdfNoTies(n), thr = tail * (1 + 1e-9), last = -1;
      for (var t = 0; t < cdf.length && cdf[t] <= thr; t++) last = t;
      c = last >= 0 ? last + 1 : 0;
    } else {
      var sd = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
      var tt = Math.floor(M / 2 - 0.5 - normPpf(1 - tail) * sd);
      c = tt >= 0 ? tt + 1 : 0;
    }
    if (c < 1) return { lo: -Infinity, hi: Infinity, level: level };
    return { lo: w[c - 1], hi: w[M - c], level: level };
  }
  function hodgesLehmann(d, level) {
    var n = d.length;
    if (!n) return { hl_estimate: NaN, ci_low: NaN, ci_high: NaN, ci_level: level };
    var w = walshSorted(d), ci = hlInterval(w, n, level);
    return { hl_estimate: median(w), ci_low: ci.lo, ci_high: ci.hi, ci_level: level };
  }

  function minRuns(alpha, m, alternative) {
    var tails = alternative === 'two-sided' ? 2 : 1, n = 1;
    while (tails * m > alpha * Math.pow(2, n)) n++;
    return n;
  }

  // TOST de una comparación (tfmfdd.stats.effect_test con margin = delta).
  function tost(dIn, delta, alpha, opts) {
    var method = opts && opts.method === 'normal' ? 'normal' : 'auto';
    var d0 = [];
    for (var i = 0; i < dIn.length; i++) if (!isNaN(dIn[i])) d0.push(dIn[i]);
    var n = d0.length;
    var out = {
      n: n, delta: delta, alpha: alpha, hl_estimate: NaN, ci_low: NaN, ci_high: NaN, ci_level: 1 - alpha,
      eq_ci_low: NaN, eq_ci_high: NaN, eq_ci_level: 1 - 2 * alpha, effect_size: NaN, n_nonzero: NaN,
      n_zero: NaN, p_value: NaN, p_lower: NaN, p_upper: NaN, p_equivalent: NaN, p_relevant: NaN,
      w_lower: NaN, w_upper: NaN, p_method: null, outcome: 'untestable'
    };
    if (n < MIN_PAIRS) return out;
    var d = roundNoise(d0, maxAbs(d0));
    var sr = signedRank(d, method);
    var w = walshSorted(d), ci = hlInterval(w, n, 1 - alpha), ce = hlInterval(w, n, 1 - 2 * alpha);
    var up = frenteA(d, delta, method);    // d − δ: H1 θ < +δ es p_below
    var lo = frenteA(d, -delta, method);   // d + δ: H1 θ > −δ es p_above
    out.hl_estimate = median(w);
    out.ci_low = ci.lo; out.ci_high = ci.hi;
    out.eq_ci_low = ce.lo; out.eq_ci_high = ce.hi;
    out.effect_size = sr.rank_biserial;
    out.n_nonzero = sr.n_nonzero; out.n_zero = sr.n_zero;
    out.p_value = sr.p_two_sided;
    out.p_lower = lo.p_above; out.p_upper = up.p_below;
    out.w_lower = lo.w_plus; out.w_upper = up.w_plus;
    out.zeros_lower = lo.n_zero; out.zeros_upper = up.n_zero;
    out.p_equivalent = Math.max(out.p_lower, out.p_upper);
    out.p_relevant = Math.min(1, 2 * Math.min(up.p_above, lo.p_below));
    out.p_method = (up.p_method === 'normal' || lo.p_method === 'normal' || sr.p_method === 'normal') ? 'normal' : 'exact';
    out.outcome = out.p_relevant <= alpha ? 'relevant' : out.p_equivalent <= alpha ? 'equivalent' : 'inconclusive';
    return out;
  }

  // tfmfdd.stats.holm_correction: p ajustado y decisión por pasos (los NaN quedan fuera).
  function holm(p, alpha) {
    var n = p.length, idx = [], i, k;
    var adjusted = new Array(n).fill(NaN), significant = new Array(n).fill(false), threshold = new Array(n).fill(NaN);
    for (i = 0; i < n; i++) if (!isNaN(p[i])) idx.push(i);
    idx.sort(function (a, b) { return p[a] - p[b]; });
    var m = idx.length, run = 0, ok = true;
    for (k = 0; k < m; k++) {
      var j = idx[k], factor = m - k;
      run = Math.max(run, factor * p[j]);
      adjusted[j] = Math.min(1, run);
      threshold[j] = alpha / factor;
      ok = ok && p[j] <= alpha / factor;
      significant[j] = ok;
    }
    return { adjusted: adjusted, significant: significant, threshold: threshold, m: m };
  }

  // Una familia de comparaciones (tfmfdd.stats.compare_arms con family = () y margin = delta).
  function analyze(blocks, delta, alpha, opts) {
    var rows = blocks.map(function (b) { return tost(b.d, delta, alpha, opts); });
    var m = rows.length;
    function ones(key) { return rows.map(function (r) { return isNaN(r[key]) ? 1 : r[key]; }); }
    var hE = holm(ones('p_equivalent'), alpha), hR = holm(ones('p_relevant'), alpha), hV = holm(ones('p_value'), alpha);
    var nRel = minRuns(alpha, m, 'two-sided'), nEq = minRuns(alpha, m, 'greater'), lowPower = [];
    rows.forEach(function (r, i) {
      r.p_equivalent_holm = hE.adjusted[i];
      r.p_relevant_holm = hR.adjusted[i];
      r.p_value_holm = hV.adjusted[i];
      r.outcome_family = isNaN(r.p_relevant) ? 'untestable' : hR.significant[i] ? 'relevant'
        : hE.significant[i] ? 'equivalent' : 'inconclusive';
      if (isNaN(r.n_nonzero) || r.n_nonzero < nRel || r.n < nEq) lowPower.push(i);
    });
    var allEq = m > 0 && rows.every(function (r) { return r.p_equivalent <= alpha; });
    return { rows: rows, m: m, all_equivalent: allEq, n_min_relevant: nRel, n_min_equivalent: nEq,
             low_power: lowPower,
             n_equivalent_raw: rows.filter(function (r) { return r.p_equivalent <= alpha; }).length,
             n_equivalent_holm: rows.filter(function (r) { return r.outcome_family === 'equivalent'; }).length };
  }

  /* ---------------------------------------------------------------- lectura de datos */

  var RE_NUM = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
  var RE_MISS = /^(|na|n\/a|nan|null|#n\/a|#n\/d)$/i;

  function classify(tok) {
    var t = tok.trim().replace(/−/g, '-');
    if (RE_MISS.test(t)) return { kind: 'miss', v: NaN };
    if (t.indexOf(',') >= 0) {
      if (t.indexOf('.') >= 0) return { kind: 'text', bad: true };   // separador de miles: no se admite
      t = t.replace(',', '.');
      if (t.indexOf(',') >= 0) return { kind: 'text', bad: true };
    }
    if (!RE_NUM.test(t)) return { kind: 'text' };
    var v = Number(t);
    if (!isFinite(v)) return { kind: 'text', bad: true };
    var dec = 0, m = /\.(\d+)/.exec(t);
    if (/e/i.test(t)) dec = -1; else if (m) dec = m[1].length;
    return { kind: 'num', v: v, dec: dec };
  }
  function splitLine(t, mode) {
    var fields = false, parts;
    if (/[\t;]/.test(t)) { parts = t.split(/\s*[\t;]\s*/); fields = true; }
    else if (t.indexOf('.') >= 0 && t.indexOf(',') >= 0) { parts = t.split(/\s*,\s*/); fields = true; }
    else if (/\s/.test(t)) parts = t.split(/\s+/);
    else if (mode === 'ab' && (t.match(/,/g) || []).length === 1) { parts = t.split(','); fields = true; }
    else parts = [t];
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();   // separador final
    return { parts: parts, fields: fields };
  }

  // mode 'ab': pares A y B por línea. mode 'd': diferencias (una por línea o una comparación por fila).
  function parse(text, mode) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var blocks = [], errors = [], byLabel = {}, current = null, total = 0;
    function newBlock(name) {
      var b = { name: name || null, a: [], b: [], d: [], dropped: 0, dec: 0, line: 0 };
      blocks.push(b);
      return b;
    }
    function err(i, code, info) { if (errors.length < 8) errors.push({ line: i + 1, code: code, info: info }); }
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/ /g, ' ').trim();
      if (!t) { if (current && (current.d.length || current.dropped)) current = null; continue; }
      if (t.charAt(0) === '#') { current = newBlock(t.replace(/^#+/, '').trim()); current.line = i + 1; continue; }
      var sp = splitLine(t, mode), toks = sp.parts.map(classify);
      var nText = toks.filter(function (k) { return k.kind === 'text'; }).length;
      if (toks.some(function (k) { return k.bad; })) { err(i, 'thousands'); continue; }
      if (nText === toks.length) {   // sin números: cabecera de columnas o título de una comparación
        if (!sp.fields) { current = newBlock(t); current.line = i + 1; }
        continue;
      }
      var label = null;
      if (toks[0].kind === 'text') {
        if (!sp.fields) { err(i, 'label'); continue; }
        label = sp.parts[0].trim(); toks = toks.slice(1); nText--;
      }
      if (nText > 0) { err(i, 'text'); continue; }
      var blk;
      if (mode === 'ab') {
        if (toks.length !== 2) { err(i, 'ab', toks.length); continue; }
        blk = label != null ? (byLabel[label] || (byLabel[label] = newBlock(label))) : (current || (current = newBlock(null)));
        if (toks[0].kind === 'miss' || toks[1].kind === 'miss') { blk.dropped++; continue; }
        blk.a.push(toks[0].v); blk.b.push(toks[1].v);
        blk.d.push(toks[0].v - toks[1].v);
        blk.dec = Math.max(blk.dec, toks[0].dec < 0 || toks[1].dec < 0 ? 99 : Math.max(toks[0].dec, toks[1].dec));
        total++;
      } else if (toks.length === 1) {
        blk = label != null ? (byLabel[label] || (byLabel[label] = newBlock(label))) : (current || (current = newBlock(null)));
        if (toks[0].kind === 'miss') { blk.dropped++; continue; }
        blk.d.push(toks[0].v); blk.dec = Math.max(blk.dec, toks[0].dec < 0 ? 99 : toks[0].dec);
        total++;
      } else {   // una comparación por fila
        blk = newBlock(label); blk.line = i + 1; current = null;
        toks.forEach(function (k) {
          if (k.kind === 'miss') { blk.dropped++; return; }
          blk.d.push(k.v); blk.dec = Math.max(blk.dec, k.dec < 0 ? 99 : k.dec); total++;
        });
      }
    }
    blocks = blocks.filter(function (b) { return b.d.length || b.dropped; });
    blocks.forEach(function (b, k) {
      if (b.d.length > MAX_PER_BLOCK) err(b.line ? b.line - 1 : 0, 'toomany', k + 1);
      // Con A y B, como tfmfdd.compare_arms: d = A − B redondeado a la escala de A y B.
      if (mode === 'ab') b.d = Array.prototype.slice.call(roundNoise(b.d, maxAbs(b.a, b.b)));
    });
    if (blocks.length > MAX_BLOCKS) err(0, 'blocks', blocks.length);
    return { blocks: blocks, errors: errors, total: total };
  }

  var TOST = {
    MIN_PAIRS: MIN_PAIRS, EXACT_MAX_N: EXACT_MAX_N, DIGITS: DIGITS, MAX_PER_BLOCK: MAX_PER_BLOCK,
    roundNoise: roundNoise, rankAbs: rankAbs, signedRank: signedRank, shift: shift, frenteA: frenteA,
    hodgesLehmann: hodgesLehmann, tost: tost, holm: holm, analyze: analyze, minRuns: minRuns,
    normCdf: normCdf, normSf: normSf, normPpf: normPpf, parse: parse, maxAbs: maxAbs
  };
  if (typeof module === 'object' && module.exports) module.exports = TOST;
  root.TOST = TOST;
  if (typeof document === 'undefined' || !document.getElementById('tost-app')) return;

  /* ================================================================ interfaz */

  var doc = document, html = doc.documentElement;
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var EX_PAIRS = [
    [[0.880, 0.875], [0.802, 0.792], [0.745, 0.728], [0.857, 0.845], [0.877, 0.886], [0.863, 0.861],
     [0.847, 0.851], [0.743, 0.727], [0.740, 0.732], [0.895, 0.864], [0.879, 0.879], [0.856, 0.866],
     [0.765, 0.753], [0.779, 0.778], [0.759, 0.758], [0.865, 0.872], [0.862, 0.857], [0.768, 0.773],
     [0.744, 0.746], [0.871, 0.868], [0.762, 0.754], [0.751, 0.764], [0.759, 0.741], [0.763, 0.761]],
    [[0.867, 0.847], [0.815, 0.855], [0.899, 0.893], [0.830, 0.821], [0.876, 0.893], [0.827, 0.823],
     [0.868, 0.876], [0.750, 0.755]],
    [[0.831, 0.780], [0.854, 0.840], [0.761, 0.720], [0.775, 0.720], [0.841, 0.812], [0.799, 0.728],
     [0.755, 0.714], [0.757, 0.697], [0.874, 0.822], [0.817, 0.769], [0.858, 0.817], [0.886, 0.838],
     [0.782, 0.722], [0.896, 0.856], [0.827, 0.787], [0.867, 0.829], [0.761, 0.715], [0.812, 0.741],
     [0.899, 0.860], [0.866, 0.830]]
  ];
  var EX_DELTA = '0.02', EX_ALPHA = '0.05';

  var T = {
    es: {
      title: 'Calculadora de equivalencia TOST · Pablo Duque Marín',
      exName: 'Ejemplo sintético', cmp: 'Comparación',
      outcome: { equivalent: 'Equivalente', relevant: 'Diferencia relevante', inconclusive: 'Inconcluso', untestable: 'No contrastable' },
      phAB: 'Pega aquí dos columnas (A y B) desde una hoja de cálculo.\n# nombre o una línea en blanco empieza otra comparación.',
      phD: 'Pega aquí las diferencias d = A − B, una por línea,\no una comparación por fila.',
      errHead: 'Revisa los datos:', errLine: 'línea',
      errs: {
        thousands: 'número con punto y coma a la vez; quita el separador de miles',
        label: 'texto antes de los números; usa «# nombre» en su propia línea, o separa las columnas con tabulador o «;»',
        text: 'hay un valor que no es un número',
        ab: function (k) { return 'se esperaban 2 valores (A y B) y hay ' + k + '; si son diferencias, cambia a «Diferencias»'; },
        toomany: function (k) { return 'la comparación ' + k + ' tiene más de ' + MAX_PER_BLOCK + ' pares (tope de esta calculadora)'; },
        blocks: function (k) { return k + ' comparaciones; el tope es ' + MAX_BLOCKS; }
      },
      badDelta: 'δ tiene que ser un número mayor que 0, en las unidades de la diferencia.',
      badAlpha: 'α tiene que estar entre 0 y 0,5 (por ejemplo, 0,05).',
      empty: 'Pega tus datos o carga el ejemplo.',
      th: ['Comparación', 'n', 'HL', 'IC', 'p (θ > −δ)', 'p (θ < +δ)', 'p TOST', 'p TOST · Holm', 'Desenlace'],
      ic: function (l) { return 'IC ' + l + ' %'; },
      one: {
        equivalent: function (r) { return 'Los dos unilaterales rechazan: la pseudomediana está dentro de (−δ, +δ).'; },
        relevant: function () { return 'La pseudomediana está fuera de ±δ: la diferencia es mayor que el margen.'; },
        inconclusive: function () { return 'Los datos son compatibles a la vez con una diferencia dentro y fuera de ±δ. No es «equivalencia débil»: falta información.'; },
        untestable: function () { return 'Con menos de 5 pares no se contrasta: ningún resultado podría salir significativo.'; }
      },
      famHead: function (k, m) { return k + ' de ' + m + ' equivalentes tras Holm'; },
      iuYes: function (m) { return 'Las ' + m + ' comparaciones son equivalentes a la vez (intersección-unión: cada una al α, sin corrección).'; },
      iuNo: function (k, m) { return 'No se puede afirmar que las ' + m + ' sean equivalentes a la vez: lo son ' + k + ' de ' + m + ' al α sin corregir (intersección-unión).'; },
      kv: function (r, f, fp, lvl) {
        return 'p TOST = ' + fp(r.p_equivalent) + ' · HL = ' + f(r.hl_estimate) + ' · IC ' + lvl + ' % [' + f(r.eq_ci_low) + '; ' + f(r.eq_ci_high) + ']';
      },
      ciInside: 'El intervalo queda dentro de (−δ, +δ)', ciOutside: 'El intervalo no queda dentro de (−δ, +δ)',
      tiesNote: 'Hay empates o ceros: el intervalo es aproximado y decide el p, que sí es exacto.',
      lowPower: function (names, m) { return 'Pocas diferencias no nulas en: ' + names + '. Con Holm sobre ' + m + ', no pueden llegar a todos los desenlaces aunque el efecto exista.'; },
      dropped: function (k) { return k + ' fila(s) con valores vacíos o NA descartadas.'; },
      method: { exact: 'exacto (condicional, con empates y ceros)', normal: 'aproximación normal con corrección de continuidad' },
      methodOpt: { auto: 'exacto', normal: 'normal' },
      det: {
        sum: 'Detalle', n: 'pares usados', nz: 'diferencias no nulas', z: 'ceros en d', wl: 'W+ sobre d + δ (ceros en d + δ)',
        wu: 'W+ sobre d − δ (ceros en d − δ)', m: 'método del p', p0: 'p bilateral de θ = 0', pr: 'p de diferencia relevante',
        prh: 'p de diferencia relevante · Holm', ci1: function (l) { return 'IC ' + l + ' % (decisión de diferencia relevante)'; },
        rb: 'correlación biserial de rangos'
      },
      axis: function (d) { return 'Pseudomediana de A − B (punto) con su IC al 1 − 2α (barra); la banda es (−δ, +δ), con δ = ' + d + '.'; },
      copied: 'Resultados copiados como tabla (TSV).', copyFail: 'No se pudo copiar; selecciona la tabla a mano.',
      tsv: ['comparacion', 'n', 'hl', 'ic_bajo', 'ic_alto', 'p_inferior', 'p_superior', 'p_tost', 'p_tost_holm', 'p_relevante_holm', 'desenlace'],
      calc: 'Calculando…',
      themeLight: 'Tema claro', themeDark: 'Tema oscuro'
    },
    en: {
      title: 'TOST equivalence calculator · Pablo Duque Marín',
      exName: 'Synthetic example', cmp: 'Comparison',
      outcome: { equivalent: 'Equivalent', relevant: 'Relevant difference', inconclusive: 'Inconclusive', untestable: 'Not testable' },
      phAB: 'Paste two columns (A and B) from a spreadsheet.\n# name or a blank line starts another comparison.',
      phD: 'Paste the differences d = A − B, one per line,\nor one comparison per row.',
      errHead: 'Please check the data:', errLine: 'line',
      errs: {
        thousands: 'number with both a dot and a comma; remove the thousands separator',
        label: 'text before the numbers; put “# name” on its own line, or separate columns with tabs or “;”',
        text: 'a value is not a number',
        ab: function (k) { return 'expected 2 values (A and B) but found ' + k + '; if these are differences, switch to “Differences”'; },
        toomany: function (k) { return 'comparison ' + k + ' has more than ' + MAX_PER_BLOCK + ' pairs (this calculator’s limit)'; },
        blocks: function (k) { return k + ' comparisons; the limit is ' + MAX_BLOCKS; }
      },
      badDelta: 'δ must be a number greater than 0, in the units of the difference.',
      badAlpha: 'α must be between 0 and 0.5 (for example, 0.05).',
      empty: 'Paste your data or load the example.',
      th: ['Comparison', 'n', 'HL', 'CI', 'p (θ > −δ)', 'p (θ < +δ)', 'TOST p', 'TOST p · Holm', 'Outcome'],
      ic: function (l) { return l + '% CI'; },
      one: {
        equivalent: function () { return 'Both one-sided tests reject: the pseudomedian lies inside (−δ, +δ).'; },
        relevant: function () { return 'The pseudomedian lies outside ±δ: the difference exceeds the margin.'; },
        inconclusive: function () { return 'The data are compatible with a difference both inside and outside ±δ. This is not “weak equivalence”: information is missing.'; },
        untestable: function () { return 'With fewer than 5 pairs there is no test: no outcome could be significant.'; }
      },
      famHead: function (k, m) { return k + ' of ' + m + ' equivalent after Holm'; },
      iuYes: function (m) { return 'All ' + m + ' comparisons are jointly equivalent (intersection–union: each at α, no correction).'; },
      iuNo: function (k, m) { return 'You cannot claim all ' + m + ' are jointly equivalent: ' + k + ' of ' + m + ' are at uncorrected α (intersection–union).'; },
      kv: function (r, f, fp, lvl) {
        return 'TOST p = ' + fp(r.p_equivalent) + ' · HL = ' + f(r.hl_estimate) + ' · ' + lvl + '% CI [' + f(r.eq_ci_low) + ', ' + f(r.eq_ci_high) + ']';
      },
      ciInside: 'The interval lies inside (−δ, +δ)', ciOutside: 'The interval does not lie inside (−δ, +δ)',
      tiesNote: 'There are ties or zeros: the interval is approximate and the p-value, which is exact, decides.',
      lowPower: function (names, m) { return 'Few non-zero differences in: ' + names + '. With Holm over ' + m + ', they cannot reach every outcome even if the effect is real.'; },
      dropped: function (k) { return k + ' row(s) with empty or NA values dropped.'; },
      method: { exact: 'exact (conditional, with ties and zeros)', normal: 'normal approximation with continuity correction' },
      methodOpt: { auto: 'exact', normal: 'normal' },
      det: {
        sum: 'Details', n: 'pairs used', nz: 'non-zero differences', z: 'zeros in d', wl: 'W+ on d + δ (zeros in d + δ)',
        wu: 'W+ on d − δ (zeros in d − δ)', m: 'p-value method', p0: 'two-sided p for θ = 0', pr: 'relevant-difference p',
        prh: 'relevant-difference p · Holm', ci1: function (l) { return l + '% CI (relevant-difference decision)'; },
        rb: 'rank-biserial correlation'
      },
      axis: function (d) { return 'Pseudomedian of A − B (dot) with its 1 − 2α CI (bar); the band is (−δ, +δ), with δ = ' + d + '.'; },
      copied: 'Results copied as a table (TSV).', copyFail: 'Could not copy; select the table by hand.',
      tsv: ['comparison', 'n', 'hl', 'ci_low', 'ci_high', 'p_lower', 'p_upper', 'p_tost', 'p_tost_holm', 'p_relevant_holm', 'outcome'],
      calc: 'Computing…',
      themeLight: 'Light theme', themeDark: 'Dark theme'
    }
  };

  var S = { lang: 'es', mode: 'ab', last: null, timer: 0, example: '' };
  try {
    var saved = localStorage.getItem('pd-lang');
    if (saved === 'es' || saved === 'en') S.lang = saved;
    else if (navigator.language && !/^es\b/i.test(navigator.language)) S.lang = 'en';
  } catch (e) {}
  function t() { return T[S.lang]; }

  function exampleText(mode, lang) {
    var name = T[lang].exName;
    return EX_PAIRS.map(function (blk, i) {
      var rows = blk.map(function (p) {
        if (mode === 'ab') return p[0].toFixed(3) + '\t' + p[1].toFixed(3);
        return (Math.round((p[0] - p[1]) * 1000) / 1000).toFixed(3);
      });
      return '# ' + name + ' ' + (i + 1) + '\n' + rows.join('\n');
    }).join('\n\n');
  }
  function isExample(txt) {
    return ['ab', 'd'].some(function (m) { return ['es', 'en'].some(function (l) { return txt === exampleText(m, l); }); });
  }

  /* ---------- formato */
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  function locale(s) { s = s.replace('-', '−'); return S.lang === 'es' ? s.replace('.', ',') : s; }
  function fmt(x, dp) {
    if (x === Infinity) return '∞';
    if (x === -Infinity) return '−∞';
    if (x == null || isNaN(x)) return '—';
    var s = dp == null ? String(Number(x.toPrecision(4))) : x.toFixed(dp);
    if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
    if (/e/.test(s)) return fexp(x);
    return locale(s);
  }
  function fexp(x) {
    var e = Math.floor(Math.log10(Math.abs(x))), m = x / Math.pow(10, e);
    if (Math.abs(m) >= 9.95) { m /= 10; e += 1; }
    return locale(m.toFixed(1)) + ' × 10' + String(e).split('').map(function (c) { return SUP[c]; }).join('');
  }
  function fp(p) {
    if (p == null || isNaN(p)) return '—';
    if (p === 0) return '< 10⁻³⁰⁰';
    if (p >= 0.9999) return locale('1.0000').replace(/[.,]0000$/, '');
    if (p >= 0.0001) return locale(p.toFixed(4));
    return fexp(p);
  }
  function dpFor(blocks) {
    var dec = 0;
    blocks.forEach(function (b) { dec = Math.max(dec, b.dec); });
    return dec > 6 ? null : Math.max(1, dec + 1);
  }

  /* ---------- idioma */
  function applyLang() {
    html.setAttribute('data-lang', S.lang);
    html.lang = S.lang;
    doc.title = t().title;
    doc.querySelectorAll('[data-lang-opt]').forEach(function (el) { el.classList.toggle('on', el.getAttribute('data-lang-opt') === S.lang); });
    doc.querySelectorAll('[data-aria-es]').forEach(function (el) { el.setAttribute('aria-label', el.getAttribute('data-aria-' + S.lang)); });
    Array.prototype.forEach.call($('method').options, function (o) { o.textContent = t().methodOpt[o.value]; });
    $('data').placeholder = S.mode === 'ab' ? t().phAB : t().phD;
    var ta = $('data');
    if (isExample(ta.value)) { ta.value = exampleText(S.mode, S.lang); S.example = ta.value; }
    paintTheme();
    run();
  }

  /* ---------- tema claro / oscuro */
  // /theme.js fija html[data-theme] antes de pintar; aquí, el botón que lo cambia. El gráfico de
  // intervalos y la tabla solo usan clases y variables CSS: cambian de colores sin recalcular nada.
  function isLight() { return html.getAttribute('data-theme') === 'light'; }
  function paintTheme() {
    var light = isLight(), b = $('theme-btn'), lbl = light ? t().themeDark : t().themeLight;
    if (b) {
      var ic = b.querySelector('.ti');
      if (ic) ic.textContent = light ? '☾' : '☀';
      b.setAttribute('aria-label', lbl);
      b.title = lbl;
    }
    // color de la barra del navegador según el tema elegido, no solo el del sistema
    doc.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', light ? '#f6f7f3' : '#0b0d11'); });
  }
  function setTheme(th, keep) {
    html.setAttribute('data-theme', th);
    if (keep) { try { localStorage.setItem('pd-theme', th); } catch (e) {} }
    paintTheme();
  }

  /* ---------- cálculo y pintado */
  function readNum(id) {
    var v = $(id).value.trim().replace(/−/g, '-').replace(',', '.');
    return RE_NUM.test(v) ? Number(v) : NaN;
  }
  function schedule() { clearTimeout(S.timer); S.timer = setTimeout(run, 350); }

  function run() {
    var txt = $('data').value, delta = readNum('delta'), alpha = readNum('alpha');
    $('ex-flag').hidden = !isExample(txt);
    var errs = [], parsed = parse(txt, S.mode);
    if (!(delta > 0)) errs.push(t().badDelta);
    if (!(alpha > 0 && alpha < 0.5)) errs.push(t().badAlpha);
    parsed.errors.forEach(function (e) {
      var f = t().errs[e.code], msg = typeof f === 'function' ? f(e.info) : f;
      errs.push((e.line ? t().errLine + ' ' + e.line + ': ' : '') + msg);
    });
    if (!parsed.blocks.length && !errs.length) errs.push(t().empty);
    var box = $('errors');
    if (errs.length) {
      box.hidden = false;
      box.innerHTML = '<b>' + esc(t().errHead) + '</b><ul>' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      $('out').hidden = true; S.last = null;
      return;
    }
    box.hidden = true;
    var res = analyze(parsed.blocks, delta, alpha, { method: $('method').value });
    S.last = { parsed: parsed, res: res, delta: delta, alpha: alpha };
    render();
  }

  function names(blocks) {
    return blocks.map(function (b, i) { return b.name || t().cmp + ' ' + (i + 1); });
  }
  function hasTies(d) {
    var seen = {}, rd = roundNoise(d, maxAbs(d));
    for (var i = 0; i < rd.length; i++) {
      var a = Math.abs(rd[i]);
      if (a === 0 || seen[a]) return true;
      seen[a] = 1;
    }
    return false;
  }

  function render() {
    var L = S.last;
    if (!L) return;
    var tt = t(), res = L.res, blocks = L.parsed.blocks, nm = names(blocks), dp = dpFor(blocks), m = res.m;
    var f = function (x) { return fmt(x, dp); };
    var lvl = String(Number(((1 - 2 * L.alpha) * 100).toPrecision(6))), lvl1 = String(Number(((1 - L.alpha) * 100).toPrecision(6)));
    if (S.lang === 'es') { lvl = lvl.replace('.', ','); lvl1 = lvl1.replace('.', ','); }
    var key = m > 1 ? 'outcome_family' : 'outcome';
    $('out').hidden = false;

    // veredicto
    var v = '';
    if (m === 1) {
      var r = res.rows[0], o = r[key];
      v += '<div class="v-tag ' + o + '">' + esc(tt.outcome[o]) + '</div>';
      v += '<p class="v-txt">' + esc(tt.one[o](r)) + '</p>';
      if (o !== 'untestable') {
        v += '<p class="v-kv mono">' + esc(tt.kv(r, f, fp, lvl)) + '</p>';
        var inside = r.eq_ci_low > -L.delta && r.eq_ci_high < L.delta;
        v += '<p class="v-sub">' + esc(inside ? tt.ciInside : tt.ciOutside) + (hasTies(blocks[0].d) ? '. ' + esc(tt.tiesNote) : '.') + '</p>';
      }
    } else {
      var k = res.n_equivalent_holm;
      v += '<div class="v-tag ' + (k === m ? 'equivalent' : k ? 'partial' : 'inconclusive') + '">' + esc(tt.famHead(k, m)) + '</div>';
      v += '<p class="v-txt">' + esc(res.all_equivalent ? tt.iuYes(m) : tt.iuNo(res.n_equivalent_raw, m)) + '</p>';
    }
    if (res.low_power.length) v += '<p class="v-warn">' + esc(tt.lowPower(res.low_power.map(function (i) { return nm[i]; }).join(', '), m)) + '</p>';
    var drop = blocks.reduce(function (s, b) { return s + b.dropped; }, 0);
    if (drop) v += '<p class="v-sub">' + esc(tt.dropped(drop)) + '</p>';
    $('verdict').innerHTML = v;

    // gráfico
    $('plot').innerHTML = forest(res.rows, nm, L.delta, key, f);
    $('plot-cap').textContent = tt.axis(f(L.delta));

    // tabla
    var th = tt.th.slice();
    th[3] = tt.ic(lvl);
    var cols = m > 1 ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 4, 5, 6, 8];
    var thead = '<tr>' + cols.map(function (c) { return '<th scope="col"' + (c ? ' class="num"' : '') + '>' + esc(th[c]) + '</th>'; }).join('') + '</tr>';
    var body = res.rows.map(function (r, i) {
      var o = r[key], cells = [
        '<th scope="row">' + esc(nm[i]) + '</th>',
        '<td class="num">' + r.n + '</td>',
        '<td class="num">' + f(r.hl_estimate) + '</td>',
        '<td class="num nowrap">' + (isNaN(r.eq_ci_low) ? '—' : '[' + f(r.eq_ci_low) + (S.lang === 'es' ? '; ' : ', ') + f(r.eq_ci_high) + ']') + '</td>',
        '<td class="num' + (r.p_lower <= L.alpha ? ' ok' : '') + '">' + fp(r.p_lower) + '</td>',
        '<td class="num' + (r.p_upper <= L.alpha ? ' ok' : '') + '">' + fp(r.p_upper) + '</td>',
        '<td class="num strong' + (r.p_equivalent <= L.alpha ? ' ok' : '') + '">' + fp(r.p_equivalent) + '</td>'
      ];
      if (m > 1) cells.push('<td class="num' + (r.outcome_family === 'equivalent' ? ' ok' : '') + '">' + fp(r.p_equivalent_holm) + '</td>');
      cells.push('<td><span class="tag ' + o + '">' + esc(tt.outcome[o]) + '</span></td>');
      return '<tr>' + cells.join('') + '</tr>';
    }).join('');
    $('tbl').innerHTML = '<thead>' + thead + '</thead><tbody>' + body + '</tbody>';

    // detalle
    var D = tt.det;
    $('details').innerHTML = res.rows.map(function (r, i) {
      if (r.outcome === 'untestable') return '';
      var items = [
        [D.n, r.n], [D.nz, r.n_nonzero], [D.z, r.n_zero],
        [D.wl, fmt(r.w_lower, 1) + ' (' + r.zeros_lower + ')'], [D.wu, fmt(r.w_upper, 1) + ' (' + r.zeros_upper + ')'],
        [D.m, tt.method[r.p_method]], [D.p0, fp(r.p_value)], [D.pr, fp(r.p_relevant)]
      ];
      if (m > 1) items.push([D.prh, fp(r.p_relevant_holm)]);
      items.push([D.ci1(lvl1), '[' + f(r.ci_low) + (S.lang === 'es' ? '; ' : ', ') + f(r.ci_high) + ']']);
      items.push([D.rb, fmt(r.effect_size, 3)]);
      return '<details class="det"><summary>' + esc(D.sum) + ' · ' + esc(nm[i]) + '</summary><dl>' +
        items.map(function (it) { return '<div><dt>' + esc(it[0]) + '</dt><dd class="mono">' + esc(String(it[1])) + '</dd></div>'; }).join('') +
        '</dl></details>';
    }).join('');
  }

  function forest(rows, nm, delta, key, f) {
    var vals = [-delta, delta, 0];
    rows.forEach(function (r) {
      [r.hl_estimate, r.eq_ci_low, r.eq_ci_high].forEach(function (x) { if (isFinite(x)) vals.push(x); });
    });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    function pos(x) { return Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)); }
    var band = '<span class="fb-band" style="left:' + pos(-delta) + '%;width:' + (pos(delta) - pos(-delta)) + '%"></span>' +
      '<span class="fb-zero" style="left:' + pos(0) + '%"></span>';
    var out = rows.map(function (r, i) {
      var o = r[key], bar = '';
      if (o !== 'untestable') {
        var a = pos(r.eq_ci_low), b = pos(r.eq_ci_high);
        bar = '<span class="fb-ci ' + o + (r.eq_ci_low === -Infinity ? ' open-l' : '') + (r.eq_ci_high === Infinity ? ' open-r' : '') +
          '" style="left:' + a + '%;width:' + Math.max(0.4, b - a) + '%"></span>' +
          '<span class="fb-pt ' + o + '" style="left:' + pos(r.hl_estimate) + '%"></span>';
      }
      return '<div class="fb-row"><span class="fb-name">' + esc(nm[i]) + '</span><span class="fb-track">' + band + bar + '</span></div>';
    }).join('');
    var axis = '<div class="fb-row fb-axis"><span class="fb-name"></span><span class="fb-track">' +
      '<span class="fb-tick" style="left:' + pos(-delta) + '%">−δ</span>' +
      '<span class="fb-tick" style="left:' + pos(0) + '%">0</span>' +
      '<span class="fb-tick" style="left:' + pos(delta) + '%">+δ</span></span></div>';
    return out + axis;
  }

  function copyResults() {
    var L = S.last;
    if (!L) return;
    var tt = t(), nm = names(L.parsed.blocks), m = L.res.m;
    var lines = [tt.tsv.join('\t')].concat(L.res.rows.map(function (r, i) {
      return [nm[i], r.n, r.hl_estimate, r.eq_ci_low, r.eq_ci_high, r.p_lower, r.p_upper, r.p_equivalent,
              m > 1 ? r.p_equivalent_holm : r.p_equivalent, m > 1 ? r.p_relevant_holm : r.p_relevant,
              tt.outcome[m > 1 ? r.outcome_family : r.outcome]].join('\t');
    }));
    var text = lines.join('\n'), msg = $('copy-msg');
    function done(ok) { msg.textContent = ok ? tt.copied : tt.copyFail; msg.hidden = false; clearTimeout(done.t); done.t = setTimeout(function () { msg.hidden = true; }, 2600); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  function setMode(mode) {
    var ta = $('data'), wasEx = isExample(ta.value);
    S.mode = mode;
    doc.querySelectorAll('[data-mode]').forEach(function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;   // tabindex móvil: el grupo es una sola parada de Tab
    });
    doc.querySelectorAll('[data-hint]').forEach(function (el) { el.hidden = el.getAttribute('data-hint') !== mode; });
    if (wasEx) ta.value = exampleText(mode, S.lang);
    ta.placeholder = mode === 'ab' ? t().phAB : t().phD;
    run();
  }
  function loadExample() {
    $('data').value = exampleText(S.mode, S.lang);
    $('delta').value = S.lang === 'es' ? EX_DELTA.replace('.', ',') : EX_DELTA;
    $('alpha').value = S.lang === 'es' ? EX_ALPHA.replace('.', ',') : EX_ALPHA;
    run();
  }

  $('lang-btn').addEventListener('click', function () {
    S.lang = S.lang === 'es' ? 'en' : 'es';
    try { localStorage.setItem('pd-lang', S.lang); } catch (e) {}
    applyLang();
  });
  $('theme-btn').addEventListener('click', function () { setTheme(isLight() ? 'dark' : 'light', true); });
  // Sin elección guardada, la página sigue al sistema también si este cambia con ella abierta.
  if (window.matchMedia) {
    var mqLight = matchMedia('(prefers-color-scheme: light)');
    var onScheme = function (e) {
      var s = null;
      try { s = localStorage.getItem('pd-theme'); } catch (x) {}
      if (s !== 'light' && s !== 'dark') setTheme(e.matches ? 'light' : 'dark', false);
    };
    if (mqLight.addEventListener) mqLight.addEventListener('change', onScheme); else if (mqLight.addListener) mqLight.addListener(onScheme);
  }
  doc.querySelectorAll('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
  // Grupo de radio (patrón ARIA): las flechas, Inicio y Fin mueven el foco y eligen el formato.
  doc.querySelectorAll('.seg[role="radiogroup"]').forEach(function (seg) {
    seg.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var btns = Array.prototype.slice.call(seg.querySelectorAll('[data-mode]'));
      var i = btns.indexOf(doc.activeElement), k = e.key, n = -1;
      if (i < 0) return;
      if (k === 'ArrowRight' || k === 'ArrowDown') n = (i + 1) % btns.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') n = (i - 1 + btns.length) % btns.length;
      else if (k === 'Home') n = 0;
      else if (k === 'End') n = btns.length - 1;
      if (n < 0) return;
      e.preventDefault();
      var mode = btns[n].getAttribute('data-mode');
      if (mode !== S.mode) setMode(mode);
      btns[n].focus();
    });
  });
  $('data').addEventListener('input', schedule);
  $('delta').addEventListener('input', schedule);
  $('alpha').addEventListener('input', schedule);
  $('method').addEventListener('change', run);
  $('run').addEventListener('click', run);
  $('load-ex').addEventListener('click', loadExample);
  $('clear').addEventListener('click', function () { $('data').value = ''; $('data').focus(); run(); });
  $('copy').addEventListener('click', copyResults);

  html.setAttribute('data-lang', S.lang);
  $('data').value = exampleText(S.mode, S.lang);
  $('delta').value = S.lang === 'es' ? EX_DELTA.replace('.', ',') : EX_DELTA;
  $('alpha').value = S.lang === 'es' ? EX_ALPHA.replace('.', ',') : EX_ALPHA;
  applyLang();
})(typeof globalThis !== 'undefined' ? globalThis : this);
