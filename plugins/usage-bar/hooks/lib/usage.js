// usage-bar 의 계산 — 순수 함수($ 없음).
// register.js 가 엔진에서 받은 값(session.measure · $.session.usage · turn.complete)을
// 띠(band.js)와 글자 요약(/usage-bar status)이 같이 쓰는 한 묶음(model)으로 바꾼다.
// 지금 시각(now)은 밖에서 받는다 — 시험이 시계를 고를 수 있게.

export const FIVE_HOURS = 5 * 3600000;
export const SEVEN_DAYS = 7 * 86400000;

/** 밝은 · 어두운 화면 둘 다에서 보이는 중간 톤(crew-mode v0.3 의 C) — 막대에만 쓴다. 글자 색은 테마 키 */
export const C = { blue: '#3b82f6', amber: '#e09a1a', red: '#e5484d', gray: '#8a8a93', track: '#8a8a9333' };

/** 이름 칸 폭(칸) — 세 줄의 막대 · 글자가 같은 세로줄에서 시작한다 */
export const LABEL_CELLS = 9;
/** 막대 칸 수(넉넉할 때) */
export const BAR_CELLS = 16;

/**
 * @typedef {{ kind: string, percentUsed: number, resetsAt?: string }} Rate 공식 한도 창 하나(types/index.d.ts 의 UsageBarRate)
 * @typedef {{ tokens: number | null, window: number | null, percent: number | null }} Ctx 컨텍스트 창
 * @typedef {{ rateLimits: Rate[], context: Ctx | null, costUsd: number | null }} Measure $.state 의 measure(UsageBarMeasure)
 * @typedef {{ v: 1, sessionId: string | null, in: number, out: number, cr: number, cc: number }} Convo $.state 의 convo(UsageBarConvo)
 * @typedef {{ t: string, bold?: boolean, dim?: boolean, color?: string }} Part 한 줄의 글자 조각
 * @typedef {{ known: boolean, note?: string, used?: number, rem?: number, level?: string, until?: string, elapsed?: number | null, fast?: boolean }} Win 띠의 한도 줄 하나
 */

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : 0);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ---- 단계 · 색 -------------------------------------------------------------------------------------

/** 남은 양(%) → 단계: 35 이상 넉넉(파랑) · 12 이상 빠듯(주황) · 그 아래 바닥(빨강) */
export const levelOf = (rem) => (rem >= 35 ? 'ok' : rem >= 12 ? 'low' : 'out');
export const LEVEL_HEX = { ok: C.blue, low: C.amber, out: C.red };
/** 남은 % 글자 색(테마 키). 넉넉하면 기본 글자색 그대로 */
export const LEVEL_TEXT = { ok: undefined, low: 'warning', out: 'error' };

// ---- 숫자 글자 -------------------------------------------------------------------------------------

/** 412000 → "412k", 1240000 → "1.2M" */
export function fmtTok(x) {
  const n = Math.max(0, num(x));
  if (n >= 999950000) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 999500) return n >= 9950000 ? `${Math.round(n / 1e6)}M` : `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

/** 3.2 → "$3.20" */
export function fmtUsd(x) {
  const n = Math.max(0, num(x));
  if (n > 0 && n < 0.005) return '$0.01 미만';
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

/** 남은 시간 → "2시간 10분". 분 단위로 올린다(1분마다 다시 그려도 "0분" 이 나오지 않게) */
export function untilText(ms) {
  if (!isNum(ms) || ms <= 0) return '';
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins}분`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}시간 ${m}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
}

/** 모델 id → 사람이 읽는 이름. claude-opus-4-5-20251101 → Opus 4.5, opus[1m] → Opus (1M) (v0.3 그대로) */
export function prettyModel(id) {
  const raw = String(id ?? '').trim();
  if (!raw) return null;
  const big = /\[1m\]|-1m\b/i.test(raw) ? ' (1M)' : '';
  const s = raw.toLowerCase().replace(/\[[^\]]*\]/g, '');
  const fam = /(opus|sonnet|haiku)/.exec(s)?.[1];
  if (!fam) return raw;
  const name = fam.charAt(0).toUpperCase() + fam.slice(1);
  // 새 이름(claude-opus-4-5)은 계열 뒤에, 옛 이름(claude-3-5-haiku)은 앞에 버전이 온다. 날짜(8자리)는 버전이 아니다.
  const after = new RegExp(`${fam}[-_ ]?(\\d{1,2})(?:[-.](\\d{1,2}))?(?!\\d)`).exec(s);
  const before = new RegExp(`(?:^|[^\\d])(\\d)(?:[-.](\\d))?[-_ ]${fam}`).exec(s);
  const v = after || before;
  const ver = v ? (v[2] != null ? `${v[1]}.${v[2]}` : v[1]) : '';
  return `${name}${ver ? ' ' + ver : ''}${big}`;
}

/** seven_day_opus → "Opus 주간", spend_limit → "지출" */
export function limitLabel(kind) {
  if (kind === 'spend_limit') return '지출';
  const k = String(kind);
  const rest = k.replace(/^seven_day_?/, '').replace(/^five_hour_?/, '').replace(/_/g, ' ') || '기타';
  return rest.replace(/^./, (c) => c.toUpperCase()) + (k.startsWith('five_hour') ? ' 5시간' : ' 주간');
}

/** 터미널 칸 폭(한글 · 전각은 2칸) — 글자 요약의 줄 맞춤용 */
export const cellWidth = (s) => [...String(s)].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);

// ---- 막대 --------------------------------------------------------------------------------------------

/** 남은 % → 찬 칸 수. 0 보다 크면 한 칸은 보이고, 100 보다 작으면 한 칸은 빈다(가득 · 텅 빈 것과 헷갈리지 않게) */
export function filledCells(pct, cells) {
  if (!(pct > 0)) return 0;
  if (pct >= 100) return cells;
  return clamp(Math.round((pct / 100) * cells), 1, cells - 1);
}

/** 터미널 · 글자 요약의 글자 막대 ▰▰▰▱▱ */
export function textBar(pct, cells) {
  const n = filledCells(pct, cells);
  return { on: '▰'.repeat(n), off: '▱'.repeat(cells - n) };
}

/** 숫자 칸(오른쪽 맞춤, "100%" 까지) · 단위 칸("남음" · "토큰") · 칸 사이 */
export const NUM_CELLS = 4;
export const UNIT_CELLS = 4;
export const GAP_CELLS = 3;
/** 설명 칸이 적어도 이만큼은 남게 막대를 줄인다 */
const DETAIL_MIN = 14;

/** 폭(칸)에 맞춘 막대 칸 수: 넉넉하면 16, 좁으면 줄이고 6 아래로는 줄이지 않는다(설명 쪽이 끝을 줄인다) */
export function barCells(cols) {
  const c = isNum(cols) && cols > 0 ? cols : 72;
  return clamp(Math.floor(c) - LABEL_CELLS - GAP_CELLS - (NUM_CELLS + 1 + UNIT_CELLS) - GAP_CELLS - DETAIL_MIN, 6, BAR_CELLS);
}

// ---- 한도 창 ----------------------------------------------------------------------------------------------

/**
 * 공식 한도 창 하나(SessionRateLimit) → { used, rem, level, until, elapsed, fast }.
 * 값이 없으면 null, 리셋 시각이 이미 지났으면(옛 값) { stale: true } — 0% 라고 단정하지 않는다.
 */
export function rateView(r, now, windowMs) {
  if (!r || !isNum(r.percentUsed)) return null;
  const t = typeof r.resetsAt === 'string' ? Date.parse(r.resetsAt) : NaN;
  const resetsAt = Number.isFinite(t) ? t : null;
  if (resetsAt != null && resetsAt <= now) return { stale: true };
  const used = clamp(Math.round(r.percentUsed), 0, 100);
  const rem = 100 - used;
  const elapsed = resetsAt != null && windowMs ? clamp(Math.round(100 * (1 - (resetsAt - now) / windowMs)), 0, 100) : null;
  return {
    used,
    rem,
    level: levelOf(rem),
    resetsAt,
    until: resetsAt != null ? untilText(resetsAt - now) : '',
    elapsed,
    // 쓴 양이 지난 시간보다 5 넘게 앞서면 "빨리 쓰는 중"
    fast: elapsed != null && used > elapsed + 5,
  };
}

// ---- 이 대화의 토큰(turn.complete 의 usage 합, 서브에이전트 포함) -------------------------------------------

/** @type {1} */
export const CONVO_V = 1;
/** @param {string | null | undefined} sessionId @returns {Convo} */
export const emptyConvo = (sessionId) => ({ v: CONVO_V, sessionId: sessionId ?? null, in: 0, out: 0, cr: 0, cc: 0 });
/** @param {unknown} c @returns {c is Convo} */
export const isConvo = (c) => Boolean(c) && typeof c === 'object' && /** @type {{ v?: unknown }} */ (c).v === CONVO_V;

/**
 * 턴 하나의 usage(ModelUsage)를 더한다 — 새 값을 돌려준다(입력은 그대로)
 * @param {unknown} c @param {any} u @returns {Convo}
 */
export function addUsage(c, u) {
  const base = isConvo(c) ? c : emptyConvo(null);
  if (!u || typeof u !== 'object') return base;
  return {
    ...base,
    in: base.in + Math.max(0, num(u.input_tokens)),
    out: base.out + Math.max(0, num(u.output_tokens)),
    cr: base.cr + Math.max(0, num(u.cache_read_input_tokens)),
    cc: base.cc + Math.max(0, num(u.cache_creation_input_tokens)),
  };
}

/** 새로 쓴 토큰 = 입력 + 출력 + 캐시 쓰기 (캐시에서 다시 읽은 양은 빼고 센다) @param {unknown} c */
export const freshTokens = (c) => (isConvo(c) ? c.in + c.out + c.cc : 0);

/**
 * 같은 세션이면 그대로(리로드 뒤에도 합이 남는다), id 를 모르던 값이면 이 세션 것으로, 다른 세션이면 0 에서.
 * id 를 못 읽었으면(null) 건드리지 않는다.
 * @param {unknown} c @param {string | null} id @returns {Convo}
 */
export function adoptConvo(c, id) {
  if (!id) return isConvo(c) ? c : emptyConvo(null);
  if (!isConvo(c)) return emptyConvo(id);
  if (c.sessionId === id) return c;
  return c.sessionId == null ? { ...c, sessionId: id } : emptyConvo(id);
}

// ---- 엔진 값 → $.state 에 둘 값 ----------------------------------------------------------------------------

/**
 * session.measure 의 e 나 $.session.usage() 의 답 → { rateLimits, context, costUsd } (JSON 만, undefined 없음)
 * @param {any} u @returns {Measure | null}
 */
export function measureOf(u) {
  if (!u || typeof u !== 'object') return null;
  const rateLimits = (Array.isArray(u.rateLimits) ? u.rateLimits : [])
    .filter((r) => r && typeof r.kind === 'string' && isNum(r.percentUsed))
    .map((r) => (typeof r.resetsAt === 'string' ? { kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt } : { kind: r.kind, percentUsed: r.percentUsed }));
  const cx = u.context && typeof u.context === 'object' ? u.context : null;
  const context = cx ? { tokens: isNum(cx.tokens) ? cx.tokens : null, window: isNum(cx.window) ? cx.window : null, percent: isNum(cx.percent) ? cx.percent : null } : null;
  const costUsd = u.cost && isNum(u.cost.usd) ? u.cost.usd : null;
  return { rateLimits, context, costUsd };
}

// ---- 띠 한 묶음 -------------------------------------------------------------------------------------------

/** 값이 없을 때의 말 — %를 지어내지 않는다 */
export const NOTE = {
  wait: '값 없음 — 첫 응답 뒤에 나와요',
  none: '값 없음 — 구독 계정에서만 나와요',
  stale: '리셋됐어요 — 다음 응답 뒤에 나와요',
  plain: '값 없음',
};

/**
 * 띠 · 글자 요약이 그릴 값 한 묶음.
 * @param {{ measure: Measure | null | undefined, convo: unknown, now: number }} input
 */
export function bandModel({ measure, convo, now }) {
  /** @type {Partial<Measure>} */
  const m = measure || {};
  const limits = Array.isArray(m.rateLimits) ? m.rateLimits : [];
  const by = new Map(limits.map((r) => [r.kind, r]));
  const tokens = freshTokens(convo);
  const cx = m.context || null;
  const responded = tokens > 0 || (cx != null && isNum(cx.tokens)) || limits.length > 0;
  const official = by.has('five_hour') || by.has('seven_day');
  // 아직 응답 전이면 기다리라고, 응답이 왔는데도 한도 값이 없으면 구독 계정이 아닌 것(API 키 · 클라우드 공급자)
  const why = official ? 'plain' : responded ? 'none' : 'wait';
  /** @param {string} kind @param {number} ms @returns {Win} */
  const win = (kind, ms) => {
    const v = rateView(by.get(kind), now, ms);
    if (v && !v.stale) return { known: true, ...v };
    return { known: false, note: v && v.stale ? 'stale' : why };
  };
  const five = win('five_hour', FIVE_HOURS);
  const week = win('seven_day', SEVEN_DAYS);
  // 두 줄이 같은 까닭으로 비면 설명은 위 줄에만(같은 말을 두 번 하지 않는다)
  if (!five.known && !week.known && five.note === week.note) week.note = 'plain';

  let ctxPct = null;
  if (cx && isNum(cx.percent)) ctxPct = clamp(Math.round(cx.percent), 0, 100);
  else if (cx && isNum(cx.tokens) && isNum(cx.window) && cx.window > 0) ctxPct = clamp(Math.round((100 * cx.tokens) / cx.window), 0, 100);

  // 5시간 · 이번 주 말고 다른 한도(Opus 주간 · 지출) — 글자 요약에만
  const extras = [];
  for (const r of limits) {
    if (r.kind === 'five_hour' || r.kind === 'seven_day') continue;
    const ms = String(r.kind).startsWith('five_hour') ? FIVE_HOURS : String(r.kind).startsWith('seven_day') ? SEVEN_DAYS : null;
    const v = rateView(r, now, ms);
    if (v && !v.stale) extras.push({ kind: r.kind, label: limitLabel(r.kind), rem: v.rem, over: r.percentUsed > 100 });
  }

  return {
    five,
    week,
    convo: {
      tokens,
      ctxPct,
      ctxHigh: ctxPct != null && ctxPct >= 85,
      usd: isNum(m.costUsd) && m.costUsd > 0 ? m.costUsd : null,
    },
    extras,
  };
}

// ---- 띠의 세 줄(표) — 띠(색 · 굵기)와 글자 요약(그냥 이어 붙임)이 같은 말을 하게 -----------------------------------
// 한 줄 = 이름 · 막대(남은 양) · 숫자(오른쪽 맞춤) + 단위 · 설명. 값을 모르면 이름 뒤에 한 마디(note)만.
// 조각: { t: 글자, bold?, dim?, color?(테마 키) }

/**
 * @typedef {{ rem: number, level: string }} RowBar
 * @typedef {{ key: string, label: string, note?: string, ctx?: boolean, bar?: RowBar | null, value?: Part | null, unit?: string, detail?: Part[] }} Row
 */

/** 5시간 · 이번 주 줄 @param {string} key @param {string} label @param {Win} w @param {boolean} isWeek @returns {Row} */
function windowRow(key, label, w, isWeek) {
  if (!w.known) return { key, label, note: NOTE[w.note ?? 'plain'] || NOTE.plain };
  /** @type {Part[]} */
  const detail = [];
  if (!isWeek && w.until) detail.push({ t: `${w.until} 뒤`, dim: true });
  // 한 주가 지난 만큼(⚑). 쓴 양이 그보다 5 넘게 앞서면 주황(빨리 쓰는 중)
  if (isWeek && w.elapsed != null) detail.push(w.fast ? { t: `⚑ ${w.elapsed}% 지남`, color: 'warning' } : { t: `⚑ ${w.elapsed}% 지남`, dim: true });
  const level = w.level ?? 'ok';
  return { key, label, bar: { rem: w.rem ?? 0, level }, value: { t: `${w.rem}%`, bold: true, color: LEVEL_TEXT[level] }, unit: '남음', detail };
}

/**
 * 이 대화 줄: 막대는 컨텍스트에서 남은 양(위 두 줄과 같은 "남은 양"), 설명은 새 토큰 · 비용(글자 요약은 앞에 '컨텍스트').
 * 컨텍스트를 모르면 막대 없이 숫자 칸에 토큰, 아무것도 없으면 한 마디.
 * @param {ReturnType<typeof bandModel>['convo']} c @returns {Row}
 */
function convoRow(c) {
  const cost = c.usd != null ? { t: `약 ${fmtUsd(c.usd)}`, dim: true } : null;
  if (c.ctxPct != null) {
    const rem = 100 - c.ctxPct;
    const level = levelOf(rem);
    const detail = [c.tokens > 0 ? { t: `${fmtTok(c.tokens)} 토큰` } : null, cost].filter(Boolean);
    return { key: 'convo', label: '이 대화', ctx: true, bar: { rem, level }, value: { t: `${rem}%`, bold: true, color: LEVEL_TEXT[level] }, unit: '남음', detail: /** @type {Part[]} */ (detail) };
  }
  if (c.tokens > 0 || cost) return { key: 'convo', label: '이 대화', bar: null, value: c.tokens > 0 ? { t: fmtTok(c.tokens), bold: true } : null, unit: c.tokens > 0 ? '토큰' : '', detail: cost ? [cost] : [] };
  return { key: 'convo', label: '이 대화', note: '아직 쓰지 않았어요' };
}

/** 띠 · 글자 요약의 세 줄 @param {ReturnType<typeof bandModel>} m @returns {Row[]} */
export function bandRows(m) {
  return [windowRow('five', '5시간', m.five, false), windowRow('week', '이번 주', m.week, true), convoRow(m.convo)];
}

/** 설명 조각 사이 — 빈칸을 넉넉히(뭉쳐 보이지 않게) */
export const DETAIL_SEP = '  ·  ';

/** 자리가 세 줄이 안 될 때의 한 줄: 5시간 62%   이번 주 39%   이 대화 82% */
export function compactParts(m) {
  /** @type {Part[]} */
  const parts = [];
  const gap = () => {
    if (parts.length) parts.push({ t: '   ' });
  };
  for (const r of bandRows(m)) {
    gap();
    parts.push({ t: `${r.label} `, dim: true });
    if (r.note) parts.push({ t: '값 없음', dim: true });
    else if (r.value) parts.push(r.value);
    else parts.push({ t: '–', dim: true });
  }
  return parts;
}

const plain = (parts) => parts.map((p) => p.t).join('');
const padLabel = (s) => s + ' '.repeat(Math.max(1, LABEL_CELLS - cellWidth(s)));
const padStart = (s, n) => ' '.repeat(Math.max(0, n - cellWidth(s))) + s;
const padEnd = (s, n) => s + ' '.repeat(Math.max(0, n - cellWidth(s)));

/**
 * /usage-bar status 의 글자 — 띠와 같은 세 줄 · 같은 칸(막대는 ▰▱ 글자). 원격 제어처럼 띠를 그릴 화면이 없을 때도 읽힌다.
 * 공식 값 말고 다른 한도(Opus 주간 · 지출)가 있으면 한 줄 더.
 * @param {ReturnType<typeof bandModel>} m @param {{ modelName?: string | null }} [opts]
 */
export function statusText(m, { modelName } = {}) {
  const gap = ' '.repeat(GAP_CELLS);
  const lines = bandRows(m).map((r) => {
    if (r.note) return `${padLabel(r.label)}${r.note}${r.key === 'convo' && modelName ? `${DETAIL_SEP}${modelName}` : ''}`;
    const b = r.bar ? textBar(r.bar.rem, BAR_CELLS) : null;
    const bar = b ? `${b.on}${b.off}` : ' '.repeat(BAR_CELLS);
    const value = `${padStart(r.value ? r.value.t : '', NUM_CELLS)} ${padEnd(r.unit || '', UNIT_CELLS)}`;
    const detail = [...(r.ctx ? ['컨텍스트'] : []), ...(r.detail || []).map((p) => p.t), ...(r.key === 'week' && m.week.known && m.week.fast ? ['빨리 쓰는 중'] : []), ...(r.key === 'convo' && modelName ? [modelName] : [])].join(DETAIL_SEP);
    return `${padLabel(r.label)}${bar}${gap}${value}${detail ? gap + detail : ''}`.trimEnd();
  });
  if (m.extras.length) lines.push(`${padLabel('다른 한도')}${m.extras.map((x) => `${x.label} ${x.over ? '한도 넘음' : `${x.rem}% 남음`}`).join(DETAIL_SEP)}`);
  return lines.join('\n');
}
