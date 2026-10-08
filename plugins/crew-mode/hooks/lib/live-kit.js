// 움직이는 조각(Client 모듈)이 같이 쓰는 것 — 순수 함수. 데스크톱이 직접 그리는 글자 · 상자만 쓴다(이미지 없음 → 깜빡이지 않는다).
// Client 는 플러그인이 다시 그려도 자기 상태와 타이머를 유지한다: 애니메이션이 처음부터 다시 시작하지 않는다.

/** 밝은 · 어두운 화면 둘 다에서 보이는 중간 톤 */
export const C = {
  claude: '#d97757',
  blue: '#3b82f6',
  green: '#22a05a',
  amber: '#e09a1a',
  red: '#e5484d',
  purple: '#8b5cf6',
  teal: '#14a39a',
  pink: '#e0629a',
  gray: '#8a8a93',
  track: '#8a8a9333',
};

const TYPE = { main: C.claude, Explore: C.teal, Plan: C.purple, 'general-purpose': C.blue, 'code-reviewer': C.pink, worker: C.amber };
const ALT = [C.blue, C.teal, C.purple, C.pink, C.amber, C.green];
const withAlpha = (hex, aa) => (/^#[0-9a-f]{6}$/i.test(String(hex)) ? `${hex}${aa}` : hex);
/** 같은 색을 옅게(45% 불투명) — 갈래의 "도구를 쓰지 않은 칸" · 기다리는 이음줄 */
export const soft = (hex) => withAlpha(hex, '73');

/** 에이전트 종류 → 캐릭터 · 갈래 색(모르는 종류는 이름으로 늘 같은 색) */
export function agentColor(type) {
  if (TYPE[type]) return TYPE[type];
  let h = 0;
  for (const ch of String(type ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ALT[h % ALT.length];
}

/** 상태별 얼굴(프레임마다 바뀐다) */
export const FACES = {
  working: ['ᕙ(•ᴗ•)ᕗ', 'ᕦ(•ᴗ•)ᕤ'],
  thinking: ['(•_•)', '(•_•).', '(•_•)..', '(•_•)…'],
  spawning: ['☆(°o°)', '(°o°)☆'],
  waiting: ['(•_•)?', '(•_•) ?'],
  done: ['(^ᴗ^)', '(^ᴗ^)✧'],
  idle: ['(-ᴗ-)', '(-ᴗ-)z', '(-ᴗ-)zZ', '(-ᴗ-)zZ'],
  error: ['(;ᴗ;)', '(;ᴗ;)💧'],
};
/** 얼굴 한 프레임. plain(터미널)이면 그림 문자(💧)를 뺀다 — 터미널마다 폭을 다르게 세어 줄이 흔들려요 */
export const face = (state, error, f, plain = false) => {
  const fr = FACES[error ? 'error' : state] || FACES.waiting;
  const s = fr[((f % fr.length) + fr.length) % fr.length];
  return plain ? s.replace('💧', '') : s;
};

/** 쓰는 도구 → 소품(데스크톱 · 휴대폰). 터미널은 그림 문자 대신 짧은 낱말 */
export const PROP = { book: '📖', pencil: '✏️', terminal: '⌨️', magnifier: '🔍', globe: '🌐', radio: '📡', clipboard: '📋', scroll: '📜', question: '❓', plug: '🔌' };
export const PROP_WORD = { book: '읽기', pencil: '고침', terminal: '실행', magnifier: '찾기', globe: '웹', radio: '호출', clipboard: '정리', scroll: '스킬', question: '질문', plug: '도구' };

/**
 * 프레임 시계. 처음 그릴 때 한 번만 타이머를 건다(그 뒤로는 surface.state 가 있다).
 * live 가 아니면(아무도 일하지 않음) 네 박자에 한 번만 다시 그린다 — 쉬는 얼굴 · 반짝임은 천천히, 화면은 덜 깨운다.
 * 정지 화면(Client 가 없는 휴대폰 · VS Code)에서는 every · setState 가 아무 일도 하지 않아 주어진 프레임에 머문다.
 */
const LIVE = new WeakMap();
export function frame(surface, ms, live = true) {
  LIVE.set(surface, Boolean(live));
  if (surface.state === undefined) {
    let n = 0;
    surface.every(ms, () => {
      n += 1;
      if (!LIVE.get(surface) && n % 4 !== 0) return;
      const s = surface.state || { f: 0 };
      surface.setState({ ...s, f: (s.f || 0) + 1 });
    });
    surface.setState({ f: 0 });
  }
  return (surface.state && surface.state.f) || 0;
}

/** Client 를 못 그리는 표면에서 같은 함수를 한 번 그려 볼 때 쓰는 가짜 surface */
export function stillSurface(elements, columns = 44, state) {
  return { elements, state, setState() {}, columns, rows: 0, every: () => () => {}, onPointer: () => () => {}, onKey: () => () => {}, post() {} };
}

/** 폭을 고정한 칸 — 프레임마다 글자 폭이 달라도 옆 글자가 흔들리지 않게 */
export const cell = (E, width, child, o = {}) => E.Box({ width, flexShrink: 0, ...o, children: child ? [child] : [] });
/** 한 줄짜리 고정 칸 — 글꼴이 넓어 넘치면 줄임표 없이 잘라 낸다(이음줄 · 얼굴이 "├•─…" 처럼 되지 않게) */
export const clip = (E, width, child, o = {}) => cell(E, width, child, { height: 1, overflow: 'hidden', ...o });

/** 터미널 칸 폭(한글 · 전각 · 그림 문자는 2칸) — 칸 맞춤용 */
export const cellW = (s) => [...String(s ?? '')].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0);

/** 같은 모양이 이어지는 칸({ ch, color, dim, bold })을 한 글자 덩어리로 */
export function runs(E, cells) {
  const out = [];
  let cur = null;
  for (const c of cells) {
    const k = `${c.color}|${c.dim ? 1 : 0}|${c.bold ? 1 : 0}`;
    if (cur && cur.k === k) cur.text += c.ch;
    else out.push((cur = { k, color: c.color, dim: c.dim, bold: c.bold, text: c.ch }));
  }
  return out.map((r) => E.Text({ ...(r.color ? { color: r.color } : {}), ...(r.dim ? { dimColor: true } : {}), ...(r.bold ? { bold: true } : {}), children: [r.text] }));
}

/** 옅은 레일(갈래 밖 · 빈 막대) — 데스크톱은 반투명 색, 터미널은 dim */
export const rail = (plain) => (plain ? { color: C.gray, dim: true } : { color: C.track });

/**
 * 구역 제목 줄: 왼쪽 굵은 제목(+ 붙는 조각), 오른쪽 옅은 말(+ 단추). 넘치면 오른쪽 말 끝을 줄인다.
 * left · right 는 요소 배열(빈 값은 뺀다).
 */
export function head(E, title, left = [], right = []) {
  const keep = (xs) => xs.filter(Boolean);
  return E.Box({
    key: 'head',
    flexDirection: 'row',
    justifyContent: 'space-between',
    columnGap: 2,
    children: [
      E.Box({ flexDirection: 'row', flexShrink: 0, columnGap: 2, children: [E.Text({ bold: true, children: [title] }), ...keep(left)] }),
      E.Box({ flexDirection: 'row', flexShrink: 1, columnGap: 2, justifyContent: 'flex-end', children: keep(right) }),
    ],
  });
}

/** 옅은 글자 한 조각(넘치면 끝을 줄인다) */
export const dimText = (E, s, o = {}) => E.Text({ dimColor: true, wrap: 'truncate-end', ...o, children: [String(s ?? '')] });
