#!/usr/bin/env bash
# Dokploy 部署脚本 — 一键创建/复用 project、application、配置 GHCR 镜像源、
# 生成 sslip.io 自动域名、触发部署。
#
# 用法:
#   export DOKPLOY_URL=https://dok.inglegames.com
#   export DOKPLOY_API_KEY=<your-key>
#   ./deploy/dokploy-deploy.sh
#
# 幂等:重复跑只是重新部署一次,不会重复创建。

set -euo pipefail

: "${DOKPLOY_URL:?need DOKPLOY_URL}"
: "${DOKPLOY_API_KEY:?need DOKPLOY_API_KEY}"

PROJECT_NAME="${PROJECT_NAME:-zorr}"
APP_NAME="${APP_NAME:-zorr}"
IMAGE="${IMAGE:-ghcr.io/kanekanefy/zorr:latest}"
APP_PORT="${APP_PORT:-9001}"

# POST helper — JSON body
api_post() {
  local path="$1"; shift
  curl -sS -X POST \
    -H "x-api-key: ${DOKPLOY_API_KEY}" \
    -H "Content-Type: application/json" \
    "${DOKPLOY_URL}/api/${path}" \
    "$@"
}

# GET helper — plain query string (NOT tRPC's ?input={...} form)
api_get() {
  local path="$1"; shift
  curl -sS \
    -H "x-api-key: ${DOKPLOY_API_KEY}" \
    "${DOKPLOY_URL}/api/${path}" \
    "$@"
}

echo "[1/5] Finding or creating project '${PROJECT_NAME}'..."
PROJECT_ID="$(api_get project.all | jq -r --arg n "$PROJECT_NAME" '.[] | select(.name == $n) | .projectId' | head -1)"
if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "null" ]]; then
  RESP="$(api_post project.create -d "$(jq -nc --arg n "$PROJECT_NAME" '{name:$n, description:"florr-style game (gardn) — kanekanefy/zorr"}')")"
  PROJECT_ID="$(echo "$RESP" | jq -r '.project.projectId')"
  ENV_ID="$(echo "$RESP" | jq -r '.environment.environmentId')"
  echo "  created project $PROJECT_ID with environment $ENV_ID"
else
  echo "  reusing project $PROJECT_ID"
fi

# If we didn't get ENV_ID from create (because we reused), fetch it now
if [[ -z "${ENV_ID:-}" ]]; then
  ENV_ID="$(api_get "project.one?projectId=${PROJECT_ID}" \
    | jq -r '.environments[] | select(.isDefault == true) | .environmentId')"
fi
echo "  environmentId: $ENV_ID"

echo "[2/5] Finding or creating application '${APP_NAME}'..."
APP_ID="$(api_get "project.one?projectId=${PROJECT_ID}" \
  | jq -r --arg n "$APP_NAME" '.environments[] | select(.isDefault==true) | .applications[]? | select(.name == $n) | .applicationId' | head -1)"
if [[ -z "$APP_ID" || "$APP_ID" == "null" ]]; then
  RESP="$(api_post application.create -d "$(jq -nc \
    --arg n "$APP_NAME" --arg e "$ENV_ID" \
    '{name:$n, appName:$n, description:"zorr game server", environmentId:$e}')")"
  # Response is the created application object (sibling keys to applicationId)
  APP_ID="$(echo "$RESP" | jq -r '.applicationId // .application.applicationId // .id // empty')"
  if [[ -z "$APP_ID" || "$APP_ID" == "null" ]]; then
    # Fallback: re-query
    APP_ID="$(api_get "project.one?projectId=${PROJECT_ID}" \
      | jq -r --arg n "$APP_NAME" '.environments[] | select(.isDefault==true) | .applications[]? | select(.name == $n) | .applicationId' | head -1)"
  fi
  echo "  created application $APP_ID"
else
  echo "  reusing application $APP_ID"
fi

echo "[3/5] Setting Docker image source to ${IMAGE}..."
api_post application.saveDockerProvider -d "$(jq -nc \
  --arg id "$APP_ID" --arg img "$IMAGE" \
  '{applicationId:$id, dockerImage:$img, username:null, password:null, registryUrl:null}')" > /dev/null
echo "  done"

echo "[4/5] Ensuring auto-generated domain..."
EXISTING_HOST="$(api_get "domain.byApplicationId?applicationId=${APP_ID}" 2>/dev/null \
  | jq -r '.[]?.host // empty' | head -1)"
if [[ -z "$EXISTING_HOST" ]]; then
  HOST="$(api_post domain.generateDomain -d "$(jq -nc --arg n "$APP_NAME" '{appName:$n}')" | jq -r '. // empty')"
  if [[ -z "$HOST" || "$HOST" == "null" ]]; then
    echo "  generateDomain returned empty — abort"; exit 1
  fi
  api_post domain.create -d "$(jq -nc \
    --arg id "$APP_ID" --arg h "$HOST" --argjson port "$APP_PORT" \
    '{applicationId:$id, host:$h, path:"/", port:$port, https:true, certificateType:"letsencrypt", domainType:"application"}')" > /dev/null
  echo "  attached https://${HOST}"
else
  HOST="$EXISTING_HOST"
  echo "  reusing https://${HOST}"
fi

echo "[5/5] Triggering deploy..."
api_post application.deploy -d "$(jq -nc --arg id "$APP_ID" \
  '{applicationId:$id, title:"deploy via dokploy-deploy.sh", description:"automated"}')" | head -c 200
echo
echo
echo "=== summary ==="
echo "  projectId:     $PROJECT_ID"
echo "  environmentId: $ENV_ID"
echo "  applicationId: $APP_ID"
echo "  url:           https://${HOST}"
echo
echo "Watch deploy at: ${DOKPLOY_URL}/projects/${PROJECT_ID}"
