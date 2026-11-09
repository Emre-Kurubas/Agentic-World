// Provinces hold mixed peoples. Policy, schooling, war and flight slowly change who lives where.
import { clamp, between, pick } from './util.js';
import { aliveCountries, countryProvinces, provincePop } from './world.js';

export const LANGUAGE_POLICY = ['assimilate', 'tolerate', 'autonomy'];
export const FAITH_POLICY = ['state', 'tolerate', 'secular'];
const LANG_WEIGHT = { assimilate: 1.8, tolerate: 1, autonomy: .5 }, FAITH_WEIGHT = { state: 1.6, tolerate: 1, secular: .7 };

export const groupsOf = p => p.groups?.length ? p.groups : [{ eth: p.eth, rel: p.rel, share: 1 }];
const shareWhere = (p, f) => groupsOf(p).filter(f).reduce((a, g) => a + g.share, 0);
export const minorityShare = (p, c) => shareWhere(p, g => g.eth !== c.majorityEth);
export const faithMinorityShare = (p, c) => shareWhere(p, g => g.rel !== c.majorityRel);

export function culturePenalty(c, p) {
  return minorityShare(p, c) * (Math.max(0, c.axes.nation) * .22 + 3) * LANG_WEIGHT[c.languagePolicy ?? 'tolerate'] + faithMinorityShare(p, c) * (Math.max(0, c.axes.faith) * .18 + 2) * FAITH_WEIGHT[c.faithPolicy ?? 'tolerate'];
}

// Governed by someone of another people or faith costs standing where the state is nationalist or devout.
export function leaderForeignness(w, c) {
  const o = w.characters[c.leader]?.origin; if (!o) return 0;
  return (o.eth !== c.majorityEth ? 3 + Math.max(0, c.axes.nation) * .05 : 0) + (o.rel !== c.majorityRel ? 2 + Math.max(0, c.axes.faith) * .05 : 0);
}

function normalize(p) {
  const total = p.groups.reduce((a, g) => a + g.share, 0) || 1;
  p.groups = p.groups.map(g => ({ ...g, share: g.share / total })).filter(g => g.share > .004).sort((a, b) => b.share - a.share);
  p.eth = p.groups[0].eth; p.rel = p.groups[0].rel;
}

function add(p, eth, rel, share) { const g = p.groups.find(x => x.eth === eth && x.rel === rel); if (g) g.share += share; else p.groups.push({ eth, rel, share }); }

export function initGroups(w) {
  const cs = aliveCountries(w), peoples = cs.map(c => [c.majorityEth, c.majorityRel]);
  for (const p of Object.values(w.provinces)) {
    const c = w.countries[p.controller], border = p.neighbors.some(n => w.provinces[n].controller !== p.controller), main = between(w, border ? .62 : .78, border ? .85 : .96);
    p.groups = [{ eth: p.eth, rel: p.rel, share: main }];
    const [eth, rel] = pick(w, peoples);
    add(p, eth === p.eth ? c.majorityEth : eth, rel, 1 - main);
    normalize(p);
  }
  const FROM = { cunta: 'assimilate', monarsi: 'assimilate', teokrasi: 'tolerate', devrim: 'tolerate', cumhuriyet: 'tolerate', tacir: 'tolerate', tarim: 'tolerate', federasyon: 'autonomy' };
  for (const c of cs) { c.languagePolicy = FROM[c.archetype] ?? 'tolerate'; c.faithPolicy = c.archetype === 'teokrasi' ? 'state' : c.archetype === 'devrim' ? 'secular' : 'tolerate'; }
}

// Part of a people's weight moves with refugees.
export function migrate(from, to, rate) {
  if (!from.groups || !to.groups) return;
  for (const g of from.groups) add(to, g.eth, g.rel, g.share * rate * provincePop(from) / Math.max(provincePop(to), 1));
  normalize(to);
}

const DRIFT = { assimilate: .0025, tolerate: .0004, autonomy: 0 }, FAITH_DRIFT = { state: .002, tolerate: .0003, secular: 0 };

export function cultureStep(w) {
  for (const c of aliveCountries(w)) for (const p of countryProvinces(w, c.id)) {
    if (!p.groups) continue;
    const school = clamp(c.literacy / 50, .3, 1.6), lang = DRIFT[c.languagePolicy ?? 'tolerate'] * school, faith = FAITH_DRIFT[c.faithPolicy ?? 'tolerate'];
    let moved = 0;
    for (const g of p.groups) {
      if (g.eth !== c.majorityEth && lang) { const m = g.share * lang; g.share -= m; moved += m; add(p, c.majorityEth, g.rel, m); }
      if (g.rel !== c.majorityRel && faith) { const m = g.share * faith; g.share -= m; moved += m; add(p, g.eth, c.majorityRel, m); }
    }
    if (moved) normalize(p);
    if (c.languagePolicy === 'assimilate') p.unrest = clamp(p.unrest + minorityShare(p, c) * .5, 0, 100);
    // A people's kin state across the border is a fact the province feels.
    const kin = p.neighbors.map(n => w.countries[w.provinces[n].controller]).find(o => o && o.id !== c.id && o.axes.nation > 40 && groupsOf(p).some(g => g.eth === o.majorityEth && g.eth !== c.majorityEth && g.share > .25));
    if (kin) p.unrest = clamp(p.unrest + .4, 0, 100);
  }
}
