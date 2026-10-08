// 움직이는 조각: 작업 구역 — 제목 줄(한 마디 요약 · 다시 확인), 이 대화의 결과물, PR 한 줄, 저장소 목록.
//   결과물: 편집 → 커밋 → 푸시 → PR → 머지 를 이은 점. 끝난 단계는 초록 실선, 다음에 할 단계는 주황 점이 숨 쉬고
//           그 앞 이음줄로 빛이 흐른다. 아직인 단계는 옅게.
//   저장소: 한 줄에 이름 · 브랜치(옅게) · 짧은 말(좋지 않을 때만) · 세 점(폴더 → 커밋 → 원격). 워크트리는 본 저장소 아래에
//           └ 로 들여 쓰고, Claude 가 만든 워크트리(.claude/worktrees/)는 ✻ 를 붙인다.
// Client 모듈(데스크톱 · 터미널이 그린다). props 는 views.js 의 workProps(). '다시 확인' 은 post → register.js 의 ui.message.
import { C, cellW, clip, dimText, frame, head, rail, runs, soft } from './live-kit.js';

const LV_HEX = { good: C.green, warn: C.amber, bad: C.red, unknown: C.gray };
const NODE = { done: '●', partial: '◐', todo: '●', skip: '·', none: '○' };
const NODE_HEX = { done: C.green, partial: C.amber, todo: C.amber, skip: C.gray, none: C.gray };
const TONE_KEY = { good: 'success', warn: 'warning', info: 'suggestion' };

/** 단계 a → b 사이 이음줄의 칸 n 개. side: a 의 오른쪽 절반('out') 또는 b 의 왼쪽 절반('in') */
function connCells(a, b, n, f, plain, side, L, R) {
  const solid = a.state === 'done' && (b.state === 'done' || b.state === 'partial');
  const pending = (a.state === 'done' || a.state === 'partial') && (b.state === 'todo' || b.state === 'partial') && !solid;
  const base = solid ? { color: C.green } : pending ? (plain ? { color: C.amber, dim: true } : { color: soft(C.amber) }) : rail(plain);
  const cells = Array.from({ length: n }, () => ({ ch: '━', ...base }));
  if (pending) {
    // 빛이 다음 단계 쪽으로 흐른다: 두 절반(R + L 칸)을 한 줄로 보고 한 칸씩
    const k = f % (R + L + 4);
    const idx = side === 'out' ? k : k - R;
    if (idx >= 0 && idx < n) cells[idx] = { ch: '━', color: C.amber, bold: true };
  }
  return cells;
}

function pipeline(E, stages, cols, f, plain) {
  const n = stages.length;
  const SW = Math.max(6, Math.min(14, Math.floor(cols / Math.max(1, n))));
  const L = Math.floor((SW - 1) / 2);
  const R = SW - 1 - L;
  const blank = (w) => E.Box({ width: w, flexShrink: 0 });
  const nodes = stages.map((st, i) => {
    const prev = stages[i - 1];
    const next = stages[i + 1];
    const pulse = st.state === 'todo' && Math.floor(f / 3) % 2 === 1;
    // 숨 쉬기: 데스크톱은 옅은 색, 터미널(plain)은 반투명 색 대신 dim
    const node = E.Text({ bold: true, color: pulse && !plain ? soft(NODE_HEX[st.state]) : NODE_HEX[st.state] || C.gray, ...(pulse && plain ? { dimColor: true } : {}), children: [NODE[st.state] || '○'] });
    return E.Box({
      key: `n-${st.id}`,
      width: SW,
      flexShrink: 0,
      flexDirection: 'row',
      children: [
        prev ? clip(E, L, E.Text({ children: runs(E, connCells(prev, st, L + 2, f, plain, 'in', L, R)) })) : blank(L),
        E.Box({ width: 1, flexShrink: 0, children: [node] }),
        next ? clip(E, R, E.Text({ children: runs(E, connCells(st, next, R + 2, f, plain, 'out', L, R)) })) : blank(R),
      ],
    });
  });
  const labels = stages.map((st) => {
    const quiet = st.state === 'none' || st.state === 'skip';
    const style = quiet ? { dimColor: true } : st.state === 'todo' || st.state === 'partial' ? { color: 'warning' } : {};
    return E.Box({ key: `t-${st.id}`, width: SW, flexShrink: 0, flexDirection: 'row', justifyContent: 'center', children: [E.Text({ ...style, wrap: 'truncate-end', children: [st.label] })] });
  });
  return E.Box({
    key: 'pipe',
    flexDirection: 'column',
    marginTop: 1,
    children: [E.Box({ key: 'nodes', flexDirection: 'row', children: nodes }), E.Box({ key: 'labels', flexDirection: 'row', children: labels })],
  });
}

function prRow(E, pr) {
  return E.Box({
    key: 'pr',
    flexDirection: 'row',
    columnGap: 1,
    marginTop: 1,
    children: [
      E.Text({ color: pr.color || C.green, bold: true, children: ['⑂'] }),
      pr.url ? E.Link({ href: pr.url, label: pr.label }) : E.Text({ children: [pr.label] }),
      pr.detail ? dimText(E, pr.detail) : null,
    ].filter(Boolean),
  });
}

/** 저장소 한 줄의 세 점(폴더 → 커밋 → 원격). 푸시를 기다리면 커밋 → 원격 이음줄이 숨 쉰다 */
function chain(E, r, f, plain) {
  const lv = Array.isArray(r.checks) ? r.checks : [];
  const cells = [];
  lv.forEach((l, i) => {
    if (i > 0) {
      const ok = lv[i - 1] === 'good' && l === 'good';
      const waiting = i === 2 && r.pulse && Math.floor(f / 3) % 2 === 0;
      cells.push({ ch: '━', ...(ok ? { color: C.green } : waiting ? { color: C.amber } : rail(plain)) });
    }
    cells.push({ ch: l === 'unknown' ? '○' : '●', color: LV_HEX[l] || C.gray, bold: true });
  });
  return E.Box({ key: 'chain', flexShrink: 0, children: [E.Text({ children: runs(E, cells) })] });
}

function repoRows(E, p, cols, f, plain) {
  const repos = Array.isArray(p.repos) ? p.repos : [];
  const kids = [];
  if (p.loading) kids.push(dimText(E, 'git 상태를 읽는 중…'));
  if (p.error) kids.push(E.Text({ color: 'error', wrap: 'truncate-end', children: [`✖ ${p.error}`] }));
  if (!p.loading && !p.error && !repos.length) kids.push(dimText(E, '살펴볼 git 저장소가 없어요'));
  // 이름 칸: 가장 긴 이름 + 1칸(8–18칸)
  const nameOf = (r) => `${r.depth > 0 ? '└ ' : ''}${r.claude ? '✻ ' : ''}${r.name || ''}`;
  const NW = Math.max(8, Math.min(18, Math.floor(cols * 0.38), Math.max(0, ...repos.map((r) => cellW(nameOf(r)) + 1))));
  repos.forEach((r, i) => {
    const name = E.Text({
      wrap: 'truncate-end',
      children: [
        r.depth > 0 ? E.Text({ dimColor: true, children: ['└ '] }) : null,
        r.claude ? E.Text({ color: C.claude, bold: true, children: ['✻ '] }) : null,
        E.Text({ ...(r.bold ? { bold: true } : {}), children: [r.name || '저장소'] }),
      ].filter(Boolean),
    });
    const kidsRow = [E.Box({ width: NW, flexShrink: 0, children: [name] })];
    if (r.error) kidsRow.push(E.Box({ flexGrow: 1, flexShrink: 1, children: [E.Text({ color: 'error', wrap: 'truncate-end', children: ['✖ 읽지 못했어요'] })] }));
    else {
      // 좁아지면 브랜치가 먼저 줄고, 그다음 짧은 말이 끝을 줄인다(두 줄로 접히지 않게)
      kidsRow.push(E.Box({ flexGrow: 1, flexShrink: 4, children: [dimText(E, r.branch || '')] }));
      const noteStyle = r.noteLevel === 'bad' ? { color: 'error' } : r.noteLevel === 'warn' ? { color: 'warning' } : { dimColor: true };
      if (r.note) kidsRow.push(E.Box({ flexShrink: 1, children: [E.Text({ ...noteStyle, wrap: 'truncate-end', children: [r.note] })] }));
      kidsRow.push(chain(E, r, f + i, plain));
    }
    kids.push(E.Box({ key: `r-${r.key || i}`, flexDirection: 'row', columnGap: 2, children: kidsRow }));
  });
  if (p.more > 0) kids.push(dimText(E, `+ 저장소 ${p.more}개 더`));
  return E.Box({ key: 'repos', flexDirection: 'column', marginTop: 1, children: kids });
}

/** 이 구역이 그리는 줄 수(views.js 가 창 높이를 나눌 때) — 아래 그리기와 같은 셈 */
export function workHeight(p) {
  const repos = Array.isArray(p.repos) ? p.repos : [];
  const notes = (p.loading ? 1 : 0) + (p.error ? 1 : 0) + (!p.loading && !p.error && !repos.length ? 1 : 0) + (p.more > 0 ? 1 : 0);
  return 1 + (Array.isArray(p.stages) && p.stages.length ? 3 : 0) + (p.pr ? 2 : 0) + 1 + repos.length + notes;
}

export default function LiveWork(props, surface) {
  const E = surface.elements;
  const p = props || {};
  const plain = Boolean(p.plain);
  const stages = Array.isArray(p.stages) ? p.stages : [];
  const repos = Array.isArray(p.repos) ? p.repos : [];
  const live = stages.some((s) => s.state === 'todo') || repos.some((r) => r.pulse);
  const f = frame(surface, plain ? 200 : 150, live);
  const cols = Math.max(30, Math.floor(p.cols || surface.columns || 48));
  const sum = p.summary || {};
  const verify = p.verify || {};
  const right = [
    sum.text ? E.Text({ wrap: 'truncate-end', ...(TONE_KEY[sum.tone] ? { color: TONE_KEY[sum.tone] } : { dimColor: true }), children: [sum.text] }) : null,
    verify.can
      ? E.Button({
          key: 'verify',
          label: verify.busy ? '확인 중…' : '↻',
          dimColor: true,
          ...(plain ? { hotkey: 'v' } : {}),
          onPress: () => surface.post({ action: 'verify' }),
        })
      : null,
  ];
  return E.Box({
    flexDirection: 'column',
    children: [head(E, '작업', [], right), stages.length ? pipeline(E, stages, cols, f, plain) : null, p.pr ? prRow(E, p.pr) : null, repoRows(E, p, cols, f, plain)].filter(Boolean),
  });
}
