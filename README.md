# zorr

A self-hosted, heavily-modded deployment of [`trigonal-bacon/gardn`](https://github.com/trigonal-bacon/gardn),
a florr.io-style multiplayer game. Containerized via Docker, built in CI,
deployed via Dokploy with push-to-deploy auto-rollout.

**Live (staging):** https://zorr-a97703-64-188-28-149.sslip.io

## What's in here

| Path | 作用 |
|------|------|
| `upstream/gardn/` | gardn pinned as git submodule (pristine; see `UPSTREAM_PIN.txt`) |
| `patches/` | **9 patches** — cosmetic + gameplay (OP mode, bots, mobs, craft) — applied at build time. Each row in [`patches/README.md`](patches/README.md) explains one patch. |
| `Dockerfile` | multi-stage build (`emscripten/emsdk` → `node:20-alpine`) |
| `docker-compose.yml` | local dev shortcut |
| `.github/workflows/` | builds on push to main → publishes to GHCR → triggers Dokploy redeploy webhook |
| `deploy/` | one-shot Dokploy bootstrap script + auto-deploy docs ([`deploy/README.md`](deploy/README.md)) |
| `cloudflare/` | runbook for putting CF proxy in front of a real domain (optional) |
| `docs/` | design specs, plans, handoff materials |
| `AGENTS.md` | **read this if you (human or AI) are about to modify the project** |

## License

AGPL-3.0 (because gardn is). See [`LICENSE-NOTICE.md`](LICENSE-NOTICE.md).

## Quick start: local dev

```bash
git clone --recurse-submodules https://github.com/kanekanefy/zorr.git
cd zorr
docker compose up --build
# First build is slow (~10-15 min, downloads emscripten/emsdk image).
# Subsequent builds are cached.
# Open http://localhost:9001
```

## Quick start: deploy

**Default path (push-to-deploy):** already wired up.

```bash
git push origin main
# → GHA builds wasm + Docker image (~1-3 min, cached)
# → pushes to ghcr.io/kanekanefy/zorr:latest
# → fires Dokploy webhook → container rolls to new image
# Watch: https://github.com/kanekanefy/zorr/actions
```

**First-time setup or override** (rare — only if creating a new Dokploy app, changing the image source, or adding a domain):

```bash
source deploy/.secrets   # gitignored — contains DOKPLOY_URL + DOKPLOY_API_KEY
./deploy/dokploy-deploy.sh
```

For a real domain via Cloudflare proxy, see [`cloudflare/README.md`](cloudflare/README.md).

## Updating gardn upstream

```bash
cd upstream/gardn
git fetch && git checkout <new-sha>
cd ../..

# Verify patches still apply
cd upstream/gardn
for p in ../../patches/*.patch; do patch -p1 --dry-run < "$p" || echo "BROKEN: $p"; done
git reset --hard HEAD; git clean -fdx   # revert dry-run side effects

# If broken, edit the .patch files (typically just @@ line numbers / context)
# until dry-run passes. See AGENTS.md → "Patch workflow" for the stash dance
# used to generate clean incremental diffs.

# Update pin
cd upstream/gardn && PIN=$(git rev-parse HEAD) && cd ../..
echo "Based on gardn commit: $PIN" > UPSTREAM_PIN.txt
git add upstream/gardn UPSTREAM_PIN.txt patches/
git commit -m "chore: bump gardn to $PIN"
```

## What zorr adds on top of vanilla gardn

| # | Feature | Patch |
|---|---|---|
| 0001 | Title rebrand → "zorr" | cosmetic |
| 0002 | WS URL from `window.location` (cross-domain portable) | cosmetic |
| 0003 | Green map background (was brown) | cosmetic |
| 0004 | **Super Fun Mode** — XP×8, HP×5, dmg×20, drop×8, density×3, 8 slots, bot bonus drops | gameplay |
| 0005 | Auto-equip starter loadout on first spawn | gameplay |
| 0006 | **30 AI bots** (20 rookie / 7 competitor / 3 veteran, FSM AI, follow + engage players) | gameplay |
| 0007 | New mob: **Starfish** (pink stationary) | content |
| 0008 | New mobs: **Jellyfish + Mushroom + BubbleMob** (3 mechanics: high-dmg, poison, glass-cannon) | content |
| 0009 | **Persistent inventory + lottery craft** (5 same-rarity → 1 random next-rarity, success [60,45,30,20,12,6,3]%, fail destroys 1-4, all client-side via localStorage) | system |

## Architectural notes

- **Patches over forks.** gardn submodule stays pristine; all changes live in `patches/*.patch`. Lets us rebase onto upstream cleanly. See `AGENTS.md` for the patch-generation workflow.
- **WASM-Node server mode.** Server is C++ compiled with Emscripten to WASM, then `node` runs it (no native uWebSockets build chain). Simpler container, ~30% slower than native — acceptable for current scale.
- **No external persistence.** Inventory + settings live in client-side `localStorage` via existing `Client/Storage.cc`. No DB, no auth, no leaderboard server.
- **Reference research locally only.** `docs/hornex-reference/` (gitignored) contains design notes from studying `sandbox.hornex.pro`. See its own README for legal notes — that material is NOT redistributed.

## Attribution

Built on top of [`trigonal-bacon/gardn`](https://github.com/trigonal-bacon/gardn). Original game design heavily inspired by the closed-source `florr.io` by M28 — this is fan / educational work, not affiliated with or endorsed by florr.io's author. The "fun mode" balancing, AI bots, new mobs, and craft system are zorr-specific.
