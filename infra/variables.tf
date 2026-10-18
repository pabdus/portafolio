variable "aws_profile" {
  description = "Perfil local de la cuenta PERSONAL. Nunca el de un cliente."
  type        = string
  default     = "default"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "domain_name" {
  description = "Dominio registrado en Route 53 Domains (crea su zona alojada automáticamente)."
  type        = string
  default     = "pabloduque.dev"
}

variable "github_oidc_subject_prefix" {
  description = "Prefijo del claim sub (sujeto inmutable). Se consulta con: gh api repos/OWNER/REPO/actions/oidc/customization/sub"
  type        = string
  default     = "repo:pabdus@112780608/portafolio@1423935587"
}

variable "github_environment" {
  description = "Entorno de GitHub Actions autorizado a desplegar (restringido a la rama main en GitHub)."
  type        = string
  default     = "produccion"
}

variable "budget_email" {
  description = "Correo que recibe la alerta de presupuesto."
  type        = string
  default     = "pabdus3000@gmail.com"
}

variable "monthly_budget_usd" {
  type    = string
  default = "5"
}

variable "content_security_policy" {
  description = "CSP del sitio. Ajustar si el sitio carga recursos de otros orígenes. Las fuentes se sirven desde /fonts. 'unsafe-inline' en style-src sigue haciendo falta: hay bloques <style> y app.js genera atributos style."
  type        = string
  default     = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests"
}

variable "google_site_verification" {
  description = "Registros TXT de verificación de Google Search Console (propiedad de dominio)."
  type        = list(string)
  default     = ["google-site-verification=MC8GAzHwnQVQ_z8Qc-xvgSKxe2ynLIbUAm2cUSufWqg"]
}

variable "demo_checks" {
  description = "Demos que vigila el chequeo de salud: id (igual al del caso en content.js), URL y código HTTP esperado."
  type = list(object({
    id     = string
    url    = string
    expect = number
  }))
  default = [
    { id = "facturas", url = "https://rdd4yyol7clnebrcjjem4mdxmu0ubhqh.lambda-url.us-east-1.on.aws/", expect = 200 },
    { id = "sitio", url = "https://pabloduque.dev/", expect = 200 },
  ]
}
