// Legacy dynamic types are explicit during the full language migration.
// Paper versions of training that happened: one finished workout (its detail sheet's "Save as
// PDF"), and the performance report over a stretch of days (Stats, History and Settings > Data).
// The numbers come from lib/report.ts; the page shell, the page-break rules and the printing from
// lib/print-doc.js. Charts are inline SVG drawn here, so they stay sharp at any zoom and print the
// same on every platform. No exercise media is ever put on paper.
import { EXIDX } from './exercises.ts';
import { setLabel, sessionSections, workoutVolume, sessionVolume, countsWarmups, workoutDuration, workoutDay } from './history.ts';
import { isWarmupRow, hasCompletedWork } from './workout-model.ts';
import { fmtNum, fmtVol, fmtDur, fmtDate, todayISO, DAYS, weekOrder, weekDayOffset } from './format.ts';
import { t, tn, dateLocale } from './i18n-core.ts';
import { speedUnitOf } from './speed.ts';
import { printedName } from './plan-share.ts';
import { esc, printShell, printDocument, probeMarks, paperDate } from './print-doc.ts';
import { reportData, workSetsOf } from './report.ts';
/* ----------------------------------- pieces ----------------------------------- */
const nameParts: any = (e?: any) => printedName(EXIDX[e.id], e.n || e.muscleSnapshot?.n || e.id);
function nameHTML(e?: any, { pr = false, short = false }: any = {}) {
    const ex: any = EXIDX[e.id];
    const { name, en, cls }: any = nameParts(e);
    const part: any = ex && ex.bp && ex.bp !== 'cardio' ? ` <span class="part">${esc(t(ex.bp))}</span>` : '';
    // `short`: a row in a long list, where the English line and the spelled-out badge cost a line each.
    const badge: any = pr ? ` <span class="pr">${short ? 'PR' : esc(t('New best'))}</span>` : '';
    return `<div class="ex-n ${cls}">${esc(name)}${part}${badge}</div>`
        + (en && !short ? `<div class="ex-en">${esc(en)}</div>` : '');
}
// Short day + date for lists: "Thu 15 Oct".
const listDate: any = (iso?: any) => (iso ? fmtDate(iso, true) : '');
const clock: any = (ms?: any) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' }) : '');
const signed: any = (n?: any, digits: any = 1) => {
    if (n == null || !Number.isFinite(n))
        return '';
    const r: any = Math.round(n * 10 ** digits) / 10 ** digits;
    return (r > 0 ? '+' : r < 0 ? '−' : '±') + fmtNum(Math.abs(r));
};
// Change against the stretch before, as a small line under a card's number: arrow, the change
// itself and, when there was something before, the percentage ("▲ +3 · 33%"). The arrow and the
// sign carry the meaning, the colour only helps (so it reads the same in grey and to colour-blind
// eyes). Nothing when both stretches are empty.
function delta(now?: any, before?: any, fmt: any = (v?: any) => fmtNum(Math.round(v))) {
    if (now == null || before == null || !(now > 0 || before > 0))
        return '';
    const d: any = now - before;
    if (!d)
        return `<div class="delta flat">± 0</div>`;
    const pct: any = before > 0 ? ` · ${fmtNum(Math.abs(Math.round(d / before * 100)))}%` : '';
    return `<div class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ −'}${esc(fmt(Math.abs(d)))}${pct}</div>`;
}
// A stat card: label, value, an optional line under it.
const card: any = (label?: any, value?: any, sub: any = '') => `<div class="card"><div class="c-l">${esc(label)}</div><div class="c-v">${value}</div>${sub}</div>`;
/* ----------------------------------- charts ----------------------------------- */
// Shared rules: a recessive grid (three hairlines, labelled at the start edge), thin marks, the
// accent only on the mark that matters (the latest bar, the best point), labels in text ink.
const NICE: any = [1, 2, 2.5, 5, 10];
function niceMax(v?: any) {
    if (!(v > 0))
        return 1;
    const p: any = 10 ** Math.floor(Math.log10(v));
    for (const n of NICE)
        if (n * p >= v)
            return n * p;
    return 10 * p;
}
const compact: any = (v?: any) => (v >= 10000 ? fmtNum(Math.round(v / 100) / 10) + 'k' : fmtNum(Math.round(v)));
/** Vertical bars, one per bucket. `bars` = [{ label, value, title }]. */
export function barChartSVG(bars?: any, { w = 680, h = 170, unit = '' }: any = {}) {
    const padL: any = 44, padR: any = 8, padT: any = 12, padB: any = 22;
    const max: any = niceMax(Math.max(0, ...bars.map((b?: any) => b.value)));
    const iw: any = w - padL - padR, ih: any = h - padT - padB;
    const n: any = Math.max(1, bars.length);
    const slot: any = iw / n;
    const bw: any = Math.max(2, Math.min(36, slot * 0.62));
    const y: any = (v?: any) => padT + ih - (v / max) * ih;
    const grid: any = [0, 0.5, 1].map((f?: any) => {
        const v: any = max * f, yy: any = y(v);
        return `<line x1="${padL}" x2="${w - padR}" y1="${yy}" y2="${yy}" class="g${f === 0 ? ' base' : ''}"/><text x="${padL - 6}" y="${yy + 3}" class="ax" text-anchor="end">${esc(compact(v))}</text>`;
    }).join('');
    // Every label when they fit, else every k-th so they never collide.
    const every: any = Math.ceil(n / Math.max(1, Math.floor(iw / 46)));
    const last: any = bars.length - 1;
    const marks: any = bars.map((b?: any, i?: any) => {
        const x: any = padL + slot * i + (slot - bw) / 2;
        const hh: any = Math.max(0, (b.value / max) * ih);
        const r: any = Math.min(3, bw / 2, hh);
        const top: any = padT + ih - hh;
        const shape: any = hh > 0
            ? `<path d="M${x},${padT + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${padT + ih} Z" class="${i === last ? 'bar hot' : 'bar'}"><title>${esc(b.title || '')}</title></path>`
            : '';
        const lab: any = i % every === 0 || i === last ? `<text x="${x + bw / 2}" y="${h - 6}" class="ax" text-anchor="middle">${esc(b.label)}</text>` : '';
        return shape + lab;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(unit)}">${grid}${marks}</svg>`;
}
/** A line over time. `pts` = [{ t, y }] ascending; `from`/`to` fix the time axis (ms). */
export function lineChartSVG(pts?: any, { w = 680, h = 150, from, to, fmt = fmtNum, labels = [] }: any = {}) {
    const padL: any = 44, padR: any = 12, padT: any = 14, padB: any = 22;
    const iw: any = w - padL - padR, ih: any = h - padT - padB;
    if (!pts.length)
        return '';
    const ys: any = pts.map((p?: any) => p.y);
    let lo: any = Math.min(...ys), hi: any = Math.max(...ys);
    if (hi - lo < 1e-9) {
        lo -= 1;
        hi += 1;
    }
    // Round numbers on the axis: two or three steps of 1, 2, 2.5 or 5 × a power of ten.
    const step: any = niceMax((hi - lo) / 2);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    if (hi - lo < step * 2)
        hi = lo + step * 2;
    const ticks: any = [];
    for (let v: any = lo; v <= hi + step / 2; v += step)
        ticks.push(v);
    const t0: any = from ?? pts[0].t, t1: any = Math.max(to ?? pts[pts.length - 1].t, t0 + 1);
    const x: any = (tt?: any) => padL + ((tt - t0) / (t1 - t0)) * iw;
    const y: any = (v?: any) => padT + ih - ((v - lo) / (hi - lo)) * ih;
    const grid: any = ticks.map((v?: any) => {
        const yy: any = y(v);
        return `<line x1="${padL}" x2="${w - padR}" y1="${yy}" y2="${yy}" class="g"/><text x="${padL - 6}" y="${yy + 3}" class="ax" text-anchor="end">${esc(fmt(v))}</text>`;
    }).join('');
    const path: any = pts.map((p?: any, i?: any) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    let best: any = 0;
    pts.forEach((p?: any, i?: any) => { if (p.y > pts[best].y)
        best = i; });
    const dots: any = pts.map((p?: any, i?: any) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${i === best ? 3.6 : 2.2}" class="${i === best ? 'dot hot' : 'dot'}"/>`).join('');
    // Direct labels on the last point and the best one, not on every point.
    const lab: any = (i?: any, above?: any) => {
        const p: any = pts[i];
        const xx: any = Math.min(w - padR, Math.max(padL, x(p.t)));
        const anchor: any = xx > w - padR - 30 ? 'end' : xx < padL + 30 ? 'start' : 'middle';
        return `<text x="${xx}" y="${y(p.y) + (above ? -7 : 13)}" class="val" text-anchor="${anchor}">${esc(fmt(p.y))}</text>`;
    };
    // Above the point, unless the line comes down into it (then below, clear of the line).
    const vlabels: any = [...new Set([best, pts.length - 1])].map((i?: any) => lab(i, i === best || !(i > 0 && pts[i - 1].y > pts[i].y))).join('');
    const xl: any = labels.map(([tt, text]: any, i?: any) => `<text x="${x(tt)}" y="${h - 6}" class="ax" text-anchor="${i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}">${esc(text)}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img">${grid}<path d="${path}" class="line"/>${dots}${vlabels}${xl}</svg>`;
}
/** The consistency calendar: one column per week, one row per weekday, shaded by volume. */
export function calendarSVG(days?: any, ws?: any, { cell = 13, gap = 3 }: any = {}) {
    if (!days.length)
        return '';
    // Two weeks or less: one strip of days, each named under its square.
    if (days.length <= 14) {
        const c: any = 22, g: any = 4;
        const w: any = days.length * (c + g), h: any = c + 16;
        const cells: any = days.map((day?: any, i?: any) => {
            const label: any = new Date(day.d + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'narrow' });
            return `<rect x="${i * (c + g)}" y="0" width="${c}" height="${c}" rx="4" class="l${day.level}"><title>${esc(day.d)}</title></rect>`
                + `<text x="${i * (c + g) + c / 2}" y="${c + 12}" class="ax" text-anchor="middle">${esc(label)}</text>`;
        }).join('');
        return `<svg class="cal" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${cells}</svg>`;
    }
    const first: any = new Date(days[0].d + 'T12:00:00');
    const lead: any = weekDayOffset(first.getDay(), ws);
    const cols: any = Math.ceil((lead + days.length) / 7);
    const left: any = 26, top: any = 4;
    const w: any = left + cols * (cell + gap), h: any = top + 7 * (cell + gap);
    const rows: any = weekOrder(ws).map((d?: any, i?: any) => (i % 2 === 0 ? `<text x="${left - 5}" y="${top + i * (cell + gap) + cell - 3}" class="ax" text-anchor="end">${esc(t(DAYS[d]))}</text>` : '')).join('');
    const cells: any = days.map((day?: any, i?: any) => {
        const k: any = lead + i;
        const cx: any = left + Math.floor(k / 7) * (cell + gap), cy: any = top + (k % 7) * (cell + gap);
        return `<rect x="${cx}" y="${cy}" width="${cell}" height="${cell}" rx="2.5" class="l${day.level}"><title>${esc(day.d)}</title></rect>`;
    }).join('');
    return `<svg class="cal" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${rows}${cells}</svg>`;
}
const CHART_CSS: any = `
  svg.chart { display: block; overflow: visible; }
  svg .g { stroke: #e9ebf0; stroke-width: 1; }
  svg .g.base { stroke: #c9cdd6; }
  svg .ax { font-size: 9px; fill: #8a909d; font-family: inherit; }
  svg .val { font-size: 9.5px; fill: #3b404b; font-weight: 600; font-family: inherit; }
  svg .bar { fill: #6b7180; }
  svg .bar.hot { fill: #4d7c0f; }
  svg .line { fill: none; stroke: #3b404b; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
  svg .dot { fill: #3b404b; stroke: #fff; stroke-width: 1.2; }
  svg .dot.hot { fill: #a3e635; stroke: #3f6212; stroke-width: 1.4; }
  svg.cal { display: block; }
  svg.cal .l0 { fill: #f0f1f4; } svg.cal .l1 { fill: #e2f5bd; } svg.cal .l2 { fill: #bfe57a; }
  svg.cal .l3 { fill: #84cc16; } svg.cal .l4 { fill: #3f6212; }
`;
/* ------------------------------- shared page CSS ------------------------------- */
const REPORT_CSS: any = `
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt; }
  .card { border: 1px solid var(--rule); border-radius: 6pt; padding: 7pt 9pt; min-width: 0; }
  .c-l { font-size: 7pt; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  .c-v { font-size: 15pt; font-weight: 700; letter-spacing: -.01em; margin-top: 1pt; white-space: nowrap; }
  .c-v small { font-size: 8.5pt; font-weight: 500; color: var(--muted); margin-inline-start: 2pt; }
  .c-s { font-size: 7.5pt; color: var(--muted); }
  .delta { font-size: 7.5pt; color: var(--muted); }
  .delta.up { color: var(--lime-ink); }
  .note-line { font-size: 7.5pt; color: var(--faint); margin-top: 4pt; }

  .panel { margin-top: 2pt; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt 14pt; }
  .lift { min-width: 0; }
  .lift-h { display: flex; justify-content: space-between; gap: 6pt; align-items: baseline; }
  .lift-h .ex-n { font-size: 9pt; }
  .lift-c { font-size: 8pt; color: var(--muted); white-space: nowrap; }
  .lift-c b { color: var(--ink-2); }
  .lift-c b.up { color: var(--lime-ink); }

  .facts-row { display: flex; flex-wrap: wrap; gap: 4pt 16pt; margin-top: 6pt; font-size: 8.5pt; color: var(--ink-2); }
  .facts-row b { font-weight: 700; }
  .cal-wrap { display: flex; gap: 18pt; align-items: flex-start; flex-wrap: wrap; }
  .legend { display: flex; gap: 3pt; align-items: center; font-size: 7.5pt; color: var(--faint); margin-top: 4pt; }
  .legend i { display: inline-block; width: 8pt; height: 8pt; border-radius: 2pt; }
  .legend .l0 { background: #f0f1f4; } .legend .l1 { background: #e2f5bd; } .legend .l2 { background: #bfe57a; }
  .legend .l3 { background: #84cc16; } .legend .l4 { background: #3f6212; }
  .keep-next { break-after: avoid; page-break-after: avoid; }

  table.mus td { padding: 2.5pt 6pt 2.5pt 0; border-bottom: 0; }
  table.mus td.m { width: 26%; white-space: nowrap; }
  table.mus td.v { width: 16%; text-align: end; white-space: nowrap; color: var(--muted); }
  .hbar { height: 7pt; border-radius: 2pt; background: #6b7180; }
  .hbar.top { background: #4d7c0f; }

  .ex-n { font-weight: 600; overflow-wrap: anywhere; }
  .ex-n.capitalize { text-transform: capitalize; }
  .ex-n .part { display: inline-block; text-transform: none; color: var(--faint); font-weight: 400; font-size: 8pt; margin-inline-start: 2pt; }
  .ex-n .part::first-letter { text-transform: uppercase; }
  td.num + td.num, th.num + th.num { padding-inline-start: 12pt; }
  .ex-en { color: var(--faint); font-size: 8pt; text-transform: capitalize; overflow-wrap: anywhere; }
  .pr { display: inline-block; font-size: 6.5pt; letter-spacing: .06em; text-transform: uppercase; font-weight: 700;
    color: #3f6212; background: var(--lime-soft); border: 1px solid #d3eba4; border-radius: 3pt; padding: 0 3pt; vertical-align: 1pt; margin-inline-start: 3pt; }

  /* a list's heading, printed as its table's first header row (repeats on the next page) */
  th.t-h { font-size: 7.5pt; letter-spacing: .12em; color: var(--muted); padding: 16pt 0 3pt; border-bottom: 1px solid var(--rule); }
  .panel.list { margin-top: 0; }

  /* one workout in the report's list */
  table.wk { margin-bottom: 8pt; }
  th.wk-h { text-transform: none; letter-spacing: 0; font-size: 9.5pt; color: var(--ink); padding: 7pt 0 3pt; border-bottom: 1px solid var(--ink); }
  th.wk-h .t { font-weight: 700; overflow-wrap: anywhere; }
  th.wk-h .t span { color: var(--muted); font-weight: 500; margin-inline-end: 6pt; }
  th.wk-h .f { float: right; font-size: 8pt; color: var(--muted); font-weight: 400; white-space: nowrap; margin-inline-start: 8pt; }
  [dir="rtl"] th.wk-h .f { float: left; }
  table.wk td { font-size: 8.5pt; padding: 2.5pt 6pt 2.5pt 0; }
  table.wk td.n { width: 38%; }
  table.wk td.n .ex-n { font-weight: 500; }
  table.wk td.s { color: var(--ink-2); }
  td.wk-note { font-size: 8pt; color: var(--muted); font-style: italic; border-bottom: 0; }

  /* one exercise of a single workout */
  .wx { padding: 6pt 0 7pt; border-bottom: 1px solid var(--rule-soft); }
  .wx-h { display: flex; gap: 8pt; align-items: flex-start; }
  .wx-num { flex: none; width: 14pt; height: 14pt; margin-top: 1pt; border-radius: 50%; background: var(--tint); color: var(--muted); font-size: 7pt; font-weight: 700; line-height: 14pt; text-align: center; }
  .wx-main { flex: 1; min-width: 0; }
  .wx-sum { flex: none; font-size: 8pt; color: var(--muted); white-space: nowrap; text-align: end; }
  .sets { margin: 4pt 0 0 22pt; font-size: 0; }
  [dir="rtl"] .sets { margin: 4pt 22pt 0 0; }
  .set { display: inline-block; vertical-align: top; min-width: 23mm; margin: 0 4pt 4pt 0; padding: 3pt 6pt; border: 1px solid var(--rule); border-radius: 4pt; font-size: 8.5pt; }
  [dir="rtl"] .set { margin: 0 0 4pt 4pt; }
  .set .k { display: block; font-size: 6.5pt; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); font-weight: 700; }
  .set .v { font-weight: 600; white-space: nowrap; }
  /* "100×5 (RIR 2)" reads left to right in every language, Arabic included. */
  .set .v, table.wk td.s { unicode-bidi: isolate; direction: ltr; }
  [dir="rtl"] table.wk td.s { text-align: right; }
  .set.warm { border-style: dashed; color: var(--muted); }
  .set.warm .v { font-weight: 500; }
  .set.skip { color: var(--faint); }
  .wx-note { margin: 2pt 0 0 22pt; font-size: 8.5pt; color: var(--ink-2); font-style: italic; }
  [dir="rtl"] .wx-note { margin: 2pt 22pt 0 0; }
  .ss { border-inline-start: 2.5pt solid var(--lime); padding-inline-start: 8pt; margin: 4pt 0; }
  .ss-tag { font-size: 7pt; letter-spacing: .1em; text-transform: uppercase; color: var(--lime-ink); font-weight: 700; padding-top: 5pt; }
  .ss .wx:last-child { border-bottom: 0; }
  .session-note { border-inline-start: 2.5pt solid var(--rule); padding: 4pt 0 4pt 9pt; color: var(--ink-2); font-style: italic; white-space: pre-wrap; }
  ${CHART_CSS}
`;
/* ------------------------------- one workout ------------------------------- */
function workoutUnits(w?: any) {
    const entries: any = w.entries || [];
    return sessionSections(entries).flatMap((s?: any) => s.units).map((u?: any) => u.map((i?: any) => entries[i]).filter(Boolean)).filter((u?: any) => u.length);
}
// The sets of one exercise as small boxes: warm-ups dashed, sets not done faint. Wraps onto as
// many lines as it needs and never runs past the page edge.
function setsHTML(e?: any, speedUnit?: any) {
    let n: any = 0;
    const rows: any = (e.sets || []).map((s?: any) => {
        const warm: any = isWarmupRow(s);
        const done: any = hasCompletedWork(s);
        const key: any = warm ? t('Warm-up') : t('Set {0}', ++n);
        const value: any = done ? setLabel(e.id, s, e.target, speedUnit) : '–';
        return `<div class="set${warm ? ' warm' : ''}${done ? '' : ' skip'}"><span class="k">${esc(key)}</span><span class="v">${esc(value)}</span></div>`;
    });
    return rows.length ? `<div class="sets">${rows.join('')}</div>` : '';
}
function entryVolume(e?: any, S?: any) { return workoutVolume({ entries: [e] }, { warmups: countsWarmups(S) }); }
/**
 * One finished workout on paper: what it was, when, how long and how heavy, then every exercise
 * with every set. Each exercise, and each superset, stays whole on a page.
 */
export function workoutPrintHTML(S?: any, w?: any, { owner = '', probe = false }: any = {}) {
    const m: any = probeMarks(probe);
    const unit: any = S.unit || 'kg';
    const speedUnit: any = speedUnitOf(S);
    const prs: any = new Set(w.prs || []);
    const ms: any = workoutDuration(w);
    const day: any = workoutDay(w);
    const sets: any = workSetsOf(w);
    const vol: any = sessionVolume(w, S);
    const cards: any = [
        ms >= 60000 ? card(t('Duration'), esc(fmtDur(ms))) : '',
        card(t('Sets'), esc(fmtNum(sets))),
        card(t('Volume'), esc(fmtVol(vol, unit))),
        card(t('New bests'), esc(fmtNum(prs.size))),
        w.bw ? card(t('Body weight'), esc(fmtNum(w.bw) + ' ' + unit)) : '',
        card(t('Exercises'), esc(fmtNum((w.entries || []).length))),
    ].filter(Boolean).slice(0, 6);
    let num: any = 0;
    const exHTML: any = (e?: any) => {
        const v: any = entryVolume(e, S);
        const done: any = (e.sets || []).filter((s?: any) => !isWarmupRow(s) && hasCompletedWork(s)).length;
        const sum: any = [t('{0} sets', done), v > 0 ? fmtVol(v, unit) : ''].filter(Boolean).join(' · ');
        return `<div class="wx"><div class="wx-h"><div class="wx-num">${++num}</div><div class="wx-main">${nameHTML(e, { pr: prs.has(e.id) })}</div><div class="wx-sum">${esc(sum)}</div></div>`
            + setsHTML(e, speedUnit)
            + (e.note ? `<div class="wx-note">${esc(e.note)}</div>` : '') + '</div>';
    };
    const units: any = workoutUnits(w);
    const blocks: any = units.map((u?: any, i?: any) => {
        const inner: any = u.length > 1 ? `<div class="ss"><div class="ss-tag">${esc(t('Superset'))}</div>${u.map(exHTML).join('')}</div>` : exHTML(u[0]);
        const head: any = i === 0 ? `${m.h('x0')}<h3 class="sec-h">${esc(t('Exercises'))}</h3>` : '';
        return `<div class="keep">${m.s('x' + i)}${head}${inner}${m.e('x' + i)}</div>`;
    }).join('');
    const note: any = w.note ? `<div class="keep">${m.s('note')}<h3 class="sec-h">${esc(t('Session note'))}</h3><div class="session-note">${esc(w.note)}</div>${m.e('note')}</div>` : '';
    const facts: any = [day ? paperDate(day) : '', [clock(w.start), clock(w.end)].filter(Boolean).join(' – ')];
    const body: any = `<div class="keep">${m.s('cards')}<div class="cards">${cards.join('')}</div>${m.e('cards')}</div>`
        + (blocks || `<p class="none">${esc(t('no sets'))}</p>`) + note;
    return printShell({ title: w.name || t('Workout'), kicker: t('Workout'), facts, owner, date: todayISO(), body, css: REPORT_CSS });
}
/* ---------------------------- the performance report ---------------------------- */
function rangeTitle(r?: any) {
    if (r.kind === '7d')
        return t('Last 7 days');
    if (r.kind === '4w')
        return t('Last 4 weeks');
    if (r.kind === '3m')
        return t('Last 3 months');
    return t('{0} days', r.days);
}
const bucketLabel: any = (b?: any, unit?: any) => {
    const d: any = new Date(b.from + 'T12:00:00');
    if (unit === 'day')
        return d.toLocaleDateString(dateLocale(), { weekday: 'short' }).replace(/\.$/, '');
    if (unit === 'month')
        return d.toLocaleDateString(dateLocale(), { month: 'short' });
    return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'numeric' });
};
function summaryHTML(R?: any, unit?: any) {
    const T: any = R.totals, P: any = R.prev;
    const bw: any = T.bwChange != null
        ? card(t('Body weight'), `${esc(signed(T.bwChange))}<small>${esc(unit)}</small>`, `<div class="c-s">${esc(fmtNum(T.bwStart))} → ${esc(fmtNum(T.bwEnd))} ${esc(unit)}</div>`)
        : card(t('Body weight'), T.bwEnd != null ? `${esc(fmtNum(T.bwEnd))}<small>${esc(unit)}</small>` : '–', `<div class="c-s">${esc(T.bwEnd != null ? t('One weigh-in') : t('No weigh-ins'))}</div>`);
    const cards: any = [
        card(t('Workouts'), esc(fmtNum(T.workouts)), delta(T.workouts, P.workouts)),
        card(t('Volume'), `${esc(compact(T.volume))}<small>${esc(unit)}</small>`, delta(T.volume, P.volume, (v?: any) => `${compact(v)} ${unit}`)),
        card(t('Work sets'), esc(fmtNum(T.sets)), delta(T.sets, P.sets)),
        card(t('Training time'), esc(T.ms >= 60000 ? fmtDur(T.ms) : '–'), delta(T.ms, P.ms, (v?: any) => fmtDur(Math.max(60000, v)))),
        card(t('New bests'), esc(fmtNum(T.prs)), delta(T.prs, P.prs)),
        bw,
    ];
    // The note only when at least one card carries an arrow.
    const note: any = cards.some((c?: any) => c.includes('class="delta')) ? `<div class="note-line">${esc(t('Arrows compare with the {0} days before.', R.range.days))}</div>` : '';
    return `<div class="cards">${cards.join('')}</div>${note}`;
}
function volumeHTML(R?: any, unit?: any) {
    const { unit: per, buckets }: any = R.buckets;
    const bars: any = buckets.map((b?: any) => ({ label: bucketLabel(b, per), value: b.volume, title: `${b.from}: ${fmtVol(b.volume, unit)}` }));
    const title: any = per === 'day' ? t('Volume per day') : per === 'week' ? t('Volume per week') : t('Volume per month');
    return { title, html: barChartSVG(bars, { unit }) + `<div class="note-line">${esc(unit)} · ${esc(t('Work sets only, warm-ups left out.'))}</div>` };
}
function calendarHTML(R?: any) {
    const s: any = R.streak;
    const facts: any = [
        [t('Active days'), `${fmtNum(s.activeDays)} / ${fmtNum(R.range.days)}`],
        [t('Workouts per week'), fmtNum(R.perWeek)],
        [t('Most days in a row'), fmtNum(s.longestDays)],
        [t('Week streak'), fmtNum(s.weeks ?? s.longestWeeks)],
    ];
    const legend: any = `<div class="legend">${esc(t('Less'))} ${[0, 1, 2, 3, 4].map((l?: any) => `<i class="lg l${l}"></i>`).join('')} ${esc(t('More'))}</div>`;
    return `<div class="cal-wrap"><div>${calendarSVG(R.calendar, R.weekStart)}${legend}</div>`
        + `<div class="facts-row" style="flex-direction:column;gap:3pt">${facts.map(([k, v]: any) => `<div>${esc(k)}: <b>${esc(v)}</b></div>`).join('')}</div></div>`;
}
function musclesHTML(R?: any, m?: any) {
    const list: any = R.muscles.worked;
    if (!list.length)
        return `<div class="keep panel"><h3 class="sec-h">${esc(t('Sets per muscle'))}</h3><p class="none">${esc(t('No muscle work in this period.'))}</p></div>`;
    const max: any = list[0].sets || 1;
    const rows: any = list.map((x?: any, i?: any) => `<tr><td class="m">${m.s('mus' + i)}${esc(t(x.name))}${m.e('mus' + i)}</td><td><div class="hbar${i === 0 ? ' top' : ''}" style="width:${Math.max(2, Math.round(x.sets / max * 100))}%"></div></td><td class="v">${esc(t('{0} sets', x.sets >= 0.5 ? fmtNum(Math.round(x.sets)) : '<1'))}</td></tr>`).join('');
    const missed: any = R.muscles.missed.length ? `<div class="note-line">${esc(t('Not trained:'))} ${esc(R.muscles.missed.map((x?: any) => t(x.name)).join(', '))}</div>` : '';
    return `<table class="mus">${headRow(t('Sets per muscle'), 3, 'mus0', m)}<tbody>${rows}</tbody></table>${missed}<div class="note-line">${esc(t('Rounded to whole sets. A set counts fully for its main muscle and partly for the ones that help, so the muscles add up to more than your work sets.'))}</div>`;
}
function liftsHTML(R?: any, unit?: any, range?: any, m?: any) {
    const t0: any = new Date(range.from + 'T00:00:00').getTime(), t1: any = new Date(range.to + 'T23:59:59').getTime();
    return R.lifts.map((l?: any, i?: any) => {
        const e: any = { id: l.id };
        const change: any = l.change != null ? `<b class="${l.change > 0 ? 'up' : ''}">${esc(signed(l.change))} ${esc(unit)}</b>` : '';
        const best: any = l.best ? `${esc(t('Best:'))} ${esc(fmtNum(l.best.y))} ${esc(unit)}` : '';
        const chart: any = l.points.length > 1
            ? lineChartSVG(l.points, { w: 330, h: 120, from: t0, to: t1, labels: [[t0, fmtDate(range.from)], [t1, fmtDate(range.to)]] })
            : `<p class="none small">${esc(t('One session in this period.'))} ${best}</p>`;
        return `<div class="lift keep">${m.s('lift' + i)}<div class="lift-h">${nameHTML(e)}<div class="lift-c">${[change, best].filter(Boolean).join(' · ')}</div></div>${chart}${m.e('lift' + i)}</div>`;
    });
}
// A list's heading as the first row of its table header: a table's header row is printed again
// at the top of every page the table continues on, so the heading can never be left alone at
// the bottom of a page, and a continued list says what it is.
function headRow(title?: any, cols?: any, id?: any, m?: any, more: any = '') {
    return `<thead><tr><th colspan="${cols}" class="t-h">${m.h(id)}${esc(title)}</th></tr>${more}</thead>`;
}
function prsHTML(R?: any, unit?: any, m?: any) {
    const rows: any = R.prs.map((p?: any, i?: any) => {
        const e: any = p.entry || { id: p.id };
        const set: any = p.best ? `${fmtNum(p.best.w)} ${unit} × ${p.best.r}` : (p.entry ? (p.entry.sets || []).filter((s?: any) => !isWarmupRow(s) && hasCompletedWork(s)).map((s?: any) => setLabel(p.id, s, p.entry.target)).slice(-1)[0] || '' : '');
        return `<tr><td style="white-space:nowrap">${m.s('pr' + i)}${esc(listDate(p.d))}${m.e('pr' + i)}</td><td>${nameHTML(e)}</td><td class="num">${esc(set)}</td><td class="num">${p.best ? esc(fmtNum(p.best.est) + ' ' + unit) : '–'}</td></tr>`;
    }).join('');
    return `<table>${headRow(t('New bests'), 4, 'pr0', m, `<tr><th>${esc(t('Date'))}</th><th>${esc(t('Exercise'))}</th><th class="num">${esc(t('Best set'))}</th><th class="num">${esc(t('Est. 1RM'))}</th></tr>`)}<tbody>${rows}</tbody></table>`;
}
function workoutListItem(S?: any, w?: any, unit?: any, speedUnit?: any, m?: any, id?: any, lead: any = '') {
    const prs: any = new Set(w.prs || []);
    const ms: any = workoutDuration(w);
    const facts: any = [ms >= 60000 ? fmtDur(ms) : '', fmtVol(sessionVolume(w, S), unit), t('{0} sets', workSetsOf(w))].filter(Boolean).join(' · ');
    const rows: any = workoutUnits(w).flat().map((e?: any, j?: any) => {
        const sets: any = (e.sets || []).filter((s?: any) => !isWarmupRow(s) && hasCompletedWork(s)).map((s?: any) => setLabel(e.id, s, e.target, speedUnit));
        if (!sets.length)
            return '';
        return `<tr><td class="n">${m.s(id + 'r' + j)}${nameHTML(e, { pr: prs.has(e.id), short: true })}</td><td class="s">${esc(sets.join(', '))}${m.e(id + 'r' + j)}</td></tr>`;
    }).join('');
    const note: any = w.note ? `<tr><td colspan="2" class="wk-note">${esc(w.note)}</td></tr>` : '';
    // One table per workout: it stays on one page when it fits; a workout longer than a page
    // breaks between exercises, and its header row (date, name, totals) comes along to the next.
    // The probe id starts with T-: the check allows such a block to run over, but only from the
    // top of a page, never because it was started near the bottom.
    const end: any = m.e('T-' + id);
    return `<table class="wk keep"><thead>${lead}<tr><th colspan="2" class="wk-h">${m.s('T-' + id)}<span class="f">${esc(facts)}</span><span class="t"><span>${esc(listDate(workoutDay(w)))}</span>${esc(w.name || t('Workout'))}</span></th></tr></thead>`
        + `<tbody>${rows}${note}${end ? `<tr><td colspan="2" style="padding:0;border:0">${end}</td></tr>` : ''}</tbody></table>`;
}
/**
 * The performance report for `range` ('7d' | '4w' | '3m' | 'custom' with from/to, ISO days):
 * summary cards with the change against the stretch before, the charts (volume, consistency
 * calendar, muscles, estimated 1RM of the top lifts, body weight), and the lists (new bests,
 * every workout with its sets).
 */
export function reportPrintHTML(S?: any, { range = '4w', from, to, owner = '', probe = false, today }: any = {}) {
    const m: any = probeMarks(probe);
    const unit: any = S.unit || 'kg';
    const speedUnit: any = speedUnitOf(S);
    const R: any = reportData(S, { range, from, to, today });
    const r: any = R.range;
    // A section: its heading travels with its first block, which stays whole on a page.
    const section: any = (id?: any, title?: any, html?: any) => `<div class="keep panel">${m.s(id)}${m.h(id)}<h3 class="sec-h">${esc(title)}</h3>${html}${m.e(id)}</div>`;
    const parts: any = [];
    parts.push(`<div class="keep">${m.s('summary')}${summaryHTML(R, unit)}${m.e('summary')}</div>`);
    if (!R.workouts.length) {
        parts.push(`<p class="none">${esc(t('No workouts in this period.'))}</p>`);
    }
    else {
        const vol: any = volumeHTML(R, unit);
        parts.push(section('volume', vol.title, vol.html));
        parts.push(section('consistency', t('Consistency'), calendarHTML(R)));
        // Up to eighteen rows: a list that may run over a page, row by row, its heading kept with it.
        parts.push(`<div class="panel list">${musclesHTML(R, m)}</div>`);
        if (R.lifts.length) {
            // Two charts a row; the heading rides with the first row.
            const blocks: any = liftsHTML(R, unit, r, m);
            parts.push(`<div class="keep panel">${m.s('lifts-h')}${m.h('lifts-h')}<h3 class="sec-h">${esc(t('Estimated 1RM, top lifts'))}</h3><div class="two">${blocks.slice(0, 2).join('')}</div>${m.e('lifts-h')}</div>`);
            if (blocks.length > 2)
                parts.push(`<div class="keep two" style="margin-top:8pt">${blocks.slice(2).join('')}</div>`);
        }
    }
    if (R.bodyweight.length > 1) {
        const t0: any = new Date(r.from + 'T00:00:00').getTime(), t1: any = new Date(r.to + 'T23:59:59').getTime();
        const pts: any = R.bodyweight.map((b?: any) => ({ t: b.t, y: b.w }));
        parts.push(section('bw', t('Body weight'), lineChartSVG(pts, { from: t0, to: t1, labels: [[t0, fmtDate(r.from)], [t1, fmtDate(r.to)]] })
            + `<div class="note-line">${esc(unit)} · ${esc(tn('{0} weigh-in', '{0} weigh-ins', R.bodyweight.length))}</div>`));
    }
    // A long list may run over a page: its rows never split and its header row repeats. The heading
    // stays with the first rows (break-after: avoid, and the probe checks it).
    if (R.prs.length)
        parts.push(`<div class="panel list">${prsHTML(R, unit, m)}</div>`);
    if (R.workouts.length) {
        const lead: any = `<tr><th colspan="2" class="t-h">${m.h('T-wk0')}${esc(t('All workouts'))}</th></tr>`;
        R.workouts.forEach((w?: any, i?: any) => parts.push(workoutListItem(S, w, unit, speedUnit, m, 'wk' + i, i === 0 ? lead : '')));
    }
    const facts: any = [`${paperDate(r.from)} – ${paperDate(r.to)}`, tn('{0} workout', '{0} workouts', R.workouts.length)];
    return printShell({ title: rangeTitle(r), kicker: t('Performance report'), facts, owner, date: today || todayISO(), body: parts.join(''), css: REPORT_CSS });
}
/** Print the report (see printDocument): the dialog on the web, the print sheet in the app. */
export function printReport(S?: any, opts?: any) {
    return printDocument(reportPrintHTML(S, opts), t('Performance report'));
}
/** Print one finished workout. */
export function printWorkout(S?: any, w?: any, opts?: any) {
    return printDocument(workoutPrintHTML(S, w, opts), w.name || t('Workout'));
}
