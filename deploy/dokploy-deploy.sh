#!/usr/bin/env bash
# Dokploy 部署脚本 — 一键创建 project、application、配置 GHCR 镜像源、
# 生成 traefik.me 域名、触发部署。
#
# 用法:
#   export DOKPLOY_URL=https://dok.inglegames.com
#   export DOKPLOY_API_KEY=<your-key>
#   ./deploy/dokploy-deploy.sh
#
# 幂等(差不多):重复跑会:
#   - 复用已存在的 project (按名字找)
#   - 复用已存在的 application (按名字找)
#   - 复用域名
#   - 每次都触发一次重新 deploy

set -euo pipefail

: "${DOKPLOY_URL:?need DOKPLOY_URL}"
: "${DOKPLOY_API_KEY:?need DOKPLOY_API_KEY}"

PROJECT_NAME="${PROJECT_NAME:-zorr}"
APP_NAME="${APP_NAME:-zorr}"
IMAGE="${IMAGE:-ghcr.io/kanekanefy/zorr:latest}"
APP_PORT="${APP_PORT:-9001}"

api() {
  local path="$1"; shift
  curl -sS -X POST \
    -H "x-api-key: ${DOKPLOY_API_KEY}" \
    -H "Content-Type: application/json" \
    "${DOKPLOY_URL}/api/${path}" \
    "$@"
}

api_get() {
  local path="$1"; shift
  curl -sS -G \
    -H "x-api-key: ${DOKPLOY_API_KEY}" \
    "${DOKPLOY_URL}/api/${path}" \
    "$@"
}

echo "[1/6] Finding or creating project '${PROJECT_NAME}'..."
PROJECT_ID="$(api_get project.all | jq -r --arg n "${PROJECT_NAME}" '.[] | select(.name == $n) | .projectId' | head -1)"
if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(api project.create -d "$(jq -nc --arg n "$PROJECT_NAME" '{name:$n, description:"florr-style game (gardn fork) — see github.com/kanekanefy/zorr"}')" | jq -r '.projectId // .data.json.projectId')"
  echo "  created project: $PROJECT_ID"
else
  echo "  reusing project: $PROJECT_ID"
fi

echo "[2/6] Getting production environment id..."
ENV_ID="$(api_get project.one --data-urlencode "input={\"projectId\":\"${PROJECT_ID}\"}" \
  | jq -r '.environments[] | select(.isDefault == true) | .environmentId')"
echo "  environmentId: $ENV_ID"

echo "[3/6] Finding or creating application '${APP_NAME}'..."
# project.one returned environments[].applications — refresh and look there
EXISTING_APP_ID="$(api_get project.one --data-urlencode "input={\"projectId\":\"${PROJECT_ID}\"}" \
  | jq -r --arg n "$APP_NAME" '.environments[] | select(.isDefault == true) | .applications[]? | select(.name == $n) | .applicationId' | head -1)"
if [[ -z "$EXISTING_APP_ID" ]]; then
  APP_ID="$(api application.create -d "$(jq -nc --arg n "$APP_NAME" --arg e "$ENV_ID" '{name:$n, appName:$n, description:"zorr game server", environmentId:$e}')" | jq -r '.applicationId // .data.json.applicationId')"
  echo "  created application: $APP_ID"
else
  APP_ID="$EXISTING_APP_ID"
  echo "  reusing application: $APP_ID"
fi

echo "[4/6] Configuring application to pull from ${IMAGE}..."
api application.saveDockerProvider -d "$(jq -nc \
  --arg id "$APP_ID" \
  --arg img "$IMAGE" \
  '{applicationId:$id, dockerImage:$img, username:"", password:"", registryUrl:""}')" > /dev/null
echo "  source set to dockerImage=${IMAGE}"

echo "[5/6] Generating traefik.me domain and attaching..."
EXISTING_DOMAIN_HOST="$(api_get domain.byApplicationId --data-urlencode "input={\"applicationId\":\"${APP_ID}\"}" \
  | jq -r '.[]?.host // empty' | head -1)"
if [[ -z "$EXISTING_DOMAIN_HOST" ]]; then
  # generateDomain only suggests the host string; we still have to domain.create
  HOST="$(api domain.generateDomain -d "$(jq -nc --arg n "$APP_NAME" '{appName:$n}')" | jq -r '. // empty')"
  if [[ -z "$HOST" || "$HOST" == "null" ]]; then
    echo "  generateDomain returned empty — falling back to manually-built traefik.me host"
    HOST="${APP_NAME}-$(echo 64.188.28.149 | tr . -).traefik.me"
  fi
  api domain.create -d "$(jq -nc \
    --arg id "$APP_ID" \
    --arg h "$HOST" \
    --argjson port "$APP_PORT" \
    '{applicationId:$id, host:$h, path:"/", port:$port, https:true, certificateType:"letsencrypt", domainType:"application"}')" > /dev/null
  echo "  attached domain: https://${HOST}"
else
  HOST="$EXISTING_DOMAIN_HOST"
  echo "  reusing domain: https://${HOST}"
fi

echo "[6/6] Triggering deploy..."
api application.deploy -d "$(jq -nc --arg id "$APP_ID" '{applicationId:$id, title:"deploy via dokploy-deploy.sh", description:"automated"}')" | jq -c '.' | head -c 300; echo
echo
echo "DONE. Watch deploy at: ${DOKPLOY_URL}"
echo "Once deployed, open: https://${HOST}"
echo
echo "Container env (for re-run):"
echo "  PROJECT_ID=${PROJECT_ID}"
echo "  ENV_ID=${ENV_ID}"
echo "  APP_ID=${APP_ID}"
echo "  HOST=${HOST}"
