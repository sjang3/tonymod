import { expect, mock, test } from 'claude-code/testing'
import * as U from '../hooks/lib/usage.js'
import { bandView } from '../hooks/lib/band.js'
import { CONVO, NOW, TURNS, USAGE } from './fixtures.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const u = U as Any
type El = { type: string; props: Record<string, unknown>; children: Node[] }
type Node = El | string

const M = 60000
const H = 60 * M
const D = 24 * H
const iso = (t: number) => new Date(t).toISOString()
const SURFACES = ['terminal', 'desktop'] as const

// ---- 도우미: 가짜 요소 표 · 트리 검사 (순수 함수 시험용) ---------------------------------------------------

/** $.ui.resolve(e) 흉내 — 요소를 평범한 데이터로 만든다 */
function table(): Any {
  const flat = (c: unknown, out: Node[] = []): Node[] => {
    if (c == null || c === false || c === true) return out
    if (Array.isArray(c)) {
      for (const x of c) flat(x, out)
      return out
    }
    out.push(typeof c === 'number' ? String(c) : (c as Node))
    return out
  }
  const t: Record<string, (props?: Record<string, unknown>) => El> = {}
  for (const name of ['Box', 'Text'])
    t[name] = (props = {}) => {
      const { children, ...rest } = props
      return { type: name, props: rest, children: flat(children) }
    }
  return t
}
/** 그려진 트리는 빈 props · children 을 빼고 온다 — 늘 있는 것으로 고쳐 둔다 */
const norm = (n: Any): Node => (typeof n === 'string' ? n : { type: n.type, props: n.props ?? {}, children: (n.children ?? []).map(norm) })
const nodesOf = (tree: Node): El[] => {
  const out: El[] = []
  const visit = (n: Node) => {
    if (typeof n === 'string') return
    out.push(n)
    n.children.forEach(visit)
  }
  visit(norm(tree))
  return out
}
const textOf = (n: Node): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''))
const THEME_KEYS = new Set(['text', 'inactive', 'subtle', 'suggestion', 'success', 'error', 'warning', 'claude', 'permission'])
/** 계약: Box · Text 만, 퍼센트 폭은 정수, 색은 테마 키나 #rrggbb(aa), 이상한 글자 없음 */
function problems(name: string, tree: Node): string[] {
  const out: string[] = []
  for (const n of nodesOf(tree)) {
    if (n.type !== 'Box' && n.type !== 'Text') out.push(`${name}: ${n.type}`)
    for (const k of ['width', 'height']) {
      const v = n.props[k]
      if (typeof v === 'string' && !/^\d+%$/.test(v)) out.push(`${name}: ${k}=${v}`)
      if (typeof v === 'number' && !(Number.isInteger(v) && v >= 0)) out.push(`${name}: ${k}=${v}`)
    }
    for (const k of ['color', 'backgroundColor']) {
      const c = n.props[k]
      if (c != null && !THEME_KEYS.has(String(c)) && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(c))) out.push(`${name}: ${k}=${String(c)}`)
    }
    for (const c of n.children) if (typeof c === 'string' && /NaN|undefined|null|\[object Object\]|Infinity/.test(c)) out.push(`${name}: 글자 "${c}"`)
  }
  return out
}
const modelOf = (name: keyof typeof USAGE, now = NOW) => u.bandModel({ measure: u.measureOf(USAGE[name]), convo: (CONVO as Any)[name], now })

// ---- 순수 함수: 계산 ---------------------------------------------------------------------------------------

test('한도 창: 남은 % · 한 주가 지난 % · 리셋까지 남은 시간', async () => {
  const five = u.rateView({ kind: 'five_hour', percentUsed: 38, resetsAt: iso(NOW + 2 * H + 10 * M) }, NOW, U.FIVE_HOURS)
  expect(five).toMatchObject({ used: 38, rem: 62, level: 'ok', until: '2시간 10분', elapsed: 57, fast: false })
  const week = u.rateView({ kind: 'seven_day', percentUsed: 61, resetsAt: iso(NOW + 2 * D + 14 * H) }, NOW, U.SEVEN_DAYS)
  expect(week).toMatchObject({ rem: 39, elapsed: 63, fast: false, until: '2일 14시간' })
  // 소수 한 자리 값은 반올림한 "쓴 %" 의 나머지(공식 값과 같은 말)
  expect(u.rateView({ kind: 'five_hour', percentUsed: 37.6 }, NOW, U.FIVE_HOURS).rem).toBe(62)
  // 리셋 시각이 없으면 지난 % · 남은 시간도 없다
  expect(u.rateView({ kind: 'five_hour', percentUsed: 38 }, NOW, U.FIVE_HOURS)).toMatchObject({ elapsed: null, until: '', fast: false })
  // 이미 리셋된 창은 옛 값 — 0% 라고 단정하지 않는다
  expect(u.rateView({ kind: 'five_hour', percentUsed: 90, resetsAt: iso(NOW - 1000) }, NOW, U.FIVE_HOURS)).toEqual({ stale: true })
  // 값이 아닌 것은 null
  expect(u.rateView(undefined, NOW, U.FIVE_HOURS)).toBe(null)
  expect(u.rateView({ kind: 'five_hour', percentUsed: 'x' }, NOW, U.FIVE_HOURS)).toBe(null)
  // 지출 한도는 100 을 넘을 수 있다 — 남은 양은 0 에서 멈춘다
  expect(u.rateView({ kind: 'spend_limit', percentUsed: 112 }, NOW, null)).toMatchObject({ used: 100, rem: 0, level: 'out' })
})

test('리셋까지 남은 시간: 분 단위로 올리고, 시간 · 일로 묶는다', async () => {
  expect(u.untilText(30 * 1000)).toBe('1분')
  expect(u.untilText(59 * M + 1)).toBe('1시간')
  expect(u.untilText(2 * H + 9 * M + 30 * 1000)).toBe('2시간 10분')
  expect(u.untilText(2 * H)).toBe('2시간')
  expect(u.untilText(2 * D + 13 * H + 59 * M + 1)).toBe('2일 14시간')
  expect(u.untilText(3 * D)).toBe('3일')
  expect(u.untilText(0)).toBe('')
  expect(u.untilText(-5)).toBe('')
  expect(u.untilText(NaN)).toBe('')
})

test('막대 색은 남은 양으로: 35 이상 파랑 · 12 이상 주황 · 그 아래 빨강', async () => {
  const lv = (rem: number) => u.levelOf(rem)
  expect([100, 35, 34, 12, 11, 0].map(lv)).toEqual(['ok', 'ok', 'low', 'low', 'out', 'out'])
  expect(U.LEVEL_HEX).toEqual({ ok: U.C.blue, low: U.C.amber, out: U.C.red })
  expect([U.C.blue, U.C.amber, U.C.red]).toEqual(['#3b82f6', '#e09a1a', '#e5484d'])
  expect(U.LEVEL_TEXT).toMatchObject({ low: 'warning', out: 'error' })
})

test('숫자 글자: 토큰 · 달러', async () => {
  expect([0, 999, 1000, 412000, 999499, 999500, 1240000, 9949999, 9950000, 21400000, 1.2e9].map((n) => u.fmtTok(n))).toEqual(['0', '999', '1k', '412k', '999k', '1.0M', '1.2M', '9.9M', '10M', '21M', '1.2B'])
  expect(u.fmtTok(NaN)).toBe('0')
  expect([3.2, 11.468, 0.001, 0, 123.4].map((n) => u.fmtUsd(n))).toEqual(['$3.20', '$11.47', '$0.01 미만', '$0.00', '$123'])
})

test('막대 칸: 0 보다 크면 한 칸은 차고, 100 보다 작으면 한 칸은 빈다 · 좁으면 막대가 줄어든다', async () => {
  expect([0, 1, 50, 62, 99, 100].map((p) => u.filledCells(p, 16))).toEqual([0, 1, 8, 10, 15, 16])
  expect(u.textBar(62, 16)).toEqual({ on: '▰'.repeat(10), off: '▱'.repeat(6) })
  // 표: 이름 9 · 막대 · 3 · 숫자 4 + 1 + 단위 4 · 3 · 설명(적어도 14) — 넉넉하면 16칸, 좁으면 줄이고 6칸 아래로는 안 줄인다
  expect([undefined, 100, 72, 53, 52, 45, 30].map((c) => u.barCells(c))).toEqual([16, 16, 16, 15, 14, 7, 6])
})

test('이 대화의 토큰: 턴마다 더하고(캐시 읽기는 새 토큰에서 빼고), 세션이 바뀌면 0 에서', async () => {
  let c = u.emptyConvo('sess-1')
  for (const t of TURNS) c = u.addUsage(c, t.usage)
  expect(c).toEqual(CONVO.known)
  expect(u.freshTokens(c)).toBe(412000)
  // 입력은 그대로 둔다
  const before = JSON.stringify(c)
  u.addUsage(c, TURNS[0]!.usage)
  expect(JSON.stringify(c)).toBe(before)
  // 이상한 값은 0 으로
  expect(u.addUsage(c, { input_tokens: -5, output_tokens: 'x' })).toEqual(c)
  // 같은 세션(리로드)이면 그대로, id 를 모르던 값은 이 세션 것으로, 다른 세션이면 0, id 를 못 읽으면 그대로
  expect(u.adoptConvo(c, 'sess-1')).toBe(c)
  expect(u.adoptConvo({ ...c, sessionId: null }, 'sess-1')).toEqual(c)
  expect(u.adoptConvo(c, 'sess-2')).toEqual(u.emptyConvo('sess-2'))
  expect(u.adoptConvo(c, null)).toBe(c)
  expect(u.adoptConvo({ old: true }, 'sess-1')).toEqual(u.emptyConvo('sess-1'))
})

test('엔진 값 → 저장할 값: JSON 만 남기고 모르는 것은 null', async () => {
  const m = u.measureOf(USAGE.known)
  expect(m.rateLimits).toHaveLength(3)
  expect(m.context).toEqual({ tokens: 182000, window: 1000000, percent: 18 })
  expect(m.costUsd).toBe(3.2)
  expect(u.measureOf(USAGE.unknown)).toEqual({ rateLimits: [], context: { tokens: null, window: 200000, percent: null }, costUsd: null })
  expect(u.measureOf({ rateLimits: [{ kind: 'five_hour' }, null, { kind: 'seven_day', percentUsed: 3 }] }).rateLimits).toEqual([{ kind: 'seven_day', percentUsed: 3 }])
  expect(u.measureOf(null)).toBe(null)
})

test('값을 모르면 %를 지어내지 않는다: 첫 응답 전 · 구독이 아닐 때 · 리셋된 창', async () => {
  const fresh = modelOf('unknown')
  expect(fresh.five).toEqual({ known: false, note: 'wait' })
  expect(fresh.week).toEqual({ known: false, note: 'plain' }) // 같은 말을 두 번 하지 않는다
  expect(u.bandRows(fresh)[0].note).toBe('값 없음 — 첫 응답 뒤에 나와요')
  expect(u.bandRows(fresh)[2]).toEqual({ key: 'convo', label: '이 대화', note: '아직 쓰지 않았어요' })
  // API 키: 응답은 왔지만 한도 값이 없다
  const api = modelOf('apiKey')
  expect(api.five.note).toBe('none')
  expect(u.bandRows(api)[0].note).toBe('값 없음 — 구독 계정에서만 나와요')
  // 5시간 창의 리셋 시각이 지났다 — 다음 응답까지 값 없음, 이번 주는 그대로
  const later = modelOf('known', NOW + 2 * H + 11 * M)
  expect(later.five).toEqual({ known: false, note: 'stale' })
  expect(u.bandRows(later)[0].note).toBe('리셋됐어요 — 다음 응답 뒤에 나와요')
  expect(later.week.known).toBe(true)
  // 한 줄만 비면 그 줄만 "값 없음"
  const half = u.bandModel({ measure: u.measureOf({ rateLimits: [USAGE.known.rateLimits[0]] }), convo: CONVO.known, now: NOW })
  expect(half.five.known).toBe(true)
  expect(half.week).toEqual({ known: false, note: 'plain' })
  // 값을 모르는 줄은 막대 · 숫자 없이 한 마디만, 그 말에도 % 숫자가 없다
  for (const m of [fresh, api, later, half])
    for (const r of u.bandRows(m).slice(0, 2).filter((x: Any) => x.note)) {
      expect(r.bar ?? null).toBe(null)
      expect(r.value ?? null).toBe(null)
      expect(/\d+%/.test(r.note)).toBe(false)
    }
})

test('이번 주의 ⚑: 쓴 양이 지난 시간 + 5 보다 많으면 주황, 아니면 옅게', async () => {
  const blank = { known: false, note: 'plain' }
  const noConvo = { tokens: 0, ctxPct: null, ctxHigh: false, usd: null }
  const weekRow = (used: number) => u.bandRows({ five: blank, week: { known: true, ...u.rateView({ kind: 'seven_day', percentUsed: used, resetsAt: iso(NOW + 2 * D + 14 * H) }, NOW, U.SEVEN_DAYS) }, convo: noConvo, extras: [] })[1]
  const flag = (r: Any) => r.detail.find((p: Any) => String(p.t).startsWith('⚑'))
  expect(flag(weekRow(61))).toEqual({ t: '⚑ 63% 지남', dim: true })
  expect(flag(weekRow(68))).toEqual({ t: '⚑ 63% 지남', dim: true }) // 경계: 63 + 5 는 아직 괜찮다
  expect(flag(weekRow(69))).toEqual({ t: '⚑ 63% 지남', color: 'warning' })
  // 5시간 줄에는 ⚑ 대신 리셋까지 남은 시간 — 숫자 칸 · 단위 칸 · 설명이 따로
  const five = u.bandRows(modelOf('known'))[0]
  expect(five).toMatchObject({ key: 'five', label: '5시간', bar: { rem: 62, level: 'ok' }, value: { t: '62%', bold: true }, unit: '남음', detail: [{ t: '2시간 10분 뒤', dim: true }] })
  // 한도 가까이: 남은 % 글자도 단계 색
  const near = u.bandRows(modelOf('nearLimit'))
  expect(near[0].value).toEqual({ t: '7%', bold: true, color: 'error' })
  expect(near[1].value).toEqual({ t: '22%', bold: true, color: 'warning' })
  expect(flag(near[1])).toEqual({ t: '⚑ 40% 지남', color: 'warning' })
})

test('이 대화 줄: 막대는 컨텍스트에서 남은 양(위 두 줄과 같은 뜻), 설명은 새 토큰 · 비용, 모르면 숫자 칸에 토큰', async () => {
  const row = (m: Any) => u.bandRows(m)[2]
  const words = (r: Any) => r.detail.map((p: Any) => p.t)
  expect(row(modelOf('known'))).toMatchObject({ key: 'convo', label: '이 대화', ctx: true, bar: { rem: 82, level: 'ok' }, value: { t: '82%', bold: true }, unit: '남음' })
  expect(words(row(modelOf('known')))).toEqual(['412k 토큰', '약 $3.20'])
  // 컨텍스트 90% 를 썼다 = 10% 남음 — 바닥(빨강)
  expect(row(modelOf('nearLimit'))).toMatchObject({ bar: { rem: 10, level: 'out' }, value: { t: '10%', bold: true, color: 'error' } })
  expect(words(row(modelOf('nearLimit')))).toEqual(['2.0M 토큰', '약 $11.47'])
  // 이어 연 대화: 이 세션에서 센 토큰은 없지만 컨텍스트 · 비용은 있다
  expect(words(row(u.bandModel({ measure: u.measureOf(USAGE.known), convo: CONVO.unknown, now: NOW })))).toEqual(['약 $3.20'])
  // 컨텍스트를 모르면 막대 없이 숫자 칸에 토큰(단위 '토큰')
  const noCtx = row(u.bandModel({ measure: { rateLimits: [], context: null, costUsd: null }, convo: CONVO.known, now: NOW }))
  expect(noCtx).toMatchObject({ bar: null, value: { t: '412k', bold: true }, unit: '토큰', detail: [] })
})

test('/usage-bar status 의 글자: 띠와 같은 세 줄(+ 다른 한도가 있으면 한 줄)', async () => {
  const known = u.statusText(modelOf('known'), { modelName: 'Opus 5.5' }).split('\n')
  // 띠와 같은 표: 이름 칸 · 막대 · (3칸) 숫자(오른쪽 맞춤) 단위 · (3칸) 설명 — 숫자 · 설명이 세 줄 모두 같은 세로줄에서
  expect(known).toEqual([
    `5시간    ${'▰'.repeat(10)}${'▱'.repeat(6)}    62% 남음   2시간 10분 뒤`,
    `이번 주  ${'▰'.repeat(6)}${'▱'.repeat(10)}    39% 남음   ⚑ 63% 지남`,
    `이 대화  ${'▰'.repeat(13)}${'▱'.repeat(3)}    82% 남음   컨텍스트  ·  412k 토큰  ·  약 $3.20  ·  Opus 5.5`,
    '다른 한도 Opus 주간 56% 남음',
  ])
  expect(u.statusText(modelOf('unknown')).split('\n')).toEqual(['5시간    값 없음 — 첫 응답 뒤에 나와요', '이번 주  값 없음', '이 대화  아직 쓰지 않았어요'])
  const near = u.statusText(modelOf('nearLimit')).split('\n')
  expect(near[0]).toBe(`5시간    ${'▰'}${'▱'.repeat(15)}     7% 남음   25분 뒤`)
  expect(near[1]).toContain('⚑ 40% 지남  ·  빨리 쓰는 중')
})

test('자리가 모자라면 한 줄: 5시간 62%   이번 주 39%   이 대화 82% (칸 사이를 넉넉히)', async () => {
  const say = (m: Any) => u.compactParts(m).map((p: Any) => p.t).join('')
  expect(say(modelOf('known'))).toBe('5시간 62%   이번 주 39%   이 대화 82%')
  expect(say(modelOf('unknown'))).toBe('5시간 값 없음   이번 주 값 없음   이 대화 값 없음')
  expect(say(modelOf('known', NOW + 2 * H + 11 * M))).toBe('5시간 값 없음   이번 주 39%   이 대화 82%')
  // 컨텍스트를 모르면 이 대화는 토큰
  expect(say(u.bandModel({ measure: u.measureOf(USAGE.known), convo: CONVO.known, now: NOW, ...{} }))).toContain('이 대화 82%')
  expect(say(u.bandModel({ measure: { rateLimits: [], context: null, costUsd: null }, convo: CONVO.known, now: NOW }))).toContain('이 대화 412k')
})

test('띠 트리(순수): 모든 견본 · 여러 폭 · 두 표면에서 계약을 지키고, 같은 입력이면 같은 트리', async () => {
  const issues: string[] = []
  for (const name of Object.keys(USAGE) as (keyof typeof USAGE)[]) {
    for (const surface of SURFACES) {
      for (const cols of [20, 40, 52, 72, 120]) {
        for (const compact of [false, true]) {
          const tag = `${name}/${surface}/${cols}/${compact ? 'compact' : 'full'}`
          const tree = bandView(table(), modelOf(name), { surface, cols, compact })
          issues.push(...problems(tag, tree))
          if (JSON.stringify(bandView(table(), modelOf(name), { surface, cols, compact })) !== JSON.stringify(tree)) issues.push(`${tag}: 같은 입력인데 트리가 달라요`)
          const rows = compact ? 1 : 3
          if (tree.children.length !== (compact ? 1 : 3)) issues.push(`${tag}: 줄 ${tree.children.length} ≠ ${rows}`)
        }
      }
    }
  }
  // 남은 %가 소수여도(0.7 씩) 트리가 계약을 지킨다
  for (let used = 0; used <= 100; used += 0.7) {
    const m = u.bandModel({ measure: { rateLimits: [{ kind: 'five_hour', percentUsed: Math.round(used * 10) / 10 }], context: null, costUsd: null }, convo: null, now: NOW })
    issues.push(...problems(`used ${used}`, bandView(table(), m, { surface: 'desktop', cols: 72 })))
  }
  expect(issues).toEqual([])
})

test('제어 문자(ESC · NUL)는 글자에서 빠진다', async () => {
  const m = modelOf('known')
  m.five.until = '2시간\u001b[31m 10분\u0000'
  const tree = bandView(table(), m, { surface: 'terminal', cols: 72 })
  expect(textOf(tree)).toContain('2시간[31m 10분 뒤')
  expect(/[\u0000-\u0008\u000b-\u001f]/.test(textOf(tree))).toBe(false)
})

// ---- 엔진을 통해: 띠 · 명령 · 이벤트 ------------------------------------------------------------------------

const BAND = { plugin: 'usage-bar', component: 'AbovePrompt' } as const
const bandProps = (o: Record<string, unknown> = {}) => ({ hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 72, scroll: { offset: 0, bodyRows: 8 }, view: {}, ...o }) as Any

type World = { clock: Any; usage: Any; id: string; store: Map<string, unknown>; storeSets: { key: string; value: unknown }[] }
/** 플러그인이 부르는 엔진의 것을 메모리로 답한다(시계는 NOW 에서 멈춰 있다) */
function world(on: Any, o: { usage?: Any; surfaces?: string[]; store?: Record<string, unknown> } = {}): World {
  const w: World = { clock: mock.clock(on, { now: NOW }), usage: o.usage ?? USAGE.unknown, id: 'sess-1', store: new Map(Object.entries(o.store ?? {})), storeSets: [] }
  on('store.get', ($: Any, e: Any) => ({ value: w.store.get(e.key) }))
  on('store.set', ($: Any, e: Any) => {
    w.store.set(e.key, e.value)
    w.storeSets.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  on('session.id', () => ({ value: w.id }))
  on('session.usage', () => ({ value: w.usage }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['desktop'] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.measure', ($: Any, e: Any) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => ({ value: { command: 'usage-bar' } }))
  on('classic.SessionStart', () => ({}))
  return w
}
const start = ($: Any) => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
const turn = ($: Any, t: Any, i = 0) => $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: `t${i}`, reason: 'answer', ...(t.agentId ? { agentId: t.agentId } : {}), usage: t.usage })
const measure = ($: Any, x: Any) => $.session.measure({ context: x.context, rateLimits: x.rateLimits, ...(x.cost ? { cost: x.cost } : {}), changed: ['context', 'rateLimits', 'cost'] })
const run = async ($: Any, args: string) => String(((await $.command.run({ command: 'usage-bar', args })) as Any)?.text ?? '')
const rowText = async (ui: Any, key: string) => String((await ui.find({ key }))?.text ?? '')
/** 그려진 트리의 모든 마디 */
const drawnNodes = async (ui: Any): Promise<El[]> => nodesOf((await ui.drawn()) as Node)

test('띠: 터미널 · 데스크톱 모두 세 줄(5시간 · 이번 주 · 이 대화), 막대는 남은 양', async ($, on) => {
  world(on, { usage: USAGE.known })
  await start($)
  for (const [i, t] of TURNS.entries()) await turn($, t, i)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: bandProps() })
    const tree = (await ui.drawn()) as Any
    expect(tree.children.map((r: Any) => r.props.key)).toEqual(['five', 'week', 'convo'])
    expect(await rowText(ui, 'five')).toMatch(/^5시간[▰▱]{16}62%남음2시간 10분 뒤$/)
    expect(await rowText(ui, 'week')).toMatch(/^이번 주[▰▱]{16}39%남음⚑ 63% 지남$/)
    expect(await rowText(ui, 'convo')).toMatch(/^이 대화[▰▱]{16}82%남음412k 토큰 {2}· {2}약 \$3\.20$/)
    const nodes = await drawnNodes(ui)
    // 두 표면 모두 글자 막대: ▰ 가 남은 만큼, ▱ 가 나머지 — 둘 다 16칸(데스크톱에서 상자 막대 둘이 위아래로 붙어 보이지 않게)
    expect(nodes.some((n) => n.type === 'Box' && n.props.backgroundColor !== undefined)).toBe(false)
    const on = nodes.filter((n) => n.type === 'Text' && n.props.color === U.C.blue).map(textOf)
    expect(on).toEqual(['▰'.repeat(10), '▰'.repeat(6), '▰'.repeat(13)])
    // 나머지: 터미널은 옅은 ▱, 데스크톱은 바탕색 ▰(테두리 네모가 지저분해 보이지 않게)
    const off = surface === 'terminal' ? nodes.filter((n) => n.type === 'Text' && /^▱+$/.test(textOf(n))) : nodes.filter((n) => n.type === 'Text' && n.props.color === U.C.track && /^▰+$/.test(textOf(n)))
    expect(off.map((n) => textOf(n).length)).toEqual([6, 10, 3])
    // 이름 칸은 고정 폭 — 막대 · 글자가 같은 세로줄에서 시작
    expect(nodes.filter((n) => n.type === 'Box' && n.props.width === 9 && n.props.flexShrink === 0)).toHaveLength(3)
    // 숫자 칸(4칸, 오른쪽 맞춤) · 단위 칸(4칸)도 세 줄 모두 같은 폭 — 설명이 같은 세로줄에서 시작
    expect(nodes.filter((n) => n.type === 'Box' && n.props.width === U.NUM_CELLS && n.props.justifyContent === 'flex-end')).toHaveLength(3)
    expect(nodes.filter((n) => n.type === 'Box' && n.props.width === U.UNIT_CELLS && n.props.marginLeft === 1)).toHaveLength(3)
    // 칸 사이는 3칸씩(숫자 칸 앞 · 설명 앞)
    expect(nodes.filter((n) => n.type === 'Box' && n.props.marginLeft === U.GAP_CELLS)).toHaveLength(6)
    await ui.unmount()
  }
})

test('값을 모르면 %를 지어내지 않는다(두 표면 모두) · 이 대화 줄은 늘 있다', async ($, on) => {
  world(on, { usage: USAGE.unknown })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: bandProps() })
    expect(await rowText(ui, 'five')).toBe('5시간값 없음 — 첫 응답 뒤에 나와요')
    expect(await rowText(ui, 'week')).toBe('이번 주값 없음')
    expect(await rowText(ui, 'convo')).toBe('이 대화아직 쓰지 않았어요')
    expect(/\d+%/.test(String((await ui.find({ type: 'Box' }))?.text))).toBe(false)
    // 막대도 없다
    expect((await drawnNodes(ui)).some((n) => n.props.backgroundColor === U.C.track || /[▰▱]/.test(textOf(n)))).toBe(false)
    await ui.unmount()
  }
})

test('API 키처럼 응답이 와도 한도 값이 없으면 "구독 계정에서만" 이라고 한다', async ($, on) => {
  world(on, { usage: USAGE.apiKey })
  await start($)
  await turn($, TURNS[0])
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps() })
  expect(await rowText(ui, 'five')).toBe('5시간값 없음 — 구독 계정에서만 나와요')
  expect(await rowText(ui, 'week')).toBe('이번 주값 없음')
  expect(await rowText(ui, 'convo')).toMatch(/^이 대화▰{12}▱{4}74%남음220k 토큰 {2}· {2}약 \$0\.84$/)
  await ui.unmount()
})

test('한도 가까이: 빨강 · 주황 막대, ⚑ 은 주황(빨리 쓰는 중), 컨텍스트가 10% 남으면 빨강', async ($, on) => {
  world(on, { usage: USAGE.nearLimit })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: bandProps() })
    const nodes = await drawnNodes(ui)
    // 막대의 색 조각(글자만 든 Text)만 — 바깥 한 줄 Text(조각을 감싼 것)와 바탕색 조각은 뺀다
    const fills = nodes.filter((n) => n.type === 'Text' && n.children.every((c) => typeof c === 'string') && /^▰+$/.test(textOf(n)) && n.props.color !== U.C.track)
    expect(fills.map((n) => n.props.color)).toEqual([U.C.red, U.C.amber, U.C.red])
    // 색 조각(글자만 든 Text) — 조각을 감싼 바깥 줄 Text 는 빼고
    const piece = (t: string) => nodes.find((n) => n.type === 'Text' && n.children.every((c) => typeof c === 'string') && textOf(n) === t)
    expect(piece('⚑ 40% 지남')?.props).toEqual({ color: 'warning' })
    expect(nodes.find((n) => n.type === 'Text' && textOf(n) === '7%')?.props).toEqual({ bold: true, color: 'error' })
    expect(nodes.find((n) => n.type === 'Text' && textOf(n) === '10%')?.props).toEqual({ bold: true, color: 'error' })
    expect(await rowText(ui, 'five')).toContain('7%남음25분 뒤')
    await ui.unmount()
  }
})

test('자리가 세 줄이 안 되면(maxRows < 3) 한 줄로 줄인다', async ($, on) => {
  world(on, { usage: USAGE.known })
  await start($)
  for (const [i, t] of TURNS.entries()) await turn($, t, i)
  for (const surface of SURFACES) {
    for (const maxRows of [2, 1, 0]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: bandProps({ maxRows, scroll: { offset: 0, bodyRows: maxRows } }) })
      const tree = (await ui.drawn()) as Any
      expect(tree.props.key).toBe('compact')
      expect(tree.children).toHaveLength(1)
      expect(await rowText(ui, 'compact')).toBe('5시간 62%   이번 주 39%   이 대화 82%')
      await ui.unmount()
    }
    const roomy = await $.ui.mount({ ...BAND, surface, props: bandProps({ maxRows: 3 }) })
    expect(((await roomy.drawn()) as Any).children).toHaveLength(3)
    await roomy.unmount()
  }
})

test('설문이 띠를 쓰면(hasSurvey) 자리를 내준다', async ($, on) => {
  world(on, { usage: USAGE.known })
  // 엔진 자리: 설문을 그린다
  on('ui.render', { component: 'AbovePrompt' }, ($: Any, e: Any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ key: 'survey', children: ['설문이에요'] })
  })
  await start($)
  for (const surface of SURFACES) {
    const survey = await $.ui.mount({ ...BAND, surface, props: bandProps({ hasSurvey: true }) })
    expect(textOf((await survey.drawn()) as Node)).toBe('설문이에요')
    await survey.unmount()
    const band = await $.ui.mount({ ...BAND, surface, props: bandProps() })
    expect(await rowText(band, 'five')).toContain('62%남음')
    await band.unmount()
  }
})

test('/usage-bar 로 숨기면 자리를 내주고, 그 선택을 $.store 에 남기고, 다시 부르면 보인다', async ($, on) => {
  const w = world(on, { usage: USAGE.known })
  on('ui.render', { component: 'AbovePrompt' }, ($: Any, e: Any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['엔진의 빈 띠'] })
  })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: bandProps() })
    expect(await rowText(ui, 'five')).toContain('62%남음')
    expect(await run($, '')).toContain('숨겼어요')
    expect(w.store.get('pref:hidden')).toBe(true)
    expect(textOf((await ui.drawn()) as Node)).toBe('엔진의 빈 띠') // 그려 둔 띠가 바로 바뀐다
    expect(await run($, '')).toContain('보여 드려요')
    expect(w.store.get('pref:hidden')).toBe(false)
    expect(await rowText(ui, 'five')).toContain('62%남음')
    // hide · show 는 몇 번을 불러도 같은 자리
    await run($, 'hide')
    await run($, 'hide')
    expect(w.store.get('pref:hidden')).toBe(true)
    await run($, 'show')
    expect(w.store.get('pref:hidden')).toBe(false)
    await ui.unmount()
  }
})

test('숨겨 둔 선택은 다음 세션에도: 시작할 때 $.store 를 읽는다', async ($, on) => {
  world(on, { usage: USAGE.known, store: { 'pref:hidden': true } })
  on('ui.render', { component: 'AbovePrompt' }, ($: Any, e: Any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['엔진의 빈 띠'] })
  })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps() })
  expect(textOf((await ui.drawn()) as Node)).toBe('엔진의 빈 띠')
  await ui.unmount()
})

test('이 대화의 토큰은 메인과 서브에이전트의 턴을 모두 더한다(캐시 읽기는 빼고)', async ($, on) => {
  world(on, { usage: USAGE.known })
  await start($)
  await turn($, TURNS[0], 0)
  const term = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps() })
  expect(await rowText(term, 'convo')).toContain('220k 토큰')
  // 서브에이전트의 턴(agentId) — 띠는 저절로 다시 그려진다
  await turn($, TURNS[1], 1)
  expect(await rowText(term, 'convo')).toContain('292k 토큰')
  await turn($, TURNS[2], 2)
  expect(await rowText(term, 'convo')).toContain('412k 토큰')
  // 중단된 턴처럼 usage 가 없으면 그대로
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'tx', reason: 'aborted' } as Any)
  expect(await rowText(term, 'convo')).toContain('412k 토큰')
  await term.unmount()
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps() })
  expect(await rowText(desk, 'convo')).toContain('412k 토큰')
  await desk.unmount()
})

test('다시 불러와도(같은 세션) 토큰 합이 남고, 다른 세션 · /clear 면 0 에서 센다', async ($, on) => {
  const w = world(on, { usage: USAGE.known })
  await start($)
  for (const [i, t] of TURNS.entries()) await turn($, t, i)
  // 리로드 뒤의 session.start(같은 세션 id): $.state 의 합이 그대로
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps() })
  expect(await rowText(ui, 'convo')).toContain('412k 토큰')
  // /clear: 다른 대화 — 토큰은 0 에서, 컨텍스트 · 비용은 엔진 값 그대로
  w.usage = USAGE.unknown
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-2' } as Any)
  expect(await rowText(ui, 'convo')).toBe('이 대화아직 쓰지 않았어요')
  await turn($, TURNS[0])
  // 컨텍스트 값이 없으면 막대 자리는 비우고(세로줄은 그대로) 숫자 칸에 토큰
  expect(await rowText(ui, 'convo')).toMatch(/^이 대화 {16}220k토큰$/)
  // 압축(compact)은 같은 대화 — 그대로
  await $.classic.SessionStart({ source: 'compact', session_id: 'sess-2' } as Any)
  expect(await rowText(ui, 'convo')).toMatch(/^이 대화 {16}220k토큰$/)
  // 새 프로세스가 다른 세션으로 시작
  w.id = 'sess-9'
  await start($)
  expect(await rowText(ui, 'convo')).toBe('이 대화아직 쓰지 않았어요')
  await ui.unmount()
})

test('응답이 오면(session.measure) 띠가 저절로 다시 그려진다', async ($, on) => {
  world(on, { usage: USAGE.unknown })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps() })
  expect(await rowText(ui, 'five')).toContain('값 없음')
  await measure($, USAGE.known)
  expect(await rowText(ui, 'five')).toContain('62%남음2시간 10분 뒤')
  await measure($, USAGE.nearLimit)
  expect(await rowText(ui, 'five')).toContain('7%남음25분 뒤')
  expect(await rowText(ui, 'convo')).toContain('10%남음약 $11.47')
  await ui.unmount()
})

test('1분에 한 번 다시 그려 리셋까지 남은 시간을 줄이고, 리셋이 지나면 값 없음', async ($, on) => {
  const w = world(on, { usage: USAGE.known })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps() })
  expect(await rowText(ui, 'five')).toContain('2시간 10분 뒤')
  await w.clock.advance(60000)
  expect(await rowText(ui, 'five')).toContain('2시간 9분 뒤')
  await w.clock.advance(2 * H + 9 * M)
  expect(await rowText(ui, 'five')).toBe('5시간리셋됐어요 — 다음 응답 뒤에 나와요')
  expect(await rowText(ui, 'week')).toContain('39%남음')
  await ui.unmount()
})

test('/usage-bar status: 같은 세 줄을 글자로(띠를 숨겨도 · 그릴 화면이 없어도)', async ($, on) => {
  world(on, { usage: USAGE.known, surfaces: [] })
  await start($)
  for (const [i, t] of TURNS.entries()) await turn($, t, i)
  const text = await run($, 'status')
  const lines = text.split('\n')
  expect(lines[0]).toBe(`5시간    ${'▰'.repeat(10)}${'▱'.repeat(6)}    62% 남음   2시간 10분 뒤`)
  expect(lines[1]).toBe(`이번 주  ${'▰'.repeat(6)}${'▱'.repeat(10)}    39% 남음   ⚑ 63% 지남`)
  expect(lines[2]).toBe(`이 대화  ${'▰'.repeat(13)}${'▱'.repeat(3)}    82% 남음   컨텍스트  ·  412k 토큰  ·  약 $3.20  ·  Opus 5.5`)
  expect(await run($, '상태')).toBe(text)
  // 원격 제어(그릴 화면 없음)에서 /usage-bar: 선택은 바꾸고, 안내와 세 줄을 같이 돌려준다
  const toggled = await run($, '')
  expect(toggled).toContain('숨겼어요')
  expect(toggled).toContain('띠를 그릴 화면이 붙어 있지 않아요')
  expect(toggled).toContain('62% 남음   2시간 10분 뒤')
  // 모르는 말은 바꾸지 않고 쓰는 법만
  const help = await run($, 'blah')
  expect(help).toContain('모르는 말이에요: blah')
  expect(await run($, 'status')).toBe(text)
})

test('좁은 띠: 막대가 줄고(6칸까지) 줄은 늘지 않는다(글자는 끝을 줄인다)', async ($, on) => {
  world(on, { usage: USAGE.known })
  await start($)
  for (const surface of SURFACES) {
    for (const bodyColumns of [45, 30]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: bandProps({ bodyColumns }) })
      const nodes = await drawnNodes(ui)
      const want = bodyColumns === 45 ? 7 : 6
      // 막대 = ▰ 조각 + ▱ 조각, 칸 수(글자 수)가 폭에 따라 준다
      const bars = nodes.filter((n) => n.type === 'Text' && n.children.some((c) => typeof c !== 'string' && /^[▰▱]+$/.test(textOf(c as El))))
      expect(bars.map((b) => textOf(b).length)).toEqual([want, want, want])
      expect(((await ui.drawn()) as Any).children).toHaveLength(3)
      for (const t of nodes.filter((n) => n.type === 'Text' && n.children.some((c) => typeof c !== 'string'))) expect(t.props.wrap).toBe('truncate-end')
      await ui.unmount()
    }
  }
})
