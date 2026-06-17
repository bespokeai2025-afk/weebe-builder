#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WEBEE — One-time App Runner setup
#
# Run this ONCE from your local machine (with AWS CLI configured) to create:
#   • An ECR repository for the Docker images
#   • An IAM role App Runner uses to pull from ECR
#   • An IAM user + policy for GitHub Actions (push to ECR + trigger deploy)
#   • An App Runner service pointed at the ECR repo
#
# Prerequisites:
#   1. AWS CLI installed: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html
#   2. Configured with admin credentials: aws configure
#   3. Copy this file locally or clone the repo
#
# Usage:
#   bash deploy/apprunner-setup.sh
#
# At the end it prints the exact GitHub secrets/variables you need to add.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config (edit these if needed) ────────────────────────────────────────────
APP_NAME="${APP_NAME:-webee}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PORT="${PORT:-8080}"

log()  { echo ""; echo "▶ $*"; }
done() { echo "  ✓ $*"; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_REPO_URI="${ECR_REGISTRY}/${APP_NAME}"

# ── 1. ECR repository ─────────────────────────────────────────────────────────
log "Creating ECR repository: ${APP_NAME}"
aws ecr create-repository \
  --repository-name "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --image-scanning-configuration scanOnPush=true \
  --output table 2>/dev/null \
  || echo "  (already exists — skipping)"
done "ECR repository: ${ECR_REPO_URI}"

# Lifecycle: keep last 10 images
aws ecr put-lifecycle-policy \
  --repository-name "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --lifecycle-policy-text '{
    "rules":[{
      "rulePriority":1,
      "description":"Keep last 10 images",
      "selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},
      "action":{"type":"expire"}
    }]
  }' \
  --output table 2>/dev/null || true

# ── 2. App Runner ECR access role ─────────────────────────────────────────────
log "Creating App Runner ECR access role"
APPRUNNER_ROLE_NAME="${APP_NAME}-apprunner-ecr-access"

aws iam create-role \
  --role-name "${APPRUNNER_ROLE_NAME}" \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"build.apprunner.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }' \
  --output table 2>/dev/null \
  || echo "  (already exists — skipping)"

aws iam attach-role-policy \
  --role-name "${APPRUNNER_ROLE_NAME}" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess" \
  2>/dev/null || true

APPRUNNER_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${APPRUNNER_ROLE_NAME}"
done "ECR access role: ${APPRUNNER_ROLE_ARN}"

# ── 3. GitHub Actions IAM user ────────────────────────────────────────────────
log "Creating GitHub Actions IAM user"
GH_USER_NAME="${APP_NAME}-github-actions"

aws iam create-user \
  --user-name "${GH_USER_NAME}" \
  --output table 2>/dev/null \
  || echo "  (already exists — skipping)"

# Inline policy: push to ECR + trigger App Runner deploys
aws iam put-user-policy \
  --user-name "${GH_USER_NAME}" \
  --policy-name "webee-ci-deploy" \
  --policy-document "{
    \"Version\":\"2012-10-17\",
    \"Statement\":[
      {
        \"Effect\":\"Allow\",
        \"Action\":[
          \"ecr:GetAuthorizationToken\"
        ],
        \"Resource\":\"*\"
      },
      {
        \"Effect\":\"Allow\",
        \"Action\":[
          \"ecr:BatchCheckLayerAvailability\",
          \"ecr:InitiateLayerUpload\",
          \"ecr:UploadLayerPart\",
          \"ecr:CompleteLayerUpload\",
          \"ecr:PutImage\",
          \"ecr:BatchGetImage\"
        ],
        \"Resource\":\"arn:aws:ecr:${AWS_REGION}:${ACCOUNT_ID}:repository/${APP_NAME}\"
      },
      {
        \"Effect\":\"Allow\",
        \"Action\":[
          \"apprunner:StartDeployment\",
          \"apprunner:DescribeService\"
        ],
        \"Resource\":\"arn:aws:apprunner:${AWS_REGION}:${ACCOUNT_ID}:service/${APP_NAME}/*\"
      }
    ]
  }"

# Create access key for GitHub Actions
log "Creating access key for GitHub Actions"
KEY_OUTPUT=$(aws iam create-access-key --user-name "${GH_USER_NAME}" --output json)
GH_ACCESS_KEY_ID=$(echo "${KEY_OUTPUT}" | python3 -c "import sys,json; print(json.load(sys.stdin)['AccessKey']['AccessKeyId'])")
GH_SECRET_ACCESS_KEY=$(echo "${KEY_OUTPUT}" | python3 -c "import sys,json; print(json.load(sys.stdin)['AccessKey']['SecretAccessKey'])")
done "Access key created (shown once — save it now)"

# ── 4. Collect runtime secrets ────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Enter your runtime secrets (stored in App Runner, not GitHub)."
echo "  Press Enter to skip optional ones."
echo "═══════════════════════════════════════════════════════════════════"
read -r -p "  VITE_SUPABASE_URL (e.g. https://xxx.supabase.co): " RT_SUPABASE_URL
read -r -p "  VITE_SUPABASE_PUBLISHABLE_KEY (anon key):           " RT_ANON_KEY
read -r -p "  SUPABASE_SERVICE_ROLE_KEY (service role key):       " RT_SERVICE_KEY
read -r -p "  RETELL_API_KEY:                                      " RT_RETELL_KEY
read -r -p "  PUBLIC_SITE_URL (your domain, e.g. https://app.co): " RT_SITE_URL
read -r -p "  RESEND_API_KEY (optional, for emails):               " RT_RESEND_KEY

# Build env var list for App Runner
ENV_VARS="NODE_ENV=production,PORT=${PORT}"
[[ -n "${RT_SUPABASE_URL}" ]]  && ENV_VARS+=",VITE_SUPABASE_URL=${RT_SUPABASE_URL},SUPABASE_URL=${RT_SUPABASE_URL}"
[[ -n "${RT_ANON_KEY}" ]]      && ENV_VARS+=",VITE_SUPABASE_PUBLISHABLE_KEY=${RT_ANON_KEY},VITE_SUPABASE_ANON_KEY=${RT_ANON_KEY}"
[[ -n "${RT_SERVICE_KEY}" ]]   && ENV_VARS+=",SUPABASE_SERVICE_ROLE_KEY=${RT_SERVICE_KEY}"
[[ -n "${RT_RETELL_KEY}" ]]    && ENV_VARS+=",RETELL_API_KEY=${RT_RETELL_KEY}"
[[ -n "${RT_SITE_URL}" ]]      && ENV_VARS+=",PUBLIC_SITE_URL=${RT_SITE_URL},PUBLIC_BASE_URL=${RT_SITE_URL}"
[[ -n "${RT_RESEND_KEY}" ]]    && ENV_VARS+=",RESEND_API_KEY=${RT_RESEND_KEY}"

# ── 5. App Runner service ─────────────────────────────────────────────────────
log "Creating App Runner service: ${APP_NAME}"

# Push a placeholder image first so the service has something to start from.
# The first real deploy via GitHub Actions will replace it.
log "Pushing placeholder image (first-time bootstrap only)…"
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

docker pull node:22-slim
docker tag  node:22-slim "${ECR_REPO_URI}:latest"
docker push "${ECR_REPO_URI}:latest"
done "Placeholder image pushed"

SERVICE_OUTPUT=$(aws apprunner create-service \
  --service-name "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --source-configuration "{
    \"ImageRepository\":{
      \"ImageIdentifier\":\"${ECR_REPO_URI}:latest\",
      \"ImageConfiguration\":{
        \"Port\":\"${PORT}\",
        \"RuntimeEnvironmentVariables\":{
          $(echo "${ENV_VARS}" | tr ',' '\n' \
            | awk -F= '{print "\"" $1 "\":\"" $2 "\""}' \
            | paste -sd ',')
        }
      },
      \"ImageRepositoryType\":\"ECR\"
    },
    \"AutoDeploymentsEnabled\":false,
    \"AuthenticationConfiguration\":{
      \"AccessRoleArn\":\"${APPRUNNER_ROLE_ARN}\"
    }
  }" \
  --instance-configuration "Cpu=1 vCPU,Memory=2 GB" \
  --health-check-configuration "Protocol=HTTP,Path=/api/health,Interval=10,Timeout=5,HealthyThreshold=2,UnhealthyThreshold=3" \
  --output json 2>/dev/null || true)

SERVICE_ARN=$(echo "${SERVICE_OUTPUT}" | python3 -c "import sys,json; print(json.load(sys.stdin)['Service']['ServiceArn'])" 2>/dev/null || true)

if [[ -z "${SERVICE_ARN}" ]]; then
  # Service already exists — get its ARN
  SERVICE_ARN=$(aws apprunner list-services \
    --region "${AWS_REGION}" \
    --query "ServiceSummaryList[?ServiceName=='${APP_NAME}'].ServiceArn" \
    --output text)
  echo "  (service already exists — ARN: ${SERVICE_ARN})"
fi

done "App Runner service ARN: ${SERVICE_ARN}"

# ── 6. Print GitHub setup instructions ───────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║         COPY THESE INTO GITHUB ACTIONS — ONE-TIME SETUP             ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  Go to: github.com → your-repo → Settings → Secrets and variables   ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  SECRETS TAB (sensitive values):                                     ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
printf "║  %-30s  %-35s ║\n" "Name" "Value"
printf "║  %-30s  %-35s ║\n" "──────────────────────────────" "───────────────────────────────────"
printf "║  %-30s  %-35s ║\n" "AWS_ACCESS_KEY_ID"       "${GH_ACCESS_KEY_ID}"
printf "║  %-30s  %-35s ║\n" "AWS_SECRET_ACCESS_KEY"   "${GH_SECRET_ACCESS_KEY}"
printf "║  %-30s  %-35s ║\n" "APP_RUNNER_SERVICE_ARN"  "${SERVICE_ARN}"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  VARIABLES TAB (public/non-sensitive):                               ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
printf "║  %-30s  %-35s ║\n" "Name" "Value"
printf "║  %-30s  %-35s ║\n" "──────────────────────────────" "───────────────────────────────────"
printf "║  %-30s  %-35s ║\n" "AWS_REGION"              "${AWS_REGION}"
printf "║  %-30s  %-35s ║\n" "ECR_REPOSITORY"          "${APP_NAME}"
[[ -n "${RT_SUPABASE_URL}" ]] && printf "║  %-30s  %-35s ║\n" "VITE_SUPABASE_URL"       "${RT_SUPABASE_URL}"
[[ -n "${RT_ANON_KEY}" ]]     && printf "║  %-30s  %-35s ║\n" "VITE_SUPABASE_PUBLISHABLE_KEY" "${RT_ANON_KEY}"
[[ -n "${RT_ANON_KEY}" ]]     && printf "║  %-30s  %-35s ║\n" "VITE_SUPABASE_ANON_KEY"  "${RT_ANON_KEY}"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "After adding those, push to main — GitHub deploys automatically."
echo ""
echo "Your App Runner URL will appear in:"
echo "  AWS Console → App Runner → ${APP_NAME} → Default domain"
