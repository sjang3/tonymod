// crew-mode 의 $.state 계약 — 이 세션의 에이전트 · 흐름 사실과 이 대화가 한 일(편집 · 커밋 · 푸시 · PR)을 한 값으로 비춰 둔다.
// 핫 리로드나 /reload-plugins 뒤에도 같은 세션이면 session.start 에서 되살린다.
// (v: 4 = v0.5 — work-status 를 다시 합쳤다. v0.4 의 v: 3 · v0.3 의 v: 2 값도 에이전트 · 흐름 부분은 같은 모양이라 그대로 읽는다.
//  토큰 · 사용량은 usage-bar 가 따로 가진다.)

/** 흐름 갈래의 눈금 하나(도구 호출 한 번) — 그 시각의 칸이 갈래 색으로 진해진다 */
export type CrewMark = {
  t: number;
};

/** 도구 한 번(진행 중이거나 막 끝난 것) */
export type CrewTool = {
  name: string;
  ts: number;
  verb: string;
  target: string;
  /** 손에 든 소품의 이름(book · pencil · terminal · magnifier …) */
  prop: string;
};

/** 에이전트 · 작업자 하나의 기록 */
export type CrewAgentFact = {
  id: string;
  seenAt: number;
  startAt: number;
  endAt: number | null;
  doneAt: number | null;
  stopAt: number | null;
  status: 'running' | 'waiting' | 'done' | 'error';
  rawStatus: string | null;
  listed: boolean;
  type: string | null;
  name: string | null;
  desc: string;
  parentKey: string;
  workerN: number;
  tools: number;
  lastTool: CrewTool | null;
  lastToolAt: number;
  lastActAt: number;
  marks: CrewMark[];
};

/** 이 대화가 고친 파일 하나 */
export type CrewTouched = { path: string; ts: number };

/** 이 대화의 Bash 결과에서 읽은 커밋 하나(dir = 명령을 실행한 폴더 — 워크트리면 워크트리) */
export type CrewCommit = { hash: string; branch: string; subject: string; dir: string | null; ts: number };

/** 이 대화의 푸시 하나(올라간 ref 줄이 있을 때만) */
export type CrewPush = { ok: boolean; ref: string | null; dir: string | null; ts: number };

/** 이 대화가 만들거나 머지한 PR 하나 */
export type CrewPr = { url: string | null; repo: string | null; number: number; action: 'create' | 'merge'; title: string | null; ts: number };

export type CrewFacts = {
  v: 4;
  sessionId: string;
  savedAt: number;
  startedAt: number;
  /** 첫 턴의 저절로 열기를 이미 했는가(다시 불러와도 또 열지 않게) */
  autoOpened: boolean;
  /** Claude 의 갈래: 처음 일한 시각 · 마지막 턴이 끝난 시각 · 도구 눈금 */
  main: { firstAt: number | null; lastTurnEnd: number | null; marks: CrewMark[] };
  agents: CrewAgentFact[];
  workerSeq: number;
  /** /clear 전에 끝난 에이전트 id — 목록에 남아 있어도 다시 세지 않는다 */
  cleared: string[];
  touched: CrewTouched[];
  commits: CrewCommit[];
  pushes: CrewPush[];
  prs: CrewPr[];
};

declare module 'claude-code' {
  interface PluginState {
    'crew-mode': { facts: CrewFacts };
  }
}
