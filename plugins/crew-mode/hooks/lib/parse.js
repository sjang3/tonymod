// 도구 해석 · 무대 · 흐름 모델 — 순수 함수($ 없음). register.js 가 모은 사실(도구 호출 · 에이전트 목록)을 화면이 그릴 값으로 바꾼다.

// ---- 문자열 · 시간 도우미 ------------------------------------------------------------------
export const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
export const trunc = (s, n = 48) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim()) ?? '';

/** 걸린 시간을 짧게 — 40초 · 6분 · 1시간 5분 (흐름 오른쪽 칸 · 머리의 "6분 전") */
export function shortDur(ms) {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
}

// ---- 도구 ------------------------------------------------------------------------------------
/** 도구 호출 → 화면에 보일 동사 · 대상 · 소품. 입력은 tool.call 의 e (인자가 e 의 필드) */
export function toolInfo(name, input = {}) {
  const t = (s, n = 40) => trunc(s, n);
  switch (name) {
    case 'Read':
      return { verb: '읽는 중', target: base(input.file_path), prop: 'book' };
    case 'Edit':
    case 'MultiEdit':
      return { verb: '고치는 중', target: base(input.file_path), prop: 'pencil' };
    case 'Write':
      return { verb: '쓰는 중', target: base(input.file_path), prop: 'pencil' };
    case 'NotebookEdit':
      return { verb: '노트북 고치는 중', target: base(input.notebook_path), prop: 'pencil' };
    case 'Bash':
      return { verb: '명령 실행', target: t(input.description || firstLine(input.command)), prop: 'terminal' };
    case 'BashOutput':
      return { verb: '명령 결과 보는 중', target: '', prop: 'terminal' };
    case 'KillShell':
      return { verb: '명령 멈추는 중', target: '', prop: 'terminal' };
    case 'Grep':
      return { verb: '내용 검색', target: t(input.pattern), prop: 'magnifier' };
    case 'Glob':
      return { verb: '파일 찾는 중', target: t(input.pattern), prop: 'magnifier' };
    case 'LS':
      return { verb: '폴더 보는 중', target: base(input.path), prop: 'magnifier' };
    case 'WebSearch':
      return { verb: '웹 검색', target: t(input.query), prop: 'globe' };
    case 'WebFetch': {
      let host = '';
      try {
        host = new URL(input.url).hostname;
      } catch {
        /* 주소가 아니면 비운다 */
      }
      return { verb: '웹 페이지 읽는 중', target: host, prop: 'globe' };
    }
    case 'Agent':
    case 'Task':
      return { verb: '에이전트 호출', target: t(input.description), prop: 'radio' };
    case 'SendMessage':
      return { verb: '메시지 보내는 중', target: t(input.to || input.recipient || ''), prop: 'radio' };
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return { verb: '할 일 정리', target: '', prop: 'clipboard' };
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return { verb: '계획 세우는 중', target: '', prop: 'clipboard' };
    case 'Skill':
      return { verb: '스킬 사용', target: t(input.skill), prop: 'scroll' };
    case 'ToolSearch':
      return { verb: '도구 찾는 중', target: '', prop: 'magnifier' };
    case 'AskUserQuestion':
      return { verb: '질문하는 중', target: '', prop: 'question' };
    case 'Workflow':
      return { verb: '워크플로 실행', target: '', prop: 'radio' };
    default: {
      const m = /^mcp__(.+?)__(.+)$/.exec(name || '');
      if (m) return { verb: '외부 도구', target: `${m[1].replace(/^claude_ai_/, '')}/${m[2]}`, prop: 'plug' };
      return { verb: name || '도구', target: '', prop: 'plug' };
    }
  }
}

/** 에이전트를 새로 띄우는 도구(이 도구가 도는 동안 처음 보인 작업자는 그 갈래의 자식으로 본다) */
export const SPAWN_TOOLS = new Set(['Agent', 'Task', 'Workflow']);

// ---- 무대 모델 ------------------------------------------------------------------------------------
export const LINGER_TOOL_MS = 3000;
export const LINGER_DONE_MS = 12000;
const GRID_MAX = 9;

const toolView = (t) => (t ? { name: t.name, verb: t.verb, target: t.target, prop: t.prop } : null);
const RANK = { working: 0, thinking: 0, spawning: 0, waiting: 1, done: 2 };

/** AgentStatus → 흐름 갈래의 상태 */
export function laneStatusOf(status) {
  if (status === 'running') return 'running';
  if (status === 'completed') return 'done';
  if (status === 'failed' || status === 'killed') return 'error';
  return 'waiting'; // idle · waiting · pending
}

/**
 * 순수 입력 → 무대가 그릴 모델 d.agents.
 * input: { now, main: { busy, tool, lastTool, lastToolAt },
 *          agents: [{ id, type, name?, description, status, parentKey?, tool, lastTool, lastToolAt, tools, seenAt, doneAt }] }
 * 끝낸 지 오래된 에이전트는 무대에서 내려와 선반(shelf)으로 — 실패한 에이전트는 무대에 남긴다.
 */
export function buildStage(input) {
  const { now, main, agents } = input;
  const current = (a) => a.tool || (a.lastTool && a.lastToolAt && now - a.lastToolAt < LINGER_TOOL_MS ? a.lastTool : null);

  const mainTool = current(main);
  const mainState = main.busy ? (mainTool ? 'working' : 'thinking') : 'idle';
  const mainView = { state: mainState, tool: toolView(mainState === 'working' ? mainTool : null), error: false };

  const grid = [];
  const shelf = [];
  for (const a of agents) {
    let state;
    let error = false;
    if (a.status === 'running') {
      const t = current(a);
      state = t ? 'working' : a.seenAt && now - a.seenAt < 1500 && !a.tools ? 'spawning' : 'thinking';
    } else if (a.status === 'completed') state = 'done';
    else if (a.status === 'failed' || a.status === 'killed') {
      state = 'done';
      error = true;
    } else if (a.status === 'idle' || a.status === 'waiting' || a.status === 'pending') state = 'waiting';
    else state = 'spawning';
    const view = { key: a.id, type: a.type || 'general-purpose', name: a.name || null, desc: trunc(a.description || '', 70), state, error, tool: toolView(state === 'working' ? current(a) : null), parentKey: a.parentKey || 'main' };
    const finished = state === 'done';
    if (finished && !error && !(a.doneAt && now - a.doneAt < LINGER_DONE_MS)) shelf.push({ key: view.key, type: view.type, name: view.name, error: false });
    else grid.push(view);
  }
  grid.sort((x, y) => RANK[x.state] - RANK[y.state]);
  const shown = grid.slice(0, GRID_MAX);
  // 부모가 무대에 없으면 Claude 에게서 선을 잇는다
  const keys = new Set(shown.map((a) => a.key));
  for (const a of shown) if (a.parentKey !== 'main' && (!keys.has(a.parentKey) || a.parentKey === a.key)) a.parentKey = 'main';
  return { main: mainView, crew: shown, shelf, moreBusy: grid.slice(GRID_MAX).filter((a) => a.state !== 'done').length };
}

// ---- 흐름(스윔레인) 모델 -------------------------------------------------------------------------------
export const FLOW_WINDOW_MS = 15 * 60000;
export const FLOW_MAX_LANES = 7;
const FLOW_MIN_SPAN_MS = 30000;

/**
 * 순수 입력 → 흐름 그림의 모델 d.flow.
 * input: { now, startedAt, main: { startAt, endAt, status, marks },
 *          lanes: [{ key, kind, type, label, parentKey, startAt, endAt, status, marks }] }  (marks: 도구를 쓴 시각 [{ t }])
 * main.startAt 이 null 이면 Claude 가 아직 한 번도 일하지 않은 것(갈래는 빈 줄).
 * 보이는 갈래: 아직 도는 것 먼저, 남는 자리는 최근에 끝난 것. 최대 7개, 나머지는 hidden.
 */
export function buildFlow(input) {
  const { now, startedAt = 0, main, lanes = [] } = input;
  const max = input.maxLanes ?? FLOW_MAX_LANES;
  const baseT0 = Math.max(startedAt || 0, now - (input.windowMs ?? FLOW_WINDOW_MS));
  const cand = lanes.filter((l) => l.endAt == null || l.endAt >= baseT0);
  const live = cand.filter((l) => l.status === 'running' || l.status === 'waiting').sort((a, b) => b.startAt - a.startAt);
  const ended = cand.filter((l) => l.status === 'done' || l.status === 'error').sort((a, b) => (b.endAt ?? 0) - (a.endAt ?? 0));
  const picked = live.slice(0, max);
  for (const l of ended) if (picked.length < max) picked.push(l);
  picked.sort((a, b) => a.startAt - b.startAt || String(a.key).localeCompare(String(b.key)));

  const mainStart = main.startAt ?? null;
  const earliest = Math.min(mainStart ?? now, ...picked.map((l) => l.startAt));
  const margin = Math.max(2000, (now - earliest) * 0.04);
  let t0 = Math.max(baseT0, earliest - margin);
  if (now - t0 < FLOW_MIN_SPAN_MS) t0 = now - FLOW_MIN_SPAN_MS;

  const keys = new Set(picked.map((l) => l.key));
  const marksOf = (ms) => (ms || []).filter((m) => m.t >= t0 && m.t <= now).slice(-60).map((m) => ({ t: m.t }));
  const mainLane = { key: 'main', kind: 'main', type: 'main', label: 'Claude', parentKey: null, startAt: mainStart, endAt: main.endAt ?? null, status: main.status || 'waiting', marks: marksOf(main.marks) };
  const out = picked.map((l) => ({
    key: l.key,
    kind: l.kind,
    type: l.type,
    label: l.label,
    parentKey: l.parentKey && l.parentKey !== 'main' && keys.has(l.parentKey) && l.parentKey !== l.key ? l.parentKey : 'main',
    startAt: l.startAt,
    endAt: l.endAt ?? null,
    status: l.status,
    marks: marksOf(l.marks),
  }));
  return { t0, now, lanes: [mainLane, ...out], hidden: lanes.length - picked.length };
}
