// qa/test.mjs — automated smoke test for deployed zorr build.
//
// Uses the Module._qa_* scripting API exposed by Client/QaHooks.cc
// (patches 0024 + 0025). Industry SOTA for canvas game QA is to call
// game-internal helpers from JS — never simulate clicks against a
// canvas (King / Riot / Roblox / Supercell all do this).
//
// Run locally:
//   npm i -D playwright
//   npx playwright install chromium
//   node qa/test.mjs                       # tests https://zorr.inglegames.com
//   QA_URL=http://localhost:8080 node qa/test.mjs   # override target
//
// Run in CI: see .github/workflows/qa.yml — invoked after each deploy.
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
    // After patch 0024, when WASM finishes init, all _qa_* functions
    // become callable. We poll _qa_dump_state as the readiness signal
    // (patch 0025 made it work end-to-end via UTF8ToString export).
    await page.waitForFunction(
        () => typeof window.Module?._qa_dump_state === 'function',
        { timeout: READY_TIMEOUT_MS, polling: 200 },
    );
}

async function dumpState(page) {
    return page.evaluate(() => {
        window.__qa_state = undefined;
        window.Module._qa_dump_state();
        const raw = window.__qa_state;
        return raw ? JSON.parse(JSON.stringify(raw)) : null;
    });
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

        // ─── Test 2: dump_state populates window.__qa_state ────────
        console.log('\n[test] qa_dump_state populates window.__qa_state');
        const state = await dumpState(page);
        check('__qa_state is an object', state && typeof state === 'object');
        check('state has loadout array',
              Array.isArray(state?.loadout),
              `loadout=${typeof state?.loadout}`);
        check('state has inventory object',
              state?.inventory && typeof state.inventory === 'object',
              `inventory=${typeof state?.inventory}`);
        check('state has alive field (boolean)',
              typeof state?.alive === 'boolean');
        check('state has score field (number)',
              typeof state?.score === 'number');
        check('state has panel_open field (number)',
              typeof state?.panel_open === 'number');

        // ─── Test 3: panel toggles reflect in state ────────────────
        // Ui::Panel enum after patch 0009:
        //   kNone=0, kSettings=1, kPetals=2, kMobs=3, kChangelog=4,
        //   kInventory=5, kCraft=6
        console.log('\n[test] open/close inventory + craft panels');
        const PANEL_NONE = 0, PANEL_INVENTORY = 5, PANEL_CRAFT = 6;

        await page.evaluate(() => window.Module._qa_open_inventory());
        const afterOpenInv = await dumpState(page);
        check('inventory panel open after _qa_open_inventory',
              afterOpenInv?.panel_open === PANEL_INVENTORY,
              `panel_open=${afterOpenInv?.panel_open}`);

        await page.evaluate(() => window.Module._qa_open_craft());
        const afterOpenCraft = await dumpState(page);
        check('craft panel open after _qa_open_craft',
              afterOpenCraft?.panel_open === PANEL_CRAFT,
              `panel_open=${afterOpenCraft?.panel_open}`);

        await page.evaluate(() => window.Module._qa_close_panels());
        const afterClose = await dumpState(page);
        check('panel closed after _qa_close_panels',
              afterClose?.panel_open === PANEL_NONE,
              `panel_open=${afterClose?.panel_open}`);

        // ─── Test 4: craft slot manipulation is observable ─────────
        console.log('\n[test] craft slot ops are observable');
        await page.evaluate(() => {
            window.Module._qa_craft_reset();
            window.Module._qa_open_craft();
        });
        const cleanCraft = await page.evaluate(() => window.Module._qa_craft_slot_count());
        check('craft starts with 0 slots filled',
              cleanCraft === 0,
              `slot_count=${cleanCraft}`);

        // ─── Test 5: inventory count query returns numbers ─────────
        console.log('\n[test] inventory_count returns numeric for all ids');
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
              allNumbers ? '' : `bad value at id ${counts.findIndex((c) => !Number.isFinite(c) || c < 0)}`);

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
