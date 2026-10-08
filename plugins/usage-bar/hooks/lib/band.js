// usage-bar 의 띠 — `$.ui.resolve(e)` 로 얻은 요소 표(el)와 usage.js 의 model 을 받아 트리를 돌려준다. 순수 함수($ 없음).
//
//   5시간    ▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱    62% 남음   2시간 10분 뒤
//   이번 주  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱    39% 남음   ⚑ 63% 지남
//   이 대화  ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱    82% 남음   412k 토큰  ·  약 $3.20
//
// 세 줄이 한 표: 이름 칸(9) · 막대(남은 양) · 숫자 칸(오른쪽 맞춤 4) + 단위 칸(4) · 설명. 칸마다 폭을 정해 세로줄이 맞고,
// 칸 사이는 3칸씩 띄운다(글자가 한 덩어리로 뭉치지 않게). 셋째 줄 막대는 이 대화의 컨텍스트에서 남은 양(위 두 줄과 같은 뜻).
// 막대는 두 표면 모두 ▰ 글자 막대(사용자가 고른 모양). 데스크톱은 상자 한 칸을 글자 한 줄 높이로 그려서, 상자 막대 둘이
// 위아래 줄에 붙으면 두꺼운 한 덩어리처럼 보인다 — 글자 막대는 줄 사이가 떨어져 보인다. 이미지(SVG)는 쓰지 않는다.
// 자리가 세 줄이 안 되면(maxRows < 3) 한 줄로 줄인다. 글자는 넘치면 끝을 줄인다(줄이 늘지 않게).
import { C, DETAIL_SEP, GAP_CELLS, LABEL_CELLS, LEVEL_HEX, NUM_CELLS, UNIT_CELLS, bandRows, barCells, compactParts, textBar } from './usage.js';

/** 제어 문자(ESC · NUL …)가 섞인 글자는 엔진이 트리째 거절한다 — 줄바꿈 · 탭만 남기고 뺀다 */
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
/** undefined · null · false 인 속성은 아예 빼고 넘긴다 */
const clean = (o) => {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== false) r[k] = v;
  return r;
};
const tx = (el, s, o = {}) => el.Text({ ...clean(o), children: [String(s ?? '').replace(CTRL, '')] });
/** 조각({ t, bold, dim, color }) 하나 → Text */
const piece = (el, p) => tx(el, p.t, { bold: p.bold, dimColor: p.dim, color: p.color });
/** 한 줄 = 바깥 Text 하나 안의 색 조각들. 넘치면 끝을 줄인다(두 줄로 접히지 않게) */
const line = (el, parts) => el.Text({ wrap: 'truncate-end', children: parts.filter((p) => p && p.t).map((p) => piece(el, p)) });
/** 설명 조각들 사이에 옅은 가운데 점을 넉넉히 */
const withSeps = (parts) => parts.flatMap((p, i) => (i ? [{ t: DETAIL_SEP, dim: true }, p] : [p]));

const labelCell = (el, text) => el.Box({ width: LABEL_CELLS, flexShrink: 0, children: [tx(el, text, { dimColor: true, wrap: 'truncate-end' })] });

/**
 * 남은 양 막대 — ▰ 가 남은 만큼(수준 색), 나머지는 데스크톱은 같은 ▰ 를 옅은 바탕색으로(테두리만 있는 ▱ 는 글꼴에 따라
 * 네모 칸처럼 지저분해 보인다), 터미널은 옅은 ▱. 칸 수가 모든 줄에서 같아 뒤 칸도 세로로 맞는다.
 * 폭을 칸으로 고정하지 않는다 — 글꼴이 넓으면 끝이 잘려 비율이 틀려 보이므로 글자 그대로의 폭을 쓴다.
 * bar 가 없는 줄(컨텍스트를 모를 때)은 같은 글자를 보이지 않게 그려 자리만 맞춘다(터미널은 빈칸).
 */
function barCell(el, bar, cells, surface) {
  const term = surface === 'terminal';
  if (!bar) return el.Box({ flexShrink: 0, children: [term ? tx(el, ' '.repeat(cells)) : tx(el, '▰'.repeat(cells), { color: '#00000000' })] });
  const b = textBar(bar.rem, cells);
  const kids = [];
  if (b.on) kids.push(tx(el, b.on, { color: LEVEL_HEX[bar.level] }));
  if (b.off) kids.push(term ? tx(el, b.off, { dimColor: true }) : tx(el, '▰'.repeat([...b.off].length), { color: C.track }));
  return el.Box({ flexShrink: 0, children: [el.Text({ wrap: 'truncate-end', children: kids })] });
}

/** 숫자(오른쪽 맞춤) + 단위 — 모든 줄에서 같은 폭이라 설명이 같은 세로줄에서 시작한다 */
function valueCell(el, r) {
  return el.Box({
    flexDirection: 'row',
    flexShrink: 0,
    marginLeft: GAP_CELLS,
    children: [
      el.Box({ width: NUM_CELLS, flexShrink: 0, flexDirection: 'row', justifyContent: 'flex-end', children: r.value ? [piece(el, r.value)] : [] }),
      el.Box({ width: UNIT_CELLS, flexShrink: 0, marginLeft: 1, children: r.unit ? [tx(el, r.unit, { dimColor: true })] : [] }),
    ],
  });
}

function tableRow(el, r, cells, surface) {
  const kids = [labelCell(el, r.label)];
  if (r.note) kids.push(el.Box({ flexGrow: 1, flexShrink: 1, children: [line(el, [{ t: r.note, dim: true }])] }));
  else {
    kids.push(barCell(el, r.bar, cells, surface), valueCell(el, r));
    const detail = r.detail || [];
    if (detail.length) kids.push(el.Box({ flexGrow: 1, flexShrink: 1, marginLeft: GAP_CELLS, children: [line(el, withSeps(detail))] }));
  }
  return el.Box({ key: r.key, flexDirection: 'row', alignItems: 'center', children: kids });
}

/**
 * 입력창 위 띠 트리.
 * @param el `$.ui.resolve(e)` 의 요소 표
 * @param model usage.js 의 bandModel()
 * @param {{ surface?: string, cols?: number, compact?: boolean }} [opts] `surface`(e.surface) · `cols`(e.props.bodyColumns) · `compact`(maxRows < 3)
 */
export function bandView(el, model, opts = {}) {
  if (opts.compact) return el.Box({ key: 'compact', flexDirection: 'row', children: [line(el, compactParts(model))] });
  const cells = barCells(opts.cols);
  return el.Box({ flexDirection: 'column', children: bandRows(model).map((r) => tableRow(el, r, cells, opts.surface)) });
}
