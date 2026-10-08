// 숫자 · 색 · 저장소 판정 — 순수 함수($ 없음). 창(views.js) · 움직이는 조각(live-*.js) · 글자 요약이 같이 쓴다.
// v0.5 에서 work-status 를 다시 합치며 옮겨 왔다. 새로 더한 것: 저장소 묶기(본 저장소 → 워크트리) · 짧은 판정 말.

export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : d);
export const clampPct = (n) => Math.round(Math.max(0, Math.min(100, num(n))));

/** 밝은 · 어두운 화면 둘 다에서 보이는 중간 톤 — 막대 · 점에 쓴다(글자 색은 테마 키) */
export const C = {
  blue: '#3b82f6',
  green: '#22a05a',
  amber: '#e09a1a',
  red: '#e5484d',
  purple: '#8b5cf6',
  teal: '#14a39a',
  gray: '#8a8a93',
  track: '#8a8a9333',
};

/** 서버 판정의 짧은 말(창 제목 줄) — 긴 말은 work.js verdictOf 의 text */
export const VERDICT_SHORT = { good: '여유', warn: '빠듯', bad: '모자람', unknown: '' };

/** 판정 수준 → 점 색 · 글자 색(테마 키) */
export const LEVEL_HEX = { good: C.green, warn: C.amber, bad: C.red, unknown: C.gray };
export const LEVEL_KEY = { good: 'success', warn: 'warning', bad: 'error', unknown: 'inactive' };
/** 저장소 세 지점의 점: 좋음 ✓ · 주의 ● · 나쁨 ● · 모름 ○ */
export const LEVEL_DOT = { good: '✓', warn: '●', bad: '●', unknown: '○' };

/** 결과물 단계 칩: 끝 ✓ · 반쯤 ◐ · 할 일 ● · 건너뜀 – · 아직 · */
export const STAGE_DOT = { done: '✓', partial: '◐', todo: '●', skip: '–', none: '·' };
export const STAGE_HEX = { done: C.green, partial: C.amber, todo: C.amber, skip: C.gray, none: C.gray };

/** 머리말 어조 → 글자 색 */
export const TONE_KEY = { good: 'success', warn: 'warning', info: 'suggestion', calm: null };
export const TONE_MARK = { good: '✓', warn: '▲', info: 'ℹ', calm: '·' };

/** 메모리 조각 색 */
export const SEG_HEX = { app: C.blue, used: C.blue, wired: C.purple, compressed: C.teal, cache: C.gray };

/** 찬 정도(0–1) → 막대 색: 75% 넘으면 주황, 90% 넘으면 빨강 */
export const fillHex = (r) => (r > 0.9 ? C.red : r > 0.75 ? C.amber : C.blue);

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;
const TiB = GiB * 1024;

/** 7.1 · 8 · 11.7 · 131 — 100 아래는 소수 한 자리(.0 은 뺀다), 그 위는 정수 ("12 / 12 GB" 처럼 꽉 찬 것으로 보이지 않게) */
const short = (v) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

export const fmtBytes = (n) => {
  const v = num(n);
  if (v >= TiB) return `${(v / TiB).toFixed(1)} TB`;
  if (v >= GiB * 100) return `${Math.round(v / GiB)} GB`;
  if (v >= GiB) return `${(v / GiB).toFixed(1)} GB`;
  return `${Math.round(v / MiB)} MB`;
};

/** 전체 크기에 맞춘 단위 하나 — 막대 오른쪽 "7.1 / 8 GB" 와 범례 숫자가 같은 단위를 쓰게 */
export function unitFor(total) {
  const t = num(total);
  if (t >= TiB) return { div: TiB, name: 'TB' };
  if (t >= GiB) return { div: GiB, name: 'GB' };
  return { div: MiB, name: 'MB' };
}
export const inUnit = (bytes, unit) => short(num(bytes) / unit.div);
/** "7.1 / 8 GB" */
export function pairText(used, total) {
  const u = unitFor(total);
  return `${inUnit(used, u)} / ${inUnit(total, u)} ${u.name}`;
}

/**
 * 조각들의 바이트 → 막대 안의 정수 % (합은 실제 비율을 반올림한 값을 넘지 않는다).
 * 상자 너비 %는 정수만 받으므로 큰 나머지 순으로 1%씩 나눠 준다. 0 보다 큰 조각은 될 수 있으면 1% 이상.
 */
export function segmentPcts(values, total) {
  const t = num(total);
  if (!(t > 0)) return values.map(() => 0);
  const raw = values.map((v) => (100 * Math.max(0, num(v))) / t);
  const want = Math.min(100, Math.round(raw.reduce((a, b) => a + b, 0)));
  const out = raw.map(Math.floor);
  let left = want - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  // 아주 작은 조각도 보이게(다른 큰 조각에서 1% 를 빌린다)
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0 || !(raw[i] > 0)) continue;
    const j = out.indexOf(Math.max(...out));
    if (out[j] > 1) {
      out[j] -= 1;
      out[i] = 1;
    }
  }
  return out;
}

/** 정수 % → 글자 칸 수 (같은 방법으로 칸을 나눈다) */
export function segmentCells(pcts, width) {
  const w = Math.max(0, Math.floor(num(width)));
  const raw = pcts.map((p) => (Math.max(0, num(p)) * w) / 100);
  const want = Math.min(w, Math.round(raw.reduce((a, b) => a + b, 0)));
  const out = raw.map(Math.floor);
  let left = want - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

/**
 * 저장소 하나의 세 지점(작업 폴더 → 커밋 → 원격) 판정 — 창 · 터미널 · 글자 요약이 같은 말을 하게 한 곳에서.
 * detail = 글자 요약의 말, short = 창의 저장소 줄 오른쪽에 옅게 붙는 짧은 말(같은 사실을 두 번 말하면 빈 글자).
 */
export function repoChecks(r) {
  const noRemote = !r.remote && !r.upstream;
  const work = r.conflicts > 0 ? { level: 'bad', detail: `충돌 ${r.conflicts}개`, short: `충돌 ${r.conflicts}` } : r.dirty > 0 ? { level: 'warn', detail: `변경 ${r.dirty}개`, short: `변경 ${r.dirty}` } : { level: 'good', detail: '깨끗해요', short: '' };
  let commit;
  if (r.detached) commit = { level: 'warn', detail: '브랜치 없음(detached)', short: '브랜치 없음' };
  else if (!r.upstream) commit = r.unpushed === 0 ? { level: 'good', detail: '다 올라감', short: '' } : { level: 'warn', detail: '원격 브랜치 없음', short: noRemote ? '' : '원격 브랜치 없음' };
  else if (r.ahead > 0) commit = { level: 'warn', detail: `푸시 전 ${r.ahead}개`, short: `푸시 전 ${r.ahead}` };
  else commit = { level: 'good', detail: '다 올라감', short: '' };
  let remote;
  const rc = r.remoteCheck;
  if (noRemote) remote = { level: 'unknown', detail: '원격 없음', short: '원격 없음' };
  else if (!r.upstream) remote = r.unpushed === 0 ? { level: 'unknown', detail: '추적 설정 없음', short: '추적 설정 없음' } : { level: 'unknown', detail: '아직 안 올림', short: '' };
  // 원격에 직접 물은 값(추적 ref 와 비교)이 먼저 — 로컬의 앞섬 · 뒤처짐은 마지막 fetch 기준이라 낡았을 수 있다
  else if (rc && !rc.ok) remote = { level: 'unknown', detail: '확인 못 함', short: '원격 확인 못 함' };
  else if (rc && rc.exists === false) remote = { level: 'warn', detail: '원격에 브랜치 없음', short: '원격에 브랜치 없음' };
  else if (rc && rc.same === false) remote = { level: 'warn', detail: '원격에 새 커밋', short: '원격에 새 커밋' };
  else if (r.behind > 0 && r.ahead > 0) remote = { level: 'warn', detail: `갈라짐 ↑${r.ahead} ↓${r.behind}`, short: `갈라짐 ↑${r.ahead} ↓${r.behind}` };
  else if (r.behind > 0) remote = { level: 'warn', detail: `원격이 ${r.behind}개 앞섬`, short: `원격이 ${r.behind}개 앞섬` };
  // 올릴 커밋 수는 커밋 지점이 이미 말한다(푸시 전 N개) — 여기서는 숫자를 되풀이하지 않는다
  else if (r.ahead > 0) remote = { level: 'warn', detail: '푸시를 기다려요', short: '' };
  else remote = { level: 'good', detail: `${r.upstream} 과 같음`, short: '' };
  return [
    { id: 'work', label: '작업 폴더', ...work },
    { id: 'commit', label: '커밋', ...commit },
    { id: 'remote', label: '원격', ...remote },
  ];
}

/** 저장소 줄 오른쪽의 옅은 말 — 좋지 않은 지점만, 짧게 */
export const repoNote = (r) =>
  repoChecks(r)
    .filter((c) => c.level !== 'good' && c.short)
    .map((c) => c.short)
    .join(' · ');

/** PR 한 줄: "PR #128 열림 · 검사 통과" */
export function prLabel(pr) {
  const st = pr.state === 'MERGED' ? '머지됨' : pr.state === 'CLOSED' ? '닫힘' : pr.draft ? '초안' : '열림';
  const c = pr.checks;
  const ck = c ? (c.fail ? `검사 실패 ${c.fail}` : c.pending ? `검사 중 ${c.pending}` : c.pass ? '검사 통과' : '') : '';
  return `PR${pr.number != null ? ` #${pr.number}` : ''} ${st}${ck ? ` · ${ck}` : ''}`;
}
/** PR 기호(⑂) 색: 검사 실패 빨강 · 머지 보라 · 닫힘/초안 회색 · 검사 중 주황 · 열림 초록 */
export const prHex = (pr) => (pr.checks?.fail ? C.red : pr.state === 'MERGED' ? C.purple : pr.state === 'CLOSED' || pr.draft ? C.gray : pr.checks?.pending ? C.amber : C.green);

/** 터미널 칸 폭(한글 · 전각은 2칸) — 이름 칸 폭 · 글자 요약의 줄 맞춤용 */
export const cellW = (s) => [...String(s ?? '')].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);

/** 여러 판정 중 가장 나쁜 것 */
const RANK = { good: 0, unknown: 1, warn: 2, bad: 3 };
export const worstLevel = (levels) => (levels || []).reduce((w, l) => ((RANK[l] ?? 0) > (RANK[w] ?? 0) ? l : w), 'good');

/**
 * 저장소들을 본 저장소 → 그 워크트리 순으로 묶는다. 묶음의 자리는 들어온 순서(register.js 가 관련 · 변경 순으로 정렬)에서
 * 그 묶음이 처음 나온 자리. 워크트리는 본 저장소가 목록에 있을 때만 그 아래로 들여 쓴다(depth 1).
 * repos: [{ root, main?(본 저장소 경로 — 워크트리만), … }] → 같은 것들에 depth 를 붙여 새 순서로
 */
export function groupRepos(repos) {
  const list = Array.isArray(repos) ? repos.filter(Boolean) : [];
  const roots = new Set(list.map((r) => r.root));
  const keyOf = (r) => (r.main && r.main !== r.root && roots.has(r.main) ? r.main : r.root);
  const groups = new Map();
  for (const r of list) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [k, g] of groups) {
    const head = g.find((r) => r.root === k);
    if (head) out.push({ ...head, depth: 0 });
    for (const r of g) if (r !== head) out.push({ ...r, depth: head ? 1 : 0 });
  }
  return out;
}
