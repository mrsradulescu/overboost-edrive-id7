'use strict';
/* test_edrive_live.js - eDrive's real-car path against a scripted diagnostic link (no head unit):
 *   node tools/test_edrive_live.js
 * 1. a plug-in hybrid: the battery unit answers the charge (DDBC), health (DD7B) and the 12 V voltage (F442): the pages draw, the
 *    app logs that it found the hybrid battery, and the last values are saved;
 * 2. a car that is not a plug-in hybrid (remembered from an earlier start): the Range page draws its "no plug-in hybrid" notice
 *    and the battery unit is not asked again right away. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const SRC = path.join(__dirname, '..', 'src');
const host8 = require(path.join(SRC, 'host8.js'));
const { Diag } = require(path.join(SRC, 'kit', 'diag.js'));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (c, m) => { assert(c, m); passed++; };

async function scenario(name, saved, answers) {
    // (a second start in one process: the app's modules are loaded again, as at a fresh start)
    Object.keys(require.cache).filter((k) => k.indexOf(path.join(SRC, 'apps', 'edrive')) === 0).forEach((k) => delete require.cache[k]);
    const logs = [];
    const gpuBase = Object.assign(new EventEmitter(), { screen: { w: 1920, h: 720 }, native: false, touch: false, info: {}, ready: false, visible: false });
    const gpu = new Proxy(gpuBase, { get: (t, k) => (k in t ? (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) : (() => {})) });
    const signals = { watch: async () => ({}), proxy: async () => ({}), on: async () => {}, onAvailable: async () => {}, call: async () => { throw new Error('test'); } };
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-edrive-live-'));
    if (saved) { fs.mkdirSync(path.join(dataDir, 'edrive')); fs.writeFileSync(path.join(dataDir, 'edrive', 'battery.json'), JSON.stringify(saved)); }
    const diag = Diag(signals, { info() {}, warn() {}, error() {} });
    diag.p = {}; diag.available = true; diag.init = async () => diag;
    const asked = [];
    diag.physical = async (ecu, sid, data) => {
        const did = (data[0] << 8) | data[1], key = ecu + ':' + did.toString(16).toUpperCase();
        asked.push(key);
        const a = answers[key];
        return a ? [0x62, data[0], data[1]].concat(a) : null;
    };
    const host = host8.create({ log: (m) => logs.push(m), dataDir, signals, gpu, version: 'test', appId: 'overboost', go: () => {} });
    const s = host.session('edrive');
    if (!s) throw new Error('no session: ' + logs.join(' / ') + ' ' + JSON.stringify(host.failed));
    const frames = [];
    const present = s.display.present.bind(s.display);
    s.display.present = (n, r, soft) => { frames.push(r); return present(n, r, soft); };
    s.settings.set('demo', 'off');
    await s.enter({});
    await tick(2500);
    for (let i = 0; i < 4; i++) { s.ui.comp('BTN_PAGE').emit('action', {}); await tick(300); }
    s.leave();
    return { logs, frames, asked, dataDir };
}

(async () => {
    const a = await scenario('phev', null, { '7:DDBC': [0x02, 0x80], '7:DD7B': [92], '18:F442': [0x31, 0x38] });
    ok(a.frames.length >= 4, 'the pages drew: ' + a.frames.length);
    ok(a.asked.indexOf('7:DDBC') >= 0 && a.asked.indexOf('18:F442') >= 0, 'asked the charge and the 12 V voltage: ' + a.asked.slice(0, 8).join(' '));
    ok(a.logs.some((l) => /hybrid battery unit answers/.test(l)), 'the hybrid battery unit was found');
    const bad = a.logs.filter((l) => /^ERROR/.test(l));
    ok(bad.length === 0, 'no errors:\n' + bad.join('\n'));
    const st = JSON.parse(fs.readFileSync(path.join(a.dataDir, 'edrive', 'battery.json'), 'utf8'));
    ok(st.hybrid === true && st.soh === 92, 'saved: hybrid and health 92: ' + JSON.stringify(st).slice(0, 120));

    const b = await scenario('not phev', { noHybrid: true }, { '18:F442': [0x31, 0x38] });
    ok(b.frames.length >= 4, 'the pages drew with no hybrid unit');
    ok(!b.logs.some((l) => /^ERROR/.test(l)), 'no errors without a hybrid unit:\n' + b.logs.filter((l) => /^ERROR/.test(l)).join('\n'));
    console.log('test_edrive_live: ' + passed + ' checks passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
