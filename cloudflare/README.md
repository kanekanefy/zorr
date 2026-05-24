# Cloudflare 代理 runbook (后续可选)

第一版部署使用了 Dokploy 自带的 `*.traefik.me` 域名(IP 编码在子域名,
Let's Encrypt 直接出证书),够你和朋友测玩。

想用真正的子域名(`zorr.yourdomain.com`)+ Cloudflare 代理(免费 TLS、
DDoS、隐藏源站 IP),做下面这些。

## 前提

- 域名 NS 已指向 Cloudflare
- Dokploy 部署已经成功(traefik.me 那个 URL 能玩)

## 步骤

### 1. 加 DNS 记录

Cloudflare 控制台 → 你的 zone → DNS → **+ Add record**

| 字段 | 值 |
|------|-----|
| Type | A |
| Name | `zorr`(或你想要的子域名前缀) |
| IPv4 address | `64.188.28.149` (Dokploy 主机 IP) |
| Proxy status | **Proxied**(橙色云) |
| TTL | Auto |

`dig zorr.<your-domain>` 应返回 CF 段 IP(104.x / 172.x),不是源站。

### 2. SSL 模式

Cloudflare → SSL/TLS → Overview → **Full (strict)**

### 3. 在 Dokploy 应用上追加这个域名

```bash
# 假设你已经知道 APP_ID(从首次部署日志记下来,或重跑 deploy 脚本它会打)
curl -X POST \
  -H "x-api-key: $DOKPLOY_API_KEY" \
  -H "Content-Type: application/json" \
  https://dok.inglegames.com/api/domain.create \
  -d '{"applicationId":"<APP_ID>","host":"zorr.yourdomain.com","path":"/","port":9001,"https":true,"certificateType":"letsencrypt","domainType":"application"}'
```

Traefik 会自动从 Let's Encrypt 拿一份这个域名的证书。

### 4. WebSocket 默认通

Cloudflare proxied 域名默认支持 WebSocket,所有计划。不需要做什么。

## Free 计划 100s 空闲 timeout

`gardn` 客户端在游戏中会持续发包(每帧),所以正常玩不会触发。挂机测试 2 分钟:
- 浏览器 DevTools → Network → WS → 应该一直 "101 Switching Protocols"
- 没有 reconnect 行

如果发现 100s 准时断,在 `patches/` 加第 4 个补丁加心跳。

## 故障速查

| 症状 | 大概率原因 |
|------|------------|
| 525/526 错误 | Full (strict) 但 Dokploy 那边的证书有问题。临时换 Full(非 strict)定位 |
| 连接很快"Disconnected" | Dokploy 那层 Traefik HTTP/2 bug。见 `deploy/README.md` 末尾 |
| `dig` 返回源站 IP | DNS 记录没设成 Proxied |
