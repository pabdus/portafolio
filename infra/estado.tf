# Chequeo de salud de las demos: Lambda cada 15 min que escribe data/estado.json en el bucket del sitio.
# El despliegue excluye ese archivo del sync --delete para no borrarlo.

locals {
  estado_key = "data/estado.json"
}

data "archive_file" "estado" {
  type        = "zip"
  source_file = "${path.module}/estado/handler.py"
  output_path = "${path.module}/.build/estado.zip"
}

data "aws_iam_policy_document" "estado_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "estado" {
  name               = "portafolio-estado"
  assume_role_policy = data.aws_iam_policy_document.estado_assume.json
}

data "aws_iam_policy_document" "estado" {
  statement {
    sid       = "SoloSuArchivo"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.site.arn}/${local.estado_key}"]
  }
  # Sin s3:ListBucket, S3 responde AccessDenied (y no NoSuchKey) cuando el archivo falta, y el handler
  # no podría distinguir «primera ejecución» de «fallo al leer». Limitado a la clave de su archivo.
  statement {
    sid       = "SaberSiFaltaSuArchivo"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
    condition {
      test     = "StringEquals"
      variable = "s3:prefix"
      values   = [local.estado_key]
    }
  }
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.estado.arn}:*"]
  }
}

resource "aws_iam_role_policy" "estado" {
  name   = "estado"
  role   = aws_iam_role.estado.id
  policy = data.aws_iam_policy_document.estado.json
}

resource "aws_cloudwatch_log_group" "estado" {
  name              = "/aws/lambda/portafolio-estado"
  retention_in_days = 14
}

resource "aws_lambda_function" "estado" {
  function_name    = "portafolio-estado"
  role             = aws_iam_role.estado.arn
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.estado.output_path
  source_code_hash = data.archive_file.estado.output_base64sha256
  timeout          = 60
  memory_size      = 128
  architectures    = ["arm64"]

  environment {
    variables = {
      BUCKET        = aws_s3_bucket.site.bucket
      KEY           = local.estado_key
      CHECKS        = jsonencode(var.demo_checks)
      INTERVALO_MIN = "15"
    }
  }

  depends_on = [aws_cloudwatch_log_group.estado]
}

resource "aws_cloudwatch_event_rule" "estado" {
  name                = "portafolio-estado-15min"
  schedule_expression = "rate(15 minutes)"
}

resource "aws_cloudwatch_event_target" "estado" {
  rule = aws_cloudwatch_event_rule.estado.name
  arn  = aws_lambda_function.estado.arn
}

resource "aws_lambda_permission" "estado" {
  statement_id  = "EventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.estado.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.estado.arn
}
