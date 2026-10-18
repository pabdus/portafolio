#!/usr/bin/env python3
"""Exporta la evaluación de facturas-a-excel a site/data/facturas/eval.json.

Datos para la demo «mide tú mismo»: por extractor y por factura, qué campo acertó, qué
leyó cuando falló, si la factura fue a revisión y si un error pasó sin aviso; y la prueba
de estrés por resolución del escaneo, con el detalle de cada factura.

El repo de origen se lee, nunca se escribe (tampoco .pyc). La comparación y la validación
son las del propio repo (facturas/evaluar.py y facturas/validar.py), para que un acierto
signifique aquí lo mismo que en su informe. Antes de escribir, cada total se contrasta con:

  - salidas/prueba/metricas.json        (todos los extractores y subconjuntos)
  - salidas/prueba/facturas_*.json      (estado ok/revisar por factura, donde existe)
  - salidas/prueba/informe.md           (tabla «Resumen», incluye Haiku)
  - README.md, sección «Resultado»      (tabla principal)
  - salidas/prueba/estres/resumen.json, estres/informe.md y la tabla de estrés del README

Si algo no cuadra, el script se detiene sin escribir.

Criterio de revisión: las métricas publicadas de `prueba` y de la prueba de estrés se
calcularon antes de la decisión 16 (docs/decisiones.md), cuando una factura sin líneas
daba «no se pudo comprobar» en el chequeo `lineas` en vez de fallar. `rv` reproduce ese
criterio, el medido. Donde el criterio actual daría otra cosa, la fila lleva `rv16`.

Uso:
    python tools/facturas/export_eval.py [--fuente /c/dev/facturas-a-excel] [--salida site/data/facturas/eval.json]
"""
from __future__ import annotations

import hashlib
import argparse
import json
import re
import subprocess
import sys
import unicodedata
from decimal import Decimal
from pathlib import Path

PORTAFOLIO = Path(__file__).resolve().parents[2]
FUENTE_POR_DEFECTO = PORTAFOLIO.parent / "facturas-a-excel"
SALIDA_POR_DEFECTO = PORTAFOLIO / "site" / "data" / "facturas" / "eval.json"

# Orden de la demo. claude-haiku entra solo si sus 20 salidas existen y no traen error.
EXTRACTORES = ("reglas", "llm", "vision", "claude", "claude-haiku")
EN_TABLA_README = {"reglas", "llm", "vision", "claude"}

ETIQUETA_CAMPO = {  # nombre interno (facturas/modelo.py:CAMPOS) -> ES / EN
    "numero": ("Número de factura", "Invoice number"),
    "fecha_emision": ("Fecha de emisión", "Issue date"),
    "fecha_vencimiento": ("Fecha de vencimiento", "Due date"),
    "emisor_nombre": ("Emisor", "Supplier"),
    "emisor_nit": ("NIT del emisor", "Supplier tax ID (NIT)"),
    "cliente_nombre": ("Cliente", "Customer"),
    "cliente_nit": ("NIT del cliente", "Customer tax ID (NIT)"),
    "subtotal": ("Subtotal", "Subtotal"),
    "descuento": ("Descuento", "Discount"),
    "iva": ("IVA", "VAT (IVA)"),
    "retencion": ("Retención", "Withholding"),
    "total": ("Total", "Total"),
}
TIPO_CAMPO = {"numero": "texto", "emisor_nombre": "texto", "cliente_nombre": "texto",
              "fecha_emision": "fecha", "fecha_vencimiento": "fecha",
              "emisor_nit": "nit", "cliente_nit": "nit"}  # el resto: monto

ETIQUETA_LINEA = {
    "descripcion": ("Descripción", "Description"),
    "cantidad": ("Cantidad", "Quantity"),
    "precio_unitario": ("Precio unitario", "Unit price"),
    "total_linea": ("Total de la línea", "Line total"),
}

CHEQUEO_EN = {  # traducción de facturas/validar.py:CHEQUEOS
    "obligatorios": "Invoice number, issue date, supplier NIT and total present",
    "nit_emisor": "Supplier NIT check digit (DIAN, modulo 11)",
    "nit_cliente": "Customer NIT check digit (DIAN, modulo 11)",
    "lineas": "Quantity × unit price = line total",
    "suma_lineas": "Sum of lines = subtotal",
    "tasa_iva": "VAT / taxable base is 0 %, 5 % or 19 %",
    "cuadre": "Subtotal − discount + VAT − withholding = total",
    "fechas": "Due date on or after issue date",
}

PLANTILLA_EN = {"A": "classic", "B": "modern", "C": "services", "D": "POS receipt", "E": "new supplier"}

EXTRACTOR_INFO = {  # descripciones tomadas del README (sección «Cómo funciona») y de facturas/__main__.py
    "reglas": {"en": "Rules", "via": "texto",
               "es_d": "Expresiones regulares sobre rótulos conocidos, sin OCR. Congeladas antes de que existiera la plantilla E.",
               "en_d": "Regular expressions over known labels, no OCR. Frozen before template E existed."},
    "llm": {"en": "Local LLM", "via": "texto o imagen",
            "es_d": "qwen3.5:9b en Ollama, en un portátil. Lee el texto si el PDF lo tiene y la imagen si es un escaneo.",
            "en_d": "qwen3.5:9b on Ollama, on a laptop. Reads the text layer when there is one, the page image for scans."},
    "vision": {"en": "LLM, image only", "via": "imagen",
               "es_d": "El mismo modelo local, solo con la imagen de la página, aunque haya capa de texto.",
               "en_d": "Same local model, page image only, even when a text layer exists."},
    "claude": {"en": "Claude Opus 5.5", "via": "pdf",
               "es_d": "Claude Opus 5.5 en Amazon Bedrock. Recibe el PDF tal cual, con el mismo prompt congelado.",
               "en_d": "Claude Opus 5.5 on Amazon Bedrock. Gets the PDF as is, with the same frozen prompt."},
    "claude-haiku": {"en": "Claude Haiku 4.5", "via": "pdf",
                     "es_d": "Claude Haiku 4.5 en Amazon Bedrock, mismo lector que Opus. En 4 facturas entregó las líneas como texto mal formado.",
                     "en_d": "Claude Haiku 4.5 on Amazon Bedrock, same reader as Opus. On 4 invoices it returned the lines as malformed text."},
}

# Términos que nunca deben aparecer en el JSON público (se comparan sin tildes ni mayúsculas, palabra por palabra).
# Van como SHA-256 con sal para no publicar la lista en claro en un repo público.
# Para añadir uno: hashlib.sha256(("pd-fx|" + "termino").encode()).hexdigest()[:24]
PROHIBIDOS_SAL = "pd-fx|"
PROHIBIDOS_HASH = {"ed09e57981ebe0d3c59016c3", "6aa7c83e89002a91045ee4d9", "81b8d5483122deacc66f880d", "9396cac2274606bc6831f4a3", "a43894bb8f6a5034d00dbbae", "4f5e7779d4e32466f67c3cfd", "b340e70a8ba13695409f3a43"}


class NoCuadra(Exception):
    pass


def _importar_fuente(fuente: Path):
    sys.dont_write_bytecode = True  # el repo de origen es de solo lectura
    sys.path.insert(0, str(fuente))
    from facturas import evaluar, informe, modelo, validar  # noqa: E402
    return evaluar, informe, modelo, validar


def _leer(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _js(v):
    """Valor canónico -> JSON: Decimal con dos decimales, el resto tal cual."""
    if isinstance(v, Decimal):
        return format(v, ".2f")
    return v


def _r4(x):
    return None if x is None or x != x else round(x, 4)


def _commit(fuente: Path) -> dict:
    def git(*args):
        try:
            return subprocess.run(["git", "-C", str(fuente), *args], capture_output=True, text=True,
                                  encoding="utf-8", check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            return None
    sucio = git("status", "--porcelain", "--", "README.md", "datos/prueba", "salidas/prueba", "facturas")
    return {"commit": git("rev-parse", "--short", "HEAD"), "cambios_sin_commit": bool(sucio) if sucio is not None else None}


# ---------------------------------------------------------------- comparación por factura

def _fila(pred: dict, gt: dict, meta: dict, salida: dict, ev, vd, modelo) -> dict:
    CAMPOS, CAMPOS_LINEA = modelo.CAMPOS, modelo.CAMPOS_LINEA
    comp = ev.comparar(pred, gt)
    exactas, denom = comp["_lineas"]
    ok = all(comp[c] for c in CAMPOS) and comp["lineas"]

    resultados = vd.validar(pred)
    sin_lineas = not pred.get("lineas")
    # Criterio medido (antes de la decisión 16): sin líneas, el chequeo `lineas` no fallaba.
    fallos = [x.chequeo for x in resultados if x.ok is False and not (x.chequeo == "lineas" and sin_lineas)]
    rv = bool(fallos)
    rv16 = vd.requiere_revision(resultados)
    problema = meta["error_en_origen"] is not None or not ok

    fila = {"f": [int(comp[c]) for c in CAMPOS]}
    errores = {c: [_js(gt[c]), _js(pred[c])] for c in CAMPOS if not comp[c]}
    if errores:
        fila["e"] = errores
    fila["l"] = [exactas, len(pred.get("lineas", [])), denom]
    le = [[i, c, _js(g.get(c)), _js(p.get(c))]
          for i, (p, g) in enumerate(zip(pred.get("lineas", []), gt.get("lineas", [])), 1)
          for c in CAMPOS_LINEA if not ev._igual(c, p.get(c), g.get(c))]
    if le:
        fila["le"] = le
    fila["ok"] = ok
    fila["rv"] = rv
    if rv16 != rv:
        fila["rv16"] = rv16
    if fallos:
        fila["mot"] = fallos
    fila["sil"] = problema and not rv
    if salida.get("segundos") is not None:
        fila["s"] = salida["segundos"]
    uso = salida.get("crudo", {}).get("_uso") if isinstance(salida.get("crudo"), dict) else None
    if uso and "entrada" in uso and "salida" in uso:
        fila["tk"] = [uso["entrada"], uso["salida"]]
    return fila


def _mediana(segs):
    """Igual que facturas/evaluar.py: el elemento n//2 de la lista ordenada."""
    s = sorted(x for x in segs if x is not None)
    return s[len(s) // 2] if s else None


# ---------------------------------------------------------------- totales y contraste

def _totales(filas, facturas, ev, modelo) -> dict:
    def sub(pred):
        return [(f, x) for f, x in zip(facturas, filas) if pred(f)]

    def bloque(pares):
        CAMPOS = modelo.CAMPOS
        k = sum(sum(x["f"]) for _, x in pares)
        n = len(pares) * len(CAMPOS)
        kl = sum(x["l"][0] for _, x in pares)
        nl = sum(x["l"][2] for _, x in pares)
        ok = sum(x["ok"] for _, x in pares)
        vp = sum((f["err"] is not None or not x["ok"]) and x["rv"] for f, x in pares)
        fn = sum((f["err"] is not None or not x["ok"]) and not x["rv"] for f, x in pares)
        fp = sum(x["rv"] and not (f["err"] is not None or not x["ok"]) for f, x in pares)
        vn = len(pares) - vp - fn - fp
        origen = [(f, x) for f, x in pares if f["err"]]
        return {
            "n_facturas": len(pares),
            "por_campo": {c: sum(x["f"][i] for _, x in pares) for i, c in enumerate(CAMPOS)},
            "lineas_ok_por_factura": sum(x["l"][0] == x["l"][2] for _, x in pares),
            "campos": [k, n], "lineas": [kl, nl], "facturas_ok": [ok, len(pares)],
            "validacion": {"vp": vp, "fn": fn, "fp": fp, "vn": vn},
            "errores_proveedor": [sum(x["rv"] for _, x in origen), len(origen)],
            "mediana_s": _mediana([x.get("s") for _, x in pares]),
        }

    return {
        "todas": bloque(sub(lambda f: True)),
        "digitales": bloque(sub(lambda f: not f["esc"])),
        "escaneadas": bloque(sub(lambda f: f["esc"])),
        "plantillas_conocidas": bloque(sub(lambda f: f["p"] != "E")),
        "plantilla_nueva": bloque(sub(lambda f: f["p"] == "E")),
    }


def _contrastar_metricas(m: str, tot: dict, met: dict, errores_n: int, problemas: list):
    def igual(etq, a, b):
        if a != b:
            problemas.append(f"{m} · {etq}: calculado {a!r} ≠ metricas.json {b!r}")

    for clave, t in tot.items():
        r = met[clave]
        igual(f"{clave}.n_facturas", t["n_facturas"], r["n_facturas"])
        for c, k in t["por_campo"].items():
            igual(f"{clave}.campos.{c}", k, r["campos"][c]["aciertos"])
        igual(f"{clave}.campos.lineas", t["lineas_ok_por_factura"], r["campos"]["lineas"]["aciertos"])
        igual(f"{clave}.campos_total", t["campos"], [r["campos_total"]["aciertos"], r["campos_total"]["n"]])
        igual(f"{clave}.lineas_una_a_una", t["lineas"], [r["lineas_una_a_una"]["aciertos"], r["lineas_una_a_una"]["n"]])
        igual(f"{clave}.facturas_completas", t["facturas_ok"], [r["facturas_completas"]["aciertos"], r["facturas_completas"]["n"]])
        igual(f"{clave}.validacion", t["validacion"], r["validacion"])
        igual(f"{clave}.errores_en_origen", t["errores_proveedor"], [r["errores_en_origen"]["detectados"], r["errores_en_origen"]["n"]])
        igual(f"{clave}.segundos_mediana", t["mediana_s"], r["segundos_mediana"])
    igual("errores (n)", errores_n, len(met["errores"]))


def _celda(s: str) -> str:
    return s.replace("**", "").strip()


def _tabla_md(texto: str, primera_col: str) -> tuple[list[str], dict[str, list[str]]]:
    """Primera tabla Markdown cuya cabecera empieza por `primera_col`: (columnas, {rótulo: celdas})."""
    lineas = texto.splitlines()
    for i, l in enumerate(lineas):
        celdas = [_celda(c) for c in l.strip().strip("|").split("|")]
        if l.startswith("|") and celdas[0] == primera_col:
            cols = celdas[1:]
            filas = {}
            for l2 in lineas[i + 2:]:
                if not l2.startswith("|"):
                    break
                c2 = [_celda(c) for c in l2.strip().strip("|").split("|")]
                filas[c2[0]] = c2[1:]
            return cols, filas
    raise NoCuadra(f"no encontré la tabla que empieza por «{primera_col}»")


def _fraccion(s: str) -> list[int]:
    m = re.match(r"(\d+)\s*/\s*(\d+)", s)
    if not m:
        raise NoCuadra(f"no es una fracción: {s!r}")
    return [int(m.group(1)), int(m.group(2))]


def _pct_ic(k: int, n: int, ic, sep: str) -> str:
    lo, hi = ic
    return f"{100 * k / n:.1f}".replace(".", sep) + f" % ({100 * lo:.0f}–{100 * hi:.0f})"


def _contrastar_readme(readme: str, tots: dict, nombre: dict, problemas: list) -> list[str]:
    seccion = readme.split("## Resultado", 1)[1].split("\n## ", 1)[0]
    cols, filas = _tabla_md(seccion, "")
    por_nombre = {v: k for k, v in nombre.items()}
    revisado = []
    for j, col in enumerate(cols):
        m = por_nombre.get(col)
        if m not in tots:
            problemas.append(f"README: columna «{col}» sin extractor exportado")
            continue
        t = tots[m]["todas"]
        esperado = {
            "Campos exactos": (_fraccion, t["campos"]),
            "Líneas de detalle exactas": (_fraccion, t["lineas"]),
            "Facturas 100 % correctas": (_fraccion, t["facturas_ok"]),
            "… de ellas, escaneadas": (_fraccion, tots[m]["escaneadas"]["facturas_ok"]),
            "… de ellas, del proveedor nuevo": (_fraccion, tots[m]["plantilla_nueva"]["facturas_ok"]),
            "Errores del proveedor detectados": (_fraccion, t["errores_proveedor"]),
            "Errores de lectura que pasaron sin aviso": (int, t["validacion"]["fn"]),
            "Facturas correctas enviadas a revisión": (_fraccion, [t["validacion"]["fp"], t["validacion"]["fp"] + t["validacion"]["vn"]]),
        }
        for rot, celdas in filas.items():
            v = celdas[j]
            if rot in esperado:
                conv, calc = esperado[rot]
                if conv(v) != calc:
                    problemas.append(f"README «{rot}» · {col}: dice {v!r}, calculado {calc}")
            elif rot == "Segundos por factura (mediana)":
                med = t["mediana_s"]
                if v.startswith("<"):
                    tope = float(v.lstrip("< ").replace(",", "."))
                    if not med < tope:
                        problemas.append(f"README «{rot}» · {col}: dice {v!r}, mediana {med}")
                else:
                    dec = len(v.split(",")[1]) if "," in v else 0
                    if round(med, dec) != float(v.replace(",", ".")):
                        problemas.append(f"README «{rot}» · {col}: dice {v!r}, mediana {med}")
            else:
                problemas.append(f"README: fila «{rot}» sin contraste")
                continue
            revisado.append(f"{rot} · {col}")
    return revisado


def _contrastar_informe(informe_md: str, tots: dict, met: dict, nombre: dict, problemas: list) -> int:
    seccion = informe_md.split("### Resumen", 1)[1].split("\n### ", 1)[0]
    cols, filas = _tabla_md(seccion, "Indicador")
    por_nombre = {v: k for k, v in nombre.items()}
    n = 0
    for j, col in enumerate(cols):
        m = por_nombre.get(col)
        if m not in tots:
            problemas.append(f"informe.md: columna «{col}» sin extractor exportado")
            continue
        t, r = tots[m]["todas"], met[m]["todas"]
        v = t["validacion"]
        esperado = {
            "Campos exactos (IC 95 %)": _pct_ic(*t["campos"], r["campos_total"]["ic95"], "."),
            "Líneas de detalle exactas": _pct_ic(*t["lineas"], r["lineas_una_a_una"]["ic95"], "."),
            "Facturas 100 % correctas": "{} / {}".format(*t["facturas_ok"]),
            "Errores del proveedor detectados": "{} / {}".format(*t["errores_proveedor"]),
            "Facturas con problema enviadas a revisión": f"{v['vp']} / {v['vp'] + v['fn']}",
            "Facturas correctas enviadas a revisión": f"{v['fp']} / {v['fp'] + v['vn']}",
            "Segundos por factura (mediana)": f"{t['mediana_s']:.2f}",
        }
        for rot, celdas in filas.items():
            if esperado.get(rot) != celdas[j]:
                problemas.append(f"informe.md «{rot}» · {col}: dice {celdas[j]!r}, calculado {esperado.get(rot)!r}")
            n += 1
    return n


# ---------------------------------------------------------------- exportación

def exportar(fuente: Path, lineas_estres: bool = True) -> tuple[dict, list[str]]:
    ev, inf, modelo, vd = _importar_fuente(fuente)
    CAMPOS = modelo.CAMPOS
    problemas: list[str] = []
    contrastes: list[str] = []
    datos = fuente / "datos" / "prueba"
    salidas = fuente / "salidas" / "prueba"
    readme = (fuente / "README.md").read_text(encoding="utf-8")

    # Verdad de terreno y metadatos
    gts = {}
    facturas = []
    for ruta in sorted((datos / "verdad").glob("*.json")):
        g = _leer(ruta)
        meta = g.pop("_meta")
        gt = modelo.canonica(g)
        gts[ruta.stem] = (gt, meta)
        facturas.append({"id": ruta.stem, "p": meta["plantilla"], "esc": bool(meta["escaneada"]),
                         "nuevo": meta["plantilla"] == "E", "err": meta["error_en_origen"],
                         "v": [_js(gt[c]) for c in CAMPOS], "nl": len(gt["lineas"])})
    if len(facturas) != 20:
        problemas.append(f"se esperaban 20 facturas de prueba, hay {len(facturas)}")

    # El error de total del proveedor: cuánto se aparta lo impreso del cuadre
    for f in facturas:
        gt, meta = gts[f["id"]]
        if meta["error_en_origen"] == "total":
            calc = gt["subtotal"] - gt["descuento"] + gt["iva"] - gt["retencion"]
            f["dif_total"] = _js(gt["total"] - calc)

    # Plantillas (rótulo ES y estilo, de la tabla del README)
    _, filas_pl = _tabla_md(readme.split("## Qué hay en el conjunto de prueba", 1)[1], "Plantilla")
    plantillas = {}
    for rot, celdas in filas_pl.items():
        letra, _, nombre_es = rot.partition(" · ")
        plantillas[letra] = {"es": nombre_es, "en": PLANTILLA_EN[letra], "estilo": celdas[0]}

    met = _leer(salidas / "metricas.json")
    extractores, tots = [], {}
    for m in EXTRACTORES:
        d = salidas / m
        rutas = sorted(d.glob("*.json")) if d.is_dir() else []
        salidas_m = {r.stem: _leer(r) for r in rutas}
        faltan = [f["id"] for f in facturas if f["id"] not in salidas_m]
        con_error = [k for k, s in salidas_m.items() if s.get("error")]
        if faltan or con_error:
            msg = f"{m}: faltan {faltan} o traen error {con_error}"
            if m == "claude-haiku":
                print(f"aviso: {msg}; no se exporta", file=sys.stderr)
                continue
            problemas.append(msg)
            continue
        filas = []
        for f in facturas:
            gt, meta = gts[f["id"]]
            s = salidas_m[f["id"]]
            filas.append(_fila(modelo.canonica(s.get("canonica")), gt, meta, s, ev, vd, modelo))
        tot = _totales(filas, facturas, ev, modelo)
        n_err = sum(len(x.get("e", {})) + (x["l"][0] != x["l"][2]) for x in filas)
        if m in met:
            _contrastar_metricas(m, tot, met[m], n_err, problemas)
            contrastes.append(f"salidas/prueba/metricas.json · {m}")
        else:
            problemas.append(f"{m} no está en metricas.json")
        exp = salidas / f"facturas_{m}.json"
        if exp.exists():
            estado = {Path(x["archivo"]).stem: x["estado"] == "revisar" for x in _leer(exp)}
            for f, x in zip(facturas, filas):
                if estado.get(f["id"]) != x["rv"]:
                    problemas.append(f"{m} · {f['id']}: rv={x['rv']} pero {exp.name} dice {estado.get(f['id'])}")
            contrastes.append(f"salidas/prueba/{exp.name} · estado por factura")
        tots[m] = tot
        t = tot["todas"]
        info = EXTRACTOR_INFO[m]
        ext = {
            "id": m, "es": inf.NOMBRE[m], "en": info["en"], "via": info["via"],
            "es_d": info["es_d"], "en_d": info["en_d"],
            "en_tabla_readme": m in EN_TABLA_README,
            "tot": {
                "campos": t["campos"], "ic_campos": [_r4(x) for x in met[m]["todas"]["campos_total"]["ic95"]],
                "lineas": t["lineas"], "facturas_ok": t["facturas_ok"],
                "ok_escaneadas": tot["escaneadas"]["facturas_ok"], "ok_nuevo": tot["plantilla_nueva"]["facturas_ok"],
                "errores_proveedor": t["errores_proveedor"],
                "sin_aviso": t["validacion"]["fn"],
                "problema_a_revision": [t["validacion"]["vp"], t["validacion"]["vp"] + t["validacion"]["fn"]],
                "correctas_a_revision": [t["validacion"]["fp"], t["validacion"]["fp"] + t["validacion"]["vn"]],
                "mediana_s": t["mediana_s"],
                "por_campo": t["por_campo"],
            },
            "res": filas,
        }
        tk = [x["tk"] for x in filas if "tk" in x]
        if tk:
            ext["tot"]["tokens_mediana"] = [_mediana([a for a, _ in tk]), _mediana([b for _, b in tk])]
        cambios16 = [f["id"] for f, x in zip(facturas, filas) if "rv16" in x]
        if cambios16:
            ext["nota_rv16"] = cambios16
        extractores.append(ext)

    contrastes += [f"README.md «Resultado» · {x}" for x in _contrastar_readme(readme, tots, inf.NOMBRE, problemas)]
    n_inf = _contrastar_informe((salidas / "informe.md").read_text(encoding="utf-8"), tots, met, inf.NOMBRE, problemas)
    contrastes.append(f"salidas/prueba/informe.md «Resumen» · {n_inf} celdas")

    estres = _estres(fuente, gts, facturas, ev, vd, modelo, readme, problemas, contrastes, lineas_estres)

    out = {
        "v": 1,
        "fuente": {
            "repo": "github.com/pabdus/facturas-a-excel", **_commit(fuente),
            "verdad": "datos/prueba/verdad/*.json", "salidas": "salidas/prueba/<extractor>/*.json",
            "metricas": "salidas/prueba/metricas.json", "estres": "salidas/prueba/estres/<ppp>/*.json",
            "contrastado": sorted(set(c.split(" · ")[0] for c in contrastes)),
        },
        "leyenda": {
            "f": "acierto por campo, en el orden de `campos` (1 acierto, 0 error)",
            "e": "campo con error: [esperado, leído]; null = no leído",
            "l": "líneas de detalle: [exactas, leídas, denominador = máx(leídas, esperadas)]",
            "le": "línea emparejada por orden con algún campo distinto: [n.º de línea, campo, esperado, leído]",
            "ok": "factura 100 % correcta: los 12 campos y todas las líneas",
            "rv": "la validación la mandó a revisión (criterio medido, anterior a la decisión 16)",
            "rv16": "solo si cambia: revisión con el criterio actual (decisión 16, una factura sin líneas falla)",
            "mot": "chequeos que fallaron, ids de `chequeos`",
            "sil": "tenía un problema (error de lectura o del proveedor) y no fue a revisión",
            "s": "segundos de la extracción",
            "tk": "tokens [entrada, salida] informados por Bedrock",
            "mediana_s": "como facturas/evaluar.py: elemento n//2 de los tiempos ordenados",
        },
        "comparacion": {
            "es": "Un monto vale si coincide al centavo; una fecha, si coincide el día; un nombre, si coincide sin tildes, mayúsculas ni puntuación. Una línea vale si sus cuatro campos coinciden.",
            "en": "An amount counts if it matches to the cent; a date, to the day; a name, ignoring accents, case and punctuation. A line counts if all four of its fields match.",
        },
        "campos": [{"id": c, "es": ETIQUETA_CAMPO[c][0], "en": ETIQUETA_CAMPO[c][1], "tipo": TIPO_CAMPO.get(c, "monto")}
                   for c in CAMPOS],
        "campos_linea": [{"id": c, "es": a, "en": b} for c, (a, b) in ETIQUETA_LINEA.items()],
        "chequeos": [{"id": k, "es": v, "en": CHEQUEO_EN[k]} for k, v in vd.CHEQUEOS.items()],
        "plantillas": plantillas,
        "errores_proveedor": {
            "total": {"es": "Total mal digitado por el proveedor", "en": "Total mistyped by the supplier"},
            "linea": {"es": "Una línea con una unidad de más, que arrastra el subtotal",
                      "en": "One line with an extra unit, which carries into the subtotal"},
        },
        "facturas": facturas,
        "extractores": extractores,
        "estres": estres,
    }
    return out, problemas


def _estres(fuente, gts, facturas, ev, vd, modelo, readme, problemas, contrastes, lineas_estres=True) -> dict:
    CAMPOS = modelo.CAMPOS
    base = fuente / "salidas" / "prueba" / "estres"
    resumen = _leer(base / "resumen.json")
    niveles = []
    for nivel, r in resumen.items():
        filas = []
        for f in facturas:
            gt, meta = gts[f["id"]]
            s = _leer(base / nivel / f"{f['id']}.json")
            if s.get("error"):
                problemas.append(f"estrés {nivel} · {f['id']}: {s['error']}")
            x = _fila(modelo.canonica(s.get("canonica")), gt, meta, s, ev, vd, modelo)
            x.pop("tk", None)
            if not lineas_estres:
                x.pop("le", None)
            # Como facturas/estres.py: las facturas con error del proveedor no cuentan como silenciosas.
            x["sil"] = (not x["ok"]) and (not x["rv"]) and meta["error_en_origen"] is None
            filas.append(x)
        k = sum(sum(x["f"]) for x in filas)
        n = len(filas) * len(CAMPOS)
        evaluables = [(f, x) for f, x in zip(facturas, filas) if f["err"] is None]
        con_error = [(f, x) for f, x in evaluables if not x["ok"]]
        calc = {
            "aciertos": k, "n": n,
            "facturas_completas": sum(x["ok"] for x in filas),
            "sin_error_en_origen": len(evaluables),
            "con_error_de_lectura": len(con_error),
            "errores_detectados": sum(x["rv"] for _, x in con_error),
            "errores_silenciosos": sum(not x["rv"] for _, x in con_error),
            "falsas_alarmas": sum(x["ok"] and x["rv"] for _, x in evaluables),
        }
        pub = {"aciertos": r["campos"]["aciertos"], "n": r["campos"]["n"],
               **{c: r[c] for c in calc if c not in ("aciertos", "n")}}
        for c in calc:
            if calc[c] != pub[c]:
                problemas.append(f"estrés {nivel} · {c}: calculado {calc[c]} ≠ resumen.json {pub[c]}")
        ic = ev.wilson(k, n)
        if [round(a, 9) for a in ic] != [round(a, 9) for a in r["campos"]["ic95"]]:
            problemas.append(f"estrés {nivel} · ic95: {ic} ≠ {r['campos']['ic95']}")
        origen_sin_aviso = [f["id"] for f, x in zip(facturas, filas) if f["err"] and not x["rv"]]
        nv = {
            "ppp": r["calidad"]["ppp"], "nivel": nivel, "calidad": r["calidad"],
            "campos": [k, n], "ic_campos": [_r4(a) for a in ic],
            "facturas_ok": [calc["facturas_completas"], len(filas)],
            "con_error_lectura": [calc["con_error_de_lectura"], calc["sin_error_en_origen"]],
            "a_revision": calc["errores_detectados"], "sin_aviso": calc["errores_silenciosos"],
            "falsas_alarmas": calc["falsas_alarmas"],
            "errores_proveedor": [sum(x["rv"] for f, x in zip(facturas, filas) if f["err"]),
                                  sum(1 for f in facturas if f["err"])],
            "por_campo": {c: sum(x["f"][i] for x in filas) for i, c in enumerate(CAMPOS)},
            "mediana_s": _mediana([x.get("s") for x in filas]),
            "res": filas,
        }
        if origen_sin_aviso:
            nv["proveedor_sin_aviso"] = origen_sin_aviso
        cambios16 = [f["id"] for f, x in zip(facturas, filas) if "rv16" in x]
        if cambios16:
            nv["nota_rv16"] = cambios16
        niveles.append(nv)
    contrastes.append("salidas/prueba/estres/resumen.json")

    # informe.md de la prueba de estrés
    inf_md = (base / "informe.md").read_text(encoding="utf-8")
    _, filas_md = _tabla_md(inf_md, "Resolución")
    for nv in niveles:
        celdas = filas_md.get(f"{nv['ppp']} ppp")
        k, n = nv["campos"]
        esperado = [_pct_ic(k, n, ev.wilson(k, n), "."), "{} / {}".format(*nv["facturas_ok"]),
                    "{} / {}".format(*nv["con_error_lectura"]), str(nv["a_revision"]), str(nv["sin_aviso"])]
        if celdas != esperado:
            problemas.append(f"estres/informe.md {nv['ppp']} ppp: dice {celdas}, calculado {esperado}")
    contrastes.append("salidas/prueba/estres/informe.md")

    # Tabla de estrés del README
    sec = readme.split("## Prueba de estrés", 1)[1].split("\n## ", 1)[0]
    _, filas_rd = _tabla_md(sec, "Resolución")
    for nv in niveles:
        celdas = filas_rd.get(f"{nv['ppp']} ppp")
        k, n = nv["campos"]
        esperado = [_pct_ic(k, n, ev.wilson(k, n), ","), "{} / {}".format(*nv["con_error_lectura"]),
                    str(nv["a_revision"]), str(nv["sin_aviso"])]
        if celdas != esperado:
            problemas.append(f"README estrés {nv['ppp']} ppp: dice {celdas}, calculado {esperado}")
    contrastes.append("README.md «Prueba de estrés»")

    return {
        "extractor": "vision",
        "es_d": "Las 20 facturas de prueba, todas escaneadas de nuevo y leídas solo por imagen con el LLM local. Cambia solo la resolución: giro, ruido, desenfoque y JPEG fijos, con la misma semilla por factura.",
        "en_d": "The 20 test invoices, all rescanned and read from the image only by the local LLM. Only the resolution changes: skew, noise, blur and JPEG are fixed, with the same seed per invoice.",
        "nota": "con_error_lectura, a_revision y sin_aviso excluyen las 2 facturas con error del proveedor, como en el README.",
        "niveles": niveles,
    }


def _revisar_publicable(texto: str) -> list[str]:
    plano = "".join(c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)).casefold()
    palabras = set(re.findall(r"[a-z0-9]+", plano))
    hallazgos = [f"término prohibido (hash {h[:8]})" for w in sorted(palabras)
                 for h in [hashlib.sha256((PROHIBIDOS_SAL + w).encode()).hexdigest()[:24]] if h in PROHIBIDOS_HASH]
    if re.search(r"(?<![\d.])\d{12}(?![\d.])", texto):
        hallazgos.append("número de 12 dígitos (posible ID de cuenta AWS)")
    if re.search(r"\+57|(?<![\d.-])3\d{9}(?![\d.-])", texto):
        hallazgos.append("posible número de teléfono")
    return hallazgos


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--fuente", type=Path, default=FUENTE_POR_DEFECTO, help="repo facturas-a-excel (solo lectura)")
    p.add_argument("--salida", type=Path, default=SALIDA_POR_DEFECTO)
    p.add_argument("--sin-lineas-estres", action="store_true",
                   help="omite `le` en la prueba de estrés (unos 45 KB, casi todo de 55 ppp hacia abajo)")
    a = p.parse_args(argv)
    fuente = a.fuente.resolve()

    try:
        out, problemas = exportar(fuente, lineas_estres=not a.sin_lineas_estres)
    except NoCuadra as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    texto = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    problemas += _revisar_publicable(texto)
    if problemas:
        print("No cuadra; no se escribe nada:", file=sys.stderr)
        for x in problemas:
            print("  -", x, file=sys.stderr)
        return 1

    a.salida.parent.mkdir(parents=True, exist_ok=True)
    a.salida.write_text(texto + "\n", encoding="utf-8")
    print(f"{a.salida}  ({len(texto.encode('utf-8')) / 1024:.1f} KB, fuente {out['fuente']['commit']})")
    for e in out["extractores"]:
        t = e["tot"]
        print(f"  {e['es']:<18} campos {t['campos'][0]}/{t['campos'][1]}  líneas {t['lineas'][0]}/{t['lineas'][1]}  "
              f"facturas {t['facturas_ok'][0]}/{t['facturas_ok'][1]}  sin aviso {t['sin_aviso']}  "
              f"correctas a revisión {t['correctas_a_revision'][0]}/{t['correctas_a_revision'][1]}  "
              f"mediana {t['mediana_s']} s" + (f"  (rv16 distinto en {e['nota_rv16']})" if "nota_rv16" in e else ""))
    for nv in out["estres"]["niveles"]:
        print(f"  estrés {nv['ppp']:>3} ppp  campos {nv['campos'][0]}/{nv['campos'][1]}  facturas {nv['facturas_ok'][0]}/{nv['facturas_ok'][1]}  "
              f"con error {nv['con_error_lectura'][0]}/{nv['con_error_lectura'][1]}  a revisión {nv['a_revision']}  sin aviso {nv['sin_aviso']}"
              + (f"  (rv16 distinto en {len(nv['nota_rv16'])})" if "nota_rv16" in nv else ""))
    print("  contrastado con: " + ", ".join(out["fuente"]["contrastado"]))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
