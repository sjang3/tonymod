// 창 구성 — `$.ui.resolve(e)` 로 얻은 요소(el)와 값(d)을 받아 트리를 돌려준다. 순수 함수($ 없음).
// 오른쪽 창 탭 "세션" 하나에 세 구역:  에이전트 → 간격 → 작업 → 간격 → 서버. 간격은 창 높이를 보고 2–5줄(spacing).
// 세 구역 모두 Client 모듈(live-crew.js · live-work.js · live-server.js)이 자기 타이머로 움직인다 — 플러그인이 다시 그려도
// 애니메이션이 처음부터 다시 시작하지 않는다. Client 를 그리는 표면은 데스크톱 · 터미널뿐 — 휴대폰 · VS Code 에서는 같은 모듈을
// 한 번 그려 정지 화면으로 넣는다.
// 데이터 계약 d: { now, version, surface?, cols?, rows?, agents: parse.js buildStage(), flow: parse.js buildFlow(),
//                  session: work.js shipSummary() | null, git: { at, repos, error? } | null, verifying, sys, sysNote, where, cpuHist }
import { C, PROP, PROP_WORD, agentColor, stillSurface } from './live-kit.js';
import LiveCrew, { crewHeight } from './live-crew.js';
import LiveWork, { workHeight } from './live-work.js';
import LiveServer, { serverHeight } from './live-server.js';
import { shortDur, trunc } from './parse.js';
import { LEVEL_DOT, SEG_HEX, STAGE_DOT, TONE_MARK, VERDICT_SHORT, cellW, clampPct, fillHex, fmtBytes, groupRepos, num, pairText, prHex, prLabel, repoChecks, repoNote, segmentPcts, worstLevel } from './fmt.js';

// ---- 작은 도우미 -------------------------------------------------------------------------------------
const arr = (x) => (Array.isArray(x) ? x : []);
/** 제어 문자(ESC · NUL …)가 섞인 글자는 엔진이 트리째 거절한다 — 빼고, 줄바꿈 · 탭은 빈칸으로(trunc) */
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const safe = (s, n = 80) => trunc(String(s ?? '').replace(CTRL, ''), n);

/** 에이전트 종류 이름은 짧게 — general-purpose 는 general */
const SHORT = { 'general-purpose': 'general' };
const shortName = (s) => SHORT[s] || s || '';
const agentName = (a) => a.name || shortName(a.type) || '에이전트';

/** 지금 하는 일 — 데스크톱은 소품 그림 + 대상("📖 register.js"), 터미널은 짧은 낱말 + 대상("읽기 register.js") */
function doingText(tool, plain) {
  if (!tool) return '';
  const what = tool.target || '';
  if (plain) return `${PROP_WORD[tool.prop] || tool.verb || ''} ${what}`.trim();
  const icon = PROP[tool.prop] || '';
  return `${icon} ${what || tool.verb || ''}`.trim();
}

const STAGES = [
  { id: 'edit', label: '편집' },
  { id: 'commit', label: '커밋' },
  { id: 'push', label: '푸시' },
  { id: 'pr', label: 'PR' },
  { id: 'merge', label: '머지' },
];
const MAX_REPOS = 6;

// ---- 구역마다 Client 에 넘기는 값 — JSON 으로만(함수 없음), 글자는 미리 다듬어 Client 는 그리기만 한다 ----------------------
/** 에이전트: 갈래(캐릭터 + 시간 막대)마다 한 묶음. 시각은 0~1 비율로(왼쪽 = 창의 시작 t0, 오른쪽 = 지금) */
export function crewProps(d, cols, plain) {
  const a = d.agents || {};
  const f = d.flow || {};
  const now = num(f.now, num(d.now));
  const t0 = Math.min(num(f.t0, now), now);
  const spanMs = Math.max(1, now - t0);
  const fr = (t) => Math.max(0, Math.min(1, (num(t, now) - t0) / spanMs));
  const byKey = new Map(arr(a.crew).map((x) => [x.key, x]));
  const main = a.main || { state: 'idle', tool: null };
  const lanes = arr(f.lanes).map((l) => {
    const isMain = l.kind === 'main';
    const st = isMain ? main : byKey.get(l.key);
    // 무대에서 내려간(선반) 에이전트는 끝난 것
    const state = st ? st.state : l.status === 'running' ? 'thinking' : l.status === 'waiting' ? 'waiting' : 'done';
    const started = Number.isFinite(l.startAt);
    const end = l.endAt == null ? now : num(l.endAt, now);
    return {
      key: safe(l.key, 80),
      label: safe(isMain ? 'Claude' : shortName(l.label || l.type) || '?', 24),
      main: isMain,
      color: isMain ? C.claude : agentColor(l.kind === 'worker' ? 'worker' : l.type),
      depth: !isMain && l.parentKey && l.parentKey !== 'main' ? 1 : 0,
      state: state || 'idle',
      error: st ? Boolean(st.error) : l.status === 'error',
      doing: safe(st && st.state === 'working' ? doingText(st.tool, plain) : '', 60),
      status: l.status || 'running',
      // Claude 가 아직 한 번도 일하지 않았으면 빈 갈래(s > e)
      s: started ? fr(l.startAt) : 1,
      e: started ? fr(end) : 0,
      marks: arr(l.marks)
        .slice(-60)
        .map((mk) => fr(mk.t)),
      dur: started ? shortDur(end - l.startAt) : '',
    };
  });
  const crew = arr(a.crew);
  const busy = crew.filter((x) => x.state === 'working' || x.state === 'thinking' || x.state === 'spawning').length + num(a.moreBusy);
  const seen = crew.length + arr(a.shelf).length;
  const bits = [busy ? `${busy}명 일하는 중` : seen ? `${seen}명 다녀감` : '', num(f.hidden) > 0 ? `+${num(f.hidden)}명` : ''].filter(Boolean);
  return {
    cols,
    plain,
    summary: bits.join(' · '),
    axis: { left: spanMs >= 60000 ? `${shortDur(spanMs)} 전` : '방금 전', right: '지금' },
    lanes,
  };
}

/** Link 의 주소는 https 의 정규형이어야 한다(아니면 엔진이 그 트리를 통째로 거절한다) — 아니면 null(글자로만) */
const linkHref = (u) => {
  try {
    const x = new URL(String(u ?? ''));
    return x.protocol === 'https:' && !x.username && !x.password && x.href.length <= 2048 ? x.href : null;
  } catch {
    return null;
  }
};

const prState = (p) => (p.state === 'MERGED' ? '머지됨' : p.state === 'CLOSED' ? '닫힘' : p.draft ? '초안' : '열림');
const checksText = (p) => {
  const c = p.checks;
  return c ? (c.fail ? `검사 실패 ${c.fail}` : c.pending ? `검사 중 ${c.pending}` : c.pass ? '검사 통과' : '') : '';
};

/** 작업: 결과물 단계 · 한 마디 요약 · PR · 저장소(본 저장소 → 워크트리로 묶어) */
export function workProps(d, cols, plain) {
  const s = d.session;
  const g = d.git;
  const stages = (s && arr(s.stages).length ? s.stages : STAGES).map((x) => ({ id: x.id, label: x.label, state: x.state || 'none' }));
  const summary = s ? { text: safe(s.short || '', 40), tone: s.tone || 'calm' } : g && g.error ? { text: '읽지 못함', tone: 'warn' } : { text: '', tone: 'calm' };
  const prs = s ? arr(s.prs).filter((p) => p && p.number != null) : [];
  const p0 = prs[0];
  const pr = p0 ? { label: `#${p0.number} ${prState(p0)}`, url: linkHref(p0.url), color: prHex(p0), detail: [checksText(p0), prs.length > 1 ? `외 ${prs.length - 1}개` : ''].filter(Boolean).join(' · ') } : null;
  const grouped = g ? groupRepos(g.repos) : [];
  const repos = grouped.slice(0, MAX_REPOS).map((r) => {
    const base = { key: safe(r.root, 300), name: safe(r.name || r.root || '저장소', 40), depth: r.depth || 0, claude: Boolean(r.claude), bold: Boolean(r.relevant) };
    if (r.error) return { ...base, error: true };
    const levels = repoChecks(r).map((c) => c.level);
    return {
      ...base,
      branch: safe(r.detached ? '분리된 HEAD' : r.branch || '', 60),
      checks: levels,
      note: safe(repoNote(r), 40),
      noteLevel: worstLevel(levels),
      pulse: num(r.ahead) > 0 || num(r.unpushed) > 0,
    };
  });
  return {
    cols,
    plain,
    summary,
    stages,
    pr,
    repos,
    more: Math.max(0, grouped.length - MAX_REPOS),
    loading: !g,
    error: g && g.error ? safe(g.error, 80) : '',
    verify: { can: grouped.some((r) => !r.error && (r.upstream || r.remote)), busy: Boolean(d.verifying) },
  };
}

/** 서버: 판정 · 어디서 · 막대 줄(CPU · 메모리 · 스왑(쓸 때만) · 디스크 · 컨테이너) · CPU 흐름 */
export function serverProps(d, cols, plain) {
  const s = d.sys;
  const w = d.where || {};
  const host = safe(w.remote ? w.short || '' : w.host || (s && s.host) || w.short || '', 40);
  if (!s) return { cols, plain, verdict: null, host, note: safe(d.sysNote || '서버 상태를 읽는 중…', 80), rows: [], spark: [] };
  const lvl = (r) => (r > 0.9 ? 'bad' : r > 0.75 ? 'warn' : 'good');
  const ratio = (key, label, used, total) => {
    const r = num(total) > 0 ? num(used) / num(total) : 0;
    return { key, label, parts: [{ pct: clampPct(100 * r), color: fillHex(r) }], value: pairText(used, total), level: lvl(r) };
  };
  const rows = [];
  const cpu = clampPct(s.cpu);
  rows.push({ key: 'cpu', label: 'CPU', parts: [{ pct: cpu, color: fillHex(cpu / 100) }], value: `${cpu}%`, level: lvl(cpu / 100) });
  const m = s.mem && num(s.mem.total) > 0 ? s.mem : null;
  if (m) {
    // 쓰는 중인 조각만 쌓는다(캐시 · 빈 곳은 빈 칸) — 막대 길이가 오른쪽 숫자(쓰는 중 / 전체)와 맞게
    const segs = arr(m.segments).filter((x) => x.key !== 'free' && x.key !== 'cache' && num(x.bytes) > 0);
    const pcts = segmentPcts(
      segs.map((x) => x.bytes),
      m.total,
    );
    rows.push({ key: 'mem', label: '메모리', parts: segs.map((x, i) => ({ pct: pcts[i], color: SEG_HEX[x.key] || C.blue })), value: pairText(m.used, m.total), level: m.pressure === 'critical' ? 'bad' : m.pressure === 'warn' ? 'warn' : 'good' });
    if (num(m.swapTotal) > 0 && num(m.swapUsed) > 0) rows.push(ratio('swap', '스왑', m.swapUsed, m.swapTotal));
  }
  if (s.disk && num(s.disk.total) > 0) rows.push(ratio('disk', '디스크', s.disk.used, s.disk.total));
  const ct = s.container && num(s.container.memLimit) > 0 && s.container.memUsed != null ? s.container : null;
  if (ct) rows.push(ratio('ctr', '컨테이너', ct.memUsed, ct.memLimit));
  const v = s.verdict || null;
  return {
    cols,
    plain,
    verdict: v ? { level: v.level, word: VERDICT_SHORT[v.level] || '' } : null,
    host,
    note: '',
    rows,
    spark: arr(d.cpuHist)
      .map((x) => num(x, NaN))
      .filter(Number.isFinite)
      .slice(-24),
  };
}

// ---- 창 (모든 표면) -----------------------------------------------------------------------------------------
/**
 * 구역 사이 간격(줄). d.rows(창 몸통의 줄 수)를 알면 남는 줄을 두 간격에 고르게 나눈다(2–5줄) — 창이 길면 구역이 넉넉히 떨어지고,
 * 짧으면 붙는다. 갈래가 많을 때 갈래 사이 한 줄도 자리가 남을 때만.
 */
export function spacing(rows, cp, wp, sp) {
  const n = cp.lanes.length;
  const tight = crewHeight({ ...cp, gap: 0 }) + workHeight(wp) + serverHeight(sp);
  const budget = rows > 0 ? rows - 2 : 0; // 위 여백 한 줄 + 안전 한 줄
  const laneGap = n <= 4 || (budget > 0 && budget - tight - 4 >= n - 1) ? 1 : 0;
  const content = tight + laneGap * Math.max(0, n - 1);
  const gap = budget > 0 ? Math.max(2, Math.min(5, Math.floor((budget - content) / 2))) : 2;
  return { laneGap, gap };
}

/**
 * 창 트리: 에이전트 → 간격 → 작업 → 간격 → 서버.
 * actions.post: 정지 화면(휴대폰 · VS Code)에서 구역이 보낸 값(다시 확인)을 받는다 — Client 는 ui.message 로 간다.
 */
export function paneView(el, d, actions = {}) {
  const surface = d.surface || null;
  // Client 를 실제로 그리는 표면은 데스크톱 · 터미널뿐 — 휴대폰 · VS Code 에서는 resolve 가 Client 를 "빈 조각"으로 채워 주므로
  // el.Client 가 있는지만으로는 가를 수 없다(표면 이름이 먼저). 표에 Client 가 아예 없으면 어느 표면이든 정지 화면으로
  const live = typeof el.Client === 'function' && (!surface || surface === 'desktop' || surface === 'terminal');
  // 터미널은 소품(그림 문자) · 반투명 색 없이 — 터미널마다 폭 · 색을 다르게 그려 줄이 흔들려요
  const plain = surface === 'terminal';
  const cols = num(d.cols, 0) > 0 ? Math.floor(num(d.cols)) : 48;
  const inner = Math.max(24, cols - 2); // 좌우 한 칸씩 띄운다
  const crew0 = crewProps(d, inner, plain);
  const wp = workProps(d, inner, plain);
  const sp = serverProps(d, inner, plain);
  const { laneGap, gap } = spacing(Math.floor(num(d.rows, 0)), crew0, wp, sp);
  const cp = { ...crew0, gap: laneGap };
  // Client 가 없는 표면: 같은 모듈의 정지 화면(긴 시간이 흐른 뒤의 프레임)
  const still = () => ({ ...stillSurface(el, inner, { f: 600 }), post: (data) => (typeof actions.post === 'function' ? actions.post(data) : undefined) });
  return el.Box({
    flexDirection: 'column',
    paddingX: 1,
    paddingTop: 1,
    children: [
      live ? el.Client({ key: 'live-crew', module: './live-crew.js', props: cp, width: '100%' }) : LiveCrew(cp, still()),
      el.Box({ key: 'gap-a', height: gap, flexShrink: 0 }),
      live ? el.Client({ key: 'live-work', module: './live-work.js', props: wp, width: '100%' }) : LiveWork(wp, still()),
      el.Box({ key: 'gap-b', height: gap, flexShrink: 0 }),
      live ? el.Client({ key: 'live-server', module: './live-server.js', props: sp, width: '100%' }) : LiveServer(sp, still()),
    ],
  });
}

// ---- 글자 요약 (/crew status · 그릴 화면이 없을 때) --------------------------------------------------------------
const STATE_TEXT = { working: '일하는 중', thinking: '생각하는 중', spawning: '출근하는 중', waiting: '기다리는 중', done: '끝냈어요', idle: '쉬는 중' };
const toolLabel = (t) => `${t.verb || t.name || '일하는 중'}${t.target ? ' ' + t.target : ''}`;
/** 지금 하는 일 한 줄 */
function doing(a) {
  if (a.error) return '문제가 생겼어요';
  if (a.state === 'working' && a.tool) return toolLabel(a.tool);
  return STATE_TEXT[a.state] || '';
}

/** 칸 폭에 맞춰 자르고 채운다(한글은 2칸) — 흐름 이름 칸 맞춤용 */
function padCells(s, w) {
  let out = '';
  for (const ch of String(s)) {
    if (cellW(out + ch) > w - (cellW(s) > w ? 1 : 0)) break;
    out += ch;
  }
  if (cellW(s) > w) out += '…';
  return out + ' '.repeat(Math.max(0, w - cellW(out)));
}

/** 흐름 한 갈래를 글자 막대로 — 일한 칸은 █, 나머지는 ▁, 뒤에 상태 기호 */
function textBar(l, w) {
  const at = (x) => Math.max(0, Math.min(w - 1, Math.round(x * (w - 1))));
  const empty = !(l.e >= l.s);
  let out = '';
  for (let k = 0; k < w; k++) out += !empty && k >= at(l.s) && k <= Math.max(at(l.s), at(l.e)) ? '█' : '▁';
  const mark = empty ? ' ' : { running: '●', done: '✓', error: '✕' }[l.status] || '○';
  return `▕${out}▏${mark}`;
}

/** 선반(끝낸 지 좀 된 에이전트) — 같은 이름은 묶어서 "Explore ×2, Plan" */
function shelfText(shelf) {
  const counts = new Map();
  for (const x of arr(shelf)) {
    const k = agentName(x);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ');
}

const branchLabel = (r) => (r.detached ? '브랜치 없음(detached)' : r.branch || '(없음)');

/** 창을 못 그리는 곳(원격 제어 · -p)에서도 대화 기록에 찍을 수 있는 글자 요약 — 창과 같은 순서(에이전트 → 작업 → 서버) */
export function statusText(d) {
  const L = [];
  const head = (title, sub) => {
    if (L.length) L.push('');
    L.push(`■ ${title}${sub ? ` — ${sub}` : ''}`);
  };

  // 에이전트
  const a = d.agents || {};
  const cp = crewProps(d, 48, true);
  head('에이전트', cp.summary);
  if (a.main) L.push(`Claude: ${trunc(doing(a.main), 60)}`);
  const crew = arr(a.crew);
  crew.forEach((x, i) => L.push(`  ${x.parentKey && x.parentKey !== 'main' ? '  └' : i === crew.length - 1 ? '└' : '├'} ${trunc(agentName(x), 24)}: ${trunc(doing(x), 48)}${x.desc ? ` · ${trunc(x.desc, 40)}` : ''}`));
  if (num(a.moreBusy)) L.push(`  + ${a.moreBusy}명 더 일하는 중`);
  if (arr(a.shelf).length) L.push(`  쉬는 중: ${trunc(shelfText(a.shelf), 80)}`);
  if (cp.lanes.length) {
    L.push(`  흐름 — ${cp.axis.left} → ${cp.axis.right}`);
    for (const l of cp.lanes) L.push(`  ${padCells(`${l.depth ? '└ ' : ''}${l.label}`, 10)} ${textBar(l, 16)} ${l.dur}`.trimEnd());
  }

  // 작업: 이 대화의 결과물
  const s = d.session;
  head('이 대화의 결과물', s ? s.short : '');
  if (!s) L.push(d.git && d.git.error ? '저장소를 읽지 못해서 아직 따라갈 수 없어요' : '살펴보는 중이에요…');
  else {
    L.push(`${TONE_MARK[s.tone] || '·'} ${safe(s.headline || '', 120)}`);
    if (arr(s.stages).length) L.push(`  ${arr(s.stages).map((x) => `${x.label} ${STAGE_DOT[x.state] || '·'}`).join(' → ')}`);
    // 아직 남은 단계의 설명 — 첫 단계는 머리말이 이미 말한다
    for (const st of arr(s.stages).filter((x) => x.state === 'todo' || x.state === 'partial').slice(1)) if (st.detail) L.push(`  ${st.label} — ${safe(st.detail, 120)}`);
    for (const p of arr(s.prs).slice(0, 2)) L.push(`  ${prLabel(p)}${p.url ? ` ${p.url}` : ''}`);
  }

  // 작업: Git 저장소 · 워크트리
  head('Git 저장소', '누가 바꿨든 저장소의 지금 상태 · 워크트리는 └');
  const g = d.git;
  if (!g) L.push('git 상태를 읽는 중이에요…');
  else {
    if (g.error) L.push(`✖ ${safe(g.error, 200)}`);
    const repos = groupRepos(g.repos);
    if (!repos.length && !g.error) L.push('살펴볼 git 저장소가 없어요');
    for (const r of repos.slice(0, 10)) {
      const pre = r.depth > 0 ? '  └ ' : '';
      L.push(`${pre}${r.claude ? '✻ ' : ''}${safe(r.name || r.root, 60)}${r.error ? '' : ` (⎇ ${safe(branchLabel(r), 60)})`}${r.relevant ? ' · 이 대화가 만짐' : ''}`);
      if (r.error) {
        L.push(`${pre ? '    ' : ''}  ✖ ${safe(r.error, 120)}`);
        continue;
      }
      L.push(`${pre ? '    ' : ''}  ${repoChecks(r)
        .map((k) => `${k.label} ${LEVEL_DOT[k.level] || '○'} ${k.detail}`)
        .join(' → ')}`);
    }
    if (repos.length > 10) L.push(`저장소 ${repos.length - 10}개 더`);
  }

  // 서버
  const sy = d.sys;
  const whereLabel = d.where && d.where.label ? String(d.where.label) : '';
  head('서버', [sy && sy.verdict && sy.verdict.text, whereLabel].filter(Boolean).join(' · '));
  if (!sy) L.push(d.sysNote || '서버 상태를 읽는 중…');
  else {
    const mm = sy.mem && num(sy.mem.total) > 0 ? sy.mem : null;
    const bits = [`CPU ${clampPct(sy.cpu)}%`];
    if (mm) bits.push(`메모리 ${pairText(mm.used, mm.total)}`);
    if (mm && num(mm.swapTotal) > 0) bits.push(`스왑 ${pairText(mm.swapUsed, mm.swapTotal)}`);
    if (sy.disk && num(sy.disk.total) > 0) bits.push(`디스크 ${pairText(sy.disk.used, sy.disk.total)}`);
    L.push(bits.join(' · '));
    const ct = sy.container;
    if (ct && (ct.memLimit || ct.cpuCores)) L.push(`컨테이너 한도: ${[ct.memLimit ? `메모리 ${ct.memUsed != null ? pairText(ct.memUsed, ct.memLimit) : fmtBytes(ct.memLimit)}` : '', ct.cpuCores ? `CPU ${ct.cpuCores}코어` : ''].filter(Boolean).join(' · ')}`);
    if (sy.session && num(sy.session.rss) > 0) L.push(`이 세션 ${fmtBytes(sy.session.rss)}`);
  }
  return L.join('\n').replace(CTRL, '');
}
