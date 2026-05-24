# zorr — gardn 私服部署设计

**Date**: 2026-05-24
**Status**: Draft, pending user approval

## Context

复刻 florr.io 的玩法,自己跑一个可控的私服。已有的开源参考是 `trigonal-bacon/gardn`(C++/Emscripten,AGPL-3.0),功能上跟 florr 已经非常接近。本项目不重写游戏,而是把 gardn **容器化、可重复、跟用户现有基础设施(Dokploy + 一个 API + Cloudflare 域名)无缝合并**地部署起来。

目标受众:用户自己 + 朋友试玩,可能小范围扩散,不追求商业级 SLA。

## Scope

**做**:
- 用 gardn 作为上游(submodule),应用少量纯外观补丁(标题/文案/主题色)
- 多阶段 Dockerfile,GitHub Actions 构建并推送到 GHCR
- 在用户现有 Dokploy 实例上以"拉镜像"方式部署
- DNS 走 Cloudflare 代理(免费 TLS + DDoS + 隐藏源站 IP)
- 本地 docker-compose 开发流程

**不做**(本次):
- 游戏逻辑改动、新 mob、新花瓣
- 原生 uWebSockets 服务端(README 标注为未来性能升级路径)
- 持久化/排行榜(以 gardn 自带能力为准)
- 多区域部署

## Architecture

### 组件清单

| 组件 | 职责 | 形态 |
|---|---|---|
| `upstream/gardn/` | 上游游戏代码 | git submodule,钉死某个 commit |
| `patches/*.patch` | 三个外观补丁 | 纯文本 patch 文件,构建时应用 |
| `Dockerfile` | 多阶段构建 | builder = `emscripten/emsdk` → runtime = `node:20-alpine` |
| `docker-compose.yml` | 本地开发 | 单服务,挂载 `patches/`,build context = `./` |
| `.github/workflows/build.yml` | CI | tag 触发,构建后推 `ghcr.io/<owner>/zorr:<tag>` 与 `:latest` |
| `dokploy/README.md` | 部署 runbook | 在 Dokploy UI 上的逐步操作 + Traefik HTTP/2 修复 |
| `README.md` | 项目入口 | 5 分钟跑通本地 + 部署的速查 |

### 数据流

```
开发者 push tag v0.1.0
   ↓
GitHub Actions:
   checkout --recurse-submodules
   → 应用 patches/*.patch
   → docker build(多阶段)
   → docker push ghcr.io/<owner>/zorr:v0.1.0 + :latest
   ↓
Dokploy webhook 触发
   → pull 新镜像
   → restart 容器(监听 127.0.0.1:9001 在 dokploy 网络内)
   ↓
Dokploy Traefik(已禁用 HTTP/2):
   zorr.<domain> → 容器:9001(支持 WSS upgrade)
   ↓
Cloudflare(orange cloud proxied):
   zorr.<domain> → Dokploy 主机 IP
   ↓ 客户端浏览器
   WS 心跳 30s(避开 free plan 100s idle timeout)
```

### 关键设计决策与理由

**1. submodule + patches,不 fork。**
上游 gardn 仍在演进,我们的"自有部分"很小。fork 会让"我们的代码"和"上游"难以分辨;补丁清晰展示"我们改了什么"且 rebase 上游成本低。

**2. WS_URL 运行时化补丁(0002)从第一天就做。**
gardn 把 `WS_URL` 写成 `Shared/Config.cc` 里的编译时常量。如果不动它,每个域名都要重新编译镜像,**Docker 镜像的"一次构建多处部署"价值就废了**。打个 5-10 行的补丁让它读 `WS_URL` 环境变量(或在编译时用 `-DWS_URL=...` 注入),代价小、收益大。

**3. CI 预构建 + Dokploy 仅拉镜像,不在 Dokploy 上现场编译。**
emscripten 编译会把宿主机 CPU 占满几十分钟,会拖垮同实例的 API。Dokploy 官方文档也明说生产环境别本地构建。

**4. Dokploy Traefik 必须关 HTTP/2(对 `websecure` entryPoint)。**
[Dokploy Issue #4202](https://github.com/Dokploy/dokploy/issues/4202):HTTP/2 默认开启会把 WebSocket 长连接踢掉。runbook 里第一步就是改 `/etc/dokploy/traefik/traefik.yml`。

**5. WASM-Node 服务端,不走原生 uWebSockets。**
容器化更干净(无 libuv/glibc 版本陷阱),首版镜像小一些。性能不够时再切原生,只是换个 builder target。

**6. Cloudflare 只做代理层,不动 Dokploy 部署逻辑。**
DNS 设成 proxied(小黄云)即可拿到 TLS+DDoS,源站 IP 不暴露。如果以后想完全脱离 Dokploy 搬去 Cloudflare Containers,镜像不动,只换部署后端。

### 仓库结构

```
zorr/
├── upstream/gardn/                              # submodule,pinned commit
├── patches/
│   ├── 0001-title-and-copy.patch
│   ├── 0002-ws-url-runtime-env.patch            # 让 WS_URL 读环境变量
│   └── 0003-color-theme.patch
├── Dockerfile                                   # multi-stage
├── docker-compose.yml                           # 本地 dev
├── .dockerignore
├── .github/
│   └── workflows/
│       └── build-and-push.yml
├── dokploy/
│   └── README.md                                # 部署 runbook + traefik 修复
├── cloudflare/
│   └── README.md                                # DNS 配置 + 心跳验证
├── docs/superpowers/specs/                      # 本文档
├── .gitignore
└── README.md
```

### 本地开发流程

```bash
git clone --recurse-submodules <repo>
cd zorr
docker-compose up --build      # 首次构建慢(emscripten),后续走 layer cache
# 浏览器打开 http://localhost:9001
```

### 部署流程(每次发版)

```bash
git tag v0.1.0 && git push --tags
# → GHA 自动构建 → 推送 ghcr → Dokploy webhook → 自动 redeploy
```

## Testing / 验证

| 层级 | 怎么验 |
|---|---|
| Dockerfile 正确性 | 本地 `docker-compose up --build` 跑起来,浏览器能进游戏 |
| 补丁正确性 | 进游戏后:标题对、文案对、主色对 |
| WS_URL 运行时化 | 用两个不同的 `WS_URL` 环境变量启动同一镜像,客户端连对应地址都通 |
| GHA pipeline | 推一个 tag,观察 actions 跑完且镜像出现在 GHCR |
| Dokploy 部署 | 在 Dokploy 配 image=`ghcr.io/.../zorr:latest`,deploy 后访问子域名能进游戏 |
| WSS 升级 | 浏览器 DevTools 看 ws upgrade 成功,traffic 在 wss:// 上 |
| 100s 超时 | 进游戏后停手 2 分钟,连接不断 |
| Cloudflare 代理 | `dig zorr.<domain>` 返回 Cloudflare IP(104.x / 172.x),不暴露源站 |

## 已知约束与遗留问题

- **emscripten builder 镜像 ~3GB**:首次 GHA 构建慢,后续靠 layer cache 与 BuildKit cache mount
- **gardn 上游无 release tag**:submodule 钉 commit hash,在 README 记录"我们当前基于的 gardn commit"
- **AGPL-3.0 协议**:任何修改并对外提供服务都需对外公开源码——本项目仓库本身就是公开形式,合规
- **具体补丁文件位置 TBD**:title/welcome/colors 的具体源码位置要等 submodule 拉下后用 grep 定位,记录到实现计划里

## 未来扩展(明确不在本次范围)

- 切换到原生 uWebSockets 服务端(性能升级)
- 给 Dokploy 配资源限制(CPU/内存),避免 zorr 与 API 互相影响
- Cloudflare Containers 作为替代部署后端(zero-trust 化)
- 数值/玩法 patch(动 `EntityDef.hh`)
- 加自己的 mob 或花瓣(动 ECS 框架)
