// usage-bar 견본 값 — 시험(usage.test.ts)과 미리보기(크롬 스크린샷)가 같이 쓴다.
// USAGE 는 엔진의 `$.session.usage()` · `session.measure` 모양 그대로, CONVO 는 turn.complete 의 usage 를 더한 값.

export const NOW = 1791360000000; // 2026-10-07 17:00 KST (수요일)
const M = 60000;
const H = 60 * M;
const D = 24 * H;
const iso = (t) => new Date(t).toISOString();

export const USAGE = {
  /** 설계서 스케치 그대로: 5시간 62% 남음 · 2시간 10분 뒤, 이번 주 39% 남음 · ⚑ 63% 지남, 412k 토큰 · 컨텍스트 18% · 약 $3.20 */
  known: {
    startedAt: NOW - 3 * H,
    context: { window: 1000000, tokens: 182000, percent: 18 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 38, resetsAt: iso(NOW + 2 * H + 10 * M) },
      { kind: 'seven_day', percentUsed: 61, resetsAt: iso(NOW + 2 * D + 14 * H) },
      { kind: 'seven_day_opus', percentUsed: 44, resetsAt: iso(NOW + 2 * D + 14 * H) },
    ],
    cost: { usd: 3.2 },
  },
  /** 첫 응답 전: 한도 값도 컨텍스트 채움도 없다 */
  unknown: {
    startedAt: NOW,
    context: { window: 200000 },
    rateLimits: [],
  },
  /** 한도 가까이: 5시간 7% 남음(빨강), 이번 주 22% 남음(주황) · 빨리 쓰는 중, 컨텍스트 90% */
  nearLimit: {
    startedAt: NOW - 4 * H,
    context: { window: 1000000, tokens: 902000, percent: 90 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 93, resetsAt: iso(NOW + 25 * M) },
      { kind: 'seven_day', percentUsed: 78, resetsAt: iso(NOW + 4 * D + 4 * H) },
    ],
    cost: { usd: 11.47 },
  },
  /** API 키(구독 아님): 응답은 왔지만 한도 값이 끝내 없다 */
  apiKey: {
    startedAt: NOW - H,
    context: { window: 200000, tokens: 52000, percent: 26 },
    rateLimits: [],
    cost: { usd: 0.84 },
  },
};

export const CONVO = {
  /** 새 토큰 412k = 입력 38k + 출력 96k + 캐시 쓰기 278k (캐시 읽기 5.8M 은 빼고) */
  known: { v: 1, sessionId: 'sess-1', in: 38000, out: 96000, cr: 5800000, cc: 278000 },
  unknown: { v: 1, sessionId: 'sess-1', in: 0, out: 0, cr: 0, cc: 0 },
  nearLimit: { v: 1, sessionId: 'sess-1', in: 312000, out: 288000, cr: 21400000, cc: 1410000 },
  apiKey: { v: 1, sessionId: 'sess-1', in: 21000, out: 9400, cr: 310000, cc: 48000 },
};

/** turn.complete 의 usage 로 쪼갠 known 의 토큰 — 메인 턴 둘 + 서브에이전트 턴 하나 */
export const TURNS = [
  { agentId: undefined, usage: { input_tokens: 20000, output_tokens: 50000, cache_read_input_tokens: 3000000, cache_creation_input_tokens: 150000, model: 'claude-opus-5-5' } },
  { agentId: 'agent-1', usage: { input_tokens: 8000, output_tokens: 16000, cache_read_input_tokens: 800000, cache_creation_input_tokens: 48000, model: 'claude-sonnet-4-5' } },
  { agentId: undefined, usage: { input_tokens: 10000, output_tokens: 30000, cache_read_input_tokens: 2000000, cache_creation_input_tokens: 80000, model: 'claude-opus-5-5' } },
];

export const FIXTURES = ['known', 'unknown', 'nearLimit', 'apiKey'];
