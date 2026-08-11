# SES domain verification. If you pass route53_zone_id, the verification +
# DKIM CNAME records (and, once app_domain is set, an A record pointing at
# the app's Elastic IP) are created for you; otherwise the values you need
# are surfaced as outputs to add at whatever DNS provider you use.

locals {
  # Naive "last two labels" extraction (crm.joindevops.com -> joindevops.com).
  # Good enough for a standard .com/.in/.org apex; if your domain sits under a
  # compound public suffix (e.g. example.co.uk), set app_domain to the exact
  # apex you verify in SES instead of relying on this.
  ses_domain         = var.app_domain != "" ? regex("[^.]+\\.[^.]+$", var.app_domain) : ""
  manage_dns_for_ses = var.app_domain != "" && var.route53_zone_id != ""
}

resource "aws_ses_domain_identity" "main" {
  count  = var.app_domain != "" ? 1 : 0
  domain = local.ses_domain
}

resource "aws_ses_domain_dkim" "main" {
  count  = var.app_domain != "" ? 1 : 0
  domain = aws_ses_domain_identity.main[0].domain
}

resource "aws_route53_record" "ses_verification" {
  count   = local.manage_dns_for_ses ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "_amazonses.${local.ses_domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.main[0].verification_token]
}

resource "aws_route53_record" "ses_dkim" {
  count   = local.manage_dns_for_ses ? 3 : 0
  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.main[0].dkim_tokens[count.index]}._domainkey.${local.ses_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "app" {
  count   = local.manage_dns_for_ses ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.app_domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}
