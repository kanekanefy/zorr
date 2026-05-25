# qa/ — post-deploy smoke test

Headless Playwright runner that calls the `Module._qa_*` hooks (added in
patch 0024, fixed in patch 0025) on the deployed build to confirm core
state — inventory / craft / panels — survives the latest push.

## Run locally

```bash
cd qa
npm install
npx playwright install chromium
node test.mjs                        # tests https://zorr.inglegames.com
QA_HEADED=1 node test.mjs            # visible browser for debugging
QA_URL=http://localhost:8080 node test.mjs
QA_READY_TIMEOUT_MS=90000 node test.mjs
```

Exit code 0 = all pass, 1 = at least one fail. Console output names
each test and lists failures at the end.

## CI

`.github/workflows/qa.yml` runs this after every successful
`Build and Push` workflow on `main`. It waits ~45s for Dokploy to roll
the new image, then invokes the test. On failure it auto-creates a
GitHub issue with the assignee set to the repo owner.

## Why API hooks, not click simulation

The game is a single `<canvas>`. There is no DOM tree for Playwright to
target — `getByRole`, accessibility tree, all empty. Industry SOTA for
canvas-game QA (King, Riot, Roblox, Supercell) is **expose a scripting
API and call it from JS** rather than translating pixel coords back to
game state. That is `Client/QaHooks.cc`. The runner here is the
production consumer.

## Adding a new check

Add a `check(name, condition, detail)` call inside `runTests()`. Group
related checks under one `console.log('[test] …')` header. Keep each
check assertion simple — a failure should point straight at the bug.

If you need a new game-state hook, add an
`extern "C" EMSCRIPTEN_KEEPALIVE` function to `Client/QaHooks.cc` and
list its `_qa_<name>` symbol in `Client/CMakeLists.txt`'s
`EXPORTED_FUNCTIONS`. See patch 0024 for the pattern.

## Closure-compiler gotcha

The release build runs emscripten with `--closure=1`. That renames
top-level `var Module` to a one-letter alias. The test sidesteps this
by `addInitScript`ing `window.Module = window.Module || {}` **before**
navigation, so emscripten's boilerplate (`var Module = window.Module ||
{}`) latches onto our pre-allocated object. Without this you'll see
`Module is not defined`.
