SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
TF_DIR := terraform

.DEFAULT_GOAL := help

.PHONY: help check fmt init validate plan apply wait verify status deploy up redeploy destroy

help: ## Show this help
	@echo "The one command to provision everything and confirm it's live: make deploy"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

check: ## Verify local prerequisites (terraform, aws cli, jq) and that terraform.tfvars exists
	@command -v terraform >/dev/null || { echo "terraform not found on PATH — install it first"; exit 1; }
	@command -v aws >/dev/null || { echo "aws cli not found on PATH — install it first"; exit 1; }
	@command -v jq >/dev/null || { echo "jq not found on PATH — install it first"; exit 1; }
	@aws sts get-caller-identity >/dev/null || { echo "AWS credentials not configured — run 'aws configure' first"; exit 1; }
	@test -f $(TF_DIR)/terraform.tfvars || { echo "$(TF_DIR)/terraform.tfvars not found — copy $(TF_DIR)/terraform.tfvars.example and fill it in"; exit 1; }
	@echo "All prerequisites present."

fmt: ## terraform fmt -recursive
	@cd $(TF_DIR) && terraform fmt -recursive

init: check ## terraform init
	@cd $(TF_DIR) && terraform init

validate: init ## terraform validate
	@cd $(TF_DIR) && terraform validate

plan: validate ## terraform plan (review what will be created/changed)
	@cd $(TF_DIR) && terraform plan

apply: validate ## terraform apply — creates/updates the infra. Interactive unless AUTO_APPROVE=1.
ifeq ($(AUTO_APPROVE),1)
	@cd $(TF_DIR) && terraform apply -auto-approve
else
	@cd $(TF_DIR) && terraform apply
endif

wait: ## Wait for the EC2 instance to register with SSM (needed before verify/redeploy)
	@bash $(TF_DIR)/scripts/wait_for_ssm.sh

verify: ## Confirm docker/nginx/ssm-agent are enabled+running and the app answers on 3000/80/443
	@bash $(TF_DIR)/scripts/verify_remote.sh

status: ## Show terraform outputs plus a live service check, without changing anything
	@cd $(TF_DIR) && terraform output
	@$(MAKE) --no-print-directory verify

deploy up: apply wait verify ## THE single command: provision infra, wait for boot, verify every service is live
	@echo ""
	@echo "======================================================================"
	@echo " Deploy complete."
	@echo "======================================================================"
	@cd $(TF_DIR) && terraform output

redeploy: check ## Push the latest app_repo_ref to the already-running instance (no infra changes)
	@bash $(TF_DIR)/scripts/redeploy.sh

destroy: ## Tear down everything Terraform created (refuses while db_deletion_protection is true)
	@cd $(TF_DIR) && terraform destroy
