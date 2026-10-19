#!/usr/bin/env python3
"""Generador del CV de Pablo Duque (ES y EN) a partir de site/content.js.

El sitio y el CV listan exactamente los mismos proyectos, en el mismo orden: los casos, la
trayectoria, el stack, los idiomas, el perfil y los enlaces se leen de window.PD (content.js).
Lo que solo existe en el CV (viñetas de cada empleo, ubicaciones, estado de cada estudio) está
en cv_extra.json, y cada cifra de esas viñetas se comprueba contra content.js.

Uso, desde la raíz del repositorio:
    py -3.12 tools/cv/build_cv.py           # genera, verifica y, si todo pasa, publica en site/
    py -3.12 tools/cv/build_cv.py --check   # solo verifica los PDF que ya están en site/
    py -3.12 tools/cv/build_cv.py --chrome "C:/ruta/chrome.exe"

Requisitos: Node (para leer content.js), Python con jinja2 y pymupdf
(py -3.12 -m pip install jinja2 pymupdf) y Google Chrome (impresión a PDF sin interfaz).

Salidas:
    tools/cv/dist/cv_es.html, cv_en.html, *.pdf    intermedios (dist/ está en .gitignore)
    site/Pablo_Duque_CV_ES.pdf, site/Pablo_Duque_CV_EN.pdf
    site/Pablo_Duque_CV.pdf                        copia del EN, para no romper los enlaces actuales
Si una verificación falla, no se toca nada en site/ y el programa sale con código 1.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SITE = ROOT / "site"
CONTENT_JS = SITE / "content.js"
EXTRA_JSON = HERE / "cv_extra.json"
TEMPLATE = "cv.html.j2"
CSS = HERE / "cv.css"
DIST = HERE / "dist"

LANGS = ("es", "en")
OUT_PDF = {"es": SITE / "Pablo_Duque_CV_ES.pdf", "en": SITE / "Pablo_Duque_CV_EN.pdf"}
LEGACY_PDF = SITE / "Pablo_Duque_CV.pdf"  # el sitio enlaza este nombre: copia del EN
MAX_PAGES = 2
FONT_STEPS = (9.0, 8.8, 8.6)  # cuerpo de texto en pt; por debajo de 8,6 se pierde legibilidad

CHROME_CANDIDATES = [
    os.environ.get("CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

# ---------------------------------------------------------------------------------------------
# Salvaguardas de contenido. Los términos confidenciales (clientes, proyectos retirados, incidentes)
# NO se escriben aquí en claro porque el repositorio es público: se guardan como SHA-256 con sal de
# cada término normalizado (minúsculas, espacios simples) y se comparan con los n-gramas del CV.
# Para añadir uno: hashlib.sha256(("pd-cv|" + "termino").encode()).hexdigest()[:24]
DENY_SALT = "pd-cv|"
DENY_HASHES = {
    "ccb6ec71f87f09e43098ede5", "bb55d8a532a2fa218ecd7f97", "7e4e42a5342397e1639e0a08",
    "dc8157d9df01820a542f2631", "89474c523f2b98c6404ddf16", "484fb74a65b4ef2c89b0d372",
    "6a15c5145694f703b0577f46", "0732aa6efb4d81a1ee576d39", "39a24c7c1a9c1ee2c72ea201",
    "9dd36c355fa44b2a2bb1f622", "6006eac08f66bbc557939783", "6f5e9029fbabf3643dec5d93",
    "cc2355d63906a897330f3ea7", "8d732b18a560717c395a08b9", "2b51a713470cacf31ca4aec9",
    "6a398818a6b49f3fa0f70fe5", "bfd5ddad0057b0bd531211a1", "ec8983196232a19fb8318bbc",
    "6b5f6ef64719d2544fbddb5f", "2953657377cb399c49602d88", "c5bd10efa81da041979d255b",
    "87f2ef59d32199395a4f5918", "25d185461f22dc970ea2f611", "206806dd20ebb212044a239f",
    "c9cfe9fef19a71c2bc6f72bf", "f51164bc2e0e2caa6edf5ec7", "87ab3b3dd1ac4866e673e96c",
    "b30da3ea7bebfe237010961d", "2e39f9da23dec3aa73ee396e",
}

# Reglas públicas (no confidenciales): teléfono, IDs de cuenta, cifras retiradas, grado policial.
RULES = [
    (r"\+\s?57", "prefijo telefónico +57: el teléfono no va en el CV público"),
    (r"(?<![\d.,])3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)", "parece un número de celular"),
    (r"(?i)href=\"tel:", "enlace tel:"),
    (r"(?<!\d)\d{12}(?!\d)|(?<!\d)\d{4}-\d{4}-\d{4}(?!\d)", "parece un ID de cuenta AWS"),
    (r"(?<![\d.,])0\s*/\s*3(?![\d])", "cifra retirada «0/3» (SMOTE vs CTGAN): usar «sin ganancia real, diferencias ≤ 0,02»"),
    (r"[−-]\s?82\s?%", "cifra retirada «−82 %» del TFM"),
    (r"(?<![\d.,])12[,.]5\s?%", "cifra retirada «12,5 %» del TFM"),
    (r"(?<![\d.,])2[,.]3\s?%", "cifra retirada «2,3 %» del TFM"),
    (r"(?i)kpca[^.;:]{0,80}\b(en curso|in progress|ongoing|implementad[oa]|implemented)\b", "KPCA no tiene código: decir «planificado»"),
    (r"(?i)\b(en curso|in progress|ongoing)\b[^.;:]{0,40}kpca", "KPCA no tiene código: decir «planificado»"),
    (r"(?i)\b(0|cero|sin)\s+incidentes?\b|\b(0|zero|no)\s+incidents?\b", "RGPD: no convertirlo en «0 incidentes»"),
    (r"(?i)(?<!sub)teniente\b", "el grado policial es Subteniente"),
    (r"(?i)(?<!second )\blieutenant\b", "the police rank is Second lieutenant"),
]

NUM_RE = re.compile(r"\d+(?:[.,]\d+)*")
PD_PARTS = {"skills", "stack", "timeline", "ui", "heroStats", "rules", "summaryStack", "updated"}


# ---------------------------------------------------------------------------------------------
def load_pd(path: Path) -> dict:
    """Ejecuta content.js en Node y devuelve window.PD como dict."""
    js = ("global.window={};require(require('path').resolve(process.argv[1]));"
          "process.stdout.write(JSON.stringify(window.PD));")
    try:
        r = subprocess.run(["node", "-e", js, str(path)], capture_output=True, timeout=60)
    except FileNotFoundError:
        sys.exit("No encuentro Node: hace falta para leer site/content.js.")
    if r.returncode != 0:
        sys.exit("Node no pudo leer content.js:\n" + r.stderr.decode("utf-8", "replace"))
    return json.loads(r.stdout.decode("utf-8"))


def L(x, lang: str):
    """Igual que L() de site/app.js: 'ES|EN', {es, en} o tal cual."""
    if x is None:
        return ""
    if isinstance(x, str):
        return x.split("|")[1 if lang == "en" else 0] if "|" in x else x
    if isinstance(x, list):
        return x
    return x[lang]


def rel(p: Path):
    try:
        return p.relative_to(ROOT)
    except ValueError:
        return p


def short_url(u: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", u).rstrip("/")


def norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\u00ad", "")).strip()


def corpus(pd: dict, src: str):
    """Texto de content.js contra el que se verifican las cifras de una viñeta.
    None = fuente interna desconocida; '' = fuente externa (no verificable aquí)."""
    if src.startswith("cases."):
        cid = src.split(".", 1)[1]
        for c in pd["cases"]:
            if c["id"] == cid:
                return json.dumps(c, ensure_ascii=False)
        return None
    head = src.split(".", 1)[0]
    if head in PD_PARTS:
        return json.dumps(pd[head], ensure_ascii=False)
    return ""


def check_figures(text: str, srcs: list[str], pd: dict, where: str) -> list[str]:
    errs, blobs = [], []
    for s in srcs:
        c = corpus(pd, s)
        if c is None:
            errs.append(f"{where}: fuente desconocida {s!r}")
        elif c:
            blobs.append(c)
    figs = NUM_RE.findall(text)
    if figs and not blobs:
        errs.append(f"{where}: cifras {figs} con fuente externa {srcs}: no se pueden verificar; cita content.js o quítalas")
        return errs
    blob = "\n".join(blobs)
    for f in figs:
        if not re.search(r"(?<![\d.,])" + re.escape(f) + r"(?!\d|[.,]\d)", blob):
            errs.append(f"{where}: la cifra «{f}» no aparece en {srcs} de content.js")
    return errs


def deny_hits(text: str) -> set[str]:
    toks = re.findall(r"[a-záéíóúüñ]+", text.lower())
    hits = set()
    for n in (1, 2, 3):
        for i in range(len(toks) - n + 1):
            g = " ".join(toks[i:i + n])
            if hashlib.sha256((DENY_SALT + g).encode()).hexdigest()[:24] in DENY_HASHES:
                hits.add(g)
    return hits


PHONE_RULES = 3  # las tres primeras reglas son de teléfono: la versión privada (--privado) las omite


def guard(text: str, where: str, allow_phone: bool = False) -> list[str]:
    errs = [f"{where}: término confidencial o retirado: «{h}»" for h in sorted(deny_hits(text))]
    for pat, why in RULES[PHONE_RULES if allow_phone else 0:]:
        m = re.search(pat, text)
        if m:
            errs.append(f"{where}: {why} → «{m.group(0)}»")
    return errs


# ---------------------------------------------------------------------------------------------
def build_context(pd: dict, extra: dict, lang: str, phone: str = "") -> tuple[dict, list[str], list[str]]:
    errs: list[str] = []
    warns: list[str] = []
    ui = pd["ui"][lang]
    labels = extra["labels"][lang]
    hx = extra["header"]

    def years(s: str) -> str:
        return re.sub(r"\b(hoy|now)\b", labels["present"], L(s, lang))

    # Encabezado: correo y enlaces salen de content.js; nombre, título y ubicación de cv_extra.json.
    head = {
        "name": hx["name"],
        "title": L(hx["title"], lang),
        "location": L(hx["location"], lang),
        "email": pd["email"],
        "web": hx["web"], "web_label": short_url(hx["web"]),
        "github": pd["links"]["github"], "github_label": short_url(pd["links"]["github"]),
        "linkedin": pd["links"]["linkedin"], "linkedin_label": short_url(pd["links"]["linkedin"]),
        "avail": ui["pill"],
        "phone": phone,
    }

    profile = " ".join([ui["h1b"]] + list(ui["lead"]))

    # Experiencia: entradas 'w' de PD.timeline, en su orden, con las viñetas de cv_extra.json.
    def match_overlay(entries, overlays, kind):
        used = {}
        for o in overlays:
            hits = [i for i, e in enumerate(entries) if o["match"] in (L(e[2], "es") + " · " + L(e[3], "es"))]
            if len(hits) != 1:
                errs.append(f"cv_extra.json/{kind}: «{o['match']}» coincide con {len(hits)} entradas de PD.timeline (debe ser 1)")
                continue
            if hits[0] in used:
                errs.append(f"cv_extra.json/{kind}: «{o['match']}» y «{used[hits[0]]['match']}» apuntan a la misma entrada")
            used[hits[0]] = o
        return used

    work = [e for e in pd["timeline"] if e[1] == "w"]
    edu = [e for e in pd["timeline"] if e[1] == "e"]
    w_over = match_overlay(work, extra["experience"], "experience")
    e_over = match_overlay(edu, extra["education"], "education")

    case_ids = {c["id"] for c in pd["cases"]}
    referenced = set()
    experience = []
    for i, e in enumerate(work):
        o = w_over.get(i, {})
        if not o:
            warns.append(f"[{lang}] experiencia sin viñetas en cv_extra.json: {L(e[2], 'es')}")
        for cid in o.get("cases", []):
            if cid not in case_ids:
                errs.append(f"cv_extra.json: el caso «{cid}» no existe en PD.cases")
            referenced.add(cid)
        bullets = []
        for k, b in enumerate(o.get("bullets", [])):
            txt = L(b, lang)
            errs += check_figures(txt, b.get("src", []), pd, f"[{lang}] {o['match']} · viñeta {k + 1}")
            bullets.append(txt)
        experience.append({
            "role": L(e[2], lang),
            "years": years(e[0]),
            "org": L(o["org"], lang) if o.get("org") else L(e[3], lang),
            "location": L(o.get("location"), lang) if o.get("location") else "",
            "bullets": bullets,
        })
    for c in pd["cases"]:
        if c.get("priv") and c["id"] not in referenced:
            warns.append(f"[{lang}] el caso profesional «{c['id']}» no tiene viñetas en ninguna experiencia")

    # Proyectos: EXACTAMENTE PD.cases, en el mismo orden.
    projects = []
    for c in pd["cases"]:
        links = [{"href": f"{hx['web'].rstrip('/')}/#caso-{c['id']}", "text": labels["case"]}]
        if c.get("repo"):
            links.append({"href": c["repo"], "text": short_url(c["repo"])})
        if c.get("demo"):
            links.append({"href": c["demo"], "text": labels["demo"]})
        if c.get("lab"):
            links.append({"href": hx["web"].rstrip("/") + c["lab"]["href"], "text": labels["lab"]})
        if not (c.get("repo") or c.get("demo")):
            text = ui["private"] if c.get("priv") else ui["local"] if c.get("local") else ""
            if text:
                links.append({"href": "", "text": text})
        status = {"ongoing": ui["ongoing"], "building": ui["building"]}.get(c.get("status", ""), "")
        projects.append({
            "id": c["id"], "title": L(c["title"], lang), "kicker": L(c["kicker"], lang), "status": status,
            "mv": L(c["mv"], lang), "ml": L(c["ml"], lang).rstrip("."), "sum": L(c["sum"], lang), "links": links,
        })

    # Formación: entradas 'e' de PD.timeline + estado de cv_extra.json.
    education = []
    for i, e in enumerate(edu):
        o = e_over.get(i)
        status = L(o["status"], lang) if o else ""
        if o:
            errs += check_figures(status, [o.get("src", "")], pd, f"[{lang}] formación «{o['match']}»")
        else:
            warns.append(f"[{lang}] formación sin estado en cv_extra.json: {L(e[2], 'es')}")
        segs = [s for s in L(e[3], lang).split(" · ") if s.strip().casefold() != status.casefold()]
        education.append({"title": L(e[2], lang), "years": years(e[0]), "detail": " · ".join(segs), "status": status})

    # Competencias: PD.stack por función, agrupado por nivel real de uso.
    lv_label = {"pro": ui["lvPro"].lower(), "inv": ui["lvInv"].lower(), "pos": ui["lvPos"].lower()}
    skills = []
    for name, items in pd["stack"]:
        levels = []
        for lv in ("pro", "inv", "pos"):
            sel = [L(t, lang) for t, l in items if l == lv]
            if sel:
                levels.append({"label": lv_label[lv], "tools": sel})
        skills.append({"name": L(name, lang), "levels": levels})

    ctx = {
        "lang": lang, "labels": labels, "h": head, "profile": profile,
        "experience": experience, "projects": projects, "education": education, "skills": skills,
        "skills_intro": ui["stackSub"], "languages": ui["rcLangs"],
        "projects_intro": labels["projects_intro"].format(n=len(projects)),
        "footer": labels["footer"].format(updated=L(pd["updated"], lang)),
        "css": CSS.read_text(encoding="utf-8"),
    }
    return ctx, errs, warns


def render(ctx: dict) -> str:
    from jinja2 import Environment, FileSystemLoader, StrictUndefined
    env = Environment(loader=FileSystemLoader(str(HERE)), autoescape=True, undefined=StrictUndefined)
    env.filters["css_string"] = lambda s: str(s).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")
    return env.get_template(TEMPLATE).render(**ctx)


def find_chrome(explicit: str | None) -> str:
    for c in ([explicit] if explicit else []) + CHROME_CANDIDATES:
        if c and Path(c).is_file():
            return c
    sys.exit("No encuentro Chrome. Pásalo con --chrome RUTA o con la variable de entorno CHROME.")


def print_pdf(chrome: str, html: Path, pdf: Path) -> None:
    if pdf.exists():
        pdf.unlink()
    # Perfil temporal propio: nunca se engancha a la sesión de Chrome abierta del usuario.
    with tempfile.TemporaryDirectory(prefix="cv-chrome-", ignore_cleanup_errors=True) as prof:
        cmd = [chrome, "--headless=new", "--no-pdf-header-footer", "--disable-gpu", "--no-first-run",
               "--no-default-browser-check", "--disable-extensions", f"--user-data-dir={prof}",
               "--generate-pdf-document-outline", f"--print-to-pdf={pdf}", html.as_uri()]
        r = subprocess.run(cmd, capture_output=True, timeout=180)
    if not pdf.exists() or pdf.stat().st_size == 0:
        sys.exit(f"Chrome no generó {pdf}:\n" + r.stderr.decode("utf-8", "replace")[-2000:])


def page_count(pdf: Path) -> int:
    import pymupdf
    with pymupdf.open(pdf) as doc:
        return doc.page_count


def set_metadata(src: Path, dst: Path, ctx: dict, keywords: str) -> None:
    import pymupdf
    doc = pymupdf.open(src)
    meta = {k: v for k, v in doc.metadata.items() if k in ("creationDate", "modDate", "producer", "trapped")}
    meta.update({
        "title": ctx["labels"]["doc_title"], "author": ctx["h"]["name"], "subject": ctx["labels"]["subject"],
        "keywords": keywords, "creator": "tools/cv/build_cv.py (site/content.js) + Chrome",
    })
    doc.set_metadata(meta)
    doc.save(dst, garbage=3, deflate=True)
    doc.close()


def verify_pdf(pdf: Path, pd: dict, lang: str, html: str | None = None, allow_phone: bool = False) -> tuple[list[str], dict]:
    import pymupdf
    errs: list[str] = []
    tag = f"[{lang}] {pdf.name}"
    doc = pymupdf.open(pdf)
    pages = doc.page_count
    raw = "\n".join(p.get_text() for p in doc)
    text = norm_space(raw)
    fonts = sorted({f[3] for p in doc for f in p.get_fonts()})
    not_embedded = sorted({f[3] for p in doc for f in p.get_fonts() if f[1] in ("", "n/a")})
    uris = {l.get("uri", "") for p in doc for l in p.get_links()}
    sizes = {(round(p.rect.width), round(p.rect.height)) for p in doc}
    doc.close()

    if not 1 <= pages <= MAX_PAGES:
        errs.append(f"{tag}: {pages} páginas (máximo {MAX_PAGES})")
    if sizes != {(612, 792)}:
        errs.append(f"{tag}: tamaño de página {sizes}, se esperaba carta (612 × 792 pt)")
    if len(text) < 2000:
        errs.append(f"{tag}: casi no hay texto seleccionable ({len(text)} caracteres)")
    if not_embedded:
        errs.append(f"{tag}: fuentes sin incrustar: {not_embedded}")

    ui = pd["ui"][lang]
    must = [pd["email"], "pabloduque.dev", short_url(pd["links"]["github"]), short_url(pd["links"]["linkedin"]),
            "Pablo Alberto Duque Marín", ui["rcLangs"]]
    for m in must:
        if norm_space(m) not in text:
            errs.append(f"{tag}: falta «{m}»")
    case_urls = tuple(f"https://pabloduque.dev/#caso-{c['id']}" for c in pd["cases"])
    for u in ("mailto:" + pd["email"], "https://pabloduque.dev", pd["links"]["github"], pd["links"]["linkedin"], *case_urls):
        if not any(x.rstrip("/") == u.rstrip("/") for x in uris):
            errs.append(f"{tag}: falta el enlace {u}")

    # Proyectos: todos los títulos de PD.cases, en el mismo orden.
    last, found = -1, 0
    for c in pd["cases"]:
        t = norm_space(L(c["title"], lang))
        pos = text.find(t)
        if pos < 0:
            errs.append(f"{tag}: falta el caso «{t}»")
            continue
        found += 1
        if pos < last:
            errs.append(f"{tag}: el caso «{t}» está fuera del orden de content.js")
        last = pos
    # Experiencia: cada entrada de trabajo, por separado (Policía y Narnia incluidas).
    for e in pd["timeline"]:
        if e[1] == "w" and norm_space(L(e[2], lang)) not in text:
            errs.append(f"{tag}: falta la experiencia «{L(e[2], lang)}»")

    errs += guard(raw, tag, allow_phone)
    if html is not None:
        errs += guard(html, f"[{lang}] HTML", allow_phone)
    info = {"pages": pages, "fonts": fonts, "chars": len(text), "cases_found": f"{found}/{len(pd['cases'])}",
            "bytes": pdf.stat().st_size}
    return errs, info


# ---------------------------------------------------------------------------------------------
def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(description="Genera el CV ES/EN desde site/content.js")
    ap.add_argument("--check", action="store_true", help="solo verificar los PDF publicados en site/")
    ap.add_argument("--chrome", help="ruta a chrome.exe")
    ap.add_argument("--privado", action="store_true",
                    help="versión personal con teléfono (leído de proyectos/cv_privado.json, fuera del repo); "
                         "se guarda en --salida y nunca en site/")
    ap.add_argument("--salida", type=Path, default=Path.home() / "Documents" / "Generación Ingresos",
                    help="carpeta de la versión privada")
    args = ap.parse_args()

    try:
        import jinja2  # noqa: F401
        import pymupdf  # noqa: F401
    except ImportError as exc:
        sys.exit(f"Falta {exc.name}: py -3.12 -m pip install jinja2 pymupdf")

    pd = load_pd(CONTENT_JS)
    extra = json.loads(EXTRA_JSON.read_text(encoding="utf-8"))
    all_errs: list[str] = []
    phone = ""
    if args.privado:
        priv = ROOT / "proyectos" / "cv_privado.json"  # proyectos/ está en .gitignore
        phone = json.loads(priv.read_text(encoding="utf-8")).get("telefono", "").strip()
        if not phone:
            sys.exit(f"Falta «telefono» en {priv}")
        if SITE in args.salida.resolve().parents or args.salida.resolve() == SITE:
            sys.exit("La versión privada no puede guardarse dentro de site/")

    if args.check:
        for lang in LANGS:
            errs, info = verify_pdf(OUT_PDF[lang], pd, lang)
            all_errs += errs
            print(f"[{lang}] {OUT_PDF[lang].name}: {info}")
        if LEGACY_PDF.read_bytes() != OUT_PDF["en"].read_bytes():
            all_errs.append(f"{LEGACY_PDF.name} no es copia de {OUT_PDF['en'].name}")
    else:
        chrome = find_chrome(args.chrome)
        DIST.mkdir(exist_ok=True)
        built = {}
        for lang in LANGS:
            ctx, errs, warns = build_context(pd, extra, lang, phone)
            for w in warns:
                print("aviso:", w)
            sfx = "_privado" if args.privado else ""
            html_path = DIST / f"cv_{lang}{sfx}.html"
            raw_pdf = DIST / f"cv_{lang}{sfx}.chrome.pdf"
            final_pdf = DIST / (OUT_PDF[lang].stem + sfx + ".pdf")
            # Si content.js crece y no cabe en MAX_PAGES, se reduce un poco la letra antes de fallar.
            for fs in FONT_STEPS:
                ctx["fs"] = fs
                html = render(ctx)
                html_path.write_text(html, encoding="utf-8")
                print_pdf(chrome, html_path, raw_pdf)
                if page_count(raw_pdf) <= MAX_PAGES:
                    break
                print(f"aviso: [{lang}] no cabe en {MAX_PAGES} páginas con {fs} pt; pruebo más pequeño")
            set_metadata(raw_pdf, final_pdf, ctx, ", ".join(pd.get("summaryStack", [])))
            raw_pdf.unlink()
            verrs, info = verify_pdf(final_pdf, pd, lang, html, allow_phone=args.privado)
            info["font_pt"] = ctx["fs"]
            all_errs += errs + verrs
            built[lang] = final_pdf
            print(f"[{lang}] {rel(html_path)} → {rel(final_pdf)}: {info}")
        if not all_errs and args.privado:
            args.salida.mkdir(parents=True, exist_ok=True)
            stamp = pd["updated"]["es"].replace(".", "").replace(" ", "-")
            outs = []
            for lang, f in built.items():
                dst = args.salida / f"Pablo_Duque_CV_{lang.upper()}_{stamp}.pdf"
                shutil.copyfile(f, dst)
                f.unlink()  # dist/ no guarda la copia con teléfono
                outs.append(str(dst))
            for lang in LANGS:
                (DIST / f"cv_{lang}_privado.html").unlink(missing_ok=True)
            print("versión privada:", ", ".join(outs))
        elif not all_errs:
            for lang, f in built.items():
                shutil.copyfile(f, OUT_PDF[lang])
            shutil.copyfile(built["en"], LEGACY_PDF)
            print("publicado:", ", ".join(str(rel(p)) for p in (*OUT_PDF.values(), LEGACY_PDF)))

    if all_errs:
        print("\nERRORES (no se publicó nada en site/):" if not args.check else "\nERRORES:")
        for e in all_errs:
            print("  -", e)
        return 1
    print("verificación: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
