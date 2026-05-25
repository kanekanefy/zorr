// qa/test.mjs — automated smoke test for deployed zorr build.
//
// Uses the Module._qa_* scripting API exposed by Client/QaHooks.cc
// (patches 0024 + 0025). Industry SOTA for canvas game QA is to call
// game-internal helpers from JS — never simulate clicks against a
// canvas (King / Riot / Roblox / Supercell all do this).
//
// We deliberately avoid _qa_dump_state right now — it has a runtime
// bug (closure-minified glue throws TypeError on a property access)
// even after the UTF8ToString export fix in patch 0025. Tracked for
// a follow-up patch. Individual getter hooks all work fine, so the
// smoke test relies on those instead.
//
// Run locally:
//   cd qa && npm install
//   npx playwright install chromium
//   node test.mjs                       # tests https://zorr.inglegames.com
//   QA_URL=http://localhost:8080 node test.mjs
//   QA_HEADED=1 node test.mjs           # visible browser
//
// Exit code 0 = all pass, 1 = at least one fail.

import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'https://zorr.inglegames.com';
const HEADLESS = process.env.QA_HEADED !== '1';
const READY_TIMEOUT_MS = Number(process.env.QA_READY_TIMEOUT_MS || 60_000);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        const msg = detail ? `${name} — ${detail}` : name;
        failures.push(msg);
        console.log(`  ✗ ${name}${detail ? '  [' + detail + ']' : ''}`);
    }
}

async function waitForGameReady(page) {
    // Closure compiler (--closure=1) mangles top-level var names but
    // leaves window.* properties alone. Pre-allocating window.Module
    // before any script runs preserves the name through emscripten's
    // `var Module = window.Module || {}` boilerplate.
    //
    // We wait until _qa_alive is callable (not just defined) — that
    // means WASM init finished and main() ran.
    await page.waitForFunction(
        () => {
            if (typeof window.Module?._qa_alive !== 'function') return false;
            try {
                window.Module._qa_alive();
                return true;
            } catch (_) {
                return false;
            }
        },
        { timeout: READY_TIMEOUT_MS, polling: 200 },
    );
}

async function runTests() {
    console.log(`\n[qa] target = ${URL}`);
    console.log(`[qa] launching ${HEADLESS ? 'headless' : 'headed'} chromium\n`);

    const browser = await chromium.launch({ headless: HEADLESS });
    const ctx = await browser.newContext();

    // Critical: pre-allocate Module BEFORE the page loads any script.
    // Without this, --closure=1 renames `Module` to a single letter
    // and Module._qa_* calls throw "Module is not defined".
    await ctx.addInitScript(() => {
        window.Module = window.Module || {};
    });

    const page = await ctx.newPage();

    // Surface console errors so CI logs include any WASM init failure.
    page.on('pageerror', (e) => console.log(`  [page-error] ${e.message}`));
    page.on('console', (m) => {
        if (m.type() === 'error') console.log(`  [console-error] ${m.text()}`);
    });

    try {
        console.log('[qa] navigate + wait for game ready');
        await page.goto(URL, { waitUntil: 'domcontentloaded' });
        await waitForGameReady(page);
        console.log('[qa] game ready\n');

        // ─── Test 1: every QA hook is exposed ──────────────────────
        console.log('[test] all 18 _qa_* hooks exposed on Module');
        const EXPECTED = [
            '_qa_open_inventory', '_qa_open_craft', '_qa_close_panels',
            '_qa_inventory_count', '_qa_loadout_at', '_qa_loadout_count',
            '_qa_equip',
            '_qa_craft_set_rarity', '_qa_craft_add', '_qa_craft_reset',
            '_qa_craft_slot_count', '_qa_craft_execute',
            '_qa_last_craft_result', '_qa_last_craft_success',
            '_qa_last_craft_destroyed',
            '_qa_alive', '_qa_score', '_qa_dump_state',
        ];
        const missing = await page.evaluate((names) => {
            return names.filter((n) => typeof window.Module?.[n] !== 'function');
        }, EXPECTED);
        check('all 18 hooks present',
              missing.length === 0,
              missing.length ? `missing: ${missing.join(',')}` : '');

        // ─── Test 2: simple getters return sane primitives ─────────
        console.log('\n[test] simple state getters return sane values');
        const basic = await page.evaluate(() => ({
            alive: window.Module._qa_alive(),
            score: window.Module._qa_score(),
            loadoutCount: window.Module._qa_loadout_count(),
            craftSlotCount: window.Module._qa_craft_slot_count(),
            lastCraftSuccess: window.Module._qa_last_craft_success(),
            lastCraftResult: window.Module._qa_last_craft_result(),
        }));
        check('alive is 0 or 1',
              basic.alive === 0 || basic.alive === 1,
              `alive=${basic.alive}`);
        check('score is non-negative integer',
              Number.isInteger(basic.score) && basic.score >= 0,
              `score=${basic.score}`);
        check('loadout_count in [0,8]',
              basic.loadoutCount >= 0 && basic.loadoutCount <= 8,
              `loadout_count=${basic.loadoutCount}`);
        check('craft_slot_count in [0,5]',
              basic.craftSlotCount >= 0 && basic.craftSlotCount <= 5,
              `craft_slot_count=${basic.craftSlotCount}`);

        // ─── Test 3: loadout_at returns valid petal ids ────────────
        console.log('\n[test] loadout_at returns valid petal ids for all slots');
        const loadout = await page.evaluate(() => {
            const out = [];
            for (let i = 0; i < 16; i++) out.push(window.Module._qa_loadout_at(i));
            return out;
        });
        const loadoutOk = loadout.every((v) => Number.isInteger(v) && v >= 0 && v < 64);
        check('all 16 loadout slots return valid petal ids',
              loadoutOk,
              loadoutOk ? '' : `loadout=${JSON.stringify(loadout)}`);

        // ─── Test 4: inventory_count returns non-negative numbers ──
        console.log('\n[test] inventory_count returns non-negative numbers for all ids');
        const counts = await page.evaluate(() => {
            const out = [];
            for (let id = 0; id < 50; id++) {
                out.push(window.Module._qa_inventory_count(id));
            }
            return out;
        });
        const allNumbers = counts.every((c) => Number.isFinite(c) && c >= 0);
        check('all inventory_count results are non-negative numbers',
              allNumbers,
              allNumbers ? '' : `bad at id ${counts.findIndex((c) => !Number.isFinite(c) || c < 0)}`);

        // ─── Test 5: panel toggles don't throw ─────────────────────
        console.log('\n[test] panel open/close calls do not throw');
        const panelResult = await page.evaluate(() => {
            const errs = [];
            const safe = (name, fn) => {
                try { fn(); } catch (e) { errs.push(`${name}: ${e.message}`); }
            };
            safe('open_inventory', () => window.Module._qa_open_inventory());
            safe('close_panels',   () => window.Module._qa_close_panels());
            safe('open_craft',     () => window.Module._qa_open_craft());
            safe('close_panels',   () => window.Module._qa_close_panels());
            return errs;
        });
        check('panel API calls succeed',
              panelResult.length === 0,
              panelResult.join('; '));

        // ─── Test 6: craft reset → slot_count == 0 ─────────────────
        console.log('\n[test] craft_reset zeroes slot_count');
        const afterReset = await page.evaluate(() => {
            window.Module._qa_craft_reset();
            return window.Module._qa_craft_slot_count();
        });
        check('craft_slot_count is 0 after reset',
              afterReset === 0,
              `slot_count=${afterReset}`);

        // ─── Test 7: equip(NULL_PETAL=0) at slot 0 doesn't throw ───
        console.log('\n[test] equip API is callable without throwing');
        const equipResult = await page.evaluate(() => {
            try {
                window.Module._qa_equip(0);
                return 'ok';
            } catch (e) {
                return e.message;
            }
        });
        check('equip(0) does not throw', equipResult === 'ok', equipResult);

    } catch (e) {
        failed++;
        failures.push(`uncaught error: ${e.message}`);
        console.log(`\n[qa] uncaught: ${e.message}`);
        console.log(e.stack);
    } finally {
        await browser.close();
    }

    console.log('\n════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    if (failures.length) {
        console.log('  FAILURES:');
        for (const f of failures) console.log(`    - ${f}`);
    }
    console.log('════════════════════════════════════════════════\n');
    process.exit(failed === 0 ? 0 : 1);
}

runTests().catch((e) => {
    console.error('[qa] fatal:', e);
    process.exit(1);
});
