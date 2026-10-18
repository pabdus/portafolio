#!/usr/bin/env node
// Validación de la calculadora TOST (site/herramientas/tost/tost.js) frente a scipy.stats.wilcoxon.
//
// Uso:   node tools/tost/test_tost.mjs
//   PYTHON=/ruta/python    intérprete con scipy (si no, prueba python3, python, py -3.12 y py -3)
//   TFMFDD_DIR=/ruta/repo  opcional: compara también con tfmfdd/stats.py (effect_test, holm_correction),
//                          cargado sin escribir bytecode en ese repositorio
//
// Qué se compara, caso por caso (n = 6 a 60, más uno de n = 600 para la rama normal):
//   1. p exacto de la calculadora frente a scipy method="exact" (solo sin empates ni ceros: es el
//      único caso en que la nula de scipy es exacta).
//   2. p exacto frente a scipy method=PermutationMethod exhaustivo (2^n signos; n <= 18), que es la
//      distribución condicional exacta también con empates y ceros.
//   3. p normal forzado frente a scipy method="asymptotic", correction=True (sin ceros: con ceros,
//      scipy cuenta sus rangos en la varianza y la calculadora, como tfmfdd, no; se informa la diferencia).
//   4. p exacto frente a scipy asintótico (informativo) y frente a permutaciones Monte Carlo (n > 18
//      con empates, las dos colas del TOST, 50 000 remuestreos), con una tolerancia de 5 errores estándar.
//   5. Hodges-Lehmann frente a la mediana de los promedios de Walsh en numpy, el intervalo frente al
//      mismo cálculo con la nula exacta de scipy (_get_wilcoxon_distr) y, sin empates, la inversión:
//      justo fuera de cada extremo scipy rechaza y justo dentro no.
//   6. Holm frente a una implementación de referencia en Python (y tfmfdd si está).
// Sale con código 1 si alguna comparación con tolerancia la supera.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TOST = require(path.join(here, '..', '..', 'site', 'herramientas', 'tost', 'tost.js'));

/* ------------------------------------------------------------------ casos */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normals(n, seed) {
  const u = mulberry32(seed), z = [];
  while (z.length < n) {
    const a = u() || 1e-12, b = u();
    z.push(Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b));
  }
  return z;
}
// cont: continua (sin empates); grid: múltiplos de `step` (empates y, si delta es múltiplo, ceros).
function gen(n, seed, mu, sd, step) {
  return normals(n, seed).map((z) => {
    const v = mu + sd * z;
    return step ? Math.round(v / step) * step : v;
  });
}

const CASES = [
  { name: 'n06 continua', d: gen(6, 11, 0.1, 0.3), delta: 0.5, alpha: 0.05 },
  { name: 'n07 ceros en ±δ', d: [0.02, 0.02, -0.02, 0, 0.01, 0.02, -0.01], delta: 0.02, alpha: 0.05 },
  { name: 'n08 rejilla 0,01', d: gen(8, 12, 0.004, 0.02, 0.01), delta: 0.02, alpha: 0.05 },
  { name: 'n10 enteros (empates)', d: gen(10, 13, 0.3, 1.5, 1), delta: 1.5, alpha: 0.05 },
  { name: 'n12 continua', d: gen(12, 14, -0.2, 1), delta: 1, alpha: 0.05 },
  { name: 'n15 rejilla 0,005 (ceros)', d: gen(15, 15, 0.002, 0.01, 0.005), delta: 0.01, alpha: 0.05 },
  { name: 'n18 rejilla 1/800', d: gen(18, 16, 0.002, 0.01, 1 / 800), delta: 0.02, alpha: 0.05 },
  { name: 'n25 continua', d: gen(25, 17, 0.3, 1), delta: 0.5, alpha: 0.05 },
  { name: 'n30 rejilla 0,01', d: gen(30, 18, 0.01, 0.02, 0.01), delta: 0.03, alpha: 0.05 },
  { name: 'n40 continua α=0,10', d: gen(40, 19, 0.05, 0.4), delta: 0.25, alpha: 0.1 },
  { name: 'n50 rejilla 0,005', d: gen(50, 20, 0.001, 0.01, 0.005), delta: 0.0125, alpha: 0.05 },
  { name: 'n60 continua', d: gen(60, 21, -0.05, 0.5), delta: 0.2, alpha: 0.05 },
  { name: 'n60 rejilla 1/800', d: gen(60, 22, 0.003, 0.012, 1 / 800), delta: 0.02, alpha: 0.05 },
  { name: 'n600 continua (normal)', d: gen(600, 23, 0.01, 0.3), delta: 0.05, alpha: 0.05, big: true }
];
// Un caso con A y B leídos por el analizador de texto (decimales con coma, separados por tabulador).
{
  const a = gen(30, 31, 0.8, 0.04, 0.001), e = gen(30, 32, 0.003, 0.01);
  const txt = a.map((v, i) => `${v.toFixed(3).replace('.', ',')}\t${(v - e[i]).toFixed(3).replace('.', ',')}`).join('\n');
  const parsed = TOST.parse(txt, 'ab');
  if (parsed.errors.length || parsed.blocks.length !== 1 || parsed.blocks[0].d.length !== 30) {
    console.error('El analizador no leyó el caso A y B:', parsed.errors);
    process.exit(1);
  }
  CASES.push({ name: 'n30 A y B (texto)', d: parsed.blocks[0].d, delta: 0.02, alpha: 0.05 });
}

/* --------------------------------------------------- resultados de la calculadora */

function hasTiesOrZeros(x) {
  const s = new Set();
  for (const v of x) { const a = Math.abs(v); if (a === 0 || s.has(a)) return true; s.add(a); }
  return false;
}
function hasZeros(x) { return x.some((v) => v === 0); }

const js = CASES.map((c) => {
  const dr = Array.from(TOST.roundNoise(c.d, TOST.maxAbs(c.d)));
  const xs = { lo: Array.from(TOST.shift(dr, -c.delta)), up: Array.from(TOST.shift(dr, c.delta)) };
  const out = { dr, xs, sr: {}, srN: {}, flags: {} };
  for (const k of ['lo', 'up']) {
    out.sr[k] = TOST.signedRank(xs[k], 'auto');
    out.srN[k] = TOST.signedRank(xs[k], 'normal');
    out.flags[k] = { ties: hasTiesOrZeros(xs[k]), zeros: hasZeros(xs[k]) };
  }
  out.tost = TOST.tost(c.d, c.delta, c.alpha);
  return out;
});
const holmP = js.map((r) => (isNaN(r.tost.p_equivalent) ? 1 : r.tost.p_equivalent));
const holmJS = TOST.holm(holmP, 0.05);

/* ------------------------------------------------------------------ oráculo Python */

const PY = String.raw`
import sys, json, math, warnings
sys.dont_write_bytecode = True
import numpy as np, scipy
from scipy import stats
from scipy.stats._hypotests import _get_wilcoxon_distr

warnings.simplefilter("ignore")
inp = json.load(sys.stdin)
out = {"python": sys.version.split()[0], "scipy": scipy.__version__, "numpy": np.__version__, "cases": []}

def wil(x, alt, method, **kw):
    return float(stats.wilcoxon(np.asarray(x, dtype=float), zero_method="zsplit", alternative=alt,
                                method=method, **kw).pvalue)

def hl_ref(d, alpha):
    d = np.asarray(d, dtype=float); n = d.size
    i, j = np.triu_indices(n); w = np.sort((d[i] + d[j]) / 2.0); M = w.size
    level = 1.0 - 2.0 * alpha; tail = (1.0 - level) / 2.0
    if n <= 500:
        cdf = np.cumsum(_get_wilcoxon_distr(n))
        rej = np.flatnonzero(cdf <= tail * (1.0 + 1e-9)); c = int(rej[-1]) + 1 if rej.size else 0
    else:
        sd = math.sqrt(n * (n + 1) * (2 * n + 1) / 24.0)
        t = math.floor(M / 2.0 - 0.5 - stats.norm.ppf(1.0 - tail) * sd); c = t + 1 if t >= 0 else 0
    lo, hi = (float(w[c - 1]), float(w[M - c])) if c >= 1 else (-math.inf, math.inf)
    inv = None
    distinct = np.unique(w).size == M and np.unique(np.abs(d)).size == n and not np.any(d == 0)
    if distinct and 2 <= c and M - c + 1 < M and n <= 400:
        def p(theta, alt):
            x = d - theta
            if np.unique(np.abs(x)).size < n or np.any(x == 0):
                return None
            return wil(x, alt, "exact")
        checks = [p((w[M - c] + w[M - c + 1]) / 2, "less") <= tail,    # justo encima del extremo superior: rechaza
                  p((w[M - c - 1] + w[M - c]) / 2, "less") > tail,     # justo debajo: no rechaza
                  p((w[c - 2] + w[c - 1]) / 2, "greater") <= tail,     # justo debajo del inferior: rechaza
                  p((w[c - 1] + w[c]) / 2, "greater") > tail]          # justo encima: no rechaza
        inv = bool(all(checks))
    return {"hl": float(np.median(w)), "lo": lo, "hi": hi, "c": c, "inversion": inv}

def holm_ref(p, alpha=0.05):
    p = np.asarray(p, dtype=float); m = p.size; o = np.argsort(p, kind="stable")
    adj = np.empty(m); run = 0.0
    for k, idx in enumerate(o):
        run = max(run, (m - k) * p[idx]); adj[idx] = min(1.0, run)
    return adj.tolist()

for c in inp["cases"]:
    r = {"sides": {}}
    for side in ("lo", "up"):
        x = c["x"][side]; n = len(x); s = {}
        for alt in ("less", "greater"):
            s[alt] = {"exact": wil(x, alt, "exact"),
                      "asym": wil(x, alt, "asymptotic", correction=True)}
            tost_tail = (side, alt) in (("lo", "greater"), ("up", "less"))
            if n <= 18:
                s[alt]["perm"] = wil(x, alt, stats.PermutationMethod(n_resamples=2 ** n, batch=2 ** 15))
            elif c["ties"][side] and n <= 100 and tost_tail:
                R = 50000
                s[alt]["mc"] = wil(x, alt, stats.PermutationMethod(n_resamples=R, batch=2 ** 14,
                                                                    rng=np.random.default_rng(20261018)))
                s[alt]["mc_R"] = R
        r["sides"][side] = s
    r["hl"] = hl_ref(c["dr"], c["alpha"])
    out["cases"].append(r)

out["holm"] = holm_ref(inp["holm_p"])

tdir = inp.get("tfmfdd_dir")
if tdir:
    import importlib.util, os
    spec = importlib.util.spec_from_file_location("tfmfdd_stats_ro", os.path.join(tdir, "tfmfdd", "stats.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    tf = []
    for c in inp["cases"]:
        e = mod.effect_test(np.asarray(c["d"], dtype=float), c["delta"], c["alpha"])
        tf.append({k: (float(e[k]) if isinstance(e[k], (int, float, np.floating, np.integer)) else e[k])
                   for k in ("p_equivalent", "p_relevant", "p_value", "hl_estimate", "eq_ci_low", "eq_ci_high",
                             "ci_low", "ci_high", "outcome", "p_method")})
    out["tfmfdd"] = tf
    out["tfmfdd_holm"] = mod.holm_correction(inp["holm_p"], alpha=0.05)["p_adjusted"].tolist()

json.dump(out, sys.stdout, allow_nan=True)
`;

function findPython() {
  const cands = [];
  if (process.env.PYTHON) cands.push([process.env.PYTHON]);
  cands.push(['python3'], ['python'], ['py', '-3.12'], ['py', '-3']);
  for (const c of cands) {
    const r = spawnSync(c[0], [...c.slice(1), '-c', 'import scipy, numpy'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}
const py = findPython();
if (!py) {
  console.error('No encuentro un Python con scipy. Instala scipy (pip install scipy) o define PYTHON.');
  process.exit(2);
}
const payload = {
  cases: CASES.map((c, i) => ({
    name: c.name, d: c.d, dr: js[i].dr, x: js[i].xs, delta: c.delta, alpha: c.alpha,
    ties: { lo: js[i].flags.lo.ties, up: js[i].flags.up.ties }
  })),
  holm_p: holmP,
  tfmfdd_dir: process.env.TFMFDD_DIR || null
};
const t0 = Date.now();
const res = spawnSync(py[0], [...py.slice(1), '-c', PY], {
  input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' }
});
if (res.status !== 0) { console.error(res.stderr); process.exit(2); }
const ref = JSON.parse(res.stdout.replace(/\bNaN\b/g, 'null').replace(/-Infinity\b/g, '"-inf"').replace(/\bInfinity\b/g, '"inf"'));
const num = (v) => (v === 'inf' ? Infinity : v === '-inf' ? -Infinity : v === null ? NaN : v);

/* ------------------------------------------------------------------ comparación */

const TOL = { exact: 1e-12, perm: 1e-12, asym: 1e-12, hl: 1e-15, holm: 1e-15, tfmfdd: 1e-12 };
const stat = {};   // categoría -> {max, n, tol, fails}
function record(cat, diff, tol, where) {
  const s = stat[cat] || (stat[cat] = { max: 0, n: 0, tol, fails: [], where: '' });
  s.n++;
  if (diff > s.max) { s.max = diff; s.where = where; }
  if (tol != null && !(diff <= tol)) s.fails.push(`${where}: ${diff.toExponential(2)}`);
}
const absd = (a, b) => (a === b ? 0 : Math.abs(a - b));
const P = { less: 'p_less', greater: 'p_greater' };

CASES.forEach((c, i) => {
  const r = ref.cases[i], J = js[i];
  for (const side of ['lo', 'up']) {
    const f = J.flags[side];
    for (const alt of ['less', 'greater']) {
      const s = r.sides[side][alt], pj = J.sr[side][P[alt]], pn = J.srN[side][P[alt]];
      const w = `${c.name} · d${side === 'lo' ? '+' : '−'}δ · ${alt}`;
      if (J.sr[side].p_method === 'exact') {
        if (!f.ties) record('exacto vs scipy exact (sin empates ni ceros)', absd(pj, s.exact), TOL.exact, w);
        else record('scipy exact con empates/ceros vs exacto condicional (informativo)', absd(pj, s.exact), null, w);
        if (s.perm != null) record('exacto vs scipy permutación exhaustiva (n ≤ 18)', absd(pj, s.perm), TOL.perm, w);
        if (s.mc != null) {
          const se = Math.sqrt(Math.max(pj * (1 - pj), 1 / s.mc_R) / s.mc_R);
          record('exacto vs scipy permutación Monte Carlo (5 EE)', absd(pj, s.mc) / se, 5, w + ` (|Δ| = ${absd(pj, s.mc).toExponential(2)})`);
        }
        record('exacto vs scipy asymptotic (informativo)', absd(pj, s.asym), null, w);
      } else {
        record('rama normal automática (n no nulas > 500) vs scipy asymptotic', absd(pj, s.asym), f.zeros ? null : TOL.asym, w);
      }
      if (!f.zeros) record('normal forzada vs scipy asymptotic, correction=True (sin ceros)', absd(pn, s.asym), TOL.asym, w);
      else record('normal forzada vs scipy asymptotic con ceros (varianza distinta, informativo)', absd(pn, s.asym), null, w);
    }
  }
  const h = r.hl, T = J.tost;
  record('Hodges-Lehmann vs numpy (mediana de Walsh)', absd(T.hl_estimate, h.hl), TOL.hl, c.name);
  const ciOk = T.eq_ci_low === num(h.lo) && T.eq_ci_high === num(h.hi);
  record('IC de Hodges-Lehmann vs nula exacta de scipy (desajustes)', ciOk ? 0 : 1, 0, c.name);
  if (h.inversion !== null) record('IC: inversión con scipy exact (fallos)', h.inversion ? 0 : 1, 0, c.name);
  if (ref.tfmfdd) {
    const tf = ref.tfmfdd[i];
    for (const k of ['p_equivalent', 'p_relevant', 'p_value', 'hl_estimate']) record('tfmfdd.effect_test: ' + k, absd(T[k], num(tf[k])), TOL.tfmfdd, c.name);
    const same = T.eq_ci_low === num(tf.eq_ci_low) && T.eq_ci_high === num(tf.eq_ci_high) && T.ci_low === num(tf.ci_low) && T.ci_high === num(tf.ci_high);
    record('tfmfdd.effect_test: intervalos (desajustes)', same ? 0 : 1, 0, c.name);
    const map = { equivalent: 'equivalente a cero', relevant: 'efecto relevante', inconclusive: 'inconcluso', untestable: 'no contrastable' };
    record('tfmfdd.effect_test: desenlace (desajustes)', map[T.outcome] === tf.outcome ? 0 : 1, 0, c.name);
  }
});
holmJS.adjusted.forEach((v, k) => record('Holm vs referencia Python', absd(v, ref.holm[k]), TOL.holm, CASES[k].name));
if (ref.tfmfdd_holm) holmJS.adjusted.forEach((v, k) => record('Holm vs tfmfdd.holm_correction', absd(v, ref.tfmfdd_holm[k]), TOL.holm, CASES[k].name));

/* ------------------------------------------------------------------ informe */

console.log(`Calculadora TOST frente a scipy ${ref.scipy} (numpy ${ref.numpy}, Python ${ref.python}${ref.tfmfdd ? ', con tfmfdd' : ''})`);
console.log(`${CASES.length} casos, n = ${Math.min(...CASES.map((c) => c.d.length))} a ${Math.max(...CASES.map((c) => c.d.length))}; oráculo en ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
console.log('Casos:');
CASES.forEach((c, i) => {
  const T = js[i].tost, f = js[i].flags;
  console.log(`  ${c.name.padEnd(28)} n=${String(T.n).padStart(3)}  δ=${c.delta}  α=${c.alpha}  empates/ceros d+δ: ${f.lo.ties ? 'sí' : 'no'}/${f.lo.zeros ? 'sí' : 'no'}  d−δ: ${f.up.ties ? 'sí' : 'no'}/${f.up.zeros ? 'sí' : 'no'}  p TOST=${T.p_equivalent.toPrecision(4)}  ${T.outcome}  (${T.p_method})`);
});
console.log('\nDiferencia máxima por comparación (tolerancia entre paréntesis; «—» = informativa):');
let fails = 0;
for (const [cat, s] of Object.entries(stat)) {
  const tol = s.tol == null ? '—' : s.tol === 0 ? '0' : s.tol.toExponential(0);
  const ok = s.tol == null ? '   ' : s.fails.length ? 'MAL' : ' ok';
  console.log(`  ${ok}  ${cat.padEnd(78)} ${s.max.toExponential(2).padStart(9)}  (${tol}, ${s.n} comparaciones)${s.max > 0 ? '  máx. en ' + s.where : ''}`);
  if (s.fails.length) { fails += s.fails.length; s.fails.slice(0, 5).forEach((x) => console.log('         ' + x)); }
}
if (!ref.tfmfdd) console.log('\n(tfmfdd no comparado: define TFMFDD_DIR con la raíz del repositorio para incluirlo)');
console.log(fails ? `\n${fails} comparación(es) fuera de tolerancia.` : '\nTodas las comparaciones con tolerancia la cumplen.');
process.exit(fails ? 1 : 0);
