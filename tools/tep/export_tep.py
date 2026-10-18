"""Exporta las series T² y SPE del TEP clásico para la demo web del monitor (DEMO 4).

Qué hace
--------
Ajusta el monitor PCA del paquete `tfmfdd` (TFM, bloque de detección) con la
MISMA configuración de la línea base A1 (`experiments/A1_pca_baseline.py`):

- las 52 variables del TEP clásico (41 medidas y 11 manipuladas);
- ajuste con las 350 primeras filas de `d00.dat` y calibración de los límites con
  las 150 últimas, que el modelo no ve (`particion.calibracion_limites` = 0,3);
- componentes por varianza acumulada (`pca.variance` = 0,85, que da 27);
- nivel de confianza 0,99 (`protocolo.alpha`);
- alarma confirmada con k = 3 alarmas seguidas (`protocolo.k_alarmas`), retardo
  con la convención `appearance` (primera alarma de la primera racha de 3).

Todos esos valores se leen de `configs/baseline.yaml` del repositorio del TFM con
`tfmfdd.config`; este script no escribe ninguno a mano.

`d00.dat` viene transpuesto (52 x 500): `tfmfdd.data.load_classic` lo detecta, lo
corrige y avisa. Es el aviso que se ve al ejecutar.

Después puntúa los 22 ficheros de prueba (`d00_te.dat`, operación normal, y
`d01_te.dat` a `d21_te.dat`, fallos IDV 1 a 21; 960 muestras cada uno, el fallo
entra en la muestra 161) y calcula, con `tfmfdd.metrics.evaluate_run`, la FAR
(muestras 1 a 160; en d00_te, la serie entera, como A1), la FDR (161 a 960) y el
retardo para tres familias de límites, todas calibradas como lo hace tfmfdd
(`calibration="holdout"`, con las 150 filas reservadas):

- "f": T² con la F de Fase II (paramétrico, con n_fit = 350) y SPE con Box
  (chi-cuadrado ponderada ajustada al SPE de las filas reservadas). Es la
  configuración exacta de A1: tfmfdd no tiene límite F para el SPE.
- "kde": densidad kernel gaussiana sobre el estadístico de las filas reservadas.
- "empirico": percentil 99 empírico (`pca.quantile_method`, "linear").

El modelo (escalado, cargas, autovalores) no depende del límite: las series T² y
SPE son las mismas para los tres; el script lo comprueba.

Salidas (en OUT_DIR)
--------------------
- meta.json: configuración, límites por método, nombre y descripción de cada IDV
  en español e inglés, marca de los fallos casi indetectables (3, 9 y 15),
  métricas por fallo y método, resúmenes y la validación frente a A1.
- d00.json, idv01.json ... idv21.json: {"t2":[960 valores],"spe":[960 valores]},
  sin espacios, redondeados a 3 cifras significativas. Si al redondear un valor
  cambiaría su estado de alarma frente a alguno de los tres límites de su
  estadístico, ese valor lleva las cifras justas para conservarlo (meta.json dice
  cuántos): así el navegador, recalculando con las series, obtiene exactamente las
  mismas FAR, FDR y retardos que publica meta.json.

Validación
----------
Compara, fallo por fallo, la familia "f" con `results/summary/A1_pca_baseline_runs.csv`
(FAR, FDR, retardo, detección y límites) y los resúmenes con los de
`metrics.summary` sobre `A1_pca_baseline_T2.csv` y `A1_pca_baseline_SPE.csv`.
Comprueba también que los ficheros .dat son los mismos que usó A1 (SHA-256 de su
`.provenance.json`). Si algo no coincide, lo escribe en meta.json y termina con
código 1.

Uso
---
Con el Python 3.12 global (tiene las versiones de `requirements-probado.txt` del
TFM) o con cualquier entorno con numpy, scipy, pandas, scikit-learn, pyyaml y
matplotlib:

    py -3.12 tools/tep/export_tep.py

No instala nada ni escribe en el repositorio del TFM: importa `tfmfdd` desde su
carpeta (sin generar __pycache__) y solo escribe en OUT_DIR. Las rutas se pueden
cambiar abajo o con las variables de entorno TFM_FDD_CORE y TEP_OUT_DIR.
"""

from __future__ import annotations

import os
import sys

# ---------------------------------------------------------------- rutas
# Repositorio del TFM (paquete tfmfdd, datos y resultados de A1).
TFM_REPO = os.environ.get(
    "TFM_FDD_CORE",
    r"C:\Users\pabdu\Documents\Universidades\UNIR\TFM\tfm-fdd-core\tfm-fdd-core",
)
# Carpeta con los 44 .dat del TEP clásico (Chiang, Russell y Braatz).
DATA_DIR = os.path.join(TFM_REPO, "data", "tep_classic")
# Configuración del protocolo común (la única fuente de los valores por defecto).
CONFIG_YAML = os.path.join(TFM_REPO, "configs", "baseline.yaml")
# Resultados de la línea base A1 con los que se valida la exportación.
A1_DIR = os.path.join(TFM_REPO, "results", "summary")
# Salida para el sitio.
OUT_DIR = os.environ.get("TEP_OUT_DIR", r"C:\dev\Portafolio\site\data\tep")

# Redondeo de las series.
CIFRAS = 3

# Importar tfmfdd desde el repositorio sin escribir bytecode en él.
sys.dont_write_bytecode = True
sys.path.insert(0, TFM_REPO)

import hashlib  # noqa: E402
import json  # noqa: E402
import subprocess  # noqa: E402
import warnings  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from decimal import Decimal  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import tfmfdd  # noqa: E402
from tfmfdd import config, data, metrics  # noqa: E402
from tfmfdd.pca import PCAMonitor  # noqa: E402

# ------------------------------------------------------- textos de la demo
# Descripciones de IDV 1 a 20: tabla "Process Disturbances" de
# data/tep_classic/README.md (la de Downs y Vogel, 1993). IDV 21 no está en esa
# tabla: es la válvula de la corriente 4 fija en su posición de estado
# estacionario (Russell, Chiang y Braatz, 2000, p. 87).
TIPOS = {
    "step": ("Escalón", "Step"),
    "random": ("Variación aleatoria", "Random variation"),
    "drift": ("Deriva lenta", "Slow drift"),
    "sticking": ("Válvula que se pega", "Sticking"),
    "unknown": ("Desconocido", "Unknown"),
    "fixed": ("Posición fija", "Constant position"),
}

# id: (tipo, nombre_es, descripcion_es, nombre_en, descripcion_en)
FALLOS = {
    1: ("step", "Razón de alimentación A/C",
        "Cambio en escalón de la razón A/C, composición de B constante (corriente 4)",
        "A/C feed ratio",
        "Step change in the A/C feed ratio, B composition constant (stream 4)"),
    2: ("step", "Composición de B",
        "Cambio en escalón de la composición de B, razón A/C constante (corriente 4)",
        "B composition",
        "Step change in B composition, A/C ratio constant (stream 4)"),
    3: ("step", "Temperatura de alimentación de D",
        "Cambio en escalón de la temperatura de la alimentación de D (corriente 2)",
        "D feed temperature",
        "Step change in D feed temperature (stream 2)"),
    4: ("step", "Agua de refrigeración del reactor",
        "Cambio en escalón de la temperatura de entrada del agua de refrigeración del reactor",
        "Reactor cooling water",
        "Step change in reactor cooling water inlet temperature"),
    5: ("step", "Agua de refrigeración del condensador",
        "Cambio en escalón de la temperatura de entrada del agua de refrigeración del condensador",
        "Condenser cooling water",
        "Step change in condenser cooling water inlet temperature"),
    6: ("step", "Pérdida de alimentación de A",
        "Pérdida en escalón de la alimentación de A (corriente 1)",
        "A feed loss",
        "Step loss of the A feed (stream 1)"),
    7: ("step", "Presión del colector de C",
        "Pérdida en escalón de presión en el colector de C, disponibilidad reducida (corriente 4)",
        "C header pressure loss",
        "Step C header pressure loss, reduced availability (stream 4)"),
    8: ("random", "Composición de A, B y C",
        "Variación aleatoria de la composición de la alimentación A, B, C (corriente 4)",
        "A, B, C feed composition",
        "Random variation in A, B, C feed composition (stream 4)"),
    9: ("random", "Temperatura de alimentación de D",
        "Variación aleatoria de la temperatura de la alimentación de D (corriente 2)",
        "D feed temperature",
        "Random variation in D feed temperature (stream 2)"),
    10: ("random", "Temperatura de alimentación de C",
         "Variación aleatoria de la temperatura de la alimentación de C (corriente 4)",
         "C feed temperature",
         "Random variation in C feed temperature (stream 4)"),
    11: ("random", "Agua de refrigeración del reactor",
         "Variación aleatoria de la temperatura de entrada del agua de refrigeración del reactor",
         "Reactor cooling water",
         "Random variation in reactor cooling water inlet temperature"),
    12: ("random", "Agua de refrigeración del condensador",
         "Variación aleatoria de la temperatura de entrada del agua de refrigeración del condensador",
         "Condenser cooling water",
         "Random variation in condenser cooling water inlet temperature"),
    13: ("drift", "Cinética de reacción",
         "Deriva lenta de la cinética de reacción",
         "Reaction kinetics",
         "Slow drift in reaction kinetics"),
    14: ("sticking", "Válvula de refrigeración del reactor",
         "La válvula del agua de refrigeración del reactor se pega",
         "Reactor cooling water valve",
         "Sticking reactor cooling water valve"),
    15: ("sticking", "Válvula de refrigeración del condensador",
         "La válvula del agua de refrigeración del condensador se pega",
         "Condenser cooling water valve",
         "Sticking condenser cooling water valve"),
    16: ("unknown", "Desconocida", "Perturbación de tipo desconocido", "Unknown",
         "Disturbance of unknown type"),
    17: ("unknown", "Desconocida", "Perturbación de tipo desconocido", "Unknown",
         "Disturbance of unknown type"),
    18: ("unknown", "Desconocida", "Perturbación de tipo desconocido", "Unknown",
         "Disturbance of unknown type"),
    19: ("unknown", "Desconocida", "Perturbación de tipo desconocido", "Unknown",
         "Disturbance of unknown type"),
    20: ("unknown", "Desconocida", "Perturbación de tipo desconocido", "Unknown",
         "Disturbance of unknown type"),
    21: ("fixed", "Válvula de la corriente 4",
         "La válvula de la corriente 4 queda fija en su posición de estado estacionario",
         "Stream 4 valve",
         "The stream 4 valve is fixed at its steady-state position"),
}

# Familias de límites: clave -> (t2_method, spe_method, etiquetas).
# Los métodos son los que acepta PCAMonitor (tfmfdd.pca.T2_METHODS y SPE_METHODS).
METODOS = {
    "f": {
        "t2_method": None,   # el del yaml (pca.t2_method = f): configuración A1
        "spe_method": None,  # el del yaml (pca.spe_method = box)
        "label_es": "F (T²) y Box (SPE): paramétricos, configuración de la línea base A1",
        "label_en": "F (T²) and Box (SPE): parametric, A1 baseline configuration",
    },
    "kde": {
        "t2_method": "kde",
        "spe_method": "kde",
        "label_es": "KDE: densidad kernel del estadístico en las 150 filas reservadas",
        "label_en": "KDE: kernel density of the statistic on the 150 held-out rows",
    },
    "empirico": {
        "t2_method": "empirical",
        "spe_method": "empirical",
        "label_es": "Empírico: percentil 99 del estadístico en las 150 filas reservadas",
        "label_en": "Empirical: 99th percentile of the statistic on the 150 held-out rows",
    },
}

DESCRIPCION_METODO = {
    "f": "F de Fase II con n_fit filas del ajuste (tfmfdd.limits.t2_limit)",
    "beta": "Beta de Fase I (tfmfdd.limits.t2_limit_beta)",
    "box": "Box: chi-cuadrado ponderada ajustada a media y varianza del SPE reservado "
           "(tfmfdd.limits.spe_limit_box)",
    "kde": "KDE gaussiana, ancho de Scott (tfmfdd.limits.limit_kde)",
    "empirical": "percentil empírico (tfmfdd.limits.limit_empirical)",
}


# ------------------------------------------------------------- utilidades
def sha256(ruta: Path) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def commit_tfm() -> dict:
    """Commit del repositorio del TFM (solo lectura: rev-parse y status)."""
    try:
        commit = subprocess.run(["git", "-C", TFM_REPO, "rev-parse", "HEAD"], capture_output=True,
                                text=True, check=True).stdout.strip()
        # --no-optional-locks: status no reescribe el índice del repositorio.
        cambios = subprocess.run(["git", "--no-optional-locks", "-C", TFM_REPO, "status",
                                  "--porcelain", "--", "tfmfdd",
                                  "configs/baseline.yaml"], capture_output=True, text=True,
                                 check=True).stdout.strip()
        return {"commit": commit, "tfmfdd_y_yaml_sin_cambios": cambios == ""}
    except (OSError, subprocess.CalledProcessError):
        return {"commit": None, "tfmfdd_y_yaml_sin_cambios": None}


def numero(v: float, cifras: int) -> str:
    """v con `cifras` cifras significativas, en notación decimal y sin ceros sobrantes."""
    txt = format(Decimal(f"{v:.{cifras}g}"), "f")
    if "." in txt:
        txt = txt.rstrip("0").rstrip(".")
    return "0" if txt in ("", "-0") else txt


def redondear_serie(serie: np.ndarray, limites: list[float]) -> tuple[list[str], int]:
    """Redondea a CIFRAS cifras; sube cifras solo si el redondeo cambiaría una alarma.

    Una alarma es `estadístico > límite` (tfmfdd.metrics.alarms). Devuelve los
    textos y cuántos valores necesitaron más cifras.
    """
    textos, subidos = [], 0
    for v in serie:
        v = float(v)
        if not np.isfinite(v):
            raise ValueError(f"valor no finito en la serie: {v}")
        c = CIFRAS
        txt = numero(v, c)
        while any((float(txt) > lim) != (v > lim) for lim in limites):
            c += 1
            txt = numero(v, c)
            if c > 17:
                raise RuntimeError(f"no se puede conservar la alarma de {v!r}")
        subidos += c > CIFRAS
        textos.append(txt)
    return textos, subidos


def limpiar(x):
    """Convierte tipos de numpy y NaN a JSON (NaN -> null)."""
    if isinstance(x, dict):
        return {k: limpiar(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [limpiar(v) for v in x]
    if isinstance(x, (np.bool_, bool)):
        return bool(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        x = float(x)
        return None if not np.isfinite(x) else x
    return x


def metricas_json(r: dict, onset: int | None) -> dict:
    """Las columnas de evaluate_run que usa la demo."""
    d = r["delay_samples"]
    detectado = bool(r["detected"])
    salida = {
        "far": r["far"], "n_far": r["n_far"],
        "fdr": r["fdr"], "n_fdr": r["n_fdr"],
        "delay_samples": int(d) if detectado else None,
        "delay_minutes": float(r["delay_minutes"]) if detectado else None,
        # Muestra (base 1) en que empieza la primera racha de k alarmas tras el fallo.
        "first_alarm_sample": int(onset + d + 1) if detectado and onset is not None else None,
        "detected": detectado,
        "detected_at_chance": bool(r["detected_at_chance"]),
    }
    return limpiar(salida)


# ------------------------------------------------------------------ main
def main() -> int:
    repo = Path(TFM_REPO)
    datos = Path(DATA_DIR)
    out = Path(OUT_DIR)
    out.mkdir(parents=True, exist_ok=True)

    cfg, info_cfg = config.load_baseline(CONFIG_YAML, with_info=True)
    alpha = config.get(cfg, "protocolo.alpha")
    variance = config.get(cfg, "pca.variance")
    lags = config.get(cfg, "pca.lags")
    t2_method = config.get(cfg, "pca.t2_method")
    spe_method = config.get(cfg, "pca.spe_method")
    quantile_method = config.get(cfg, "pca.quantile_method")
    calibration = config.get(cfg, "pca.calibration")
    k = config.get(cfg, "protocolo.k_alarmas")
    cal_fraction = config.get(cfg, "particion.calibracion_limites")
    sample_minutes = config.get(cfg, "protocolo.sample_minutes")
    min_fdr = config.get(cfg, "protocolo.min_fdr")
    delay_convention = config.get(cfg, "protocolo.retardo_convencion")
    onset = data.FAULT_ONSET_TEST

    if lags != 0 or calibration != "holdout":
        raise SystemExit(f"Configuración inesperada (lags={lags}, calibration={calibration}): "
                         "la demo replica A1 con PCA estático y límites reservados.")

    # Ajuste y calibración: el mismo corte temporal de d00.dat que A1.
    with warnings.catch_warnings(record=True) as avisos:
        warnings.simplefilter("always")
        normal = data.values(data.load_classic(0, "train", root=datos))
    for a in avisos:
        print(f"Aviso de tfmfdd: {a.message}")
    corte = int(len(normal) * (1 - cal_fraction))
    X_fit, X_cal = normal[:corte], normal[corte:]

    modelos = {}
    for clave, m in METODOS.items():
        modelos[clave] = PCAMonitor(
            variance=variance, alpha=alpha, lags=0,
            t2_method=m["t2_method"] or t2_method,
            spe_method=m["spe_method"] or spe_method,
            quantile_method=quantile_method,
        ).fit(X_fit, X_cal=X_cal, calibration="holdout")
    base = modelos["f"]
    for clave, mod in modelos.items():
        assert mod.n_components_ == base.n_components_, clave
        assert np.array_equal(mod.loadings_, base.loadings_), clave
        assert np.array_equal(mod.eigenvalues_, base.eigenvalues_), clave

    var_explicada = float(np.cumsum(base.eigenvalues_)[base.n_components_ - 1] / base.eigenvalues_.sum())
    print(f"Ajuste: {len(X_fit)} filas; calibración: {len(X_cal)} filas reservadas; "
          f"{base.n_components_} componentes ({var_explicada:.4f} de varianza)")

    limites = {}
    for clave, mod in modelos.items():
        limites[clave] = {
            "label_es": METODOS[clave]["label_es"],
            "label_en": METODOS[clave]["label_en"],
            "t2": {"value": mod.t2_limit_, "method": mod.t2_method,
                   "detail": DESCRIPCION_METODO[mod.t2_method], "source": mod.limit_source_["t2"]},
            "spe": {"value": mod.spe_limit_, "method": mod.spe_method,
                    "detail": DESCRIPCION_METODO[mod.spe_method], "source": mod.limit_source_["spe"]},
        }
        print(f"  {clave:9s} T2 = {mod.t2_limit_:10.4f} ({mod.t2_method}, {mod.limit_source_['t2']})"
              f"   SPE = {mod.spe_limit_:10.4f} ({mod.spe_method}, {mod.limit_source_['spe']})")
    lim_t2 = [modelos[c].t2_limit_ for c in METODOS]
    lim_spe = [modelos[c].spe_limit_ for c in METODOS]

    # Puntuación, series y métricas.
    filas = []                     # formato de A1, para aggregate/summary
    por_fallo = {}
    subidos_total = 0
    series_info = {}
    for fault in range(22):
        X = data.values(data.load_classic(fault, "test", root=datos))
        assert X.shape == (960, data.N_VARS), (fault, X.shape)
        t2, spe = base.score(X)
        for clave, mod in modelos.items():
            t2_m, spe_m = mod.score(X)
            assert np.array_equal(t2_m, t2) and np.array_equal(spe_m, spe), (fault, clave)
        on = None if fault == 0 else onset

        # Series redondeadas, comprobando que conservan todas las alarmas.
        txt_t2, s1 = redondear_serie(t2, lim_t2)
        txt_spe, s2 = redondear_serie(spe, lim_spe)
        subidos_total += s1 + s2
        nombre = "d00.json" if fault == 0 else f"idv{fault:02d}.json"
        contenido = '{"t2":[' + ",".join(txt_t2) + '],"spe":[' + ",".join(txt_spe) + "]}"
        (out / nombre).write_text(contenido, encoding="utf-8", newline="")
        t2_r = np.array([float(x) for x in txt_t2])
        spe_r = np.array([float(x) for x in txt_spe])
        series_info[str(fault)] = {"file": nombre, "bytes": len(contenido.encode("utf-8")),
                                   "values_with_more_digits": s1 + s2}

        metr = {}
        for clave, mod in modelos.items():
            metr[clave] = {}
            for est, stat, stat_r, lim in (("t2", t2, t2_r, mod.t2_limit_),
                                           ("spe", spe, spe_r, mod.spe_limit_)):
                kw = dict(k=k, sample_minutes=sample_minutes, min_fdr=min_fdr,
                          delay_convention=delay_convention)
                r = metrics.evaluate_run(stat, lim, on, **kw)
                r_red = metrics.evaluate_run(stat_r, lim, on, **kw)
                for c in ("far", "fdr", "delay_samples", "detected", "detected_at_chance"):
                    a_, b_ = r[c], r_red[c]
                    igual = (a_ == b_) or (isinstance(a_, float) and np.isnan(a_) and np.isnan(b_))
                    if not igual:
                        raise RuntimeError(f"El redondeo cambia {c} en fallo {fault}, {clave}, {est}")
                m = metricas_json(r, on)
                if fault == 0:
                    # FAR por ventanas, informativas (A1 usa la serie entera).
                    for nom_v, ventana in (("far_1_160", (0, onset)), ("far_161_960", (onset, None))):
                        rv = metrics.evaluate_run(stat, lim, None, far_window=ventana, **kw)
                        m[nom_v] = rv["far"]
                        m[f"n_{nom_v}"] = rv["n_far"]
                metr[clave][est] = limpiar(m)
                filas.append({"method": clave, "faultNumber": fault,
                              "statistic": "T2" if est == "t2" else "SPE", "simulationRun": 1, **r})
        por_fallo[fault] = metr

    res = pd.DataFrame(filas)

    # Resúmenes con metrics.aggregate y metrics.summary, como A1.
    resumen = {}
    for clave in METODOS:
        resumen[clave] = {}
        for est in ("T2", "SPE"):
            agg = metrics.aggregate(res[(res["method"] == clave) & (res["statistic"] == est)])
            s = metrics.summary(agg, min_fdr=min_fdr)
            resumen[clave][est.lower()] = limpiar({
                "far_d00": s["far_normal"],
                "far_prefault_mean_1_21": s["far_prefallo_medio"],
                "fdr_mean_1_21": s["fdr_medio_todos"],
                "fdr_mean_without_3_9_15": s["fdr_medio_sin_dificiles"],
                "fdr_mean_3_9_15": s["fdr_medio_dificiles"],
                "delay_median_samples_valid": s["retardo_mediano_muestras"],
                "delay_median_samples_valid_n": s["retardo_mediano_muestras_n"],
                "faults_below_min_fdr": s["fallos_bajo_umbral"],
            })

    # --------------------------------------------------------- validación A1
    problemas = []
    a1 = pd.read_csv(Path(A1_DIR) / "A1_pca_baseline_runs.csv")
    prov = json.loads((Path(A1_DIR) / "A1_pca_baseline_runs.provenance.json").read_text(encoding="utf-8"))
    hashes_a1 = {e["name"]: e["sha256"] for e in prov["inputs"]}
    for nombre_f, h in hashes_a1.items():
        if sha256(datos / nombre_f) != h:
            problemas.append(f"{nombre_f}: SHA-256 distinto del de A1")
    cfg_a1 = prov["config"]
    for c, v in (("n_components", base.n_components_), ("n_fit", base.n_fit_), ("n_cal", base.n_cal_),
                 ("n_vars", base.n_features_in_), ("alpha", alpha), ("variance", variance), ("k", k)):
        if cfg_a1[c] != v:
            problemas.append(f"config {c}: A1 {cfg_a1[c]} frente a {v}")
    dif_lim = {"t2": abs(cfg_a1["t2_limit"] - base.t2_limit_), "spe": abs(cfg_a1["spe_limit"] - base.spe_limit_)}
    for c, d in dif_lim.items():
        if d > 1e-9:
            problemas.append(f"límite {c}: diferencia {d:g} con A1")

    max_dif = {"far": 0.0, "fdr": 0.0, "delay_samples": 0.0}
    nuestras = res[res["method"] == "f"].set_index(["faultNumber", "statistic"])
    for _, fila in a1.iterrows():
        n = nuestras.loc[(fila["faultNumber"], fila["statistic"])]
        for c in max_dif:
            a_, b_ = fila[c], n[c]
            if pd.isna(a_) and pd.isna(b_):
                continue
            if pd.isna(a_) or pd.isna(b_):
                problemas.append(f"fallo {fila['faultNumber']} {fila['statistic']} {c}: {a_} frente a {b_}")
                continue
            max_dif[c] = max(max_dif[c], abs(float(a_) - float(b_)))
        for c in ("detected", "detected_at_chance"):
            if bool(fila[c]) != bool(n[c]):
                problemas.append(f"fallo {fila['faultNumber']} {fila['statistic']} {c} distinto")
    for c, d in max_dif.items():
        if d > 1e-12:
            problemas.append(f"{c}: diferencia máxima {d:g} con A1")

    resumen_a1 = {}
    for est in ("T2", "SPE"):
        s = metrics.summary(pd.read_csv(Path(A1_DIR) / f"A1_pca_baseline_{est}.csv"), min_fdr=min_fdr)
        resumen_a1[est.lower()] = {"far_d00": s["far_normal"], "fdr_mean_1_21": s["fdr_medio_todos"],
                                   "fdr_mean_3_9_15": s["fdr_medio_dificiles"],
                                   "fdr_mean_without_3_9_15": s["fdr_medio_sin_dificiles"]}
        for c, v in resumen_a1[est.lower()].items():
            if abs(v - resumen["f"][est.lower()][c]) > 1e-12:
                problemas.append(f"resumen {est} {c}: A1 {v} frente a {resumen['f'][est.lower()][c]}")

    validacion = {
        "matches_A1_baseline": not problemas,
        "compared_with": "tfm-fdd-core/results/summary/A1_pca_baseline_runs.csv, A1_pca_baseline_T2.csv, "
                         "A1_pca_baseline_SPE.csv (y el .provenance.json de A1 para los SHA-256 de los .dat)",
        "A1_run": {"created_utc": prov["created_utc"], "commit": prov["git"]["commit"],
                   "baseline_yaml_sha256": prov["config_files"][0]["sha256"]},
        "max_abs_diff": {**max_dif, "t2_limit": dif_lim["t2"], "spe_limit": dif_lim["spe"]},
        "A1_summary": resumen_a1,
        "problems": problemas,
    }

    # ---------------------------------------------------------------- meta
    git = commit_tfm()
    faults_meta = [{
        "id": 0, "file": "d00.json", "source_file": "d00_te.dat",
        "name_es": "Operación normal", "name_en": "Normal operation",
        "desc_es": "Prueba sin fallo: 960 muestras (48 h); la FAR se mide en la serie entera",
        "desc_en": "Fault-free test run: 960 samples (48 h); FAR is measured on the whole series",
        "type": None, "type_es": None, "type_en": None, "hard": False,
        "metrics": por_fallo[0],
    }]
    for f in range(1, 22):
        tipo, n_es, d_es, n_en, d_en = FALLOS[f]
        faults_meta.append({
            "id": f, "file": f"idv{f:02d}.json", "source_file": f"d{f:02d}_te.dat",
            "name_es": n_es, "name_en": n_en, "desc_es": d_es, "desc_en": d_en,
            "type": tipo, "type_es": TIPOS[tipo][0], "type_en": TIPOS[tipo][1],
            "hard": f in metrics.HARD_FAULTS,
            "metrics": por_fallo[f],
        })

    meta = {
        "schema": "pabloduque.dev/tep-monitor/1",
        "generated_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "generator": "tools/tep/export_tep.py",
        "tfmfdd": {"version": tfmfdd.__version__, "repo": "tfm-fdd-core", **git,
                   "baseline_yaml_sha256": info_cfg["sha256"],
                   "baseline_script": "experiments/A1_pca_baseline.py"},
        "dataset": {
            "name": "Tennessee Eastman Process, conjunto clásico (Chiang, Russell y Braatz, 2001)",
            "name_en": "Tennessee Eastman Process, classic dataset (Chiang, Russell and Braatz, 2001)",
            "references": ["Downs, J. J. y Vogel, E. F. (1993). A plant-wide industrial process control "
                           "problem. Computers & Chemical Engineering, 17(3), 245-255.",
                           "Russell, E. L., Chiang, L. H. y Braatz, R. D. (2000). Fault detection in "
                           "industrial processes using canonical variate analysis and dynamic principal "
                           "component analysis. Chemometrics and Intelligent Laboratory Systems, 51, 81-93.",
                           "Chiang, L. H., Russell, E. L. y Braatz, R. D. (2001). Fault Detection and "
                           "Diagnosis in Industrial Systems. Springer."],
            "license": "Copyright (c) 1998-2002 The Board of Trustees of the University of Illinois "
                       "(Large Scale Systems Research Laboratory); ver tfm-fdd-core/data/tep_classic/LICENSE",
            "train_file": "d00.dat (viene transpuesto, 52 x 500; tfmfdd lo corrige)",
            "test_files": "d00_te.dat, d01_te.dat ... d21_te.dat",
            "inputs_sha256": {n: hashes_a1[n] for n in sorted(hashes_a1)},
            "fault_descriptions_source": "IDV 1-20: tfm-fdd-core/data/tep_classic/README.md, tabla Process Disturbances "
                                         "(Downs y Vogel, 1993); IDV 21: Russell et al. (2000), p. 87",
        },
        "config": limpiar({
            "n_vars": base.n_features_in_,
            "variables": "xmeas_1..xmeas_41 y xmv_1..xmv_11",
            "n_components": base.n_components_,
            "variance_target": variance,
            "variance_explained": var_explicada,
            "alpha": alpha,
            "lags": 0,
            "scaling": "media y desviación (ddof = 1) de las filas del ajuste (tfmfdd.preprocessing.Scaler)",
            "n_fit": base.n_fit_,
            "fit_rows": f"d00.dat, filas 1 a {len(X_fit)}",
            "n_cal": base.n_cal_,
            "cal_rows": f"d00.dat, filas {len(X_fit) + 1} a {len(normal)} (reservadas, el modelo no las ve)",
            "calibration": "holdout",
            "quantile_method": quantile_method,
            "k_alarms": k,
            "delay_convention": delay_convention,
            "delay_definition_es": "muestras desde la 161 hasta la primera alarma de la primera racha de "
                                   f"{k} alarmas consecutivas (0 = la racha empieza en la muestra 161)",
            "delay_definition_en": f"samples from 161 to the first alarm of the first run of {k} "
                                   "consecutive alarms (0 = the run starts at sample 161)",
            "min_fdr_at_chance": min_fdr,
            "sample_minutes": sample_minutes,
            "n_samples": 960,
            "fault_onset_index": onset,
            "fault_first_sample": onset + 1,
            "far_window_faults": [1, onset],
            "far_window_d00": [1, 960],
            "fdr_window": [onset + 1, 960],
            "alarm_rule": "estadístico > límite (tfmfdd.metrics.alarms)",
        }),
        "limits": limpiar(limites),
        "hard_faults": list(metrics.HARD_FAULTS),
        "hard_faults_note_es": "IDV 3, 9 y 15: casi indetectables; tfmfdd los promedia aparte "
                               "(tfmfdd.metrics.HARD_FAULTS)",
        "hard_faults_note_en": "IDV 3, 9 and 15: nearly undetectable; tfmfdd averages them separately "
                               "(tfmfdd.metrics.HARD_FAULTS)",
        "series": {
            "format": '{"t2":[960 valores],"spe":[960 valores]}, muestra 1 en el índice 0',
            "significant_digits": CIFRAS,
            "values_with_more_digits": subidos_total,
            "rounding_note_es": "Los valores que al redondear cambiarían de estado frente a algún límite de "
                                "su estadístico llevan las cifras justas para conservarlo: recalcular FAR, "
                                "FDR y retardo con las series da exactamente las métricas de este fichero.",
            "files": series_info,
        },
        "faults": faults_meta,
        "summary": resumen,
        "validation": limpiar(validacion),
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
                                   encoding="utf-8", newline="\n")

    # --------------------------------------------------------------- informe
    print(f"\nSeries escritas en {out} ({subidos_total} valores con más de {CIFRAS} cifras)")
    for clave in METODOS:
        for est in ("t2", "spe"):
            s = resumen[clave][est]
            print(f"  {clave:9s} {est.upper():3s} FAR d00 = {s['far_d00']:.4f}  "
                  f"FDR 1-21 = {s['fdr_mean_1_21']:.4f}  sin 3/9/15 = {s['fdr_mean_without_3_9_15']:.4f}  "
                  f"3/9/15 = {s['fdr_mean_3_9_15']:.4f}")
    print(f"\nValidación frente a A1: {'coincide' if not problemas else 'NO coincide'}")
    print(f"  diferencias máximas: {validacion['max_abs_diff']}")
    for p in problemas:
        print(f"  - {p}")
    return 0 if not problemas else 1


if __name__ == "__main__":
    sys.exit(main())
