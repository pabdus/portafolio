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

variable "github_repo" {
  description = "Repositorio autorizado a desplegar por OIDC (owner/nombre)."
  type        = string
  default     = "pabdus/portafolio"
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
  description = "CSP del sitio. Ajustar si el sitio carga recursos de otros orígenes."
  type        = string
  default     = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests"
}
