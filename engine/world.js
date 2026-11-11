import { clamp, sum, rand, between, pick, nextId } from './util.js';
import { inheritStates } from './inherit.js';
import { issueCurrency } from './money.js';
import { writeLife } from './chronicle.js';
import { ETHNICITIES, FAITHS, givenNames, familyNames, placeName, hashOf } from './names.js';

const SYL = ['ar','ven','tor','mi','sa','lor','ka','zen','ol','ri','dan','ve','gar','su','thal','ne','bor','ha','lin','es','mar','ku','ra','dor','iv','al','pe','ten'];
const ETH = ETHNICITIES, REL = FAITHS;

export const ROLES = ['leader', 'general', 'opposition', 'oligarch'];
export const CLASSES = ['peasants', 'workers', 'middle', 'elite'];
export const RAW = ['grain', 'timber', 'coal', 'iron', 'copper', 'oil', 'phosphate', 'rare'];
export const MADE = ['steel', 'fuel', 'fertilizer', 'machines', 'goods', 'arms'];
export const GOODS = [...RAW, ...MADE];
export const DEPOSITS = ['coal', 'iron', 'copper', 'oil', 'phosphate', 'rare', 'gold'];
export const PLANTS = { steel: 'Steel mill', fuel: 'Refinery', fertilizer: 'Chemical plant', machines: 'Machinery plant', goods: 'Consumer industry', arms: 'Arms factory' };
export const BASE_PRICE = { grain: 10, timber: 6, coal: 5, iron: 7, copper: 14, oil: 9, phosphate: 8, rare: 40, steel: 22, fuel: 18, fertilizer: 16, machines: 60, goods: 25, arms: 45 };
export const GOOD_LABEL = { grain: 'grain', timber: 'timber', coal: 'coal', iron: 'iron', copper: 'copper', oil: 'oil', phosphate: 'phosphate', rare: 'rare metal', gold: 'gold', steel: 'steel', fuel: 'fuel', fertilizer: 'fertilizer', machines: 'machinery', goods: 'consumer goods', arms: 'arms' };
export const TECHS = {
  railway: { name: 'Railway networks', cost: 40, req: [], does: 'second tracks and branch lines can be laid where a line already runs; a province with more railway turns out more, and its lines carry armies and feed them' },
  electricity: { name: 'Electrification', cost: 90, req: [], does: 'farms, mines and works turn out about a twelfth more as they are wired, which takes some six years from the invention; needed for fertilizer, wireless, the search for rare metals, alloys and the all-big-gun ship' },
  automatic_weapons: { name: 'Automatic weapons', cost: 70, req: [], does: 'machine guns: infantry holding a line is worth about a third more, infantry advancing a little more' },
  chemical_fertilizer: { name: 'Chemical fertilizer', cost: 100, req: ['electricity'], does: 'harvests rise by up to two fifths where fertilizer is to hand (it is made from phosphate), over some three years as farmers take to it; needed for modern medicine' },
  oil_prospecting: { name: 'Geological oil prospecting', cost: 60, req: [], does: 'oil can be looked for in the ground and found, and fuel refined from it' },
  combustion_engine: { name: 'Internal combustion engine', cost: 130, req: ['oil_prospecting'], does: 'engines on the land as fast as fuel is found for them (up to a quarter more grain), ships that burn fuel instead of coal, and submarines; needed for armoured vehicles and aircraft' },
  radio: { name: 'Radio broadcasting', cost: 90, req: ['electricity'], does: 'the columns of an offensive keep their timetable better' },
  armor: { name: 'Armored vehicles', cost: 150, req: ['combustion_engine', 'automatic_weapons'], does: 'armoured units can be raised: strong in open country, weak in close, and useless without fuel' },
  aviation: { name: 'Aviation', cost: 170, req: ['combustion_engine'], does: 'air units can be raised, and a staff with aircraft sees troops massing across a frontier sooner' },
  antibiotics: { name: 'Modern medicine', cost: 140, req: ['chemical_fertilizer'], does: 'an army in the field loses half as many men to sickness, and an epidemic kills far fewer' },
  rare_alloys: { name: 'Rare metal alloys', cost: 220, req: ['electricity', 'armor'], does: 'alloys for machine tools, armoured vehicles and aircraft, which from then on ask for rare metals every quarter' },
  dreadnought: { name: 'All-big-gun battleships', cost: 150, req: ['electricity'], does: 'the all-big-gun ship can be laid down in a harbour of the third size: worth two battleships in weight and outranging them' }
};

export const word = w => { let s = ''; const n = 2 + Math.floor(rand(w) * 2); for (let i = 0; i < n; i++) s += pick(w, SYL); return s[0].toUpperCase() + s.slice(1); };

function clipCell(sites, i, W, H) {
  let poly = [[0, 0, -1], [W, 0, -1], [W, H, -1], [0, H, -1]];
  const a = sites[i];
  sites.forEach((b, j) => {
    if (i === j || !poly.length || Math.hypot(a.x - b.x, a.y - b.y) > 320) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = b.x - a.x, ny = b.y - a.y;
    const f = p => (p[0] - mx) * nx + (p[1] - my) * ny;
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length], fp = f(p), fq = f(q);
      if (fp <= 0) out.push(p);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, fp < 0 ? j : p[2]]); }
    }
    poly = out;
  });
  return poly;
}

function makeNoise(w, cells = 7) {
  const n = cells + 2, g = Array.from({ length: n * n }, () => rand(w));
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => { const X = x * cells, Y = y * cells, i = Math.floor(X), j = Math.floor(Y), u = sm(X - i), v = sm(Y - j), at = (a, b) => g[(b % n) * n + (a % n)];
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v; };
}
function fbm(w, base) { const a = makeNoise(w, base), b = makeNoise(w, base * 2), c = makeNoise(w, base * 4); return (x, y) => (a(x, y) * .6 + b(x, y) * .28 + c(x, y) * .12); }

// Plates, elevation, climate and rivers are derived from one another; resources depend on this geology too.
function buildMap(w, target) {
  const W = 1400, H = 900, total = Math.round(target * 2.3);
  const cols = Math.round(Math.sqrt(total * W / H)), rows = Math.round(total / cols);
  const sites = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sites.push({ x: (c + .5 + between(w, -.42, .42)) * W / cols, y: (r + .5 + between(w, -.42, .42)) * H / rows });
  const plates = Array.from({ length: 11 }, () => ({ x: between(w, 0, W), y: between(w, 0, H), land: rand(w) < .6, dx: between(w, -1, 1), dy: between(w, -1, 1) }));
  const nElev = fbm(w, 5), nMoist = fbm(w, 4), nBasin = fbm(w, 6);
  sites.forEach((s, i) => {
    s.i = i; s.poly = clipCell(sites, i, W, H); s.n = new Set(s.poly.map(p => p[2]).filter(j => j >= 0));
    const d = plates.map((p, k) => [Math.hypot(s.x - p.x, s.y - p.y), k]).sort((a, b) => a[0] - b[0]);
    s.plate = d[0][1]; s.boundary = clamp(1 - (d[1][0] - d[0][0]) / 85, 0, 1);
    const pa = plates[d[0][1]], pb = plates[d[1][0] === d[0][0] ? d[0][1] : d[1][1]];
    s.collide = clamp(((pa.dx - pb.dx) * (pb.x - pa.x) + (pa.dy - pb.dy) * (pb.y - pa.y)) / 500 + .3, 0, 1);
    const edge = Math.min(s.x, W - s.x) / W * 5 * Math.min(1, Math.min(s.y, H - s.y) / H * 7);
    s.e = (pa.land ? .5 : .24) + (nElev(s.x / W, s.y / H) - .5) * .75 + s.boundary * s.collide * .42 - (1 - clamp(edge, 0, 1)) * .34;
  });
  sites.forEach(s => s.n.forEach(j => sites[j].n.add(s.i)));
  const sorted = [...sites].sort((a, b) => b.e - a.e);
  const sea = sorted[Math.min(target, sorted.length - 1)].e;
  sorted.slice(0, target).forEach(s => s.land = true);
  const maxE = sorted[0].e;
  for (const s of sites) {
    s.h = s.land ? clamp((s.e - sea) / Math.max(maxE - sea, .01), 0, 1) : 0;
    s.t = clamp(1 - Math.abs(s.y / H - .55) * 1.8 - s.h * .3, 0, 1);
    s.dist = s.land ? 99 : 0;
  }
  for (let k = 0; k < 8; k++) for (const s of sites) if (s.land) for (const j of s.n) s.dist = Math.min(s.dist, sites[j].dist + 1);
  for (const s of sites) if (s.land) s.m = clamp(nMoist(s.x / W, s.y / H) * 1.05 + (3 - Math.min(s.dist, 5)) * .07 - s.h * .05, 0, 1);
  // Rivers flow from high ground to low.
  const lands = sites.filter(s => s.land).sort((a, b) => b.h - a.h);
  for (const s of lands) s.flow = s.m;
  for (const s of lands) {
    const next = [...s.n].map(j => sites[j]).filter(x => !x.land || x.h < s.h).sort((a, b) => (a.land ? a.h : -1) - (b.land ? b.h : -1))[0];
    s.down = next ? next.i : null;
    if (next?.land) next.flow += s.flow;
  }
  return { W, H, sites, lands, nBasin };
}

// Breaks the edge shared by neighboring cells the same way, so coasts and borders look natural.
function roughen(poly) {
  const hash = (a, b) => { const k = [a[0], a[1], b[0], b[1]].map(x => Math.round(x)); const key = (k[0] + k[1] * 3 < k[2] + k[3] * 3) ? k : [k[2], k[3], k[0], k[1]]; const x = Math.sin(key[0] * 12.9898 + key[1] * 78.233 + key[2] * 37.719 + key[3] * 11.13) * 43758.5453; return x - Math.floor(x); };
  let pts = poly.map(p => [p[0], p[1]]);
  for (let round = 0; round < 2; round++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.push(a);
      if (len < 14) continue;
      const h = hash(a, b) - .5, flip = (a[0] + a[1] * 3 < b[0] + b[1] * 3) ? 1 : -1, off = h * len * .34 * flip;
      out.push([(a[0] + b[0]) / 2 + (b[1] - a[1]) / len * off, (a[1] + b[1]) / 2 - (b[0] - a[0]) / len * off]);
    }
    pts = out;
  }
  return pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
}

function terrainOf(s) {
  if (s.h > .72) return 'mountain'; if (s.t < .2) return 'tundra'; if (s.h > .48) return 'hills';
  if (s.m < .36) return 'desert'; if (s.m > .68 && s.h < .14) return 'marsh'; if (s.m > .58) return 'forest'; return 'plains';
}

function depositsFor(w, s, basin) {
  const d = {}, add = (k, chance, known, low, high) => { if (rand(w) < chance) d[k] = { amount: between(w, low, high), rich: between(w, .6, 1.6), known: rand(w) < known, mine: 0 }; };
  const sed = s.h < .4;
  add('coal', (s.h > .15 && s.h < .7 ? .34 : .08), .85, 900, 4200);
  add('iron', .12 + s.boundary * .3, .75, 700, 3200);
  add('copper', s.h > .45 ? .28 : .05, .65, 300, 1600);
  add('gold', s.h > .6 ? .16 : .02, .4, 60, 300);
  add('phosphate', (s.m < .42 || s.dist <= 1) && sed ? .16 : .02, .3, 400, 2000);
  add('rare', s.boundary > .55 && s.h > .35 ? .14 : .01, 0, 80, 500);
  if (sed && basin(s.x / 1400, s.y / 900) > .63) { d.oil = { amount: between(w, 1500, 9000), rich: between(w, 1, 2.4), known: rand(w) < .1, mine: 0 }; }
  for (const k of Object.keys(d)) if (d[k].known && k !== 'rare' && k !== 'oil' && rand(w) < .85) d[k].mine = between(w, .5, 1.2);
  return d;
}

// A background is only an event; what the character makes of it is their own affair. Does not consume world randomness.
const LIFE_COMMON = ['Lost two siblings in a famine and walked from the village to the city.', 'As a child, saw the family lose its land to debt.', 'Spent their youth in exile, working at a printing press in a foreign country.', 'Their father died in a mine accident; went down the pit at twelve.', 'Lost the whole family to an epidemic and grew up in a temple.', 'Studied on a scholarship as the child of a poor clerk.', 'Grew up as the sole heir of a great landowner.', 'The family fled a massacre because it belonged to a minority.', 'Worked as an interpreter for foreign merchants in a port city.', 'Spent childhood with a shepherd clan driven from its pastures by drought.'];
const LIFE_ROLE = {
  leader: ['Served as deputy to a provincial governor and took over the night the governor was overthrown.', 'Spent years abroad as an envoy before coming home to a divided court.', 'Youngest of a large family; the inheritance dispute among the siblings dragged on for years.', 'Joined an uprising when young and served two years in prison.'],
  general: ['Most of the regiment died in a border war; came home with a shrapnel wound.', 'Graduated first from the war college and put down a village uprising on the first posting.', 'Commanded a remote garrison for fifteen years.', 'Captured in war and held two years in an enemy camp.', 'Rose from the ranks to general as the child of a peasant family.'],
  opposition: ['Was jailed for carrying the coffins of friends shot during a strike.', 'Lived seven years in exile and founded a newspaper on returning.', 'Was expelled from university and printed clandestine pamphlets for years.', 'Was dismissed from teaching for political reasons.'],
  oligarch: ['Chartered a ship while working as a dock porter and got rich selling grain during a war.', 'Won a mining concession at cards.', 'Took a business partner to court to save the family bank from bankruptcy.', 'Started a business while acting as the agent of a foreign company.']
};
function lifeOf(w, id, name, role) {
  const pool = [...(LIFE_ROLE[role] || []), ...LIFE_COMMON];
  let h = 7; for (const ch of `${id}|${name}`) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const used = w.lifeUsed ||= [];
  if (pool.every(x => used.includes(x))) used.length = 0;
  for (let i = 0; i < pool.length; i++) { const life = pool[(h + i) % pool.length]; if (!used.includes(life)) { used.push(life); return life; } }
  return pool[h % pool.length];
}

// patch: family (a surname to carry on), age ([youngest, oldest]) and power, for heirs and others who are not drawn at random.
function spawnCharacter(w, cid, role, axes, patch = {}) {
  const id = nextId(w, 'K');
  const t = () => Math.round(between(w, 15, 90));
  const given = pick(w, givenNames(w.countries[cid]?.majorityEth, w.countries[cid]?.majorityRel)), family = pick(w, familyNames(w.countries[cid]?.majorityEth)), [young, old] = patch.age ?? [34, 68];
  w.characters[id] = {
    id, country: cid, role, name: patch.name ?? `${given} ${patch.family ?? family}`, skill: .75 + (hashOf(id) % 61) / 100, alive: true, status: 'free',
    age: Math.round(between(w, young, old)), persona: '', diary: [], outcomes: [], ties: {}, dossiers: {}, ambition: t(), loyalty: role === 'leader' ? 100 : t(), ruthless: t(), greed: t(),
    power: patch.power ?? (role === 'leader' ? 70 : Math.round(between(w, 30, 65))),
    wealth: Math.round(between(w, 10, role === 'oligarch' ? 300 : 40)),
    axes: { econ: axes.econ + between(w, -40, 40), auth: axes.auth + between(w, -40, 40), nation: axes.nation + between(w, -40, 40), faith: axes.faith + between(w, -40, 40) },
    notes: '', lastWake: -99, inbox: []
  };
  w.characters[id].background = lifeOf(w, id, w.characters[id].name, role);
  if (w.lifeReady) writeLife(w, w.characters[id]);
  return w.characters[id];
}
export { spawnCharacter, bfsSea };

export function makeCountry(w, id, patch = {}) {
  return {
    id, alive: true, name: `Region ${id}`, adj: '', ideology: 'Undefined', regime: 'Provisional government', motto: '', colors: ['#888888', '#cccccc'],
    axes: { econ: 0, auth: 0, nation: 0, faith: 0 },
    elections: false, nextElection: 12, pressFreedom: 50, rigging: 0, rate: 1, pegRate: 1, pegTo: null, fxRegime: 'gold', capitalClosed: false, rer: 1, prices: {}, lastSold: {},
    treasury: 0, debt: 0, reserves: 0, money: 0, priceLevel: 1, wageIndex: 1, inflation: .01, realGdp: 0, gdp: 0, unemployment: .08, foodRatio: 1, oreRatio: 1,
    tax: { income: .15, land: .12, business: .18 }, tariff: .08,
    budget: { military: .035, welfare: .03, infrastructure: .02, education: .02, police: .012, administration: .02 },
    armShare: .1, stock: {}, tech: { mil: 1, ind: 1, agri: 1 },
    bureaucracy: 55, corruption: 25, police: 45, intelligence: 40, legitimacy: 55, warExhaustion: 0, arrears: 0, ownership: 0,
    blocs: { army: { sat: 55, power: 30 }, capital: { sat: 55, power: 25 }, workers: { sat: 50, power: 15 }, peasants: { sat: 50, power: 15 }, clergy: { sat: 55, power: 10 }, bureaucracy: { sat: 55, power: 15 } },
    relations: {}, intel: {}, embargo: [], institutions: [], techs: {}, research: { target: null, progress: 0 }, parties: [], rulingParty: null, literacy: 35, courts: 45, unions: true, bankHealth: 70, creditors: {}, rentShare: 0, mods: [], repress: 0, parent: null, history: [], ...patch
  };
}

export function createWorld(cfg) {
  const w = { rng: cfg.seed | 0, seq: 0, turn: 0, status: 'founding', provinces: {}, seas: {}, countries: {}, characters: {}, units: {}, fleets: {}, wars: [], treaties: [], plots: [], epidemics: [], strategic: [], canals: [], routes: {}, tradeFlows: {}, globalPrice: { ...BASE_PRICE }, priceHistory: [], newsThisTurn: [], newsLog: [], debts: [], firms: {}, projects: [], contracts: [], seaRaids: {}, map: null };
  const { W, H, sites, lands, nBasin } = buildMap(w, cfg.provinces);
  const pid = s => `P${s.i}`, sid = s => `D${s.i}`;
  for (const s of sites) {
    if (!s.land) { w.seas[sid(s)] = { id: sid(s), name: '', cx: Math.round(s.x), cy: Math.round(s.y), neighbors: [...s.n].filter(j => !sites[j].land).map(j => `D${j}`), coast: [...s.n].filter(j => sites[j].land).map(j => `P${j}`) }; continue; }
    const terrain = terrainOf(s), river = clamp((s.flow - 1.1) / 4.5, 0, 1.5);
    const fert = ({ plains: 1.15, forest: .75, hills: .7, mountain: .28, desert: .22, marsh: .55, tundra: .25 })[terrain] * between(w, .85, 1.15) + river * .5;
    w.provinces[pid(s)] = {
      id: pid(s), name: word(w), cx: Math.round(s.x), cy: Math.round(s.y), elevation: Math.round(s.h * 100) / 100, moisture: Math.round(s.m * 100) / 100, terrain,
      neighbors: [...s.n].filter(j => sites[j].land).map(j => `P${j}`), seas: [...s.n].filter(j => !sites[j].land).map(j => `D${j}`), coast: [...s.n].some(j => !sites[j].land),
      river: Math.round(river * 100) / 100, downstream: s.down !== null && sites[s.down].land ? `P${s.down}` : null, dam: false,
      fertility: fert, timber: terrain === 'forest' ? between(w, .8, 1.4) : terrain === 'hills' ? .3 : .05, fish: 0, water: clamp(.55 + s.m * .4 + river * .35, .3, 1.3), deposits: depositsFor(w, s, nBasin),
      plants: { steel: 0, fuel: 0, fertilizer: 0, machines: 0, goods: 0, arms: 0 }, rail: 0, port: 0, infra: between(w, .4, .75), devastation: 0, unrest: 15, owner: null, controller: null, eth: null, rel: null, pops: {}
    };
    const p = w.provinces[pid(s)]; if (p.coast) { p.fish = between(w, .3, 1); p.port = rand(w) < .5 ? 1 : 0; }
  }
  w.map = { W, H, polys: Object.fromEntries(lands.map(s => [pid(s), roughen(s.poly)])),
    rivers: lands.filter(s => s.flow > 1.15 && s.down !== null).map(s => [Math.round(s.x), Math.round(s.y), Math.round(sites[s.down].x), Math.round(sites[s.down].y), Math.round(Math.min(s.flow, 14) * 10) / 10]) };

  // The largest landmass is divided among the countries; islands become colonies of the nearest one.
  const ids = Object.keys(w.provinces), seen = new Set(); let main = [];
  for (const id of ids) { if (seen.has(id)) continue; const comp = [], q = [id]; seen.add(id); while (q.length) { const x = q.pop(); comp.push(x); for (const n of w.provinces[x].neighbors) if (!seen.has(n)) { seen.add(n); q.push(n); } } if (comp.length > main.length) main = comp; }
  const dist = (a, b) => Math.hypot(w.provinces[a].cx - w.provinces[b].cx, w.provinces[a].cy - w.provinces[b].cy);
  const seeds = [pick(w, main)];
  while (seeds.length < cfg.countries) seeds.push(main.filter(i => !seeds.includes(i)).sort((a, b) => Math.min(...seeds.map(s => dist(b, s))) - Math.min(...seeds.map(s => dist(a, s))))[0]);
  const cIds = seeds.map((_, i) => `U${i + 1}`), fronts = {}, sizes = {}, cap = Math.ceil(main.length / cfg.countries) + 3;
  seeds.forEach((s, i) => { w.provinces[s].owner = cIds[i]; fronts[cIds[i]] = [s]; sizes[cIds[i]] = 1; });
  for (let changed = true; changed;) { changed = false; for (const c of [...cIds].sort((a, b) => sizes[a] - sizes[b])) { if (sizes[c] >= cap) continue; const opts = fronts[c].flatMap(p => w.provinces[p].neighbors).filter(n => !w.provinces[n].owner); if (!opts.length) continue; const n = pick(w, opts); w.provinces[n].owner = c; fronts[c].push(n); sizes[c]++; changed = true; } }
  // Land the states could not reach by growing (islands, and country hemmed in behind a neighbour) goes to the nearest state, province by
  // province from the nearest shore, but not without bound: a state that already holds a fifth more than an even share takes no more, and
  // the next nearest has it. (When every island went whole to whoever lay nearest, one state in a world was born with three or four times
  // the land of another, and once with sixty provinces against seven.)
  { const even = ids.length / cfg.countries, most = Math.ceil(even * 1.2);
    for (let left = Object.values(w.provinces).filter(p => !p.owner); left.length; left = left.filter(p => !p.owner)) { const held = Object.values(w.provinces).filter(x => x.owner);
      const reach = p => { const by = {}; for (const x of held) { const d = dist(x.id, p.id); if (!(d >= by[x.owner])) by[x.owner] = d; } return Object.entries(by).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)); };
      const next = left.map(p => ({ p, by: reach(p) })).sort((a, b) => a.by[0][1] - b.by[0][1] || (a.p.id < b.p.id ? -1 : 1))[0], to = (next.by.find(([o]) => sizes[o] < most) ?? next.by[0])[0];
      next.p.owner = to; sizes[to]++; }
    // And no state is born a fraction of its neighbours: one left with less than four fifths of an even share by the lie of the land is given
    // frontier provinces of its largest neighbour, nearest its own heartland first, until it has that much or there is nothing to give.
    const least = Math.floor(even * .8), land = id => Object.values(w.provinces).filter(p => p.owner === id);
    for (let guard = 0; guard < ids.length; guard++) { const small = [...cIds].sort((a, b) => sizes[a] - sizes[b] || (a < b ? -1 : 1))[0]; if (sizes[small] >= least) break;
      const mine = new Set(land(small).map(p => p.id)), heart = seeds[cIds.indexOf(small)];
      const give = Object.values(w.provinces).filter(p => p.owner !== small && !seeds.includes(p.id) && sizes[p.owner] > sizes[small] + 1 && p.neighbors.some(n => mine.has(n))).sort((a, b) => sizes[b.owner] - sizes[a.owner] || dist(a.id, heart) - dist(b.id, heart) || (a.id < b.id ? -1 : 1))[0];
      if (!give) break; sizes[give.owner]--; give.owner = small; sizes[small]++; } }
  for (const p of Object.values(w.provinces)) p.controller = p.owner;

  cIds.forEach((id, i) => {
    const c = makeCountry(w, id); w.countries[id] = c;
    const mine = Object.values(w.provinces).filter(p => p.owner === id).sort((a, b) => (b.fertility + b.port + b.river) - (a.fertility + a.port + a.river));
    // The capital stands on the country's main body of land, not on an outlying island; and not on the frontier where the country has anything
    // behind the frontier: of the provinces that lie deepest (three steps from foreign soil if there are any, else two, else wherever it can)
    // it is the best placed, by its land, its harbour and its river. (Four capitals in five lay next to a foreign province, and an army
    // enters a neighbour's country a province a quarter.)
    const body = mainBody(w, mine), deep = p => { const far = { [p.id]: 0 }, q = [p.id]; while (q.length) { const x = q.shift(); if (w.provinces[x].owner !== id) return far[x]; if (far[x] >= 3) continue; for (const n of w.provinces[x].neighbors) if (!(n in far)) { far[n] = far[x] + 1; q.push(n); } } return 3; };
    const depth = Object.fromEntries(mine.map(p => [p.id, body.has(p.id) ? deep(p) : 0]));
    mine.sort((a, b) => body.has(b.id) - body.has(a.id)); const seat = [...mine].sort((a, b) => depth[b.id] - depth[a.id])[0]; mine.splice(mine.indexOf(seat), 1); mine.unshift(seat);
    c.capital = mine[0].id;
    const eth = ETH[i % ETH.length], minor = ETH[(i + 5) % ETH.length], rel = REL[i % REL.length], minorRel = REL[(i + 3) % REL.length];
    mine.forEach((p, k) => {
      const border = p.neighbors.some(n => w.provinces[n].owner !== id);
      p.eth = (border && rand(w) < .4) || !main.includes(p.id) ? minor : eth; p.rel = rand(w) < .2 ? minorRel : rel;
      const n = between(w, 300, 900) * (.45 + p.fertility * .8 + (p.port ? .25 : 0)) * (k === 0 ? 2 : 1);
      p.pops = { peasants: { n: n * .56, sat: 52 }, workers: { n: n * .27, sat: 48 }, middle: { n: n * .14, sat: 55 }, elite: { n: n * .03, sat: 60 } };
      const urban = k === 0 ? 1 : k < mine.length / 3 ? .55 : .2;
      p.plants.goods = urban * between(w, .5, 1); p.plants.steel = (p.deposits.iron || p.deposits.coal) ? urban * between(w, .2, .8) : urban * .1; p.plants.machines = urban * between(w, .1, .4); p.plants.arms = urban * between(w, .1, .4);
      // A works has places for hands in the measure of its size (economy.js extract): as the map makes a country, before anyone has inherited
      // it, the works of every province together have places for all its working people, in the proportions drawn above.
      { const all = Object.values(p.plants).reduce((a, v) => a + v, 0); if (all > 0 && all < 1) for (const k of Object.keys(p.plants)) p.plants[k] /= all; }
      p.rail = rand(w) < urban ? 1 : 0;
    });
    if (mine[0].coast) mine[0].port = 2;
    c.majorityEth = eth; c.majorityRel = rel; c.literacy = between(w, 25, 50);
    c.parties = makeParties(w, c);
    for (const o of cIds) if (o !== id) c.relations[o] = Math.round(between(w, -25, 25));
    for (const r of ROLES) c[r] = spawnCharacter(w, id, r, c.axes).id;
    const men = sum(mine, p => CLASSES.reduce((a, k) => a + p.pops[k].n, 0)) * .012;
    const hubs = [c.capital, ...mine.filter(p => p.neighbors.some(n => w.provinces[n].owner !== id)).slice(0, 2).map(p => p.id)];
    hubs.forEach(pr => makeUnit(w, id, pr, Math.round(men / hubs.length)));
    const port = mine.find(p => p.port && p.seas.length);
    if (port) { const f = makeFleet(w, id, port.seas[0], Math.round(between(w, 8, 20))); f.port = f.home = port.id; }
    bootEconomy(w, c);
  });
  findStrategic(w);
  const taken = new Set();
  // A people has only so many place names; when they run out, new towns are named after old ones, so the search always ends.
  const AGAIN = ['New', 'Upper', 'Lower', 'Old', 'North', 'South', 'East', 'West'];
  for (const p of Object.values(w.provinces)) {
    let name = placeName(p.eth, p.id), n = 0;
    while (taken.has(name)) { const base = placeName(p.eth, `${p.id}#${++n}`); name = n <= 24 ? base : n <= 200 ? `${AGAIN[n % AGAIN.length]} ${base}` : `${base} ${n}`; }
    taken.add(name); p.name = name;
  }
  for (const c of aliveCountries(w)) issueCurrency(c);
  if (!cfg.plainStates) inheritStates(w);
  return w;
}

// The largest stretch of a country's provinces that can be walked without leaving it.
function mainBody(w, provs) {
  const own = new Set(provs.map(p => p.id)), seen = new Set(); let best = new Set();
  for (const p of provs) {
    if (seen.has(p.id)) continue;
    const part = new Set([p.id]), q = [p.id]; seen.add(p.id);
    while (q.length) for (const n of w.provinces[q.pop()].neighbors) if (own.has(n) && !seen.has(n)) { seen.add(n); part.add(n); q.push(n); }
    if (part.size > best.size) best = part;
  }
  return best;
}

function bfsSea(w, from, to, cutoff = 999) {
  const prev = { [from]: null }, q = [from];
  while (q.length) { const x = q.shift(); if (x === to) { const path = []; for (let c = to; c; c = prev[c]) path.unshift(c); return path; } for (const n of w.seas[x].neighbors) if (!(n in prev)) { prev[n] = x; q.push(n); } }
  return null;
}
function bfsLand(w, from, to) {
  const prev = { [from]: null }, q = [from];
  while (q.length) { const x = q.shift(); if (x === to) { const path = []; for (let c = to; c; c = prev[c]) path.unshift(c); return path; } for (const n of w.provinces[x].neighbors) if (!(n in prev)) { prev[n] = x; q.push(n); } }
  return null;
}

function findStrategic(w) {
  const seas = Object.values(w.seas).filter(s => s.coast.length), usage = {}, landUse = {}, provs = Object.values(w.provinces);
  for (let i = 0; i < 90 && seas.length > 1; i++) { const p = bfsSea(w, pick(w, seas).id, pick(w, seas).id); (p || []).slice(1, -1).forEach(x => usage[x] = (usage[x] || 0) + 1); }
  for (let i = 0; i < 90; i++) { const p = bfsLand(w, pick(w, provs).id, pick(w, provs).id); (p || []).slice(1, -1).forEach(x => landUse[x] = (landUse[x] || 0) + 1); }
  const add = (type, ref, name, extra = {}) => w.strategic.push({ id: nextId(w, 'N'), type, ref, name, controller: null, toll: 0, closed: false, ...extra });
  seas.filter(s => s.coast.length >= 3 && s.neighbors.length <= 4).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0)).slice(0, 5).forEach(s => { s.name = `${word(w)} Strait`; add('strait', s.id, s.name); });
  provs.filter(p => ['mountain', 'hills'].includes(p.terrain)).sort((a, b) => (landUse[b.id] || 0) - (landUse[a.id] || 0)).slice(0, 6).forEach(p => add('pass', p.id, `${p.name} Pass`));
  provs.filter(p => p.river > .35).sort((a, b) => (landUse[b.id] || 0) - (landUse[a.id] || 0)).slice(0, 4).forEach(p => add('bridge', p.id, `${p.name} Bridge`));
  provs.filter(p => p.coast).sort((a, b) => (b.river + b.seas.length * -.05 + b.fertility * .2) - (a.river + a.seas.length * -.05 + a.fertility * .2)).slice(0, 6).forEach(p => { p.port = Math.max(p.port, 3); add('port', p.id, `${p.name} Harbor`); });
  provs.filter(p => p.seas.length >= 2).map(p => { let best = 0; for (let i = 0; i < p.seas.length; i++) for (let j = i + 1; j < p.seas.length; j++) { const r = bfsSea(w, p.seas[i], p.seas[j]); best = Math.max(best, r ? r.length : 80); } return [p, best]; }).filter(x => x[1] > 14).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([p]) => add('canal_site', p.id, `${p.name} Canal Route`));
}

function makeParties(w, c) {
  const P = [['Workers\' Movement', { econ: -55, auth: -10, nation: 5, faith: -20 }, 'workers'], ['Land Party', { econ: -10, auth: 15, nation: 20, faith: 35 }, 'peasants'], ['Liberty Union', { econ: 30, auth: -40, nation: -5, faith: -15 }, 'middle'], ['Order and Property', { econ: 65, auth: 35, nation: 25, faith: 15 }, 'elite']];
  return P.map(([name, axes, base]) => ({ id: nextId(w, 'F'), name, axes, base, support: 25, banned: false }));
}

export function makeUnit(w, country, province, men, quality = 1, loyalty = 70, kind = 'infantry') {
  const id = nextId(w, 'B');
  w.units[id] = { id, country, province, men, quality, kind, morale: 65, equip: .8, loyalty, target: null };
  return w.units[id];
}

export function makeFleet(w, country, sea, ships, kind) {
  const id = nextId(w, 'G');
  w.fleets[id] = { id, country, sea, ships, quality: 1, morale: 70, target: null, ...(kind ? { kind } : {}) };
  return w.fleets[id];
}

function bootEconomy(w, c) {
  const provs = Object.values(w.provinces).filter(p => p.controller === c.id);
  const pop = sum(provs, p => CLASSES.reduce((a, k) => a + p.pops[k].n, 0));
  const gdp = sum(provs, p => p.pops.peasants.n * p.fertility * .02 * 10 + p.pops.workers.n * .5 + p.pops.middle.n);
  c.gdp = gdp; c.realGdp = gdp; c.money = gdp * 2; c.debt = gdp * between(w, 1, 1.8); c.treasury = gdp * .1; c.reserves = gdp * between(w, .3, .6);
  c.stock = Object.fromEntries(GOODS.map(g => [g, 0]));
  Object.assign(c.stock, { grain: pop * .012, timber: pop * .002, coal: pop * .004, iron: pop * .002, steel: pop * .002, goods: pop * .004, machines: pop * .0006, arms: pop * .002 });
}

export const countryProvinces = (w, id) => Object.values(w.provinces).filter(p => p.controller === id);
// A man who leaves the army goes back to what he was: to the land or to the works, in the proportion his province has of each. (When they all
// came home as workers, a state could fill its factories by passing its villages through the barracks.)
export function goHome(provs, men) { const hands = sum(provs, p => p.pops.peasants.n + p.pops.workers.n); if (!(men > 0) || !(hands > 0)) return; for (const p of provs) for (const k of ['peasants', 'workers']) p.pops[k].n += men * p.pops[k].n / hands; }
export const provincePop = p => CLASSES.reduce((a, k) => a + (p.pops[k]?.n || 0), 0);
export const atWar = (w, a, b) => w.wars.some(x => x.active && ((x.a.includes(a) && x.b.includes(b)) || (x.b.includes(a) && x.a.includes(b))));
export const hasTreaty = (w, a, b, kind) => w.treaties.some(t => t.active && t.kind === kind && t.parties.includes(a) && t.parties.includes(b));
export const leaderOf = (w, c) => w.characters[c.leader];
export const aliveCountries = w => Object.values(w.countries).filter(c => c.alive);
export const clampRel = v => clamp(v, -100, 100);
