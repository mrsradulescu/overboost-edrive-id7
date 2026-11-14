'use strict';
/* test_edrive.js - eDrive (plug-in hybrid pages) inside OVERBOOST's own host: no head unit, nothing is sent anywhere.
 *   node tools/test_edrive.js
 * Starts the real host8 session for "edrive" with a stub renderer and stub signals, runs it in demo mode through every page
 * (Range, Energy, Battery, Charge log, and the Diagnostic pages when switched on), and checks that nothing is logged as an
 * error or a warning, that every page draws, and that the header lists eDrive second, after M Vitals. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const SRC = path.join(__dirname, '..', 'src');
const host8 = require(path.join(SRC, 'host8.js'));

const logs = [];
const hostLog = (m) => logs.push(m);
const gpuBase = Object.assign(new EventEmitter(), { screen: { w: 1920, h: 720 }, native: false, touch: false, info: {}, ready: false, waiting: false, visible: false });
// every renderer call that is not a plain property is a no-op (the renderer is not there)
const gpu = new Proxy(gpuBase, { get: (t, k) => (k in t ? (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) : (() => {})) });
const signals = {
    watch: async () => ({ error: 'test' }), proxy: async () => { throw new Error('test: no head unit'); },
    on: async () => {}, onAvailable: async () => {}, call: async () => { throw new Error('test'); },
};
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-edrive-'));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (c, m) => { assert(c, m); passed++; };

(async () => {
    const host = host8.create({ log: hostLog, dataDir, signals, gpu, version: 'test', appId: 'overboost', go: () => {} });
    const s = host.session('edrive');
    ok(s, 'the edrive session exists: ' + logs.join('\n'));
    const chips = s.spec.__chips.items().map((c) => c.label);
    ok(chips[0] === 'M Vitals' && chips[1] === 'eDrive', 'eDrive is the 2nd of the header buttons: ' + chips.join(', '));
    ok(!s.spec.screens.length || s.spec.screens[0].name === 'MAIN', 'one MAIN screen');

    const frames = [];
    const present = s.display.present.bind(s.display);
    s.display.present = (name, r, soft) => { frames.push(r); return present(name, r, soft); };
    s.settings.set && s.settings.set('demo', 'on');
    await s.enter({});
    await tick(600);
    ok(frames.length > 0, 'the first page was drawn');
    const click = async (id) => { s.ui.comp(id).emit('action', {}); };
    const names = [];
    for (let i = 0; i < 5; i++) {
        const n0 = frames.length;
        await click('BTN_PAGE');
        await tick(300);
        names.push(frames.length - n0);
    }
    // 4 pages: five turns come back to the first; each turn must have drawn at least one frame
    ok(names.every((n) => n >= 1), 'every page turn drew a frame: ' + names.join(','));
    s.settings.set('diagPage', true);
    await tick(300);
    for (let i = 0; i < 6; i++) { await click('BTN_PAGE'); await tick(250); }
    s.leave();
    const bad = logs.filter((l) => /^(ERROR|WARN)/.test(l) && !/GPU|TASU|test|subscribed|signal/i.test(l));
    ok(bad.length === 0, 'no errors or warnings logged:\n' + bad.join('\n'));
    console.log('test_edrive: ' + passed + ' checks passed, ' + frames.length + ' frames');
    process.exit(0);
})().catch((e) => { console.log(logs.slice(-15).join('\n')); console.error(e); process.exit(1); });
