# Patches

应用在 `upstream/gardn/` 之上的纯外观补丁,由 Dockerfile 在 build 阶段
按文件名顺序 `patch -p1` 应用。

| # | 文件 | 作用 |
|---|------|------|
| 0001 | `add-title-and-rebrand.patch` | HTML 加 `<title>zorr</title>`,loading 文案改 "zorr" |
| 0002 | `client-ws-url-from-location.patch` | 客户端 WS URL 从 `window.location` 动态推导(不依赖编译时常量,镜像跨域名可移植) |
| 0003 | `map-background-color.patch` | 地图底色 `0xff987d72`(棕) → `0xff2c8a3e`(绿) |

## 应用方式

Dockerfile 里已经做了。手动应用:

```bash
cd upstream/gardn
for p in ../../patches/*.patch; do patch -p1 < "$p"; done
```

## 重新生成补丁

```bash
cd upstream/gardn
git diff > ../../patches/NNNN-description.patch
git checkout .   # 回退,补丁是唯一真相源
```
