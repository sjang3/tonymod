// usage-bar 의 $.state 계약 — 띠가 그리는 값. 핫 리로드 · /reload-plugins 뒤에도 같은 세션이면 남는다.

/** 공식 한도 창 하나(session.measure 의 rateLimits 그대로) */
export type UsageBarRate = {
  /** five_hour · seven_day · seven_day_opus · spend_limit … */
  kind: string;
  /** 0~100(지출 한도는 100 을 넘을 수 있다) */
  percentUsed: number;
  /** 리셋 시각(ISO 8601) */
  resetsAt?: string;
};

/** session.measure · $.session.usage() 에서 띠에 필요한 것만 */
export type UsageBarMeasure = {
  rateLimits: UsageBarRate[];
  /** 컨텍스트 창 — 첫 응답 전에는 tokens · percent 가 null */
  context: { tokens: number | null; window: number | null; percent: number | null } | null;
  /** 이 세션의 비용(달러), 엔진이 모르면 null */
  costUsd: number | null;
};

/** 이 대화의 토큰 합(turn.complete 의 usage — 메인과 서브에이전트 모두) */
export type UsageBarConvo = {
  v: 1;
  /** 어느 세션의 합인지 — 다른 세션이면 0 에서 다시 센다 */
  sessionId: string | null;
  in: number;
  out: number;
  /** 캐시에서 읽은 양(새 토큰에는 넣지 않는다) */
  cr: number;
  /** 캐시에 쓴 양 */
  cc: number;
};

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { measure: UsageBarMeasure | null; convo: UsageBarConvo; hidden: boolean };
  }
}
