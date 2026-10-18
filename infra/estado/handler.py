"""Chequeo de salud de las demos del portafolio.

Corre cada 15 minutos (EventBridge) y publica data/estado.json en el bucket del sitio.
La página /estado.html lo muestra y el sitio lo usa para ocultar el botón de una demo caída.
Sin dependencias: solo la biblioteca estándar y boto3, que ya trae el runtime de Lambda.
"""
import datetime
import json
import os
import time
import urllib.error
import urllib.request

import boto3
from botocore.exceptions import ClientError

BUCKET = os.environ["BUCKET"]
KEY = os.environ.get("KEY", "data/estado.json")
CHECKS = json.loads(os.environ["CHECKS"])  # [{"id": "facturas", "url": "https://...", "expect": 200}]
HISTORIAL = int(os.environ.get("HISTORIAL", "672"))  # 7 días a 15 min
INTERVALO_MIN = int(os.environ.get("INTERVALO_MIN", "15"))

s3 = boto3.client("s3")


def sondear(check):
    """GET a la URL de la demo: código HTTP y milisegundos hasta leer el primer bloque."""
    t0 = time.perf_counter()
    try:
        req = urllib.request.Request(check["url"], headers={"User-Agent": "pabloduque.dev-estado/1"})
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read(2048)
            codigo = r.status
    except urllib.error.HTTPError as e:
        codigo = e.code
    except Exception:  # DNS, TLS, tiempo agotado: la demo no responde
        codigo = 0
    ms = round((time.perf_counter() - t0) * 1000)
    return {"id": check["id"], "ok": codigo == check.get("expect", 200), "codigo": codigo, "ms": ms}


def existe():
    """True si data/estado.json está en el bucket (el rol solo puede listar con ese prefijo exacto)."""
    r = s3.list_objects_v2(Bucket=BUCKET, Prefix=KEY, MaxKeys=1)
    return any(o["Key"] == KEY for o in r.get("Contents", []))


def leer_previo():
    """Estado anterior. {} solo si el archivo no existe o está dañado.

    Cualquier otro error (S3 o la red fallan, permisos) se propaga: la ejecución termina sin escribir
    y la siguiente lo vuelve a intentar, en lugar de sobrescribir hasta 7 días de historial con uno vacío.
    """
    try:
        crudo = s3.get_object(Bucket=BUCKET, Key=KEY)["Body"].read()
    except s3.exceptions.NoSuchKey:  # primera ejecución
        return {}
    except ClientError as e:
        # Si S3 respondiera AccessDenied por un archivo que falta, se confirma listando: solo «no existe» es empezar de cero.
        if e.response.get("Error", {}).get("Code") == "AccessDenied" and not existe():
            return {}
        raise
    try:
        previo = json.loads(crudo)
    except ValueError:  # JSON inválido (incluye bytes que no son UTF-8): archivo dañado
        return {}
    if not isinstance(previo, dict) or not isinstance(previo.get("historial", []), list):
        return {}
    return previo


def handler(event, context):
    ahora = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    demos = [sondear(c) for c in CHECKS]

    previo = leer_previo()
    historial = previo.get("historial", [])
    historial.append({"t": ahora, "r": {d["id"]: [int(d["ok"]), d["ms"]] for d in demos}})
    historial = historial[-HISTORIAL:]

    cuerpo = {"actualizado": ahora, "intervalo_min": INTERVALO_MIN, "demos": demos, "historial": historial}
    s3.put_object(
        Bucket=BUCKET,
        Key=KEY,
        Body=json.dumps(cuerpo, separators=(",", ":")).encode(),
        ContentType="application/json",
        CacheControl="public, max-age=60",
    )
    return {d["id"]: d["ok"] for d in demos}
