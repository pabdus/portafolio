resource "aws_budgets_budget" "monthly" {
  name         = "portafolio-mensual"
  budget_type  = "COST"
  limit_amount = var.monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}

output "site_url" {
  value = "https://${local.apex}"
}

output "bucket_name" {
  description = "Va como secreto SITE_BUCKET en GitHub."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "Va como secreto CLOUDFRONT_DISTRIBUTION_ID en GitHub."
  value       = aws_cloudfront_distribution.site.id
}

output "deploy_role_arn" {
  description = "Va como secreto AWS_DEPLOY_ROLE_ARN en GitHub."
  value       = aws_iam_role.deploy.arn
}
