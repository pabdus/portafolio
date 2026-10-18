import re, sys, urllib.request, pathlib
css = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
out = pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
blocks = re.findall(r'/\* ([a-z-]+) \*/\s*(@font-face \{.*?\})', css, re.S)
keep = []
for subset, b in blocks:
    if subset not in ('latin', 'latin-ext'):
        continue
    fam = re.search(r"font-family: '([^']+)'", b).group(1)
    style = re.search(r'font-style: (\w+)', b).group(1)
    wt = re.search(r'font-weight: ([\d ]+);', b).group(1).replace(' ', '-')
    url = re.search(r'url\((https://[^)]+)\)', b).group(1)
    name = f"{fam.lower().replace(' ', '-')}-{style}-{wt}-{subset}.woff2"
    dst = out / name
    if not dst.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        dst.write_bytes(urllib.request.urlopen(req, timeout=30).read())
    keep.append(f"/* {subset} */\n" + b.replace(url, name))
hdr = ("/* Fuentes autoalojadas (SIL Open Font License): Bricolage Grotesque, IBM Plex Mono y Newsreader.\n"
       "   Generado desde Google Fonts con tools/fonts/selfhost.py; solo subconjuntos latin y latin-ext. */\n")
(out / 'fonts.css').write_text(hdr + "\n".join(keep) + "\n", encoding='utf-8')
print(len(keep), 'caras;', sum(f.stat().st_size for f in out.glob('*.woff2')) // 1024, 'KB')
