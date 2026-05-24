# Deploy

## Dokploy(自动化脚本)

```bash
export DOKPLOY_URL=https://dok.inglegames.com
export DOKPLOY_API_KEY=<your-api-key>   # Dokploy → Settings → API Keys
./deploy/dokploy-deploy.sh
```

脚本干的事:
1. 找/建项目 `zorr`
2. 找/建应用 `zorr`
3. 把应用源配成 `ghcr.io/kanekanefy/zorr:latest`
4. 自动生成一个 `*.traefik.me` 域名(IP 编码在子域名里,Let's Encrypt 直接出证书)
5. 触发部署

幂等友好 — 重跑只是再触发一次 deploy。

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
1. 上面 traefik.me 域名只是 staging
2. 真域名想用 `zorr.yourdomain.com` 时,DNS 加 A 记录指向 Dokploy 主机 IP(64.188.28.149)
3. 在 Dokploy 应用页面追加这个 domain,Let's Encrypt 自动签新证书
4. Cloudflare 开 Proxied(橙色云)→ TLS + DDoS + 隐藏源站
