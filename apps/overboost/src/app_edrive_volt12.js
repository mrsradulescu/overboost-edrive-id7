'use strict';
/**
 * The 12 V battery's voltage for the Range page (the only 12 V thing OVERBOOST's eDrive keeps).
 * Read with UDS from the first candidate in config.battery.v12 that answers; the one that answered is
 * asked first next time (and remembered). After 3 misses in a row all candidates are tried again, and after
 * 3 failed rounds only every few minutes (a unit that is not there holds the link for its timeout).
 *
 *   const v = require("./volt12')({ log, reader, exclusive, live, st, save, cfg })
 *   v.readVolt(force) -> volts or null  (also sets live.v12 / live.v12T)
 */
const G = require('./kit_gauges.js');

const VOLT_TIMEOUT_MS = 1500;     // one candidate's wait (the kit's 4 s is for one-off reads)
const DIAG_OPTS = { retryBaseMs: 150, pendingTimeoutMs: 1500, callTimeoutMs: 2000 };
const MISS_LIMIT = 3;             // misses in a row of the source that worked before the others are tried
const RETRY_MS = 5 * 60000;       // after three failed rounds: the next one after this

module.exports = function startVolt(sh) {
    const { log, reader, exclusive, live, st, save, cfg } = sh;
    const vs = { pick: G.isNum(st.v12Pick) ? st.v12Pick : null, miss: 0, fails: 0, tryT: 0, res: {} };
    // search order: those that answered before, untried ones, refused / FF, and last the ones that never reply
    const RANK = { ok: 0, new: 1, nrc: 2, bad: 2, none: 3 };

    async function readVolt(force) {
        const list = (cfg.v12 || []).map((c) => Object.assign({ timeoutMs: VOLT_TIMEOUT_MS, diagOpts: DIAG_OPTS }, c));
        if (!list.length) return null;
        const now = Date.now();
        if (!force && vs.fails >= 3 && now - vs.tryT < RETRY_MS) return null;
        vs.tryT = now;
        const one = async (i) => {
            // urgent: the voltage goes ahead of the other reads waiting for the link
            const v = await exclusive(() => reader.read(list[i]), true, 'v12');
            const r = reader.raws[reader.key(list[i])], why = (r && r.why) || '';
            vs.res[i] = v !== null ? 'ok' : /^NRC/.test(why) ? 'nrc' : /no reply/.test(why) ? 'none' : 'bad';
            return v;
        };
        let v = null;
        const p = vs.pick !== null && list[vs.pick] ? vs.pick : null;
        if (p !== null) {
            v = await one(p);
            if (v !== null) vs.miss = 0;
            else if (++vs.miss < MISS_LIMIT) return null;
        }
        if (v === null) {
            const order = list.map((c, i) => i).filter((i) => i !== p)
                .sort((a, b) => RANK[vs.res[a] || 'new'] - RANK[vs.res[b] || 'new'] || a - b);
            if (p !== null) order.push(p);
            for (const i of order) {
                v = await one(i);
                if (v !== null) {
                    vs.pick = i; vs.miss = 0;
                    if (st.v12Pick !== i) { st.v12Pick = i; save(); log.info('12 V from ' + reader.key(list[i])); }
                    break;
                }
            }
        }
        reader.pick.v12 = vs.pick;
        if (v === null) { vs.fails++; return null; }
        vs.fails = 0;
        live.v12 = v; live.v12T = Date.now();
        return v;
    }
    return { readVolt };
};
