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
const W = 420, P = 18, ROW = 20, ROWS_Y = 156;
const H = ROWS_Y + win.length * ROW + 20;
const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const status = current === min ? 'Billigst' : current === max ? 'Dyrest' : 'Normal';
const badgeText = `Nu: ${status}`;
const badgeW = badgeText.length * 7 + 24;
const trackX = P + 42 + 8, trackW = W - P - 48 - 8 - trackX;

const rows = win.map((e, i) => {
  const y = ROWS_Y + i * ROW;
  const c = color(e.pris);
  const bold = i === 0 ? ' font-weight="600"' : '';
  return `
  <text x="${P + 42}" y="${y + 8}" text-anchor="end" font-size="12" fill="${i === 0 ? C.text : C.muted}"${bold}>${pad(e.hour)}:00</text>
  <rect x="${trackX}" y="${y}" width="${trackW}" height="8" rx="4" fill="${C.track}"/>
  <rect x="${trackX}" y="${y}" width="${(trackW * bar(e.pris) / 100).toFixed(1)}" height="8" rx="4" fill="${c}"/>
  <text x="${W - P}" y="${y + 8}" text-anchor="end" font-size="12" fill="${c}"${bold}>${fmt(e.pris)}</text>`;
}).join('');

const stat = (x, anchor, label, v) => `
  <text x="${x}" y="112" text-anchor="${anchor}" font-size="12" fill="${C.muted}">${label}</text>
  <text x="${x}" y="128" text-anchor="${anchor}" font-size="12" fill="${C.text}">${fmt(v)}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <text x="${P}" y="82"><tspan font-size="64" font-weight="600" letter-spacing="-2" fill="${color(current)}">${fmt(current)}</tspan><tspan dx="8" font-size="14" fill="${C.muted}">kr/kWh</tspan></text>
  <rect x="${W - P - badgeW}" y="46" width="${badgeW}" height="26" rx="13" fill="${color(current)}"/>
  <text x="${W - P - badgeW / 2}" y="63" text-anchor="middle" font-size="12" font-weight="500" fill="${C.text}">${badgeText}</text>
  ${stat(P, 'start', 'Lav', min)}${stat(W / 2, 'middle', 'Snit', avg)}${stat(W - P, 'end', 'Høj', max)}
  ${rows}
  <text x="${W - P}" y="${H - 6}" text-anchor="end" font-size="9" fill="${C.muted}">Opdateret ${pad(nu.h)}:${nu.min}</text>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`Skrev ${OUT}: ${win.length} timer, nu ${fmt(current)} kr/kWh (${status})`);
