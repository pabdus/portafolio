# Portafolio · Pablo Duque Marín

Sitio estático bilingüe (ES/EN) en **https://pabloduque.dev**, desplegado en AWS con Terraform.
Sin frameworks ni paso de compilación: HTML, CSS y JavaScript.

```
site/          el sitio que se publica
  index.html   estructura, estilos y metadatos
  content.js   TODO el contenido (textos, casos, competencias, trayectoria)
  app.js       lógica: monitor T², visuales de cada caso, idioma, paleta Ctrl+K, resumen
  Pablo_Duque_CV.pdf, og.png, favicon.svg, 404.html, robots.txt, sitemap.xml
infra/         Terraform: S3 privado + CloudFront + ACM + Route 53 + rol OIDC + presupuesto
  bootstrap/   bucket del estado de Terraform (se aplica una sola vez)
.github/workflows/deploy.yml   publica site/ en cada push a main
archivo/       versiones anteriores del portafolio
```

## Actualizar el contenido

1. Edita `site/content.js`. Cada texto tiene su versión `es` y `en` (o `'texto ES|texto EN'`).
2. Prueba en local: `python -m http.server 8765 --directory site` y abre http://localhost:8765.
3. `git commit` y `git push`: GitHub Actions sube el sitio y limpia la caché de CloudFront en ~1 minuto.

Reglas de contenido: sin nombres de clientes ni datos internos; cada cifra debe estar respaldada por su
repositorio o informe; el teléfono no va en el sitio ni en el CV público.

## Infraestructura

| Recurso | Para qué |
|---|---|
| S3 (privado, versionado) | Archivos del sitio; solo CloudFront puede leerlos (OAC) |
| CloudFront + función de borde | HTTPS, HTTP/3, caché, `www` → dominio raíz, 404 propio |
| Política de cabeceras | HSTS, CSP estricta, `X-Frame-Options`, `Referrer-Policy` |
| ACM + Route 53 | Certificado TLS validado por DNS y registros A/AAAA |
| Rol IAM con OIDC | GitHub Actions despliega sin claves guardadas, solo desde `main` |
| AWS Budgets | Alerta por correo si el gasto pasa de USD 5 al mes |

Primera vez:

```bash
terraform -chdir=infra/bootstrap init && terraform -chdir=infra/bootstrap apply
cp infra/backend.hcl.example infra/backend.hcl   # poner el bucket que imprime bootstrap
terraform -chdir=infra init -backend-config=backend.hcl
terraform -chdir=infra apply
```

Luego se guardan en GitHub (Settings → Secrets → Actions) los tres valores que imprime `apply`:
`AWS_DEPLOY_ROLE_ARN`, `SITE_BUCKET` y `CLOUDFRONT_DISTRIBUTION_ID`.

**Cuenta:** la cuenta personal de AWS (perfil `default`). Nunca la de un cliente.
