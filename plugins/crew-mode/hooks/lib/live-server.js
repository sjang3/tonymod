// 움직이는 조각: 서버 구역 — 제목 줄(판정 점 · 짧은 말 · 어디서), usage-bar 와 같은 ▰ 막대(CPU · 메모리 · 스왑 · 디스크 · 컨테이너).
// 값이 바뀌면 막대가 몇 칸씩 미끄러지듯 따라가고(처음 열 때는 0 에서 차오른다), 데스크톱은 CPU 줄 끝에 지난 1~2분의 흐름(▁▂▅).
// 막대: 찬 칸은 ▰(색), 빈 칸은 데스크톱은 같은 ▰ 를 옅은 바탕색으로 · 터미널은 ▱. 칸 수가 모든 줄에서 같아 뒤 숫자도 세로로 맞는다.
// Client 모듈(데스크톱 · 터미널이 그린다). props 는 views.js 의 serverProps().
import { C, cellW, dimText, head, runs } from './live-kit.js';
import { segmentCells } from './fmt.js';

const LV_HEX = { good: C.green, warn: C.amber, bad: C.red, unknown: C.gray };
const SPARK = '▁▂▃▄▅▆▇█';

/** 막대 칸 수 · 이름 칸 · 흐름 칸 — 폭에 맞춰 */
export function serverLayout(rows, cols, plain) {
  const LW = Math.max(4, ...rows.map((r) => cellW(r.label) + 1));
  const VW = Math.max(3, ...rows.map((r) => cellW(r.value || '')));
  // 막대는 usage-bar 와 같은 16칸까지 — 글꼴에 따라 ▰ 가 칸보다 넓게 그려져도 창 안에 들게 넉넉히 남긴다
  const room = cols - LW - VW - 2;
  const BW = Math.max(8, Math.min(16, room - 12));
  const SPW = !plain && room - BW >= 22 ? 8 : 0;
  return { LW, VW, BW, SPW };
}

/** 이 구역이 그리는 줄 수(views.js 가 창 높이를 나눌 때) */
export function serverHeight(p) {
  const n = Array.isArray(p.rows) ? p.rows.length : 0;
  return 1 + 1 + Math.max(1, n);
}

/** 줄마다 조각 칸 수(목표) */
const targetsOf = (rows, BW) => Object.fromEntries(rows.map((r) => [r.key, segmentCells((r.parts || []).map((x) => x.pct), BW)]));

/** 보이는 칸 수를 목표 쪽으로 — 차이의 1/3 씩(적어도 한 칸) */
function stepToward(shown, target) {
  let moved = false;
  const next = {};
  for (const [k, cells] of Object.entries(target)) {
    const cur = Array.isArray(shown[k]) && shown[k].length === cells.length ? shown[k] : cells.map(() => 0);
    next[k] = cells.map((c, i) => {
      const d = c - cur[i];
      if (!d) return c;
      moved = true;
      return cur[i] + Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) / 3));
    });
  }
  return { next, moved };
}

/** 트윈 시계 — 처음 그릴 때 한 번만. 목표는 그릴 때마다 새로(WeakMap), 박자마다 보이는 칸을 옮긴다 */
const TARGET = new WeakMap();
function tween(surface, target) {
  TARGET.set(surface, target);
  if (surface.state === undefined) {
    surface.every(90, () => {
      const t = TARGET.get(surface);
      const s = surface.state || {};
      const { next, moved } = stepToward(s.shown || {}, t || {});
      if (moved) surface.setState({ ...s, shown: next });
    });
    // 처음 열 때는 빈 막대에서 차오른다
    const zeros = Object.fromEntries(Object.entries(target).map(([k, v]) => [k, v.map(() => 0)]));
    surface.setState({ shown: zeros });
    return zeros;
  }
  const shown = surface.state && surface.state.shown;
  // 정지 화면(휴대폰 · VS Code)이나 줄이 새로 생긴 직후에는 목표 그대로
  return Object.fromEntries(Object.entries(target).map(([k, v]) => [k, shown && Array.isArray(shown[k]) && shown[k].length === v.length ? shown[k] : v]));
}

function barText(E, parts, cells, BW, plain) {
  const out = [];
  parts.forEach((x, i) => {
    if (cells[i] > 0) out.push({ ch: '▰'.repeat(cells[i]), color: x.color });
  });
  const used = cells.reduce((a, b) => a + b, 0);
  if (BW - used > 0) out.push(plain ? { ch: '▱'.repeat(BW - used), color: C.gray, dim: true } : { ch: '▰'.repeat(BW - used), color: C.track });
  return E.Text({ wrap: 'truncate-end', children: runs(E, out) });
}

function spark(E, values, n) {
  const vs = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'number' && Number.isFinite(v)).slice(-n);
  if (vs.length < 2) return null;
  const s = vs.map((v) => SPARK[Math.max(0, Math.min(7, Math.round((Math.max(0, Math.min(100, v)) / 100) * 7)))]).join('');
  return E.Text({ color: C.blue, dimColor: true, children: [s] });
}

export default function LiveServer(props, surface) {
  const E = surface.elements;
  const p = props || {};
  const plain = Boolean(p.plain);
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const cols = Math.max(30, Math.floor(p.cols || surface.columns || 48));
  const { LW, VW, BW, SPW } = serverLayout(rows, cols, plain);
  const shown = tween(surface, targetsOf(rows, BW));
  const v = p.verdict;
  const left = v ? [E.Box({ key: 'verdict', flexDirection: 'row', columnGap: 1, children: [E.Text({ color: LV_HEX[v.level] || C.gray, bold: true, children: ['●'] }), dimText(E, v.word || '')] })] : [];
  const kids = [head(E, '서버', left, [p.host ? dimText(E, p.host) : null])];
  if (!rows.length) kids.push(E.Box({ key: 'note', marginTop: 1, children: [dimText(E, p.note || '서버 상태를 읽는 중…')] }));
  else
    kids.push(
      E.Box({
        key: 'bars',
        flexDirection: 'column',
        marginTop: 1,
        children: rows.map((r) =>
          E.Box({
            key: `b-${r.key}`,
            flexDirection: 'row',
            columnGap: 1,
            alignItems: 'center',
            children: [
              E.Box({ width: LW, flexShrink: 0, children: [dimText(E, r.label)] }),
              E.Box({ flexShrink: 0, children: [barText(E, r.parts || [], shown[r.key] || [], BW, plain)] }),
              E.Box({ width: VW, flexShrink: 0, justifyContent: 'flex-end', children: [E.Text({ ...(r.level === 'bad' ? { color: 'error' } : r.level === 'warn' ? { color: 'warning' } : {}), children: [r.value || ''] })] }),
              r.key === 'cpu' && SPW ? E.Box({ key: 'spark', marginLeft: 1, flexShrink: 0, children: [spark(E, p.spark, SPW)].filter(Boolean) }) : null,
            ].filter(Boolean),
          }),
        ),
      }),
    );
  return E.Box({ flexDirection: 'column', children: kids });
}
