// Tegner elpris-kortet (samme udseende som index.html) som en statisk SVG,
// så det kan vises på skærme der ikke kan køre JavaScript/iframes (fx Marco Cloud via Custom CSS).
// Brug: node scripts/render-elpris-svg.mjs <output.svg>
// Kræver Node 20+ (indbygget fetch). Ingen afhængigheder.

import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'elpris.svg';
const TZ = 'Europe/Copenhagen';
const AREA = 'DK2';

// ─── AFGIFTER OG TARIFFER (samme som index.html) ─────────
const ELAFGIFT     = 0.01;
const TRANSMISSION = 0.14;
const MOMS         = 1.25;
const KORREKTION   = 0.05;
const RADIUS = { lav: 0.1017, normal: 0.1694, hoj: 0.5081 };

function getRadiusTarif(hour) {
  if (hour >= 0 && hour <= 5) return RADIUS.lav;
  if (hour >= 17 && hour <= 20) return RADIUS.hoj;
  return RADIUS.normal;
}
function beregnPris(spotPris, hour) {
  return ((spotPris + ELAFGIFT + TRANSMISSION + getRadiusTarif(hour)) * MOMS) - KORREKTION;
}
// ─────────────────────────────────────────────────────────

const C = { text: '#fff', muted: 'rgba(255,255,255,0.6)', track: 'rgba(255,255,255,0.08)',
            low: '#4ecb8a', mid: '#f0a040', high: '#f05555' };
const MIN_BAR = 25;
const pad = n => String(n).padStart(2, '0');
const fmt = v => v.toFixed(2).replace('.', ',');

// Dato og time i dansk tid, uanset hvilken tidszone serveren kører i
function cphParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, h: Number(p.hour), min: p.minute };
}

// Henter en dag og samler til timepriser (virker både med 24 timer og 96 kvarterer)
async function hentDag(parts) {
  const url = `https://www.elprisenligenu.dk/api/v1/prices/${parts.y}/${parts.m}-${parts.d}_${AREA}.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const byHour = new Map();
  for (const e of data) {
    const h = cphParts(new Date(e.time_start)).h;
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h).push(e.DKK_per_kWh);
  }
  const out = new Map();
  for (const [h, arr] of byHour) out.set(h, arr.reduce((a, b) => a + b, 0) / arr.length);
  return out;
}

const now = new Date();
const nu = cphParts(now);
const today = await hentDag(nu);
if (!today) throw new Error('Kunne ikke hente dagens priser');
const tomorrow = await hentDag(cphParts(new Date(now.getTime() + 24 * 3600 * 1000)));

// Rullende 24-timers vindue fra nuværende time
const win = [];
for (let i = 0; i < 24; i++) {
  const hour = (nu.h + i) % 24;
  const src = nu.h + i >= 24 ? tomorrow : today;
  if (!src || !src.has(hour)) { if (nu.h + i >= 24) break; else continue; }
  win.push({ hour, pris: beregnPris(src.get(hour), hour) });
}
const prices = win.map(e => e.pris);
const min = Math.min(...prices), max = Math.max(...prices);
const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
const current = win[0].pris;

const color = v => { const r = max === min ? 0 : (v - min) / (max - min); return r < 0.33 ? C.low : r < 0.66 ? C.mid : C.high; };
const bar = v => max === min ? MIN_BAR : MIN_BAR + ((v - min) / (max - min)) * (100 - MIN_BAR);

// ─── Layout ──────────────────────────────────────────────
// Stor tekst i to kolonner (12 + 12 timer), så kortet kan læses på afstand,
// også når Marco skalerer billedet ned til widgetens størrelse.
const W = 640, P = 28, GAP = 32, ROW = 38, ROWS_Y = 232;
const PER_COL = 12;
const nRows = Math.min(PER_COL, win.length);
const H = ROWS_Y + nRows * ROW + 28;
const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const status = current === min ? 'Billigst' : current === max ? 'Dyrest' : 'Normal';
const badgeText = `Nu: ${status}`;
const badgeW = badgeText.length * 11 + 36;
const colW = (W - 2 * P - GAP) / 2;
const TIME_W = 62, VAL_W = 58;

const rows = win.map((e, i) => {
  const col = Math.floor(i / PER_COL), r = i % PER_COL;
  const x0 = P + col * (colW + GAP);
  const y = ROWS_Y + r * ROW;
  const c = color(e.pris);
  const bold = i === 0 ? ' font-weight="700"' : '';
  const trackX = x0 + TIME_W + 8, trackW = colW - TIME_W - VAL_W - 16;
  return `
  <text x="${x0 + TIME_W}" y="${y + 13}" text-anchor="end" font-size="21" fill="${i === 0 ? C.text : C.muted}"${bold}>${pad(e.hour)}:00</text>
  <rect x="${trackX}" y="${y + 1}" width="${trackW}" height="12" rx="6" fill="${C.track}"/>
  <rect x="${trackX}" y="${y + 1}" width="${(trackW * bar(e.pris) / 100).toFixed(1)}" height="12" rx="6" fill="${c}"/>
  <text x="${x0 + colW}" y="${y + 13}" text-anchor="end" font-size="21" font-weight="${i === 0 ? 700 : 600}" fill="${c}">${fmt(e.pris)}</text>`;
}).join('');

const stat = (x, anchor, label, v) => `
  <text x="${x}" y="166" text-anchor="${anchor}" font-size="19" fill="${C.muted}">${label}</text>
  <text x="${x}" y="196" text-anchor="${anchor}" font-size="26" font-weight="600" fill="${C.text}">${fmt(v)}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" rx="20" fill="rgba(0,0,0,0.55)"/>
  <text x="${P}" y="118"><tspan font-size="104" font-weight="700" letter-spacing="-3" fill="${color(current)}">${fmt(current)}</tspan><tspan dx="12" font-size="24" fill="${C.muted}">kr/kWh</tspan></text>
  <rect x="${W - P - badgeW}" y="60" width="${badgeW}" height="44" rx="22" fill="${color(current)}"/>
  <text x="${W - P - badgeW / 2}" y="90" text-anchor="middle" font-size="21" font-weight="600" fill="${C.text}">${badgeText}</text>
  ${stat(P, 'start', 'Lav', min)}${stat(W / 2, 'middle', 'Snit', avg)}${stat(W - P, 'end', 'Høj', max)}
  ${rows}
  <text x="${W - P}" y="${H - 10}" text-anchor="end" font-size="14" fill="${C.muted}">Opdateret ${pad(nu.h)}:${nu.min}</text>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`Skrev ${OUT}: ${win.length} timer, nu ${fmt(current)} kr/kWh (${status})`);
