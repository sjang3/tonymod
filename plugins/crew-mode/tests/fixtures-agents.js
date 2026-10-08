// 시험 · 미리보기용 스냅샷(에이전트 부분) — 순수 데이터. views.js 가 받는 `d`(데이터 계약)의
//   { now, version, agents: parse.js buildStage() 의 모양, flow: parse.js buildFlow() 의 모양 }. 작업 · 서버 부분은 fixtures-work.js
// 시각은 모두 NOW 기준으로 고정(Date.now() 없음) — 같은 파일이면 언제 돌려도 같은 그림이 나온다.

export const NOW = 1791360000000; // 2026-10-07 17:00 KST (수요일)

const S = 1000;
const M = 60 * S;

// ---- 도구 모양 (ToolView) -------------------------------------------------------------------
const TOOL = {
  read: (target) => ({ name: 'Read', verb: '읽는 중', target, prop: 'book' }),
  grep: (target) => ({ name: 'Grep', verb: '내용 검색', target, prop: 'magnifier' }),
  glob: (target) => ({ name: 'Glob', verb: '파일 찾는 중', target, prop: 'magnifier' }),
  edit: (target) => ({ name: 'Edit', verb: '고치는 중', target, prop: 'pencil' }),
  write: (target) => ({ name: 'Write', verb: '쓰는 중', target, prop: 'pencil' }),
  bash: (target) => ({ name: 'Bash', verb: '명령 실행', target, prop: 'terminal' }),
  fetch: (target) => ({ name: 'WebFetch', verb: '웹 페이지 읽는 중', target, prop: 'globe' }),
  agent: (target) => ({ name: 'Agent', verb: '에이전트 호출', target, prop: 'radio' }),
  todo: () => ({ name: 'TodoWrite', verb: '할 일 정리', target: '', prop: 'clipboard' }),
  mcp: (target) => ({ name: 'mcp__github__create_pull_request', verb: '외부 도구', target, prop: 'plug' }),
};

/** [몇 초 전, 도구] 목록 → 흐름 눈금(도구를 쓴 시각, 오래된 것 → 새것) */
function marks(rows) {
  return rows.map(([secAgo]) => ({ t: NOW - secAgo * S })).sort((a, b) => a.t - b.t);
}

const lane = (o) => ({ parentKey: 'main', endAt: null, status: 'running', marks: [], ...o });
const mainLane = (o) => ({ key: 'main', kind: 'main', type: 'main', label: 'Claude', parentKey: null, endAt: null, status: 'running', marks: [], ...o });

// =================================================================================================
// 1) busySession — 일이 한창: Claude 가 테스트를 돌리고, Explore · 작업자 1 이 일하는 중, Plan 은 방금 끝,
//    general-purpose 는 실패, 작업자 2 는 끝내고 쉬는 중. 6분 동안 갈래 6개.
// =================================================================================================
const busyLanes = [
  mainLane({
    startAt: NOW - 360 * S,
    marks: marks([
      [358, TOOL.todo()],
      [352, TOOL.read('auth.ts')],
      [347, TOOL.read('refresh.ts')],
      [340, TOOL.grep('SessionExpired')],
      [331, TOOL.bash('실패하는 테스트 확인')],
      [300, TOOL.agent('로그인 코드 지도 만들기')],
      [210, TOOL.agent('세션 만료 재현 스크립트')],
      [190, TOOL.read('middleware.ts')],
      [176, TOOL.edit('refresh.ts')],
      [168, TOOL.edit('auth.ts')],
      [160, TOOL.bash('테스트 돌리기')],
      [151, { ...TOOL.agent('워크플로 실행'), name: 'Workflow' }],
      [132, TOOL.agent('고치는 순서 정하기')],
      [96, TOOL.fetch('datatracker.ietf.org')],
      [72, TOOL.write('session.test.ts')],
      [30, TOOL.todo()],
      [8, TOOL.bash('테스트 돌리기')],
    ]),
  }),
  lane({
    key: 'a1',
    kind: 'agent',
    type: 'Explore',
    label: 'Explore',
    startAt: NOW - 298 * S,
    marks: marks([
      [296, TOOL.glob('src/**/auth*')],
      [288, TOOL.read('auth.ts')],
      [270, TOOL.read('session.ts')],
      [251, TOOL.grep('refreshToken')],
      [230, TOOL.read('token-store.ts')],
      [180, TOOL.grep('401')],
      [120, TOOL.read('errors.ts')],
      [60, TOOL.grep('SessionExpired')],
      [14, TOOL.grep('refreshToken')],
    ]),
  }),
  lane({
    key: 'a3',
    kind: 'agent',
    type: 'general-purpose',
    label: 'general-purpose',
    startAt: NOW - 208 * S,
    endAt: NOW - 118 * S,
    status: 'error',
    marks: marks([
      [204, TOOL.write('repro-expiry.sh')],
      [190, TOOL.bash('재현 스크립트 실행')],
      [140, TOOL.bash('docker compose up')],
    ]),
  }),
  lane({
    key: 'wf-7c1e',
    kind: 'worker',
    type: 'worker',
    label: '작업자 1',
    startAt: NOW - 150 * S,
    marks: marks([
      [148, TOOL.read('package.json')],
      [120, TOOL.bash('npm test -- auth')],
      [80, TOOL.read('jest.config.ts')],
      [22, TOOL.bash('npm test -- session')],
    ]),
  }),
  lane({
    key: 'wf-9d40',
    kind: 'worker',
    type: 'worker',
    label: '작업자 2',
    startAt: NOW - 140 * S,
    endAt: NOW - 40 * S,
    status: 'done',
    marks: marks([
      [138, TOOL.grep('TODO')],
      [110, TOOL.read('CHANGELOG.md')],
      [70, TOOL.edit('CHANGELOG.md')],
    ]),
  }),
  lane({
    key: 'a2',
    kind: 'agent',
    type: 'Plan',
    label: 'Plan',
    startAt: NOW - 130 * S,
    endAt: NOW - 8 * S,
    status: 'done',
    marks: marks([
      [126, TOOL.read('auth.ts')],
      [100, TOOL.read('refresh.ts')],
      [64, TOOL.grep('expiresAt')],
      [40, TOOL.read('middleware.ts')],
      [12, TOOL.todo()],
    ]),
  }),
];

export const busySession = {
  now: NOW,
  version: '0.4.0',
  agents: {
    main: { state: 'working', tool: TOOL.bash('테스트 돌리기'), error: false },
    crew: [
      { key: 'a1', type: 'Explore', name: null, desc: '로그인 코드 지도 만들기', state: 'working', error: false, tool: TOOL.grep('refreshToken'), parentKey: 'main' },
      { key: 'wf-7c1e', type: 'worker', name: '작업자 1', desc: '', state: 'working', error: false, tool: TOOL.bash('npm test -- session'), parentKey: 'main' },
      { key: 'a2', type: 'Plan', name: null, desc: '고치는 순서 정하기', state: 'done', error: false, tool: null, parentKey: 'main' },
      { key: 'a3', type: 'general-purpose', name: null, desc: '세션 만료 재현 스크립트', state: 'done', error: true, tool: null, parentKey: 'main' },
    ],
    shelf: [{ key: 'wf-9d40', type: 'worker', name: '작업자 2', error: false }],
    moreBusy: 0,
  },
  flow: { t0: NOW - 375 * S, now: NOW, lanes: busyLanes, hidden: 0 },
};

// =================================================================================================
// 2) freshSession — 아직 아무 일도 없다: Claude 혼자 쉬는 중, 흐름은 Claude 의 빈 갈래 하나
// =================================================================================================
export const freshSession = {
  now: NOW,
  version: '0.4.0',
  agents: {
    main: { state: 'idle', tool: null, error: false },
    crew: [],
    shelf: [],
    moreBusy: 0,
  },
  flow: { t0: NOW - 30 * S, now: NOW, lanes: [mainLane({ startAt: null, status: 'waiting' })], hidden: 0 },
};

// =================================================================================================
// 3) restingSession — 일을 마치고 쉬는 중: Claude 는 다음 요청을 기다리고, 에이전트는 모두 선반에
// =================================================================================================
const restingLanes = [
  mainLane({
    startAt: NOW - 11 * M,
    endAt: NOW - 90 * S,
    status: 'waiting',
    marks: marks([
      [655, TOOL.read('README.md')],
      [600, TOOL.agent('랜딩 페이지 구조 살피기')],
      [420, TOOL.edit('hero.tsx')],
      [300, TOOL.bash('npm run build')],
      [120, TOOL.bash('npm run lint')],
    ]),
  }),
  lane({ key: 'r1', kind: 'agent', type: 'Explore', label: 'Explore', startAt: NOW - 10 * M, endAt: NOW - 7 * M, status: 'done', marks: marks([[590, TOOL.glob('app/**/*.tsx')], [520, TOOL.read('page.tsx')], [450, TOOL.grep('Hero')]]) }),
  lane({ key: 'r2', kind: 'agent', type: 'Plan', label: 'Plan', startAt: NOW - 7 * M, endAt: NOW - 5 * M, status: 'done', marks: marks([[410, TOOL.read('hero.tsx')], [330, TOOL.todo()]]) }),
  lane({ key: 'r3', kind: 'agent', type: 'Explore', label: 'Explore', startAt: NOW - 4 * M, endAt: NOW - 2 * M, status: 'done', marks: marks([[230, TOOL.grep('useMotion')], [180, TOOL.read('motion.ts')]]) }),
];

export const restingSession = {
  now: NOW,
  version: '0.4.0',
  agents: {
    main: { state: 'idle', tool: null, error: false },
    crew: [],
    shelf: [
      { key: 'r1', type: 'Explore', name: null, error: false },
      { key: 'r2', type: 'Plan', name: null, error: false },
      { key: 'r3', type: 'Explore', name: null, error: false },
    ],
    moreBusy: 0,
  },
  flow: { t0: NOW - 11 * M - 30 * S, now: NOW, lanes: restingLanes, hidden: 0 },
};

// =================================================================================================
// 4) nestedAgents — 에이전트가 에이전트를 부름(reviewer → Explore), 막 출근한 에이전트, 쉬는 Explore
// =================================================================================================
const nestedLanes = [
  mainLane({
    startAt: NOW - 11 * M - 40 * S,
    marks: marks([
      [698, TOOL.todo()],
      [690, TOOL.bash('go test ./payments/... -run TestCharge -count=20')],
      [660, TOOL.agent('결제 테스트 위치 찾기')],
      [470, TOOL.read('charge_test.go')],
      [430, TOOL.edit('retry.go')],
      [380, TOOL.bash('go test ./payments/... -count=50')],
      [362, TOOL.agent('결제 모듈 변경 검토')],
      [120, TOOL.read('ci.yml')],
      [3, TOOL.agent('재시도 로직 벤치마크')],
    ]),
  }),
  lane({ key: 'b0', kind: 'agent', type: 'Explore', label: 'Explore', startAt: NOW - 11 * M, endAt: NOW - 8 * M, status: 'done', marks: marks([[655, TOOL.glob('**/*_test.go')], [610, TOOL.read('charge_test.go')], [530, TOOL.grep('flaky')]]) }),
  lane({ key: 'wf-1', kind: 'worker', type: 'worker', label: '작업자 1', startAt: NOW - 9 * M, endAt: NOW - 7 * M - 30 * S, status: 'done', marks: marks([[535, TOOL.bash('go vet ./...')], [470, TOOL.bash('golangci-lint run')]]) }),
  lane({ key: 'b1', kind: 'agent', type: 'code-reviewer', label: 'reviewer', startAt: NOW - 6 * M, marks: marks([[355, TOOL.bash('git diff origin/main...')], [300, TOOL.read('charge_test.go')], [245, TOOL.agent('CI 기록에서 불안정한 테스트 찾기')], [6, TOOL.read('charge.go')]]) }),
  lane({ key: 'b2', kind: 'agent', type: 'Explore', label: 'Explore', parentKey: 'b1', startAt: NOW - 4 * M, marks: marks([[235, TOOL.fetch('github.com')], [160, TOOL.read('ci-log-1832.txt')], [95, TOOL.grep('context deadline exceeded')]]) }),
  lane({ key: 'b3', kind: 'agent', type: 'general-purpose', label: 'general-purpose', startAt: NOW - 3 * S }),
];

export const nestedAgents = {
  now: NOW,
  version: '0.4.0',
  agents: {
    main: { state: 'thinking', tool: null, error: false },
    crew: [
      { key: 'b1', type: 'code-reviewer', name: 'reviewer', desc: '결제 모듈 변경 검토', state: 'working', error: false, tool: TOOL.read('charge.go'), parentKey: 'main' },
      { key: 'b2', type: 'Explore', name: null, desc: 'CI 기록에서 불안정한 테스트 찾기', state: 'thinking', error: false, tool: null, parentKey: 'b1' },
      { key: 'b3', type: 'general-purpose', name: null, desc: '재시도 로직 벤치마크', state: 'spawning', error: false, tool: null, parentKey: 'main' },
    ],
    shelf: [{ key: 'b0', type: 'Explore', name: null, error: false }],
    moreBusy: 0,
  },
  flow: { t0: NOW - 12 * M, now: NOW, lanes: nestedLanes, hidden: 0 },
};

// =================================================================================================
// 5) stress — 크기 한도 시험: 갈래 8 (Claude + 7) × 눈금 60, 캐릭터 9 + 선반 6, 숨은 갈래 5, 긴 한국어 · 영어 이름
// =================================================================================================
const LONG_KO = '아주아주 긴 설명이 여기에 들어가서 한 줄에 다 들어가지 않고 계속 이어지는 문장이에요 정말로 길어요';
const LONG_EN = 'Investigate intermittently failing end-to-end checkout tests across every supported locale and currency';
const LONG_PATH = 'src/features/checkout/components/payment-method-selector/__tests__/PaymentMethodSelector.integration.spec.tsx';
const STRESS_TYPES = ['Explore', 'Plan', 'general-purpose', 'code-reviewer', 'statusline-setup', 'security-auditor-with-a-very-long-agent-type-name', 'research-assistant', 'Explore', 'migration-planner'];
const KINDS = ['read', 'search', 'edit', 'run', 'web', 'agent', 'plan', 'ext', 'other'];
const KIND_TOOL = {
  read: () => TOOL.read(LONG_PATH),
  search: () => TOOL.grep('(?i)payment(Method|Intent)Selector\\s*\\(.*locale.*currency'),
  edit: () => TOOL.edit(LONG_PATH),
  run: () => TOOL.bash(`${LONG_KO} — pnpm -r --filter "./packages/**" test -- --runInBand`),
  web: () => TOOL.fetch('developer.mozilla.org'),
  agent: () => TOOL.agent(LONG_EN),
  plan: () => TOOL.todo(),
  ext: () => TOOL.mcp('github/create_pull_request'),
  other: () => ({ name: 'SomeUnknownTool', verb: 'SomeUnknownTool', target: '', prop: 'plug' }),
};

function stressLane(i) {
  const isMain = i === 0;
  const startAt = NOW - (isMain ? 15 * M : (14 - i) * M);
  const done = !isMain && i % 3 === 0;
  const endAt = done ? startAt + 4 * M + i * 7 * S : null;
  const until = endAt ?? NOW;
  const n = 60;
  const step = (until - startAt) / n;
  const ms = Array.from({ length: n }, (_, k) => ({ t: Math.round(startAt + step * (k + 0.5)) }));
  const type = isMain ? 'main' : STRESS_TYPES[(i - 1) % STRESS_TYPES.length];
  const worker = i === 6 || i === 7;
  return {
    key: isMain ? 'main' : `s${i}`,
    kind: isMain ? 'main' : worker ? 'worker' : 'agent',
    type: worker ? 'worker' : type,
    label: isMain ? 'Claude' : worker ? `작업자 ${i - 5}` : `${type}-${i}`,
    parentKey: isMain ? null : i === 4 ? 's2' : i === 5 ? 's4' : 'main',
    startAt,
    endAt,
    status: isMain ? 'running' : done ? (i === 3 ? 'error' : 'done') : i === 5 ? 'waiting' : 'running',
    marks: ms,
  };
}
const stressLanes = Array.from({ length: 8 }, (_, i) => stressLane(i));

const STRESS_CREW_STATES = ['working', 'thinking', 'spawning', 'waiting', 'done', 'working', 'done', 'thinking', 'working'];
const stressCrew = STRESS_CREW_STATES.map((state, i) => ({
  key: `s${i + 1}`,
  type: STRESS_TYPES[i],
  name: i % 4 === 1 ? `${LONG_EN.slice(0, 30)}-${i}` : null,
  desc: `${i % 2 ? LONG_EN : LONG_KO} (${i + 1})`,
  state,
  error: i === 6,
  tool: state === 'working' ? KIND_TOOL[KINDS[i % KINDS.length]]() : null,
  parentKey: i === 3 ? 's2' : i === 4 ? 's4' : 'main',
}));

export const stress = {
  now: NOW,
  version: '0.4.0',
  agents: {
    main: { state: 'working', tool: KIND_TOOL.run(), error: false },
    crew: stressCrew,
    shelf: Array.from({ length: 6 }, (_, i) => ({ key: `old${i}`, type: STRESS_TYPES[(i + 3) % STRESS_TYPES.length], name: null, error: false })),
    moreBusy: 3,
  },
  flow: { t0: NOW - 15 * M, now: NOW, lanes: stressLanes, hidden: 5 },
};

/** 이름 → 스냅샷 (미리보기 · 시험이 돌며 쓴다) */
export const FIXTURES = { busySession, freshSession, restingSession, nestedAgents, stress };
