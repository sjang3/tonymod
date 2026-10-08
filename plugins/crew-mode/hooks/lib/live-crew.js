// 움직이는 조각: 에이전트 구역 — 제목 줄, 갈래마다 두 줄, 맨 아래 시간 축.
//   ① 캐릭터(얼굴) · 이름 · 지금 하는 일(일할 때만, 옅게) · 걸린 시간
//   ② 시간 막대 — 왼쪽 = 창의 시작, 오른쪽 = 지금. 일한 동안은 그 에이전트 색(도구를 쓴 칸은 진하게, 그 사이는 옅게).
//      일하는 갈래는 빛이 막대를 따라 흐르고 끝(지금)이 숨 쉬듯 깜빡인다. 끝난 자리에 ✓ · ✕.
// 데스크톱은 막대를 색칠한 상자(간트 막대)로 — 상자 폭은 칸 수라 어떤 글꼴에서도 시각이 맞는다.
// 터미널은 모든 칸이 같은 글자(━)라 갈래끼리 시작 · 끝이 세로로 맞는다 — 뜻은 색으로만.
// Client 모듈(데스크톱 · 터미널이 그린다). props 는 views.js 의 crewProps().
import { C, cellW, clip, dimText, face, frame, head, rail, runs, soft } from './live-kit.js';

const FW = 10; // 캐릭터 칸 — 갈래의 이름 · 막대가 모두 같은 세로줄에서 시작한다

/** 갈래 끝의 상태 기호: 일하는 중 ●(숨 쉬듯) · 기다림 ○ · 끝 ✓ · 문제 ✕. 터미널(plain)은 반투명 색 대신 dim 으로 숨 쉰다 */
function endMark(l, f, plain = false) {
  if (l.status === 'running') return plain ? { ch: '●', color: l.color, bold: true, dim: Math.floor(f / 3) % 2 === 1 } : { ch: '●', color: Math.floor(f / 3) % 2 ? soft(l.color) : l.color, bold: true };
  if (l.status === 'done') return { ch: '✓', color: C.green, bold: true };
  if (l.status === 'error') return { ch: '✕', color: C.red, bold: true };
  return { ch: '○', color: l.color };
}

/** 시간 막대의 칸들 */
export function trackCells(l, TW, f, plain) {
  const at = (x) => Math.max(0, Math.min(TW - 1, Math.round(x * (TW - 1))));
  const cells = Array.from({ length: TW }, () => ({ ch: '━', ...rail(plain) }));
  const empty = !(typeof l.s === 'number' && typeof l.e === 'number' && l.e >= l.s); // Claude 가 아직 한 번도 일하지 않았다
  if (empty) return cells;
  const sc = at(l.s);
  const ec = Math.max(sc, at(l.e));
  const quiet = plain ? { color: l.color, dim: true } : { color: soft(l.color) };
  for (let k = sc; k <= ec; k++) cells[k] = { ch: '━', ...quiet };
  for (const x of Array.isArray(l.marks) ? l.marks : []) {
    const k = at(x);
    if (k >= sc && k < ec) cells[k] = { ch: '━', color: l.color };
  }
  // 일하는 갈래: 세 칸짜리 빛이 시작에서 지금 쪽으로 흐른다(지나간 뒤 잠깐 쉬었다 다시)
  if (l.status === 'running' && ec - sc >= 4) {
    const pos = sc + (f % (ec - sc + 8));
    for (let k = pos - 2; k <= pos; k++) if (k >= sc && k < ec) cells[k] = { ch: '━', color: l.color };
  }
  cells[ec] = endMark(l, f, plain);
  return cells;
}

/** #rrggbb → 같은 색의 투명도 aa(16진 두 자리) */
const tint = (hex, aa) => (/^#[0-9a-f]{6}$/i.test(String(hex)) ? `${hex}${aa}` : hex);

/**
 * 데스크톱의 시간 막대: 칸마다 글자 대신 색칠한 상자(간트 막대). 상자 폭은 칸 수로 정해져 어떤 글꼴에서도 시각이 정확히 맞고,
 * 가는 선(━)이 흐릿하게 그려지는 글꼴에서도 또렷하다. 바탕 레일은 칠하지 않는다(무겁지 않게) — 일한 동안만 옅은 막대,
 * 도구를 쓴 칸은 중간 톤, 흐르는 빛과 지금 끝(숨 쉬기)만 진하게. 끝난 자리의 ✓ · ✕ · ○ 는 글자로.
 */
function trackStrip(E, l, TW, f) {
  const at = (x) => Math.max(0, Math.min(TW - 1, Math.round(x * (TW - 1))));
  const kind = Array.from({ length: TW }, () => 'rail');
  const empty = !(typeof l.s === 'number' && typeof l.e === 'number' && l.e >= l.s);
  let glyph = null;
  if (!empty) {
    const sc = at(l.s);
    const ec = Math.max(sc, at(l.e));
    for (let k = sc; k <= ec; k++) kind[k] = 'base';
    for (const x of Array.isArray(l.marks) ? l.marks : []) {
      const k = at(x);
      if (k >= sc && k < ec) kind[k] = 'mark';
    }
    if (l.status === 'running') {
      if (ec - sc >= 4) {
        const pos = sc + (f % (ec - sc + 8));
        for (let k = pos - 2; k <= pos; k++) if (k >= sc && k < ec) kind[k] = 'glow';
      }
      kind[ec] = Math.floor(f / 3) % 2 ? 'mark' : 'head';
    } else {
      // 끝난 자리는 글자 칸(✓ · ✕ · ○) — 막대는 그 앞에서 멈춘다
      const m = endMark(l, f);
      kind[ec] = 'glyph';
      glyph = m;
    }
  }
  const COLOR = { base: tint(l.color, '42'), mark: tint(l.color, '99'), glow: l.color, head: l.color };
  const out = [];
  for (const k of kind) {
    const last = out.at(-1);
    if (last && last.k === k && k !== 'glyph') last.n += 1;
    else out.push({ k, n: 1 });
  }
  return out.map((r, i) => {
    if (r.k === 'rail') return E.Box({ key: `s${i}`, width: r.n, height: 1, flexShrink: 0 });
    if (r.k === 'glyph') return E.Box({ key: `s${i}`, width: 1, height: 1, flexShrink: 0, justifyContent: 'center', children: [E.Text({ color: glyph.color, bold: true, children: [glyph.ch] })] });
    return E.Box({ key: `s${i}`, width: r.n, height: 1, flexShrink: 0, backgroundColor: COLOR[r.k] });
  });
}

function laneBlock(E, l, i, f, o) {
  const color = l.error ? C.red : l.color;
  // 들여쓰기는 줄바꿈 없는 빈칸(U+00A0) — 칸이 좁아 접힐 때 빈칸에서 접혀 얼굴이 사라지지 않게
  const indent = l.depth > 0 ? '  ' : '';
  const top = E.Box({
    key: 'top',
    flexDirection: 'row',
    columnGap: 1,
    children: [
      clip(E, FW, E.Text({ color, ...(l.main ? { bold: true } : {}), children: [indent + face(l.state, l.error, Math.floor(f / 3) + i, o.plain)] })),
      E.Box({ width: o.NW, flexShrink: 0, children: [E.Text({ color, bold: true, wrap: 'truncate-end', children: [l.label || '?'] })] }),
      E.Box({ flexGrow: 1, flexShrink: 1, children: [dimText(E, l.doing || '')] }),
      E.Box({ flexShrink: 0, children: [dimText(E, l.dur || '')] }),
    ],
  });
  // 막대 — 데스크톱: 색칠한 상자들(간트 막대). 터미널: 한 줄짜리 글자 안에 색 조각(━) — 넘치면 앞(옛날)쪽을 잘라 '지금' 쪽이 늘 보인다
  const track = E.Box({
    key: 'track',
    flexDirection: 'row',
    paddingLeft: FW + 1,
    children: [
      o.plain
        ? E.Box({ width: o.TW, flexShrink: 0, height: 1, overflow: 'hidden', children: [E.Text({ wrap: 'truncate-start', children: runs(E, trackCells(l, o.TW, f + i * 5, true)) })] })
        : E.Box({ width: o.TW, flexShrink: 0, height: 1, flexDirection: 'row', children: trackStrip(E, l, o.TW, f + i * 5) }),
    ],
  });
  return E.Box({ key: `l-${l.key || i}`, flexDirection: 'column', children: [top, track] });
}

const laneGap = (p) => (typeof p.gap === 'number' ? p.gap : (Array.isArray(p.lanes) ? p.lanes.length : 0) <= 4 ? 1 : 0);
/** 이 구역이 그리는 줄 수(views.js 가 창 높이를 나눌 때) — 아래 그리기와 같은 셈 */
export function crewHeight(p) {
  const n = Array.isArray(p.lanes) ? p.lanes.length : 0;
  return 1 + 1 + n * 2 + laneGap(p) * Math.max(0, n - 1) + 1;
}

export default function LiveCrew(props, surface) {
  const E = surface.elements;
  const p = props || {};
  const plain = Boolean(p.plain);
  const lanes = Array.isArray(p.lanes) ? p.lanes : [];
  const live = lanes.some((l) => l.status === 'running');
  const f = frame(surface, plain ? 200 : 150, live);
  // 폭은 플러그인이 준 창 폭이 먼저(넓혔다 좁히면 region 은 아직 옛 폭일 수 있어요)
  const cols = Math.max(30, Math.floor(p.cols || surface.columns || 48));
  const NW = Math.min(12, Math.max(7, ...lanes.map((l) => cellW(l.label || '') + 1)));
  const TW = Math.max(12, cols - FW - 1);
  // 갈래 사이 한 줄(views.js 가 창 높이를 보고 정한다 — 없으면 갈래가 적을 때만)
  const gap = laneGap(p);
  const axis = p.axis || {};
  return E.Box({
    flexDirection: 'column',
    children: [
      head(E, '에이전트', [], [p.summary ? dimText(E, p.summary) : null]),
      E.Box({ key: 'lanes', flexDirection: 'column', marginTop: 1, rowGap: gap, children: lanes.map((l, i) => laneBlock(E, l, i, f, { plain, NW, TW })) }),
      // 시간 축: 막대 바로 아래, 막대의 양 끝에 맞춰
      E.Box({
        key: 'axis',
        flexDirection: 'row',
        paddingLeft: FW + 1,
        children: [E.Box({ width: TW, flexShrink: 0, flexDirection: 'row', justifyContent: 'space-between', children: [dimText(E, axis.left || ''), dimText(E, axis.right || '')] })],
      }),
    ],
  });
}
