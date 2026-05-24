# Deploy

## ✨ 默认路径:push 自动 deploy

**已配好**:`.github/workflows/build-and-push.yml` 末尾的 "Trigger Dokploy redeploy" 步骤。

```
git push origin main
  → GHA 构建 wasm + Docker 镜像
  → 推 ghcr.io/kanekanefy/zorr:latest
  → curl POST 到 ${{ secrets.DOKPLOY_WEBHOOK_URL }}
  → Dokploy 拉新镜像 + 滚动重启容器(无人工干预)
```

**所需 secret**:`DOKPLOY_WEBHOOK_URL` 已在 repo secrets 配好。
- 格式:`https://dok.inglegames.com/api/deploy/<application-refreshToken>`
- Token 是 application 级别(不是全局 API key),来自 Dokploy:
  - UI 路径:Application → Settings → Auto Deploy → Webhook URL
  - API 字段:`refreshToken`
- 泄露/作废:在 Dokploy UI 点 "Regenerate" 后,`gh secret set DOKPLOY_WEBHOOK_URL` 更新 GHA。

## 手工 deploy(首次配置 / 应急 / 改 image 源)

```bash
source deploy/.secrets    # 加载 DOKPLOY_URL + DOKPLOY_API_KEY (gitignored)
./deploy/dokploy-deploy.sh
```

或者:

```bash
export DOKPLOY_URL=https://dok.inglegames.com
export DOKPLOY_API_KEY=<your-api-key>   # Dokploy → Settings → API Keys
./deploy/dokploy-deploy.sh
```

脚本干的事:
1. 找/建项目 `zorr`
2. 找/建应用 `zorr`
3. 把应用源配成 `ghcr.io/kanekanefy/zorr:latest`
4. 自动生成一个 `*.sslip.io` 域名(IP 编码在子域名里,Let's Encrypt 直接出证书)
5. 触发部署

幂等友好 — 重跑只是再触发一次 deploy。**只在以下场景用**:首次创建 app、改 image 源、改域名;日常 push 不需要。

## 一次性手工修复(Dokploy Traefik HTTP/2 vs WebSocket)

**先不动**,Dokploy 0.29.5 + Traefik 3.6.7 默认配置看起来不强制 HTTP/2 over WS。
如果部署后浏览器进游戏会"Disconnected"频繁掉线,SSH 上去改:

```bash
ssh ubuntu@<dokploy-host>
sudo vi /etc/dokploy/traefik/traefik.yml
# 在 entryPoints.websecure 下加:
#   http2:
#     maxConcurrentStreams: 0
sudo docker restart dokploy-traefik
```

## Cloudflare 代理(后续)

见 `cloudflare/README.md`。简短版:
1. 上面 sslip.io 域名只是 staging
2. 真域名想用 `zorr.yourdomain.com` 时,DNS 加 A 记录指向 Dokploy 主机 IP(64.188.28.149)
3. 在 Dokploy 应用页面追加这个 domain,Let's Encrypt 自动签新证书
4. Cloudflare 开 Proxied(橙色云)→ TLS + DDoS + 隐藏源站
