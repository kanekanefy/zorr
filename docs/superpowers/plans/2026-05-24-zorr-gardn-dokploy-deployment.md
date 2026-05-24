# zorr — gardn Dockerized Deploy on Dokploy 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 trigonal-bacon/gardn 包装成可重复构建的 Docker 镜像,通过 GitHub Actions 推 GHCR,在用户现有 Dokploy 实例上一键部署,前面套 Cloudflare 代理做 TLS 和防护。

**Architecture:** gardn 作 git submodule(钉死 commit),三个小补丁(标题/底色/WS URL portability)。多阶段 Dockerfile(`emscripten/emsdk` 编译 → `node:20-alpine` 运行)。GHA 在 tag push 时构建并推 `ghcr.io/<owner>/zorr`。Dokploy 配 Docker Image 应用拉镜像,Traefik 反代时禁用 HTTP/2 修 WS bug。Cloudflare DNS 代理(orange cloud)做 TLS 和源站隐藏。

**Tech Stack:** C++20 / Emscripten / WASM / Node.js / Docker (multi-stage) / GitHub Actions / GHCR / Dokploy (Traefik) / Cloudflare

---

## 占位变量(执行时需用户提供)

整个 plan 中出现的:
- `<GHCR_OWNER>` — 用户的 GitHub 用户名或组织名(全小写),例如 `kanedesktop`
- `<ZORR_DOMAIN>` — 部署后的子域名,例如 `zorr.example.com`

执行任何任务前,用户应先在脑子里替换这两个值;commit message 用占位符即可,实际文件内容里出现这些值的地方,任务步骤会显式标出"用真实值替换"。

---

## 文件结构(实现完成后)

```
zorr/
├── upstream/gardn/                              # submodule, 钉死 commit
├── patches/
│   ├── README.md                                # 补丁清单与来源
│   ├── 0001-add-title-and-rebrand.patch
│   ├── 0002-client-ws-url-from-location.patch
│   └── 0003-map-background-color.patch
├── Dockerfile                                   # 多阶段
├── .dockerignore
├── docker-compose.yml                           # 本地 dev
├── .github/workflows/
│   └── build-and-push.yml
├── dokploy/
│   └── README.md                                # 部署 runbook
├── cloudflare/
│   └── README.md                                # DNS + 代理 runbook
├── docs/superpowers/
│   ├── specs/2026-05-24-zorr-gardn-dokploy-deployment-design.md
│   └── plans/2026-05-24-zorr-gardn-dokploy-deployment.md  (本文件)
├── .gitignore
├── LICENSE-NOTICE.md                            # AGPL 归属
└── README.md
```

---

## Task 1: 项目骨架 + .gitignore

**Files:**
- Create: `.gitignore`
- Create: `LICENSE-NOTICE.md`

- [ ] **Step 1: 写 `.gitignore`**

```gitignore
# harness state
.claude/

# build output (we never check this in)
build/
*.wasm
*.o
*.a

# IDE
.vscode/
.idea/
*.swp
.DS_Store

# local env overrides
.env
.env.local

# node (only if we end up needing it locally)
node_modules/
```

- [ ] **Step 2: 写 `LICENSE-NOTICE.md`**

```markdown
# License Notice

This project deploys [`trigonal-bacon/gardn`](https://github.com/trigonal-bacon/gardn), licensed under **AGPL-3.0**.

Because AGPL is copyleft and triggers on network use, any public deployment
of this project must make the modified source available to users. This
repository serves as that source: the upstream is included as a git
submodule under `upstream/gardn/`, and our modifications live in `patches/`.

Original gardn copyright: trigonal-bacon and contributors.

Our additions in this repo (Dockerfile, CI, deployment configs, patches) are
licensed under the same terms: **AGPL-3.0**.
```

- [ ] **Step 3: 提交**

```bash
git add .gitignore LICENSE-NOTICE.md
git commit -m "chore: add gitignore and AGPL attribution notice"
```

Expected: commit succeeds.

---

## Task 2: 添加 gardn submodule (钉 commit)

**Files:**
- Create: `upstream/gardn/` (via `git submodule add`)
- Create: `.gitmodules` (auto-generated)
- Modify: `README.md` (preview, only "based on commit X" line)

- [ ] **Step 1: 添加 submodule**

```bash
git submodule add https://github.com/trigonal-bacon/gardn.git upstream/gardn
```

Expected: clone succeeds, `upstream/gardn/` populated. `.gitmodules` created.

- [ ] **Step 2: 初始化 upstream 自己的 submodule (uWebSockets 等)**

```bash
git submodule update --init --recursive
```

Expected: `upstream/gardn/Server/uWebSockets/` 及其 nested submodule 拉下。

- [ ] **Step 3: 记录当前钉死的 commit**

```bash
cd upstream/gardn && PIN_SHA=$(git rev-parse HEAD) && cd ../..
echo "Based on gardn commit: $PIN_SHA" > UPSTREAM_PIN.txt
cat UPSTREAM_PIN.txt
```

Expected: `UPSTREAM_PIN.txt` 单行,记录 40 位 commit SHA。

- [ ] **Step 4: 提交**

```bash
git add .gitmodules upstream/gardn UPSTREAM_PIN.txt
git commit -m "chore: pin gardn upstream as submodule"
```

Expected: commit 含 submodule 引用 + UPSTREAM_PIN.txt。

---

## Task 3: Dockerfile + compose,先跑通 vanilla gardn (无补丁)

**目标:** 在不修任何代码的前提下,把 gardn 用 Docker 编出来跑起来。验证 toolchain 没问题,再叠补丁。

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`

- [ ] **Step 1: 写 `.dockerignore`**

```dockerignore
.git
.github
build
docs
dokploy
cloudflare
patches
*.md
.DS_Store
.vscode
.idea
.claude
```

注意:**不要** ignore `upstream/`,我们需要它进 build context。也不要 ignore `Dockerfile` 自己。

- [ ] **Step 2: 写 `Dockerfile`(第一版,无补丁)**

```dockerfile
# syntax=docker/dockerfile:1.7

# ---------- Stage 1: builder ----------
FROM emscripten/emsdk:3.1.74 AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      cmake g++ make git \
      libuv1-dev zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY upstream/gardn/ ./

# Build client (WASM)
RUN cmake -S Client -B Client/build -DDEBUG=0 && \
    cmake --build Client/build -j$(nproc)

# Build server (WASM-Node mode, simpler than native uWebSockets)
RUN cmake -S Server -B Server/build -DWASM_SERVER=1 -DDEBUG=0 && \
    cmake --build Server/build -j$(nproc)

# Collect artifacts in one dir
RUN mkdir -p /out && \
    cp Server/build/gardn-server.js Server/build/gardn-server.wasm /out/ && \
    cp Client/build/gardn-client.js Client/build/gardn-client.wasm /out/ && \
    cp Client/public/index.html /out/

# ---------- Stage 2: runtime ----------
FROM node:20-alpine

WORKDIR /app

# WASM-Node server needs ws package (per gardn INSTALLATION.md)
RUN npm install --omit=dev ws

COPY --from=builder /out/ ./

EXPOSE 9001

CMD ["node", "gardn-server.js"]
```

**关键说明:**
- emscripten/emsdk:3.1.74 是 2026 年初稳定 tag(GitHub Actions emsdk-action 默认值附近),够新
- Stage 1 编译完两个 target,把 5 个产物 (`gardn-server.{js,wasm}`、`gardn-client.{js,wasm}`、`index.html`) 全收到 `/out`
- Stage 2 用 `node:20-alpine` 跑,装一个 `ws` 包(WASM-Node server 唯一运行时依赖)
- 端口 9001 是 gardn 默认(`Shared/Config.cc:SERVER_PORT`),WASM-Node server 同端口托管 HTTP 静态和 WS

- [ ] **Step 3: 写 `docker-compose.yml`**

```yaml
services:
  zorr:
    build:
      context: .
      dockerfile: Dockerfile
    image: zorr:local
    ports:
      - "9001:9001"
    restart: unless-stopped
```

- [ ] **Step 4: 本地构建 + 跑 + 验证 (vanilla)**

```bash
docker compose build --progress=plain 2>&1 | tail -40
```

Expected: 首次构建 5-15 分钟(下 emsdk 镜像 ~3GB)。最终一行类似 `=> exporting to image`,无 error。

```bash
docker compose up -d && sleep 3 && docker compose logs --tail=20
```

Expected: 日志含类似 "Server listening on :9001" 或类似的 emscripten Node 启动输出(无 crash)。

```bash
curl -sf http://localhost:9001/ | head -5
```

Expected: 返回 HTML(包含 `<canvas id="canvas">`)。

```bash
# 手动浏览器验证
echo "Open http://localhost:9001 in browser. Expect to see vanilla gardn loading screen → game canvas."
```

Expected (人工): 浏览器能进游戏画面,能用 WASD 移动。注意:**vanilla 版本 WS_URL 硬编码到 `ws://localhost:9001`**,所以只在 localhost 这个地址访问能玩 —— 这正是我们 Task 5 要修的问题。

- [ ] **Step 5: 关掉容器,提交**

```bash
docker compose down
git add Dockerfile .dockerignore docker-compose.yml
git commit -m "feat: multi-stage Dockerfile building vanilla gardn (WASM-Node mode)"
```

---

## Task 4: 补丁 0001 — 加 `<title>` + 改 loading 文案 + 重命名 brand

**目标:** 让浏览器标签页显示 "zorr"、加载页文案改成自定义。这是最简单的补丁,先做它把"补丁应用流"打通。

**Files:**
- Create: `patches/0001-add-title-and-rebrand.patch`
- Create: `patches/README.md`
- Modify: `Dockerfile`(加上应用补丁的步骤)

- [ ] **Step 1: 写 `patches/README.md`**

```markdown
# Patches

应用在 `upstream/gardn/` 上的补丁,按序号顺序 `git apply` 应用。

| # | 文件 | 作用 | 风险 |
|---|------|------|------|
| 0001 | add-title-and-rebrand | HTML 加 `<title>`,loading 文案改 "zorr" | 零,纯外观 |
| 0002 | client-ws-url-from-location | 客户端 WS URL 改成从 `window.location` 算,而非编译时常量 | 低,只改 connect 调用 |
| 0003 | map-background-color | 地图底色从 0xff987d72(棕)改成 0xff2c8a3e(绿,贴近 florr) | 零,纯外观 |

## 应用方式

```bash
cd upstream/gardn
for p in ../../patches/*.patch; do git apply "$p"; done
```

Dockerfile 在 builder stage 里自动做这一步。

## 重新生成补丁

如果在 `upstream/gardn/` 里直接改了文件,要把改动转成补丁:

```bash
cd upstream/gardn
git diff > ../../patches/NNNN-description.patch
git checkout .   # 回退 upstream,补丁是唯一真相
```
```

- [ ] **Step 2: 写 `patches/0001-add-title-and-rebrand.patch`**

注意:这是 unified diff 格式,路径以 `a/` `b/` 前缀,在 `git apply` 时相对于 `upstream/gardn/` 目录。

```diff
--- a/Client/public/index.html
+++ b/Client/public/index.html
@@ -1,6 +1,7 @@
 <!DOCTYPE html>
 <html>
     <head>
+        <title>zorr</title>
         <link href="https://fonts.googleapis.com/css?family=Ubuntu:700" rel="stylesheet" type="text/css">
         <style>
             * {
@@ -41,7 +42,7 @@
     </head>
     <body>
     <div id="loading-bar">
-        <span id="loading">Loading</span>
+        <span id="loading">zorr</span>
     </div>
     <div id="font-loader" style="font-family: Ubuntu;">hello!</div>
     <canvas id="canvas" width="0" height="0"></canvas>
```

- [ ] **Step 3: 改 `Dockerfile`,在 COPY 后、cmake 前加补丁应用步骤**

在现有 Dockerfile 的 builder stage,**把** `COPY upstream/gardn/ ./` **行后面加一段:**

```dockerfile
COPY upstream/gardn/ ./

# Apply our patches before building
COPY patches/ /patches/
RUN for p in /patches/*.patch; do \
      echo ">>> Applying $p" && git apply --whitespace=nowarn "$p" ; \
    done
```

注意:**git apply 需要 .git 目录**,但 upstream/gardn 在 COPY 进来后是裸文件,没有 .git。改用 `patch -p1` 更可靠:

```dockerfile
COPY upstream/gardn/ ./

# Apply our patches before building (using `patch`, not `git apply`,
# since the COPY strips .git from the submodule).
COPY patches/ /patches/
RUN apt-get update && apt-get install -y --no-install-recommends patch && rm -rf /var/lib/apt/lists/* && \
    for p in /patches/*.patch; do \
      echo ">>> Applying $p" && patch -p1 < "$p" ; \
    done
```

如果觉得每次都装 patch 麻烦,可以挪到顶部的 apt-get install 里:

```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      cmake g++ make git patch \
      libuv1-dev zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*
```

然后补丁段简化为:

```dockerfile
COPY upstream/gardn/ ./
COPY patches/ /patches/
RUN for p in /patches/*.patch; do echo ">>> Applying $p" && patch -p1 < "$p" ; done
```

**采用后一种(把 patch 加入 base 安装包)**。

- [ ] **Step 4: 重新构建并验证**

```bash
docker compose build --progress=plain 2>&1 | grep -E "(Applying|error|Error|ERROR)" | head -10
```

Expected: 看到 `>>> Applying /patches/0001-add-title-and-rebrand.patch`,无 error。

```bash
docker compose up -d && sleep 3 && curl -sf http://localhost:9001/ | grep -E "(title|loading)"
```

Expected: HTML 中能看到 `<title>zorr</title>` 和 `<span id="loading">zorr</span>`。

```bash
# 浏览器验证
echo "Refresh http://localhost:9001. Tab title should now be 'zorr', loading screen should say 'zorr' instead of 'Loading'."
```

- [ ] **Step 5: 关容器,提交**

```bash
docker compose down
git add patches/ Dockerfile
git commit -m "feat: patch 0001 - add page title and rebrand loading text"
```

---

## Task 5: 补丁 0002 — 客户端 WS URL 从 `window.location` 计算

**目标:** 让镜像可以部署到任何域名而不需要重新编译。客户端连 WS 时不再用编译时常量 `WS_URL`,改成从浏览器当前 URL 推导。

**Files:**
- Create: `patches/0002-client-ws-url-from-location.patch`
- Modify: `patches/README.md`(已经包含 0002 行,不用改)

- [ ] **Step 1: 写补丁**

侦察(已对照真实源码 `Client/Socket.cc:46-67`)显示 `Socket::connect()` 把 C++ 传进来的 URL 字符串拷给 `EM_ASM` 里的 `new WebSocket(string)`。**最干净的做法是改 `Socket::connect` 本身**:让它无视传进来的 URL,直接在 JS 里用 `window.location` 算。一个文件、零 include 变更、零调用点改动。

`patches/0002-client-ws-url-from-location.patch`:

```diff
--- a/Client/Socket.cc
+++ b/Client/Socket.cc
@@ -46,7 +46,9 @@
 void Socket::connect(std::string const url) {
     std::cout << "Connecting to " << url << '\n';
     EM_ASM({
-        let string = UTF8ToString($1);
+        // zorr patch: derive WS URL from window.location so the image is
+        // portable across domains without recompiling.
+        let string = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
         function connect() {
             let socket = Module.socket = new WebSocket(string);
             socket.binaryType = "arraybuffer";
```

注意:`url` 参数依然传进来(没改签名)、`std::cout` 那行也保留(打印的是编译时常量值,对 debug 仍有意义,能看出"代码本来想连哪")。`$1` 在 EM_ASM 里就是 `url.c_str()`(见原代码 line 66 的 `, INCOMING_PACKET, url.c_str());`),我们把那个 `UTF8ToString($1)` 替换成 JS 计算的 URL,但 `$1` 参数仍传着,无害。

**上下文行号已对照实际源码验证**(`Client/Socket.cc:46` 是 `void Socket::connect(...)` 那行,且 `let string = UTF8ToString($1);` 在 line 49)。如果上游 commit 不同导致对不上,patch 会报 `Hunk #1 FAILED`,届时按报错的 offset 调即可。

- [ ] **Step 2: 验证补丁先在本地手 apply 一次**

```bash
cd upstream/gardn
patch -p1 --dry-run < ../../patches/0002-client-ws-url-from-location.patch
```

Expected: `checking file Client/Game.cc` 和 `Hunk #1 succeeded`(可能 with offset)。**如果 dry-run 失败**,根据报错位置调整补丁的 `@@` 行号或上下文行,直到 dry-run 通过。然后:

```bash
cd /Users/kane/Desktop/project/zorr  # 回项目根
```

(不要真 apply,真 apply 由 Dockerfile 在容器里做。)

- [ ] **Step 3: 重新构建并验证**

```bash
docker compose build --progress=plain 2>&1 | grep -E "(Applying|error|Error|ERROR|FAILED)" | head -20
```

Expected: 看到两个 `>>> Applying`,无 error,编译成功(C++ 编译输出最后无错)。

```bash
docker compose up -d && sleep 3
```

```bash
# 验证镜像在不同主机名下都能连
echo "Open http://localhost:9001 — should work as before."
echo "Then open http://127.0.0.1:9001 — should ALSO work (vanilla 版本会断在 WS,因为硬编码 localhost)。"
```

Expected (人工 + DevTools): 两个 URL 都进游戏,DevTools Network → WS 都能看到一条 ws 连接,URL 各自为 `ws://localhost:9001/` 和 `ws://127.0.0.1:9001/`,都 status 101 Switching Protocols。

- [ ] **Step 4: 关容器,提交**

```bash
docker compose down
git add patches/0002-client-ws-url-from-location.patch
git commit -m "feat: patch 0002 - client derives WS URL from window.location"
```

---

## Task 6: 补丁 0003 — 地图底色改绿

**目标:** 把 `Client/Rendering.cc:50` 的地图底色从棕色(`0xff987d72`)改成偏 florr 风格的绿(`0xff2c8a3e`)。纯外观,验证补丁链能继续叠加。

**Files:**
- Create: `patches/0003-map-background-color.patch`

- [ ] **Step 1: 确认原行**

```bash
grep -n "0xff987d72" upstream/gardn/Client/Rendering.cc
```

Expected: 一行,大概 `Rendering.cc:50: renderer.set_fill(0xff987d72);`(行号可能 ±5)。

- [ ] **Step 2: 写补丁**

`patches/0003-map-background-color.patch`:

```diff
--- a/Client/Rendering.cc
+++ b/Client/Rendering.cc
@@ -47,7 +47,8 @@
     {
         RenderContext context(&renderer);
         renderer.reset_transform();
-        renderer.set_fill(0xff987d72);
+        // zorr patch: greener map background
+        renderer.set_fill(0xff2c8a3e);
         renderer.fill_rect(0,0,renderer.width,renderer.height);
         renderer.set_fill(alpha);
         renderer.fill_rect(0,0,renderer.width,renderer.height);
```

行号 47 同样是估算,执行时根据 `grep -n "0xff987d72"` 出的真实行号调整。

- [ ] **Step 3: dry-run + 构建 + 验证**

```bash
cd upstream/gardn && patch -p1 --dry-run < ../../patches/0003-map-background-color.patch && cd ../..
```

Expected: `Hunk #1 succeeded`。

```bash
docker compose build --progress=plain 2>&1 | grep -E "(Applying|error|Error)" | head
docker compose up -d && sleep 3
echo "Open http://localhost:9001 — background should now be green, not brown."
```

Expected (人工): 进游戏后,玩家走出 zone 区域时,主背景是绿色而不是棕色。

- [ ] **Step 4: 关容器,提交**

```bash
docker compose down
git add patches/0003-map-background-color.patch
git commit -m "feat: patch 0003 - greener map background"
```

---

## Task 7: GitHub Actions → GHCR

**目标:** push 到 main 或 tag `v*` 时,GHA 自动构建多阶段镜像并推送到 `ghcr.io/<GHCR_OWNER>/zorr`,启用 BuildKit cache。

**Files:**
- Create: `.github/workflows/build-and-push.yml`

- [ ] **Step 1: 写 workflow**

```yaml
name: Build and Push

on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}   # owner/repo, lowercased automatically

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout (with submodules)
        uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compute tags
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=tag
            type=sha,prefix=sha-
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**关键说明:**
- `submodules: recursive` 保证 checkout 时把 `upstream/gardn/` 和它自己的 submodule(uWebSockets)都拉下
- `GITHUB_TOKEN` 自动有 GHCR 写权限,不需要额外 PAT(只要 repo 没设置 packages 写权限禁用)
- `cache-from/to: gha` 使用 GHA 自带的 cache backend,emsdk 那一层下次秒过
- `IMAGE_NAME` 用 `github.repository` 自动是 `<owner>/<repo>` 全小写,匹配 GHCR 命名规则

- [ ] **Step 2: 提交**

```bash
git add .github/
git commit -m "ci: GHA workflow to build and push to GHCR on main/tag"
```

- [ ] **Step 3: 用户在 GitHub 上的准备(执行步骤,非自动化)**

把以下指令展示给用户,等 ta 完成后继续:

```text
1. 在 GitHub 上创建仓库 (假设叫 zorr): https://github.com/new
2. 在本地 add remote + push:
   git remote add origin git@github.com:<GHCR_OWNER>/zorr.git
   git push -u origin main
3. 等 Actions 跑完 (首次 5-15 分钟,主要是 emsdk 拉取)
4. 去 https://github.com/<GHCR_OWNER>?tab=packages 验证有 zorr package
5. 默认 GHCR package 是 private — 第一次需要在 Package settings 里:
   - 选 Public visibility(否则 Dokploy 拉不到,除非配 ghcr 凭据)
   或者保持 private,在 Dokploy 里加 ghcr.io 的 registry credentials
```

- [ ] **Step 4: 触发并验证**

```bash
git push origin main
```

(随后人工去 GHA 看 workflow run,等绿勾。如果失败,根据 GHA 日志诊断。)

Expected: GHA Actions 显示成功,GHCR 上出现 `ghcr.io/<GHCR_OWNER>/zorr:latest` + `ghcr.io/<GHCR_OWNER>/zorr:sha-<short>`。

- [ ] **Step 5: 从 GHCR 拉镜像本地验证一次**

```bash
docker pull ghcr.io/<GHCR_OWNER>/zorr:latest
docker run -d --rm -p 9002:9001 --name zorr-ghcr-test ghcr.io/<GHCR_OWNER>/zorr:latest
sleep 3
curl -sf http://localhost:9002/ | grep -E "(title|zorr)"
docker stop zorr-ghcr-test
```

Expected: 容器跑起来,curl 返回带 `<title>zorr</title>` 的 HTML。证明 GHCR 上的镜像就是我们要的。

---

## Task 8: Dokploy 部署 runbook

**目标:** 写一份用户能照着点鼠标就部署好的指南。**这步主要是写文档,不写代码**(Dokploy 部署是 UI 操作,不是 IaC)。

**Files:**
- Create: `dokploy/README.md`

- [ ] **Step 1: 写 runbook**

```markdown
# Dokploy 部署 runbook

假设你已经有一个跑着的 Dokploy 实例,且至少跑着一个其他应用(比如你的 API)。

## 0. 一次性前置:修 Traefik HTTP/2 与 WebSocket 的 bug

Dokploy 默认的 Traefik 配置在 `websecure` entryPoint 上开了 HTTP/2,
会把 WebSocket 长连接踢掉([Dokploy Issue #4202](https://github.com/Dokploy/dokploy/issues/4202))。
**必须先关掉**。

SSH 到 Dokploy 宿主机:

\```bash
sudo nano /etc/dokploy/traefik/traefik.yml
\```

找到 `entryPoints.websecure` 段,把它改成:

\```yaml
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
    http2:
      maxConcurrentStreams: 0    # 关键:禁用 HTTP/2 multiplexing
\```

或者直接整段加 `http: {}`(不再 http2),按 Dokploy 当前模板调整。重启 traefik:

\```bash
docker restart dokploy-traefik
\```

**这个修改只需做一次**,以后所有要用 WSS 的 Dokploy 应用都受益。

## 1. 在 Dokploy 上新建 zorr 应用

1. Dashboard → 你的项目 → **+ Create Service** → **Application**
2. **Name**: `zorr`
3. **Build Type**: Docker Image (不是 Dockerfile,不是 Nixpacks)
4. **Image**: `ghcr.io/<GHCR_OWNER>/zorr:latest`
5. **Container Port**: `9001`
6. 如果 GHCR package 是 private,在 **Registry** 区域加 ghcr.io 凭据(GitHub PAT,scope: read:packages)

## 2. 配域名

1. 应用页 → **Domains** → **Add Domain**
2. **Host**: `<ZORR_DOMAIN>` (例如 zorr.example.com)
3. **Port**: 9001
4. **HTTPS**: ON
5. **Certificate Resolver**: Let's Encrypt(默认)
6. **Path**: `/`(默认,整个域名都走这个 service)

保存后 Traefik 会自动签 cert。

## 3. 配 Auto Deploy(可选但强烈推荐)

应用页 → **Deploy** → **Auto Deploy**
- 启用 webhook,把它给的 URL 配到 GitHub:
  - 进 `https://github.com/<GHCR_OWNER>/zorr/settings/hooks` → **Add webhook**
  - Payload URL = Dokploy 给的 URL
  - Content type = `application/json`
  - Events = Just the push event(或限定到 tag)

之后每次 main 分支 GHA 推完新 `:latest`,Dokploy 自动 pull + restart。

## 4. 资源限制

应用页 → **Advanced** → 设置 CPU/Memory 上限,避免它影响你的 API:
- CPU: 1.0(单核够用)
- Memory: 512Mi(WASM-Node server 占用很小)

## 5. 验证

\```bash
# 在 Dokploy 主机本地验
curl -sf -H "Host: <ZORR_DOMAIN>" http://localhost/ | grep zorr

# 从外部验(还没配 Cloudflare 的话,先用 DNS A 记录直指 Dokploy IP)
curl -sf https://<ZORR_DOMAIN>/ | grep zorr
\```

Expected: HTML 返回,包含 `<title>zorr</title>`。

浏览器打开 `https://<ZORR_DOMAIN>` → 应能进游戏,DevTools Network 里 WS 连接是 `wss://<ZORR_DOMAIN>/`(因为 patch 0002 让客户端用 location 推导)。

## 故障速查

| 症状 | 大概率原因 |
|------|------------|
| 502 Bad Gateway | 容器没起来或端口配错。Dokploy 应用 → Logs |
| 游戏画面出但很快"Disconnected" | Traefik HTTP/2 没关。重做 Step 0。 |
| WS 连成功但 ~100s 后断 | 这是 Cloudflare 那一层的问题,见 `cloudflare/README.md` |
| 一直 503 | Traefik 没认到 service,检查 Domain 配置的 Port 是不是 9001 |
```

- [ ] **Step 2: 提交**

```bash
git add dokploy/
git commit -m "docs: Dokploy deployment runbook"
```

---

## Task 9: Cloudflare 代理 runbook

**Files:**
- Create: `cloudflare/README.md`

- [ ] **Step 1: 写 runbook**

```markdown
# Cloudflare 代理 runbook

Cloudflare 在这个项目里**只做代理**(orange cloud / proxied DNS),不替换 Dokploy。
它给你:免费 TLS(在 Cloudflare 边缘到客户端这一段)、DDoS 防护、源站 IP 隐藏、
全球边缘加速。

## 前提

- 你的域名 NS 已经指向 Cloudflare
- Dokploy 部署完成,在 `https://<ZORR_DOMAIN>` 直接 A 记录指 Dokploy IP 时,游戏能跑

## 1. 配 DNS 记录

Cloudflare 控制台 → 你的 zone → DNS → **+ Add record**

| 字段 | 值 |
|------|-----|
| Type | A |
| Name | `zorr`(或你想要的子域名前缀) |
| IPv4 address | `<Dokploy 主机的公网 IP>` |
| Proxy status | **Proxied**(橙色云,关键) |
| TTL | Auto |

保存。`dig zorr.<your-domain>` 应该返回 Cloudflare 段 IP(104.x.x.x 或 172.x.x.x),
不是 Dokploy 主机的真实 IP。

## 2. SSL 模式

Cloudflare 控制台 → 你的 zone → SSL/TLS → **Overview** → **Full (strict)**

为什么 Full(strict): Dokploy 那边有 Let's Encrypt 的真证书,Cloudflare 到源站
这一段也走 https,严格验证,最干净。

如果暂时只用 Flexible(Cloudflare → 源站走 http),会少一段 TLS,但仍能跑。
推荐 Full (strict)。

## 3. WebSocket 是默认支持的

Cloudflare proxied 域名**默认支持 WebSocket**(所有计划,无开关)。不需要做任何事。
官方文档: https://developers.cloudflare.com/network/websockets

## 4. 100s idle timeout 验证

Cloudflare Free/Pro/Business 计划的 proxied connection 有 **100s 空闲超时**
(WebSocket 没数据 100s 就会被切)。Enterprise 计划可改。

测试方法:
1. 浏览器进游戏,挂机 2 分钟(2x100s,确认能扛过一次潜在超时)
2. DevTools → Network → WS → 那条 ws 连接应该一直保持 "101 Switching Protocols"
   状态,不出现新的 ws 连接(没 reconnect)

**gardn 的客户端在 Socket.cc::send 里游戏 tick 期间持续发包**,只要玩家有任何
输入(移动/转向),都会过 100s 阈值。挂机不动的情况下,服务端 tick 广播也会
让连接保持 active。所以**不需要额外加心跳**。

如果验证发现真的会断:在 `patches/` 加第 4 个补丁,在 `Client/Game.cc` 的主
循环里每 60s 发一个空包给服务端(具体做法届时再写)。当前先观察。

## 5. (可选)WAF / Firewall 规则

如果有人开始来 zorr 上薅你的 DDoS,Cloudflare 控制台 → Security → WAF:
- 加 rate limit: 每个 IP 每秒 < 50 WS message 等
- 加 geo block(如果只想给自己 + 朋友玩,封掉非中国大陆 IP)
- 加 Bot Fight Mode(免费)

这些是可选的,初期不用。

## 故障速查

| 症状 | 大概率原因 |
|------|------------|
| `dig` 返回的是源站 IP | DNS 记录没设成 Proxied(橙色云) |
| 浏览器报 ERR_SSL_PROTOCOL_ERROR | SSL 模式不对。试 Flexible → 能通就改 Full → 再调回 Full (strict) |
| WS 100s 准时断 | Cloudflare 超时打中。见上面 Step 4。 |
| 525 / 526 错误 | Full (strict) 但源站证书有问题。临时改 Full(非 strict)定位。 |
```

- [ ] **Step 2: 提交**

```bash
git add cloudflare/
git commit -m "docs: Cloudflare proxy runbook"
```

---

## Task 10: README 总入口 + 收尾

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README**

```markdown
# zorr

A self-hosted private deployment of [`trigonal-bacon/gardn`](https://github.com/trigonal-bacon/gardn),
a florr.io-style multiplayer game. Containerized, CI-built, deployed via
Dokploy and fronted by Cloudflare.

This repository contains:
- **upstream/gardn/** — gardn pinned as a git submodule (see `UPSTREAM_PIN.txt`)
- **patches/** — three small cosmetic patches applied at build time
- **Dockerfile** — multi-stage build (emscripten → node:alpine)
- **.github/workflows/** — auto-build on push, push image to GHCR
- **dokploy/** — runbook to deploy on Dokploy
- **cloudflare/** — runbook to put Cloudflare proxy in front

## License

This project is AGPL-3.0 (because gardn is). See `LICENSE-NOTICE.md`.

## Quick start: local dev

```bash
git clone --recurse-submodules <this-repo>
cd zorr
docker compose up --build
# First build is slow (~10 min, downloads emscripten/emsdk image).
# Subsequent builds use layer cache.

# Open http://localhost:9001
```

## Quick start: production deploy

1. Push to GitHub → GHA builds & pushes `ghcr.io/<you>/zorr:latest`
2. Configure a new Dokploy app pulling that image — see [dokploy/README.md](dokploy/README.md)
3. Put Cloudflare in front — see [cloudflare/README.md](cloudflare/README.md)

## What's *not* in here

- Gameplay changes (no new mobs/petals/balance tweaks)
- Native uWebSockets server (the WASM-Node server is simpler to containerize;
  native is the documented perf upgrade path)
- Persistence / leaderboards beyond what gardn itself provides

## Updating to a newer gardn

```bash
cd upstream/gardn
git fetch && git checkout <new-sha>
cd ../..
cd upstream/gardn && PIN_SHA=$(git rev-parse HEAD) && cd ../..
echo "Based on gardn commit: $PIN_SHA" > UPSTREAM_PIN.txt
# Re-test that all patches still apply cleanly:
cd upstream/gardn
for p in ../../patches/*.patch; do patch -p1 --dry-run < "$p" || echo "FAILED: $p"; done
# Fix any broken patches by adjusting line numbers / context,
# then commit submodule update + UPSTREAM_PIN.txt.
```
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: top-level README"
```

- [ ] **Step 3: 推送到 GitHub(若上面 Task 7 的 push 步骤还没做)**

```bash
git push origin main
```

Expected: GHA 重新跑,绿勾,GHCR 上有最新镜像。

---

## 整体验收清单

实现完所有任务后,以下都应为真:

- [ ] `docker compose up --build` 在本地能跑,浏览器进游戏,标题显示 "zorr",底色为绿
- [ ] `docker compose up` 跑起来后,从 `http://localhost:9001` 和 `http://127.0.0.1:9001` 都能玩(证明 WS_URL portability 补丁生效)
- [ ] `git push origin main` 后 GHA 走通,GHCR 上 `ghcr.io/<owner>/zorr:latest` 可见
- [ ] `docker pull ghcr.io/<owner>/zorr:latest && docker run -p 9002:9001 ...` 本地能跑
- [ ] Dokploy 应用配好,`https://<ZORR_DOMAIN>` 能访问,标题 "zorr",底色绿,游戏能玩
- [ ] DevTools 看 WS 连接是 `wss://<ZORR_DOMAIN>/`,不是写死的 ws://localhost
- [ ] 挂机 2 分钟连接不断
- [ ] `dig <ZORR_DOMAIN>` 返回 Cloudflare IP,不暴露源站

## 后续(明确不在本计划内)

| 想法 | 下次开 plan 写 |
|------|----------------|
| 上原生 uWebSockets server 提升性能 | 新 Dockerfile target + benchmark |
| 改游戏数值(EntityDef.hh) | 进入"动游戏逻辑"分支,写新一份 spec |
| Cloudflare Containers 作为替代部署后端 | 单独 plan,共用同一镜像 |
| 给 Dokploy 多 region 部署 | 新 spec |
