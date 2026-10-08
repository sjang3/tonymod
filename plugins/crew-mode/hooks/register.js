// crew-mode — 오른쪽 창 탭 "세션": 에이전트(캐릭터 + 흐름) · 작업(이 대화의 결과물 + git 저장소 · 워크트리) · 서버(CPU · 메모리).
//
// `$` 를 쓰는 코드는 전부 이 파일에 있다(검증기가 `$` 를 다른 파일로 넘기는 걸 막는다).
// 해석 · 판정은 hooks/lib/ 의 순수 함수(parse.js 에이전트 · work.js 작업/서버 · fmt.js 숫자/판정)가,
// 그리는 일은 views.js 와 Client 모듈(live-crew.js · live-work.js · live-server.js)이 맡는다.
// v0.5: v0.4 에서 나눴던 work-status(작업 상태 탭)를 다시 합쳤다 — 탭 하나에 세 구역, 구역 사이는 넉넉히, 서버는 창 아래에.
import { SPAWN_TOOLS, buildFlow, buildStage, laneStatusOf, toolInfo } from './lib/parse.js';
import {
  PR_TOOL,
  base,
  buildMem,
  cleanRemoteUrl,
  commandDir,
  dirnameOf,
  flatten,
  isClaudeWorktree,
  join,
  linuxSample,
  parseCpuinfo,
  parseDf,
  parseGitStatus,
  parseIostat,
  parsePrList,
  parseProcStat,
  parsePs,
  parseShipResult,
  parseSwap,
  parseVmStat,
  parseWorktreeList,
  prFactsFromTool,
  round1,
  samePathKey,
  sessionGroup,
  shipKinds,
  shipSummary,
  slugOf,
  splitHeadOutput,
  trunc,
  verdictOf,
  whereView,
} from './lib/work.js';
import { paneView, statusText } from './lib/views.js';

const PANE = 'crew';
const TITLE = '세션';
const VERSION = '0.5.0';
const FACTS = { plugin: 'crew-mode', key: 'facts' };
const PREF_AUTO_OPEN = 'pref:autoOpen';
const MARKS = 60;
const WORKER_AFTER_POLLS = 3; // 목록을 이만큼(1초에 한 번) 읽어도 이름을 안 대면 "작업자"
const WORKER_STALE_MS = 600000; // 작업자가 10분 동안 조용하면 끝난 것으로 본다 (정확한 끝은 turn.complete · SubagentStop)
const SKIP_DIRS = new Set(['node_modules', '.venv', 'venv', '.git', '.next', 'dist', 'build', 'out', '__pycache__', 'Library']);
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const HIST = 24; // CPU 표본(4초마다) — 판정(90% 넘는 표본 3번 연속)과 CPU 흐름(▁▂▅)에
const MAX_ROOTS = 12;
// 리눅스: 한 번의 `head` 로 읽는 파일들(없는 파일은 그 값만 빠진다). cgroup v2 먼저, v1 은 예비.
const LINUX_FILES = [
  '/proc/stat',
  '/proc/loadavg',
  '/proc/meminfo',
  '/proc/pressure/memory',
  '/sys/fs/cgroup/memory.max',
  '/sys/fs/cgroup/memory.current',
  '/sys/fs/cgroup/cpu.max',
  '/sys/fs/cgroup/memory.pressure',
  '/sys/fs/cgroup/memory.stat',
  '/sys/fs/cgroup/memory/memory.limit_in_bytes',
  '/sys/fs/cgroup/memory/memory.usage_in_bytes',
  '/sys/fs/cgroup/memory/memory.stat',
  '/sys/fs/cgroup/cpu/cpu.cfs_quota_us',
  '/sys/fs/cgroup/cpu/cpu.cfs_period_us',
];

// ---- 상태 ------------------------------------------------------------------------------------------
const S = {
  sessionId: null,
  startedAt: Date.now(),
  paneOpen: false,
  wake: false, // 창이 (다른 탭 뒤에서) 다시 보이기 시작했다 — 다음 박자에 바로 새로 읽는다
  autoOpened: false,
  dirty: true,
  factsDirty: false,
  lastInval: 0,
  tickN: 0,
  // 에이전트
  agentsBusy: false,
  main: { busy: false, tool: null, lastTool: null, lastToolAt: 0, firstAt: null, lastTurnEnd: null, marks: [] },
  agentMeta: new Map(), // 에이전트 id → 기록(아래 metaFor)
  agentSig: '',
  workerSeq: 0,
  spawners: [], // 진행 중인 Agent · Task · Workflow 호출 { key, t }
  cleared: new Set(), // /clear 전에 끝난 에이전트 — 목록에 남아 있어도 다시 세지 않는다
  // 어디서
  cwd: null,
  home: '',
  where: { kind: null, entrypoint: null, surfaces: [] },
  // 이 대화가 한 일(사실) — $.state 에 비춰 둔다
  touched: new Map(),
  commits: [],
  pushes: [],
  prs: [],
  // 서버
  sys: null,
  sysStatic: null,
  sysNote: '서버 상태를 읽는 중…',
  hist: [],
  sysBusy: false,
  statPrev: null,
  // git
  git: null,
  session: null,
  gitBusy: false,
  needGit: false,
  verifying: false,
  rootMemo: new Map(),
  repoMemo: { at: 0, cwd: null, roots: [] },
  wtMemo: new Map(), // 저장소 → 워크트리 목록 (60초)
  pushedMemo: new Set(),
  showMemo: new Map(), // 저장소:해시 → 커밋 정보(커밋은 바뀌지 않는다)
  repoMeta: new Map(), // 저장소 → 원격 주소 · 기본 브랜치 (5분)
  prMemo: new Map(),
  remoteMemo: new Map(),
  ghMemo: { at: 0, ok: false },
};

// ---- 순수 상태 갱신(= $ 를 안 쓰는 것) ---------------------------------------------------------------
/** 사실이 바뀌었다: 다시 그리고, $.state 에도 비춰 둔다 */
function mark() {
  S.dirty = true;
  S.factsDirty = true;
}

function metaFor(key) {
  if (key === 'main') return S.main;
  let m = S.agentMeta.get(key);
  if (!m) {
    const now = Date.now();
    const sp = S.spawners.at(-1);
    m = { id: key, seenAt: now, startAt: now, endAt: null, doneAt: null, stopAt: null, status: 'running', rawStatus: null, listed: false, type: null, name: null, desc: '', parentKey: sp && sp.key !== key ? sp.key : 'main', workerN: 0, polls: 0, tools: 0, tool: null, lastTool: null, lastToolAt: 0, lastActAt: now, marks: [] };
    S.agentMeta.set(key, m);
    S.cleared.delete(key);
  }
  return m;
}

/** 목록이 이름을 댄 에이전트이거나 작업자 번호를 받은 것만 화면에 나온다 */
const visible = (m) => m.listed || m.workerN > 0;
const typeOf = (m) => m.type || (m.listed ? 'general-purpose' : 'worker');
const nameOfMeta = (m) => m.name || (m.workerN ? `작업자 ${m.workerN}` : null);
/** 지금 일하는 갈래가 있나 — 있으면 2초마다, 없으면 10초마다 다시 그린다 */
const isLive = () => S.main.busy || [...S.agentMeta.values()].some((m) => visible(m) && m.endAt == null && m.status === 'running');

/** 목록에 없는(작업자) 갈래가 끝났다가 다시 움직이면 다시 연다 */
function reopen(m) {
  if (m === S.main || m.listed || m.endAt == null) return;
  m.endAt = null;
  m.doneAt = null;
  m.stopAt = null;
  m.status = 'running';
}

function finish(m, at, error) {
  if (m.endAt != null) return;
  m.endAt = at;
  m.doneAt = Date.now();
  m.status = error ? 'error' : 'done';
  mark();
}

function startTool(key, t) {
  const m = metaFor(key);
  if (key === 'main') {
    if (m.firstAt == null) m.firstAt = t.ts;
  } else {
    reopen(m);
    if (m.stopAt && t.ts > m.stopAt) m.stopAt = null;
    m.lastActAt = t.ts;
  }
  m.tool = t;
  m.lastTool = t;
  m.lastToolAt = t.ts;
  if (key !== 'main') m.tools += 1;
  m.marks.push({ t: t.ts });
  if (m.marks.length > MARKS) m.marks.splice(0, m.marks.length - MARKS);
  if (SPAWN_TOOLS.has(t.name)) S.spawners.push({ key, t });
  mark();
}

function endTool(key, t) {
  const m = metaFor(key);
  if (m.tool === t) m.tool = null;
  m.lastToolAt = Date.now();
  if (key !== 'main') m.lastActAt = m.lastToolAt;
  const i = S.spawners.findIndex((s) => s.t === t);
  if (i >= 0) S.spawners.splice(i, 1);
  S.dirty = true;
}

function addPr(p) {
  const dup = S.prs.some((x) => x.action === p.action && ((p.url && x.url === p.url) || (!p.url && x.number === p.number)));
  if (dup) return;
  S.prs.push({ url: p.url ?? null, repo: p.repo ?? null, number: p.number, action: p.action, title: p.title ?? null, ts: Date.now() });
  S.needGit = true;
  mark();
}

/** 흐름 갈래로 쓸 AgentStatus 흉내(작업자는 목록에 없으니 갈래 상태에서 만든다) */
const workerStatus = (m) => ({ running: 'running', waiting: 'idle', done: 'completed', error: 'failed' })[m.status] || 'running';

/** 화면에 그릴 값 한 묶음 — S 에서 뽑는 순수 계산(데이터 계약 d, views.js 머리말) */
function snapshotView() {
  const now = Date.now();
  const metas = [...S.agentMeta.values()].filter(visible);
  const agents = metas.map((m) => ({
    id: m.id,
    type: typeOf(m),
    name: nameOfMeta(m),
    description: m.desc,
    status: m.listed ? m.rawStatus || 'running' : workerStatus(m),
    parentKey: m.parentKey,
    tool: m.tool,
    lastTool: m.lastTool,
    lastToolAt: m.lastToolAt,
    tools: m.tools,
    seenAt: m.seenAt,
    doneAt: m.doneAt,
  }));
  const main = S.main;
  const fnow = isLive() ? now : Math.ceil(now / 30000) * 30000; // 쉬는 동안엔 흐름 그림이 30초마다만 바뀐다
  const flow = buildFlow({
    now: fnow,
    startedAt: S.startedAt,
    main: { startAt: main.firstAt, endAt: main.busy ? null : main.lastTurnEnd, status: main.busy ? 'running' : 'waiting', marks: main.marks },
    lanes: metas.map((m) => ({
      key: m.id,
      kind: m.listed ? 'agent' : 'worker',
      type: typeOf(m),
      label: nameOfMeta(m) || typeOf(m),
      parentKey: m.parentKey,
      startAt: m.startAt,
      endAt: m.endAt,
      status: m.status,
      marks: m.marks,
    })),
  });
  return {
    now,
    version: VERSION,
    agents: buildStage({ now, main, agents }),
    flow,
    session: S.session,
    git: S.git,
    verifying: S.verifying,
    sys: S.sys,
    sysNote: S.sysNote,
    cpuHist: S.hist.map((h) => h.cpu),
    where: whereView({ kind: S.where.kind, entrypoint: S.where.entrypoint, surfaces: S.where.surfaces, host: S.sysStatic?.host || '', os: S.sysStatic?.os || '' }),
  };
}

// ---- $.state 에 비춰 두기 · 되살리기 ------------------------------------------------------------------
function factsOf() {
  const agents = [...S.agentMeta.values()]
    .sort((a, b) => b.startAt - a.startAt)
    .slice(0, 40)
    .map((m) => ({ id: m.id, seenAt: m.seenAt, startAt: m.startAt, endAt: m.endAt, doneAt: m.doneAt, stopAt: m.stopAt, status: m.status, rawStatus: m.rawStatus, listed: m.listed, type: m.type, name: m.name, desc: m.desc, parentKey: m.parentKey, workerN: m.workerN, tools: m.tools, lastTool: m.lastTool, lastToolAt: m.lastToolAt, lastActAt: m.lastActAt, marks: m.marks }));
  return {
    v: 4,
    sessionId: S.sessionId,
    savedAt: Date.now(),
    startedAt: S.startedAt,
    autoOpened: S.autoOpened,
    main: { firstAt: S.main.firstAt, lastTurnEnd: S.main.lastTurnEnd, marks: S.main.marks },
    agents,
    workerSeq: S.workerSeq,
    cleared: [...S.cleared].slice(-200),
    touched: [...S.touched].slice(-300).map(([path, v]) => ({ path, ts: v.ts })),
    commits: S.commits.slice(-40),
    pushes: S.pushes.slice(-40),
    prs: S.prs.slice(-40),
  };
}

function applyFacts(f) {
  S.startedAt = f.startedAt || S.startedAt;
  S.autoOpened = Boolean(f.autoOpened);
  const marksOf = (ms) => (Array.isArray(ms) ? ms.filter((x) => Number.isFinite(x?.t)).map((x) => ({ t: x.t })) : []);
  S.main = { ...S.main, firstAt: f.main?.firstAt ?? null, lastTurnEnd: f.main?.lastTurnEnd ?? null, marks: marksOf(f.main?.marks) };
  S.agentMeta = new Map((f.agents || []).map((a) => [a.id, { ...a, polls: 0, tool: null, marks: marksOf(a.marks) }]));
  S.workerSeq = f.workerSeq || 0;
  S.cleared = new Set(f.cleared || []);
  // v4 부터: 이 대화가 한 일(v3 · v2 에는 없다 — work-status 가 따로 가졌다)
  if (f.v === 4) {
    S.touched = new Map((f.touched || []).map((t) => [t.path, { ts: t.ts }]));
    S.commits = f.commits || [];
    S.pushes = f.pushes || [];
    S.prs = f.prs || [];
    S.needGit = S.touched.size > 0 || S.commits.length > 0;
  }
}

async function restoreFacts($) {
  let id = null;
  try {
    id = await $.session.id();
  } catch {
    return;
  }
  S.sessionId = id || null;
  if (!id) return;
  try {
    const { value } = await $.state.get(FACTS);
    // v3(v0.4) · v2(v0.3) 가 남긴 값도 에이전트 · 흐름 부분은 같은 모양이라 그대로 읽는다
    if (value && (value.v === 4 || value.v === 3 || value.v === 2) && value.sessionId === id) applyFacts(value);
  } catch {
    /* 되살리지 못하면 새로 시작 */
  }
}

/** 1초 박자(tick)에서만 부른다 — 그래서 쓰기는 많아야 1초에 한 번 */
async function saveFacts($) {
  if (!S.factsDirty || !S.sessionId) return;
  S.factsDirty = false;
  try {
    await $.state.set(FACTS, factsOf());
  } catch {
    /* 저장이 막혀도 화면은 계속 */
  }
}

// ---- $ 를 쓰는 도우미(모두 최상위 함수 — `$` 를 인자로 받는다) --------------------------------------------
async function setPref($, value) {
  try {
    await $.store.set(PREF_AUTO_OPEN, value);
  } catch {
    /* 기억하지 못해도 창은 열고 닫힌다 */
  }
}

async function run($, argv, init) {
  try {
    return await $.process.run(argv, init);
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err && err.message ? err.message : err) };
  }
}

async function git($, root, args, timeoutMs = 10000) {
  return run($, ['git', '--no-optional-locks', '-C', root, ...args], { timeoutMs, env: { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' } });
}

// ---- 진단: 원격 화면에 창이 안 뜰 때 원인을 남긴다($.store 'diag:<세션>' · /crew debug) -----------------------------
const NO_SURFACE_NOTE = '이 연결에는 창을 그릴 화면이 붙어 있지 않아요(원격 제어로 붙은 데스크톱 · 휴대폰은 mod 창을 그리지 않아요). 대신 같은 내용을 글자로 보여 드려요. 창으로 보려면 데스크톱 앱 Code 탭에서 이 컴퓨터(로컬 또는 SSH)로 세션을 여세요.';
const DIAG = { sessionId: null, version: null, envKind: null, entry: null, surfaces: [], attaches: [], detaches: [], opens: [], renders: {}, lastRender: null, panes: null, notes: [] };
let diagDirty = false;
function diagPush(list, item, max = 12) {
  list.push({ at: new Date().toISOString(), ...item });
  if (list.length > max) list.splice(0, list.length - max);
  diagDirty = true;
}
async function saveDiag($) {
  if (!diagDirty || !DIAG.sessionId) return;
  diagDirty = false;
  try {
    await $.store.set(`diag:${DIAG.sessionId}`, { ...DIAG, savedAt: new Date().toISOString() });
  } catch {
    /* 진단을 못 남겨도 창은 계속 */
  }
}
function diagText() {
  const L = [];
  L.push(`crew-mode ${VERSION} 진단 — 세션 ${DIAG.sessionId || '?'} · Claude Code ${DIAG.version || '?'}`);
  L.push(`환경: ${DIAG.envKind || '(없음)'} · 진입점: ${DIAG.entry || '(없음)'}`);
  L.push(`붙은 화면($.session.surfaces): ${DIAG.surfaces.length ? DIAG.surfaces.join(', ') : '없음'}`);
  L.push(`붙음(session.attach): ${DIAG.attaches.length ? DIAG.attaches.map((a) => `${a.surface}/${a.clientId}${a.isFullscreen != null ? ` 옆창=${a.isFullscreen}` : ''}`).join(' · ') : '한 번도 없음'}`);
  if (DIAG.detaches.length) L.push(`떨어짐: ${DIAG.detaches.map((d) => d.clientId).join(' · ')}`);
  L.push(`창 열기: ${DIAG.opens.length ? DIAG.opens.map((o) => `${o.why}→${o.error ? '오류 ' + o.error : o.isPlaced ? '놓임' : '안 놓임' + (o.reason ? ` (${o.reason})` : '')}`).join(' · ') : '시도 안 함'}`);
  L.push(`창 목록: ${DIAG.panes ? JSON.stringify(DIAG.panes) : '모름'}`);
  const r = Object.entries(DIAG.renders);
  L.push(`그리기 요청(ui.render): ${r.length ? r.map(([k, n]) => `${k} ${n}회`).join(', ') : '한 번도 안 옴'}${DIAG.lastRender ? ` · 마지막 ${DIAG.lastRender.surface} ${DIAG.lastRender.columns ?? '?'}칸 × ${DIAG.lastRender.rows ?? '?'}줄 옆창=${DIAG.lastRender.isFullscreen ?? '?'}` : ''}`);
  for (const n of DIAG.notes) L.push(`메모: ${n.text}`);
  return L.join('\n');
}

async function openPane($, why = 'open') {
  try {
    const r = await $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true, columns: 56 });
    diagPush(DIAG.opens, { why, isPlaced: r?.isPlaced ?? null, reason: r?.isPlaced === false ? r.reason : undefined });
    return r;
  } catch (err) {
    diagPush(DIAG.opens, { why, error: String(err && err.message ? err.message : err).slice(0, 200) });
    throw err;
  }
}

/** 어디서 돌고 어떻게 보고 있는지: 환경 종류 · 진입점 · 붙은 화면 (창 머리 · 진단) */
async function refreshWhere($) {
  try {
    const [kind, entry, surfaces, remote] = await Promise.all([$.env.get('CLAUDE_CODE_ENVIRONMENT_KIND'), $.env.get('CLAUDE_CODE_ENTRYPOINT'), $.session.surfaces(), $.env.get('CLAUDE_CODE_REMOTE')]);
    const surf = [...(surfaces || [])];
    // 관리형 클라우드는 KIND 없이 CLAUDE_CODE_REMOTE 만 둘 때가 있다
    S.where = { kind: kind || (/^(1|true)$/i.test(remote || '') ? 'anthropic_cloud' : null), entrypoint: entry || null, surfaces: surf };
    S.dirty = true;
    if (JSON.stringify(DIAG.surfaces) !== JSON.stringify(surf) || DIAG.envKind !== (kind || null) || DIAG.entry !== (entry || null)) {
      DIAG.surfaces = surf;
      DIAG.envKind = kind || null;
      DIAG.entry = entry || null;
      diagDirty = true;
    }
  } catch {
    /* 모르면 그대로 */
  }
}

async function refreshAgents($) {
  if (S.agentsBusy) return false;
  S.agentsBusy = true;
  try {
    let list = [];
    try {
      list = await $.agent.list();
    } catch {
      return false;
    }
    const now = Date.now();
    let changed = false;
    for (const a of list) {
      const st = laneStatusOf(a.status);
      if (S.cleared.has(a.id)) {
        if (st === 'done' || st === 'error') continue;
        S.cleared.delete(a.id);
      }
      const wasListed = S.agentMeta.get(a.id)?.listed === true;
      const m = metaFor(a.id);
      m.listed = true;
      m.type = a.type || m.type;
      m.name = a.name || null;
      m.desc = a.description || '';
      m.parentKey = a.parentId && a.parentId !== a.id ? a.parentId : 'main';
      m.rawStatus = a.status;
      if (!wasListed) changed = true;
      if (st === 'done' || st === 'error') {
        if (m.endAt == null) {
          finish(m, m.stopAt ?? now, st === 'error');
          changed = true;
        }
      } else if (m.endAt != null) {
        m.endAt = null;
        m.doneAt = null;
        m.stopAt = null;
        changed = true;
      }
      if (m.status !== st) {
        m.status = st;
        changed = true;
      }
    }
    // 목록에서 빠진 에이전트(엔진은 끝난 뒤 30초쯤 지나 지운다)는 끝난 것으로
    const ids = new Set(list.map((a) => a.id));
    for (const m of S.agentMeta.values()) {
      if (!m.listed || m.endAt != null || ids.has(m.id)) continue;
      m.tool = null;
      m.rawStatus = 'completed'; // 무대는 목록 에이전트의 rawStatus 를 읽는다
      finish(m, m.stopAt ?? m.lastActAt ?? now, false);
      changed = true;
    }
    // 목록이 끝내 이름을 대지 않는 id(워크플로 에이전트 · 엔진의 갈래) → 작업자 1, 2, …
    for (const m of S.agentMeta.values()) {
      if (m.listed) continue;
      m.polls = (m.polls || 0) + 1;
      if (!m.workerN && (m.endAt != null || m.polls >= WORKER_AFTER_POLLS)) {
        m.workerN = ++S.workerSeq;
        changed = true;
      }
      if (m.status === 'running' && !m.tool && m.endAt == null && now - m.lastActAt > WORKER_STALE_MS) {
        finish(m, m.lastActAt, false);
        changed = true;
      }
    }
    const sig = JSON.stringify(list.map((a) => [a.id, a.status, a.type, a.description, a.name]));
    if (sig !== S.agentSig) {
      S.agentSig = sig;
      changed = true;
    }
    if (changed) mark();
    return changed;
  } finally {
    S.agentsBusy = false;
  }
}

// ---- 서버 (macOS · Linux) -------------------------------------------------------------------------------
/** 한 번만 읽는 값: OS · 호스트 이름 · 코어 · 메모리 총량 */
async function loadStatic($) {
  if (S.sysStatic) return S.sysStatic;
  const os = (await run($, ['uname', '-s'])).stdout.trim();
  let st = null;
  if (os === 'Darwin') {
    const [memsize, ncpu, host] = await Promise.all([run($, ['sysctl', '-n', 'hw.memsize']), run($, ['sysctl', '-n', 'hw.ncpu']), run($, ['hostname', '-s'])]);
    st = { os, total: Number(memsize.stdout.trim()) || 0, cores: Number(ncpu.stdout.trim()) || 0, host: host.stdout.trim() };
  } else if (os === 'Linux') {
    const [cpuinfo, host, nproc] = await Promise.all([run($, ['cat', '/proc/cpuinfo']), run($, ['uname', '-n']), run($, ['nproc'])]);
    st = { os, total: 0, cores: parseCpuinfo(cpuinfo.stdout).count || Number(nproc.stdout.trim()) || 0, host: host.stdout.trim() };
  } else if (os) st = { os, total: 0, cores: 0, host: '' };
  // 못 읽었으면 기억하지 않는다(다음에 다시)
  if (st && !(st.os === 'Darwin' && !st.total)) {
    S.sysStatic = st;
    S.dirty = true;
  }
  return st;
}

async function sampleDarwin($, st) {
  const [vm, swap, press, io, ps, df] = await Promise.all([
    run($, ['vm_stat']),
    run($, ['sysctl', '-n', 'vm.swapusage']),
    run($, ['sysctl', '-n', 'kern.memorystatus_vm_pressure_level']),
    run($, ['iostat', '-n', '0', '-c', '2', '-w', '1'], { timeoutMs: 5000 }), // top 보다 훨씬 가볍다
    run($, ['ps', '-A', '-o', 'pid=,ppid=,pcpu=,rss=,comm=']),
    run($, ['df', '-kP', '/System/Volumes/Data']),
  ]);
  const mem = buildMem(parseVmStat(vm.stdout), parseSwap(swap.stdout), press.stdout, st.total);
  const t = parseIostat(io.stdout);
  if (!mem || t.cpu == null) return null;
  return { cpu: round1(t.cpu), load: t.load, mem, container: null, psText: ps.stdout, disk: parseDf(df.stdout) };
}

async function sampleLinux($) {
  // CPU % 는 두 번 읽은 /proc/stat 의 차이 — 첫 표본이면 1초 전 값을 먼저 만든다
  if (!S.statPrev) S.statPrev = parseProcStat((await run($, ['sh', '-c', 'head -n 1 /proc/stat; sleep 1'], { timeoutMs: 5000 })).stdout);
  const [h, ps, df] = await Promise.all([run($, ['head', '-n', '400', ...LINUX_FILES]), run($, ['ps', '-A', '-o', 'pid=,ppid=,pcpu=,rss=,comm=']), run($, ['df', '-kP', S.cwd || '/'])]);
  let parts = splitHeadOutput(h.stdout);
  if (!parts['/proc/stat']) {
    // head 가 없거나 머리를 찍지 않는 환경: 꼭 필요한 셋만 따로
    const [a, b, c] = await Promise.all(['/proc/stat', '/proc/loadavg', '/proc/meminfo'].map((f) => run($, ['cat', f])));
    parts = { '/proc/stat': a.stdout, '/proc/loadavg': b.stdout, '/proc/meminfo': c.stdout };
  }
  const s = linuxSample(parts, S.statPrev);
  if (s.stat) S.statPrev = s.stat;
  if (!s.mem || s.cpu == null) return null;
  return { cpu: s.cpu, load: s.load, mem: s.mem, container: s.container, psText: ps.stdout, disk: parseDf(df.stdout) };
}

async function refreshSystem($) {
  if (S.sysBusy) return;
  S.sysBusy = true;
  try {
    const st = await loadStatic($);
    if (!st || (st.os !== 'Darwin' && st.os !== 'Linux')) {
      S.sysNote = st ? `이 서버(${st.os})의 CPU · 메모리는 아직 읽을 수 없어요` : '서버 상태를 읽지 못했어요';
      S.dirty = true;
      return;
    }
    if (st.os === 'Darwin' && !st.total) {
      S.sysNote = '서버 상태를 읽지 못했어요';
      return;
    }
    const sample = st.os === 'Darwin' ? await sampleDarwin($, st) : await sampleLinux($);
    if (!sample) {
      if (!S.sys) S.sysNote = '서버 상태를 읽지 못했어요';
      S.dirty = true;
      return;
    }
    // 이 세션(우리 CLI 와 자손)이 쓰는 메모리 — 프로세스 목록은 그리지 않는다
    const g = sessionGroup(parsePs(sample.psText));
    S.hist.push({ t: Date.now(), cpu: sample.cpu });
    if (S.hist.length > HIST) S.hist.shift();
    S.sys = {
      os: st.os,
      host: st.host,
      cpu: sample.cpu,
      cores: st.cores,
      load: sample.load,
      mem: sample.mem,
      disk: sample.disk,
      container: sample.container,
      session: g ? { cpu: g.cpu, rss: g.rss, count: g.count } : null,
      verdict: verdictOf({ mem: sample.mem, cpu: sample.cpu, history: S.hist, container: sample.container }),
    };
    S.sysNote = '';
    S.dirty = true;
  } finally {
    S.sysBusy = false;
  }
}

// ---- git ----------------------------------------------------------------------------------------------------
async function findRoot($, dir) {
  if (!dir) return null;
  const hit = S.rootMemo.get(dir);
  if (hit && Date.now() - hit.at < 60000) return hit.root;
  let d = dir;
  let root = null;
  for (let i = 0; i < 40; i++) {
    let has = false;
    try {
      has = await $.fs.exists(join(d, '.git')); // 워크트리는 .git 이 파일 — 그것도 뿌리
    } catch {
      has = false;
    }
    if (has) {
      root = d;
      break;
    }
    const up = dirnameOf(d);
    if (up === d) break;
    d = up;
  }
  S.rootMemo.set(dir, { at: Date.now(), root });
  return root;
}

async function childRepos($, dir, depth) {
  let ents = [];
  try {
    ents = await $.fs.list(dir);
  } catch {
    return [];
  }
  if (ents.length > 80) return [];
  const found = [];
  for (const e of ents) {
    if (e.kind !== 'dir' || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    let has = false;
    try {
      has = await $.fs.exists(join(p, '.git'));
    } catch {
      has = false;
    }
    if (has) found.push(p);
    if (depth > 1) found.push(...(await childRepos($, p, depth - 1)));
  }
  return found;
}

/** 저장소의 작업 트리 목록(본 저장소 + 연결된 워크트리) — 60초 기억. 같은 저장소의 어느 작업 트리에서 물어도 같은 목록 */
async function worktreesOf($, root) {
  const hit = S.wtMemo.get(root);
  if (hit && Date.now() - hit.at < 60000) return hit.list;
  const r = await git($, root, ['worktree', 'list', '--porcelain'], 6000);
  const list = r.exitCode === 0 ? parseWorktreeList(r.stdout) : [];
  S.wtMemo.set(root, { at: Date.now(), list });
  return list;
}

/**
 * 살펴볼 저장소: 세션 폴더의 저장소 · 그 아래 두 단계의 저장소 · 이 대화가 만진 곳의 저장소, 그리고 그 저장소들의 워크트리
 * (`git worktree list` — Claude 가 만든 `.claude/worktrees/…` 처럼 숨은 폴더에 있어도). 워크트리 → 본 저장소 짝도 돌려준다.
 */
async function discoverRepos($, cwd, extraDirs) {
  const roots = [];
  const keys = new Set();
  const add = (p) => {
    const k = samePathKey(p);
    if (!p || keys.has(k)) return;
    keys.add(k);
    roots.push(p);
  };
  add(await findRoot($, cwd));
  if (S.repoMemo.cwd !== cwd || Date.now() - S.repoMemo.at > 60000) S.repoMemo = { at: Date.now(), cwd, roots: cwd ? await childRepos($, cwd, 2) : [] };
  for (const d of extraDirs) add(await findRoot($, d));
  for (const r of S.repoMemo.roots) add(r);
  const mainOf = new Map(); // 워크트리 경로(견주기 열쇠) → 본 저장소 경로
  const inside = new Map(); // 본 저장소(견주기 열쇠) → 그 폴더 안에 있는 워크트리의 상대 경로(.claude/worktrees/x) — git status 에서 뺀다
  const seen = new Set();
  for (const r of [...roots]) {
    const list = await worktreesOf($, r);
    if (list.length < 2) continue; // 연결된 워크트리가 없는 저장소
    const main = list[0].path;
    if (seen.has(samePathKey(main))) continue; // 같은 저장소를 다른 작업 트리에서 이미 봤다
    seen.add(samePathKey(main));
    if (!list[0].bare) add(main); // 워크트리 안에서 도는 세션이면 본 저장소도 함께(작업 폴더가 없는 bare 저장소는 빼고)
    // 본 저장소는 목록에 들어간 철자로(/tmp/x 로 찾았는데 git 은 /private/tmp/x 라고 말해도 창이 같은 저장소 아래로 묶게)
    const mainRoot = roots.find((x) => samePathKey(x) === samePathKey(main)) ?? main;
    for (const w of list.slice(1)) {
      if (w.bare || w.prunable) continue;
      mainOf.set(samePathKey(w.path), mainRoot);
      add(w.path);
      // 본 저장소 폴더 안의 워크트리(.claude/worktrees/x)는 본 저장소의 git status 에 '새 폴더'로 잡힌다 — 변경이 아니다
      const mk = samePathKey(main);
      const wk = samePathKey(w.path);
      if (wk.startsWith(mk + '/')) {
        if (!inside.has(mk)) inside.set(mk, []);
        inside.get(mk).push(wk.slice(mk.length + 1));
      }
    }
  }
  return { roots: roots.slice(0, MAX_ROOTS), mainOf, inside };
}

/** excludes: 이 저장소 폴더 안에 있는 워크트리의 상대 경로 — 변경으로 세지 않는다 */
async function repoStatus($, root, excludes = []) {
  // 원격 주소 · 기본 브랜치는 거의 안 바뀐다 — 5분 동안 기억해 git 을 덜 띄운다
  const meta = S.repoMeta.get(root);
  const fresh = meta && Date.now() - meta.at < 300000;
  // literal: 워크트리 이름에 * ? [ 가 있어도 패턴이 아니라 그 경로 그대로
  const skip = excludes.length ? ['--', '.', ...excludes.map((x) => `:(exclude,literal)${x}`)] : [];
  const [st, remote, defRef] = await Promise.all([
    git($, root, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal', '-z', ...skip]),
    fresh ? { stdout: meta.url } : git($, root, ['remote', 'get-url', 'origin']),
    fresh ? { stdout: meta.defRef } : git($, root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
  ]);
  if (st.exitCode !== 0 && !st.stdout) return { root, name: base(root), error: 'git 상태를 읽지 못했어요' };
  if (!fresh) S.repoMeta.set(root, { at: Date.now(), url: remote.stdout, defRef: defRef.stdout });
  const s = parseGitStatus(st.stdout);
  const hasCommit = Boolean(s.oid && s.oid !== '(initial)');
  const url = cleanRemoteUrl(remote.stdout.trim());
  const defaultBranch = defRef.stdout.trim().replace(/^origin\//, '') || null;
  // 추적 설정이 없을 때만: 어느 원격 브랜치에도 없는 커밋 수(-u 없이 푸시했거나 detached)
  const ul = !s.upstream && url && hasCommit ? await git($, root, ['rev-list', '--count', 'HEAD', '--not', '--remotes'], 6000) : null;
  const unpushed = ul && ul.exitCode === 0 ? Number(ul.stdout.trim()) : null;
  return {
    unpushed,
    root,
    name: base(root),
    branch: s.branch,
    detached: s.detached,
    upstream: s.upstream,
    ahead: s.ahead,
    behind: s.behind,
    staged: s.staged,
    unstaged: s.unstaged,
    untracked: s.untracked,
    conflicts: s.conflicts,
    dirty: s.files.length,
    files: s.files,
    remote: url ? { url, slug: slugOf(url) } : null,
    onDefault: s.branch ? [defaultBranch, 'main', 'master'].filter(Boolean).includes(s.branch) : false,
  };
}

async function commitsFor($, root, sinceMs, hashes) {
  const fmt = '%H%x1f%h%x1f%s%x1f%ct';
  const out = new Map();
  const since = await git($, root, ['log', `--since=${new Date(sinceMs - 60000).toISOString()}`, `--format=${fmt}`, '-n', '40'], 8000);
  for (const line of since.stdout.split('\n')) {
    const [sha, short, subject, ct] = line.split('\x1f');
    if (sha) out.set(sha, { sha, short, subject: trunc(subject, 80), ts: Number(ct) * 1000, byClaude: false });
  }
  // amend · rebase 로 버려진 커밋은 뺀다 — 브랜치 · 태그 · HEAD 에서 닿는 최근 커밋을 한 번에 읽어 견준다
  let live = null;
  if (hashes.length) {
    const r = await git($, root, ['rev-list', '--all', `--since=${new Date(sinceMs - 86400000).toISOString()}`], 8000);
    if (r.exitCode === 0) live = r.stdout.split('\n').filter(Boolean);
  }
  for (const h of hashes) {
    if (live && !live.some((x) => x.startsWith(h))) continue;
    const key = `${root}:${h}`;
    let c = S.showMemo.get(key);
    if (!c) {
      const r = await git($, root, ['show', '-s', `--format=${fmt}`, h], 8000);
      const [sha, short, subject, ct] = r.stdout.trim().split('\x1f');
      if (!sha) continue;
      c = { sha, short, subject: trunc(subject, 80), ts: Number(ct) * 1000 };
      S.showMemo.set(key, c);
    }
    out.set(c.sha, { ...c, byClaude: true });
  }
  return [...out.values()].sort((a, b) => b.ts - a.ts);
}

/** 어느 원격 브랜치에든 올라갔는가 — 추적 브랜치와 다른 곳(`main:refs/heads/x`)으로 푸시해도 맞게 */
async function isPushed($, root, sha) {
  const key = `${root}:${sha}`;
  if (S.pushedMemo.has(key)) return true;
  const r = await git($, root, ['branch', '-r', '--contains', sha], 6000);
  const pushed = r.exitCode === 0 && r.stdout.trim().length > 0;
  if (pushed) S.pushedMemo.add(key);
  return pushed;
}

async function ghOk($) {
  if (!S.ghMemo.at || Date.now() - S.ghMemo.at > 300000) S.ghMemo = { at: Date.now(), ok: (await run($, ['gh', 'auth', 'status'], { timeoutMs: 8000 })).exitCode === 0 };
  return S.ghMemo.ok;
}

async function prFor($, slug, branch) {
  const key = `${slug}:${branch}`;
  const hit = S.prMemo.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  let value = { unavailable: true };
  if (await ghOk($)) {
    const r = await run($, ['gh', 'pr', 'list', '-R', slug, '--head', branch, '--state', 'all', '--limit', '3', '--json', 'number,title,state,url,isDraft,mergedAt,baseRefName,reviewDecision,statusCheckRollup,updatedAt'], { timeoutMs: 15000 });
    value = r.exitCode === 0 ? parsePrList(r.stdout) : { unavailable: true };
  }
  S.prMemo.set(key, { at: Date.now(), value });
  return value;
}

/** 이 세션이 기록한 PR 을 주소로 다시 읽는다(세션 밖에서 머지 · 닫힘을 알아채려고) */
async function prByUrl($, url) {
  const hit = S.prMemo.get(url);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  const r = (await ghOk($)) ? await run($, ['gh', 'pr', 'view', url, '--json', 'number,title,state,url,isDraft,mergedAt,statusCheckRollup,updatedAt'], { timeoutMs: 15000 }) : null;
  const value = r && r.exitCode === 0 ? parsePrList(`[${r.stdout}]`) : null;
  S.prMemo.set(url, { at: Date.now(), value });
  return value;
}

/**
 * 원격에 직접 묻는다: 추적 브랜치(upstream)의 원격 sha 가 로컬의 추적 ref(@{u})와 같은가.
 * 추적 ref 가 바뀌면(푸시 · 풀) 기억도 새로 — 낡은 HEAD 와 견주지 않는다.
 */
async function remoteCheck($, root, upstream, force) {
  const tracked = (await git($, root, ['rev-parse', '@{u}'], 4000)).stdout.trim();
  const key = `${root}:${upstream}:${tracked}`;
  const hit = S.remoteMemo.get(key);
  if (!force && hit && Date.now() - hit.at < 120000) return hit.value;
  const i = upstream.indexOf('/');
  // 전체 ref 로 물어야 feature/main 같은 꼬리 일치가 섞이지 않는다
  const ref = `refs/heads/${upstream.slice(i + 1)}`;
  const r = await git($, root, ['ls-remote', upstream.slice(0, i), ref], 12000);
  let value;
  if (r.exitCode !== 0) value = { ok: false, at: Date.now(), error: trunc(r.stderr || '원격에 닿지 못했어요', 80) };
  else {
    const remoteSha = r.stdout.split('\n').map((l) => l.split('\t')).find((p) => p[1] === ref)?.[0] ?? null;
    value = { ok: true, at: Date.now(), exists: Boolean(remoteSha), same: remoteSha === tracked };
  }
  S.remoteMemo.set(key, { at: Date.now(), value });
  return value;
}

/** 저장소 하나 → 창이 그리는 모양. main: 워크트리면 본 저장소 경로 */
function repoView(s, mine, mineDirty, relevant, pr, rc, main) {
  const prView = pr && pr.number ? { number: pr.number, url: pr.url ?? null, state: pr.state, draft: Boolean(pr.draft), title: pr.title ?? null, checks: pr.checks ?? null } : pr || null;
  return { root: s.root, name: s.name, main: main ?? null, claude: isClaudeWorktree(s.root), branch: s.branch, detached: s.detached, upstream: s.upstream, unpushed: s.unpushed ?? null, ahead: s.ahead, behind: s.behind, staged: s.staged, unstaged: s.unstaged, untracked: s.untracked, conflicts: s.conflicts, dirty: s.dirty, remote: s.remote, remoteCheck: rc, relevant, mine: mine.length, mineDirty: mineDirty.length, onDefault: s.onDefault, pr: prView };
}

function errorRepo(s, relevant, mineCount, main) {
  return { root: s.root, name: s.name, main: main ?? null, claude: isClaudeWorktree(s.root), branch: null, detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, dirty: 0, remote: null, remoteCheck: null, relevant, mine: mineCount, mineDirty: 0, onDefault: false, pr: null, error: s.error };
}

async function refreshGit($, force = false) {
  for (let i = 0; force && S.gitBusy && i < 20; i++) await $.clock.sleep(250); // 다시 확인: 돌던 갱신이 끝나면 원격까지 다시
  if (S.gitBusy) {
    S.needGit = true; // 도는 갱신이 방금 편집을 못 봤을 수 있다 — 끝나고 3초 뒤에 한 번 더
    return;
  }
  S.gitBusy = true;
  try {
    if (!S.cwd) S.cwd = await $.session.cwd();
    const touchedPaths = [...S.touched.keys()];
    const extraDirs = [...touchedPaths.map(dirnameOf), ...S.commits.map((c) => c.dir), ...S.pushes.map((p) => p.dir)].filter(Boolean);
    const { roots, mainOf, inside } = await discoverRepos($, S.cwd, extraDirs);
    const statuses = await Promise.all(roots.map((r) => repoStatus($, r, inside.get(samePathKey(r)) ?? [])));

    // 만진 파일 · 기록된 커밋 → 저장소(가장 안쪽 뿌리 — 워크트리 안의 파일은 그 워크트리)
    const mineByRoot = new Map();
    const outside = [];
    for (const p of touchedPaths) {
      const root = await findRoot($, dirnameOf(p));
      if (!root) {
        outside.push(p);
        continue;
      }
      if (!mineByRoot.has(root)) mineByRoot.set(root, []);
      mineByRoot.get(root).push(p.startsWith(root + '/') ? p.slice(root.length + 1) : p);
    }
    const hashesByRoot = new Map();
    for (const c of S.commits) {
      const root = await findRoot($, c.dir);
      if (!root) continue;
      if (!hashesByRoot.has(root)) hashesByRoot.set(root, []);
      hashesByRoot.get(root).push(c.hash);
    }

    const repos = [];
    let leftover = 0;
    let commitsAll = [];
    for (const s of statuses) {
      const mine = mineByRoot.get(s.root) ?? [];
      const relevant = mine.length > 0 || hashesByRoot.has(s.root);
      const main = mainOf.get(samePathKey(s.root)) ?? null;
      if (s.error) {
        repos.push(errorRepo(s, relevant, mine.length, main));
        continue;
      }
      const dirtySet = new Set(s.files.map((f) => f.path));
      // 새 폴더는 git 이 `pkg/` 한 줄로만 보여 준다 — 그 안의 파일을 고쳤으면 아직 커밋 전
      const newDirs = s.files.filter((f) => f.kind === 'untracked' && f.path.endsWith('/')).map((f) => f.path);
      const mineDirty = mine.filter((p) => dirtySet.has(p) || newDirs.some((d) => p.startsWith(d)));
      leftover += mineDirty.length;
      if (relevant) {
        const commits = await commitsFor($, s.root, S.startedAt, hashesByRoot.get(s.root) ?? []);
        for (const c of commits) {
          c.pushed = await isPushed($, s.root, c.sha);
          c.repo = s.name;
        }
        commitsAll = commitsAll.concat(commits);
      }
      const pr = s.remote?.slug && s.branch && !s.onDefault ? await prFor($, s.remote.slug, s.branch) : null;
      const rc = s.upstream ? await remoteCheck($, s.root, s.upstream, force) : null;
      repos.push(repoView(s, mine, mineDirty, relevant, pr, rc, main));
    }
    repos.sort((a, b) => Number(Boolean(b.relevant)) - Number(Boolean(a.relevant)) || (b.dirty ?? 0) - (a.dirty ?? 0) || (b.ahead ?? 0) - (a.ahead ?? 0));
    // 같은 커밋이 두 저장소(작업 트리 · 본 저장소)에서 나오면 하나로 — 올라간 쪽을 남긴다
    const bySha = new Map();
    for (const c of commitsAll) if (!bySha.has(c.sha) || (c.pushed && !bySha.get(c.sha).pushed)) bySha.set(c.sha, c);
    commitsAll = [...bySha.values()].sort((a, b) => b.ts - a.ts);
    const pushes = [];
    for (const p of S.pushes) {
      const root = p.dir ? await findRoot($, p.dir) : null;
      pushes.push({ ts: p.ts, ok: p.ok, ref: p.ref ?? null, repo: root ? base(root) : null });
    }
    // 결과물(이 대화가 한 일)과 Git(저장소 상태)은 같은 갱신에서 나오지만 따로 담는다.
    // 기록된 PR 은 주소로 지금 상태를 다시 읽는다(GitHub 에서 머지하고 main 으로 돌아온 경우)
    const prs = [];
    for (const p of S.prs.slice(-5)) {
      const live = p.url ? await prByUrl($, p.url) : null;
      prs.push(live?.number ? { ...p, state: live.state, draft: live.draft, checks: live.checks } : p);
    }
    S.session = shipSummary({ touchedCount: S.touched.size, prs, pushes }, repos, commitsAll, leftover, outside, S.home);
    S.git = { at: Date.now(), repos };
  } catch (err) {
    S.git = { at: Date.now(), error: String(err && err.message ? err.message : err), repos: [] };
  } finally {
    S.gitBusy = false;
    S.dirty = true;
  }
}

async function verifyGit($) {
  S.verifying = true;
  $.ui.invalidate('ui.render');
  try {
    await refreshGit($, true);
  } finally {
    S.verifying = false;
    $.ui.invalidate('ui.render');
  }
}

/** /crew status · 화면이 없을 때: 지금 값을 모두 새로 읽는다 */
async function refreshAll($) {
  await Promise.all([refreshAgents($), refreshSystem($), refreshGit($, true), refreshWhere($)]);
}

// ---- 창 열기 · 박자 -----------------------------------------------------------------------------------------------
async function refreshPaneState($) {
  try {
    const [panes, surf] = await Promise.all([$.ui.panes(), $.session.surfaces()]);
    const snap = panes.map((p) => ({ id: p.id, isPlaced: p.isPlaced, isShown: p.isShown }));
    if (JSON.stringify(snap) !== JSON.stringify(DIAG.panes)) {
      DIAG.panes = snap;
      diagDirty = true;
    }
    // 아무 화면도 붙어 있지 않거나(원격 제어가 끊김), 다른 탭 뒤에 있거나, 아직 자리를 못 잡은 창이면 다시 그리기 · 무거운 일을 쉰다
    S.paneOpen = surf.length > 0 && panes.some((p) => p.id === PANE && p.isShown !== false && p.isPlaced !== false);
  } catch {
    S.paneOpen = false;
  }
}

/** 창이 막 열렸을 때: 다음 박자에 바로 다시 그리고, 무거운 값(서버 · git)을 바로 채운다 */
function kick($) {
  S.paneOpen = true;
  S.dirty = true;
  refreshSystem($).catch(() => {});
  refreshGit($).catch(() => {});
  refreshWhere($).catch(() => {});
}

/** 첫 턴에 저절로 열기 */
async function autoOpen($) {
  try {
    if ((await openPane($, 'auto'))?.isPlaced !== false) kick($);
  } catch {
    /* 못 열면 /crew 로 */
  }
}

async function tick($) {
  S.tickN += 1;
  const changed = await refreshAgents($);
  // 방금 다시 그려졌으면(다시 보이기 시작) 이번 박자는 창 상태를 묻지 않고 바로 읽는다
  const woke = S.wake;
  S.wake = false;
  if (S.tickN % 3 === 1 && !woke) await refreshPaneState($);
  if (S.paneOpen) {
    // 창이 보일 때만: 서버 4초, git 7초(편집 직후는 직전 갱신에서 3초 뒤에야 다시)
    if (woke || S.tickN % 4 === 0) refreshSystem($).catch(() => {});
    if (woke || S.tickN % 7 === 0 || (S.needGit && Date.now() - (S.git?.at || 0) >= 3000)) {
      S.needGit = false;
      refreshGit($).catch(() => {});
    }
    // 바뀐 게 있으면 바로, 시간만 흘렀으면 일하는 동안 2초 · 쉬는 동안 10초에 한 번(흐름의 오른쪽 끝 = 지금)
    const now = Date.now();
    if (changed || S.dirty || now - S.lastInval >= (isLive() ? 2000 : 10000)) {
      S.dirty = false;
      S.lastInval = now;
      $.ui.invalidate('ui.render');
    }
  }
  await saveFacts($);
  await saveDiag($);
}

// ---- 훅 ------------------------------------------------------------------------------------------------------------------
export function register(on) {
  on('session.start', async ($, e, next) => {
    S.startedAt = Date.now();
    S.cwd = e.cwd || S.cwd;
    try {
      S.cwd = await $.session.cwd();
      S.home = (await $.env.get('HOME')) || '';
    } catch {
      /* 값을 못 읽어도 창은 뜬다 */
    }
    await restoreFacts($);
    try {
      DIAG.sessionId = await $.session.id();
      DIAG.version = (await $.session.version()).version;
      diagDirty = true;
    } catch {
      /* 진단 머리말 없이 */
    }
    await refreshWhere($);
    $.clock.every(1000, () => tick($));
    await $.command.register({ name: 'crew', description: '세션 창(오른쪽 탭 "세션": 에이전트 · 작업 · 서버) 열고 닫기 (status: 글자 요약 · debug: 창이 안 뜰 때 진단)', argumentHint: '[status|debug]' });
    return next(e);
  });

  on('command.run', { command: 'crew' }, async ($, e) => {
    // `/crew status` — 창을 못 그리는 곳(원격 제어 · -p)에서도 보이는 글자 요약
    if (/^\s*(status|text|상태)(?=\s|$)/.test(e.args || '')) {
      await refreshAll($);
      return { text: statusText(snapshotView()) };
    }
    // `/crew debug` — 창이 안 뜰 때 엔진이 보는 것(붙은 화면 · 창 열기 결과 · 그리기 요청)
    if (/^\s*(debug|진단)(?=\s|$)/.test(e.args || '')) {
      await Promise.all([refreshWhere($), refreshPaneState($)]);
      await saveDiag($);
      return { text: diagText() };
    }
    // 자리를 못 잡고 기다리는 창(isPlaced false)은 닫지 않고 연다 — 사람이 부른 열기는 폭과 상관없이 놓인다
    const panes = await $.ui.panes();
    if (panes.some((p) => p.id === PANE && p.isPlaced !== false)) {
      await $.ui.close({ id: PANE });
      S.paneOpen = false;
      await setPref($, false); // 닫았으면 다음부터 저절로 열지 않는다
      return {};
    }
    await openPane($, '/crew');
    await setPref($, true);
    // 원격 제어(claude remote)로 붙은 화면은 엔진에 '그릴 화면'으로 붙지 않는다 — 창이 열려도 아무도 그리지 않으니
    // 무거운 갱신은 시작하지 않고(화면이 붙으면 그때 그린다) 지금 값을 글자로 보여 준다
    const surf = await $.session.surfaces();
    if (!surf.length) {
      await refreshAll($);
      return { text: `${NO_SURFACE_NOTE}\n\n${statusText(snapshotView())}` };
    }
    kick($);
    return {};
  });

  // 창이 닫히면 다시 그리기 · 무거운 일을 멈춘다(저절로 열기는 /crew 로 닫을 때만 끈다 — 실수로 누른 Esc 가 모든 세션에 남지 않게)
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) S.paneOpen = false;
    return next(e);
  });

  // 구역(Client)이 보낸 값 — 작업 구역의 '다시 확인'(↻)
  on('ui.message', async ($, e, next) => {
    const data = e.data && typeof e.data === 'object' ? e.data : null;
    if (e.requestId === PANE && data && data.action === 'verify') {
      if (!S.verifying) verifyGit($).catch(() => {});
      return {};
    }
    return next(e);
  });

  on('turn.start', async ($, e, next) => {
    S.main.busy = true;
    if (S.main.firstAt == null) S.main.firstAt = Date.now();
    mark();
    // 첫 턴에 한 번 저절로 연다 — 옆 창으로 놓이는 데스크톱에서만, 사람이 /crew 로 닫아 둔 적이 있으면(pref:autoOpen=false) 열지 않는다.
    // 데스크톱이 아직 안 붙었으면 다음 턴에 다시 본다
    if (!S.autoOpened) {
      const surf = await $.session.surfaces(); // never rejects
      if (!surf.includes('desktop') && !DIAG.notes.some((n) => n.kind === 'no-desktop')) diagPush(DIAG.notes, { kind: 'no-desktop', text: `첫 턴에 붙은 화면이 [${surf.join(', ')}] 라 저절로 열지 않았어요` });
      if (surf.includes('desktop')) {
        S.autoOpened = true;
        let pref;
        try {
          pref = await $.store.get(PREF_AUTO_OPEN);
        } catch {
          pref = undefined;
        }
        if (pref !== false) await autoOpen($);
      }
    }
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      S.main.busy = false;
      S.main.tool = null;
      S.main.lastTurnEnd = Date.now();
    } else {
      // 목록에 없는 작업자는 자기 턴이 끝나면 끝(목록에 있는 에이전트는 목록의 상태를 따른다)
      const m = S.agentMeta.get(e.agentId);
      if (m && !m.listed) {
        m.tool = null;
        finish(m, Date.now(), e.reason === 'error' || e.reason === 'aborted');
      }
    }
    mark();
    return next(e);
  });

  // 서브에이전트의 정확한 시작 · 끝 (워크플로 에이전트는 목록에 없지만 여기로는 온다)
  on('classic.SubagentStart', async ($, e, next) => {
    if (e.agent_id) {
      const m = metaFor(e.agent_id);
      reopen(m);
      m.startAt = Math.min(m.startAt, Date.now());
      if (!m.listed && e.agent_type) m.type = e.agent_type;
      mark();
    }
    return next(e);
  });

  on('classic.SubagentStop', async ($, e, next) => {
    const m = e.agent_id ? S.agentMeta.get(e.agent_id) : null;
    if (m) {
      m.stopAt = Date.now();
      m.tool = null;
      if (!m.listed) finish(m, m.stopAt, false);
      mark();
    }
    return next(e);
  });

  // 도구가 돌아가는 동안 그 에이전트의 "지금 하는 일"로 보인다 + 흐름의 눈금
  on('tool.call', async ($, e, next) => {
    const key = e.agentId ?? 'main';
    const t = { name: e.tool, ts: Date.now(), ...toolInfo(e.tool, e) };
    startTool(key, t);
    try {
      return await next(e);
    } finally {
      endTool(key, t);
    }
  });

  // 성공한 도구의 결과에서 편집 · 커밋 · 푸시 · PR 사실을 모은다
  on('classic.PostToolUse', async ($, e, next) => {
    const input = e.tool_input || {};
    const name = String(e.tool_name || '');
    if (FILE_TOOLS.has(name)) {
      const p = input.file_path || input.notebook_path;
      if (p) {
        S.touched.set(p, { ts: Date.now() });
        S.needGit = true;
        mark();
      }
    } else if (name === 'Bash' && typeof input.command === 'string' && shipKinds(input.command).length) {
      const dir = commandDir(input.command, e.cwd || S.cwd); // e.cwd = 그 명령의 셸 위치(작업 트리 에이전트면 작업 트리)
      const found = parseShipResult(input.command, flatten(e.tool_response), dir);
      for (const c of found.commits) S.commits.push({ ...c, ts: Date.now() });
      for (const p of found.pushes) S.pushes.push({ ...p, ts: Date.now() });
      for (const p of found.prs) addPr(p);
      S.needGit = true;
      mark();
    } else if (PR_TOOL.test(name)) {
      // MCP 의 PR 도구(create_pull_request · merge_pull_request …) — 결과의 github.com/…/pull/N 주소
      for (const p of prFactsFromTool(name, input, flatten(e.tool_response))) addPr(p);
    }
    return next(e);
  });

  on('classic.PostToolUseFailure', async ($, e, next) => {
    if (e.tool_name === 'Bash' && typeof e.tool_input?.command === 'string') {
      const cmd = e.tool_input.command;
      // `commit && push` 에서 푸시만 실패해도 커밋은 됐다 — 오류 글(종료 코드 + stderr + stdout)에서 커밋 줄을 건진다
      if (shipKinds(cmd).includes('commit')) {
        for (const c of parseShipResult(cmd, String(e.error || ''), commandDir(cmd, e.cwd || S.cwd)).commits) {
          S.commits.push({ ...c, ts: Date.now() });
          S.needGit = true;
          mark();
        }
      }
    }
    return next(e);
  });

  // 어디서 보고 있는지(휴대폰 · 데스크톱 앱이 붙고 떨어짐) — 진단에 남기고, 아무도 안 보면 다시 그리기를 쉰다
  on('session.attach', async ($, e, next) => {
    diagPush(DIAG.attaches, { surface: e.surface, clientId: e.clientId, isFullscreen: e.viewport?.isFullscreen ?? null, columns: e.viewport?.columns ?? null });
    if (e.surface && !S.where.surfaces.includes(e.surface)) S.where = { ...S.where, surfaces: [...S.where.surfaces, e.surface] };
    S.dirty = true;
    $.clock.after(500, () => refreshWhere($).then(() => refreshPaneState($)));
    return next(e);
  });

  on('session.detach', async ($, e, next) => {
    diagPush(DIAG.detaches, { clientId: e.clientId ?? null });
    S.dirty = true;
    $.clock.after(500, () => refreshWhere($).then(() => refreshPaneState($)));
    return next(e);
  });

  // /clear · /resume 뒤에는 이 대화의 흔적을 비운다(같은 프로세스가 다른 대화 id 로 이어 간다)
  on('classic.SessionStart', { source: ['clear', 'resume'] }, async ($, e, next) => {
    S.main = { ...S.main, tool: null, lastTool: null, lastToolAt: 0, firstAt: null, lastTurnEnd: null, marks: [] };
    for (const [id, m] of S.agentMeta) {
      if (m.status === 'done' || m.status === 'error') {
        S.cleared.add(id);
        S.agentMeta.delete(id);
      }
    }
    S.touched = new Map();
    S.commits = [];
    S.pushes = [];
    S.prs = [];
    S.session = null;
    S.startedAt = Date.now();
    try {
      S.sessionId = (await $.session.id()) || S.sessionId;
    } catch {
      /* 같은 id 로 계속 */
    }
    S.needGit = true;
    mark();
    return next(e);
  });

  // 창 그리기: 에이전트 · 작업 · 서버. 데스크톱 · 터미널은 Client(움직임), 휴대폰 · VS Code 는 같은 모듈의 정지 화면
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // 그려 달라는 요청 = 창이 보인다. 쉬고 있었다면 다음 박자에 바로 새로 읽는다(무거운 일은 그리기 밖에서)
    if (!S.paneOpen) S.wake = true;
    S.paneOpen = true;
    const cols = e.props?.bodyColumns ?? e.viewport?.columns ?? null;
    const rows = e.props?.scroll?.bodyRows ?? null;
    DIAG.renders[e.surface] = (DIAG.renders[e.surface] || 0) + 1;
    DIAG.lastRender = { at: new Date().toISOString(), surface: e.surface, columns: cols, rows, isFullscreen: e.viewport?.isFullscreen ?? null };
    diagDirty = true;
    const el = $.ui.resolve(e);
    const d = { ...snapshotView(), surface: e.surface, cols, rows };
    // 정지 화면(휴대폰 · VS Code)의 '다시 확인' 은 여기로 바로 온다
    const actions = { post: (data) => (data && data.action === 'verify' && !S.verifying ? verifyGit($).catch(() => {}) : undefined) };
    return paneView(el, d, actions);
  });
}
