import { expect, test } from 'claude-code/testing'
// parse.js 는 이름이 자주 바뀌므로 통째로 가져온다(없는 이름 하나 때문에 파일 전체가 깨지지 않게)
import * as P from '../hooks/lib/parse.js'
import { C, FACES, agentColor, face } from '../hooks/lib/live-kit.js'
import { crewHeight, trackCells } from '../hooks/lib/live-crew.js'
import { crewProps, statusText } from '../hooks/lib/views.js'
import { NOW, busySession, freshSession, nestedAgents, restingSession, stress } from './fixtures.js'
import type { Any, El } from './kit.js'
import { DONE, EMOJI, PANE, START, byKey, clientText, drawn, drawnText, lastFacts, nodesOf, textAt, textOf, world } from './kit.js'

const p = P as Any

// ---- 순수 함수: 도구 · 시간 · 무대 · 흐름 모델 ---------------------------------------------------------------

test('도구 호출이 한국어 동사 · 대상 · 소품으로 바뀐다', async () => {
  expect(p.toolInfo('Read', { file_path: '/a/b/c.ts' })).toMatchObject({ verb: '읽는 중', target: 'c.ts', prop: 'book' })
  expect(p.toolInfo('Bash', { command: 'ls -la\nwc -l', description: '목록 보기' })).toMatchObject({ verb: '명령 실행', target: '목록 보기', prop: 'terminal' })
  expect(p.toolInfo('Bash', { command: '\n  npm test\nnext' }).target).toBe('npm test')
  expect(p.toolInfo('WebFetch', { url: 'https://example.com/a?b' }).target).toBe('example.com')
  expect(p.toolInfo('WebFetch', { url: 'not a url' }).target).toBe('')
  expect(p.toolInfo('Agent', { description: '로그인 코드 지도' })).toMatchObject({ verb: '에이전트 호출', prop: 'radio' })
  expect(p.toolInfo('mcp__claude_ai_Notion__search', {})).toMatchObject({ verb: '외부 도구', target: 'Notion/search', prop: 'plug' })
  expect(p.toolInfo('SomethingNew', {})).toMatchObject({ verb: 'SomethingNew', prop: 'plug' })
  expect([...p.SPAWN_TOOLS].sort()).toEqual(['Agent', 'Task', 'Workflow'])
})

test('걸린 시간은 짧게: 초 · 분 · 시간', async () => {
  expect(p.shortDur(40_000)).toBe('40초')
  expect(p.shortDur(360_000)).toBe('6분')
  expect(p.shortDur(298_000)).toBe('5분')
  expect(p.shortDur(65 * 60_000)).toBe('1시간 5분')
  expect(p.shortDur(120 * 60_000)).toBe('2시간')
  expect(p.shortDur(-5)).toBe('0초')
  expect(p.shortDur(NaN)).toBe('0초')
  expect(p.trunc('  a\n b\tc  ', 10)).toBe('a b c')
  expect(p.trunc('abcdefghij', 5)).toBe('abcd…')
})

test('AgentStatus → 갈래 상태', async () => {
  expect(['running', 'completed', 'failed', 'killed', 'idle', 'waiting', 'pending'].map(p.laneStatusOf)).toEqual(['running', 'done', 'error', 'error', 'waiting', 'waiting', 'waiting'])
})

test('무대 모델: 방금 끝난 도구는 잠깐 현재 도구로 보인다', async () => {
  const now = 100000
  const main = { busy: true, tool: null, lastTool: { name: 'Read', verb: '읽는 중', target: 'a.ts', prop: 'book' }, lastToolAt: now - 800 }
  expect(p.buildStage({ now, main, agents: [] }).main).toMatchObject({ state: 'working', tool: { verb: '읽는 중', target: 'a.ts' } })
  expect(p.buildStage({ now: now + 5000, main, agents: [] }).main).toMatchObject({ state: 'thinking', tool: null })
  expect(p.buildStage({ now, main: { ...main, busy: false }, agents: [] }).main).toMatchObject({ state: 'idle', tool: null })
})

test('무대 모델: "N명 더 일하는 중" 은 끝나지 않은 숨은 에이전트만 센다', async () => {
  const now = 100000
  const main = { busy: true, tool: null, lastTool: null, lastToolAt: 0 }
  const agents = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, type: 'worker', description: '', status: 'failed', tools: 1, seenAt: now - 9000, doneAt: now - 60000 }))
  agents.push({ id: 'live', type: 'Explore', description: '', status: 'running', tools: 1, seenAt: now - 9000, doneAt: 0 } as Any)
  const s = p.buildStage({ now, main, agents })
  expect(s.crew.length).toBe(9)
  expect(s.crew[0].key).toBe('live') // 일하는 에이전트가 먼저 자리를 차지한다
  expect(s.moreBusy).toBe(0)
})

test('무대 모델: 서브에이전트 상태 · 선반 · 부모, 에이전트 구역 제목 줄의 "N명 일하는 중"', async () => {
  const now = 100000
  const main = { busy: false, tool: null, lastTool: null, lastToolAt: 0 }
  const agents = [
    { id: 'a', type: 'Explore', description: '지도', status: 'running', tool: { name: 'Grep', verb: '내용 검색', target: 'x', prop: 'magnifier' }, tools: 2, seenAt: now - 9000 },
    { id: 'n', type: 'Plan', description: '막 왔어요', status: 'running', tools: 0, seenAt: now - 500, parentKey: 'a' },
    { id: 'b', type: 'Plan', description: '계획', status: 'completed', tools: 5, seenAt: now - 50000, doneAt: now - 2000 },
    { id: 'c', type: 'Plan', description: '옛 계획', status: 'completed', tools: 5, seenAt: now - 90000, doneAt: now - 60000 },
    { id: 'd', type: 'general-purpose', description: '실패', status: 'failed', tools: 1, seenAt: now - 90000, doneAt: now - 60000, parentKey: 'ghost' },
    { id: 'w', type: 'Explore', description: '', status: 'idle', tools: 1, seenAt: now - 90000 },
  ]
  const s = p.buildStage({ now, main, agents })
  expect(s.main.state).toBe('idle')
  expect(s.crew.map((a: Any) => `${a.key}:${a.state}`)).toEqual(['a:working', 'n:spawning', 'w:waiting', 'b:done', 'd:done'])
  expect(s.crew.find((a: Any) => a.key === 'd').error).toBe(true) // 실패한 건 선반으로 보내지 않는다
  expect(s.crew.find((a: Any) => a.key === 'd').parentKey).toBe('main') // 부모가 무대에 없으면 Claude 에게서
  expect(s.crew.find((a: Any) => a.key === 'n').parentKey).toBe('a')
  expect(s.shelf.map((a: Any) => a.key)).toEqual(['c'])
  // 제목 줄: 일하는(일 · 생각 · 출근) 에이전트 수 + 넘친 일꾼, 아무도 안 일하면 다녀간 수, 숨은 갈래는 +N명
  const flow = { t0: now - 60000, now, lanes: [], hidden: 0 }
  expect(crewProps({ now, agents: s, flow }, 48, false).summary).toBe('2명 일하는 중')
  expect(crewProps({ now, agents: { ...s, moreBusy: 3 }, flow: { ...flow, hidden: 4 } }, 48, false).summary).toBe('5명 일하는 중 · +4명')
  expect(crewProps(restingSession, 48, false).summary).toBe('3명 다녀감')
  expect(crewProps(freshSession, 48, false).summary).toBe('')
})

test('흐름 모델: Claude 가 맨 위, 나머지는 시작 순, 갈래는 7개까지 · 나머지는 hidden', async () => {
  const now = 10_000_000
  const lane = (i: number, over: Record<string, unknown> = {}) => ({ key: `a${i}`, kind: 'agent', type: 'Explore', label: `A${i}`, parentKey: 'main', startAt: now - (20 - i) * 30000, endAt: null, status: 'running', marks: [{ t: now - 1000 }], ...over })
  const lanes = Array.from({ length: 10 }, (_, i) => lane(i, i < 3 ? { status: 'done', endAt: now - 60000 } : {}))
  const f = p.buildFlow({ now, startedAt: now - 3600000, main: { startAt: now - 700000, status: 'running', marks: [] }, lanes })
  expect(f.lanes[0]).toMatchObject({ key: 'main', kind: 'main', label: 'Claude', startAt: now - 700000 })
  expect(f.lanes.length - 1).toBe(7)
  expect(f.hidden).toBe(3)
  const starts = f.lanes.slice(1).map((l: Any) => l.startAt)
  expect(starts).toEqual([...starts].sort((a: number, b: number) => a - b))
  // 돌고 있는 7개가 먼저 자리를 차지한다
  expect(f.lanes.slice(1).every((l: Any) => l.status === 'running')).toBe(true)
  expect(f.t0 <= Math.min(...f.lanes.map((l: Any) => l.startAt))).toBe(true)
  expect(f.now).toBe(now)
  // 부모가 안 보이면 Claude 에게서 갈라진 것으로
  const g = p.buildFlow({ now, startedAt: 0, main: { startAt: now - 60000, status: 'running', marks: [] }, lanes: [lane(1, { parentKey: 'ghost' })] })
  expect(g.lanes[1].parentKey).toBe('main')
})

test('흐름 모델: 창(15분) 밖에서 끝난 갈래 · 눈금은 빠지고, Claude 가 아직 일하지 않았으면 빈 갈래', async () => {
  const now = 10_000_000
  const M = 60000
  const f = p.buildFlow({
    now,
    startedAt: now - 60 * M,
    main: { startAt: now - 40 * M, endAt: now - 2 * M, status: 'waiting', marks: [{ t: now - 30 * M }, { t: now - 5 * M }] },
    lanes: [
      { key: 'old', kind: 'agent', type: 'Plan', label: 'Plan', parentKey: 'main', startAt: now - 30 * M, endAt: now - 20 * M, status: 'done', marks: [] },
      { key: 'new', kind: 'worker', type: 'worker', label: '작업자 1', parentKey: 'main', startAt: now - 3 * M, endAt: now - M, status: 'done', marks: [{ t: now - 2 * M }] },
    ],
  })
  expect(f.lanes.map((l: Any) => l.key)).toEqual(['main', 'new'])
  expect(f.hidden).toBe(1)
  expect(f.t0).toBe(now - 15 * M)
  expect(f.lanes[0].marks).toEqual([{ t: now - 5 * M }]) // 창 밖 눈금은 빠지고, 눈금은 시각만
  expect(f.lanes[0]).toMatchObject({ endAt: now - 2 * M, status: 'waiting' })
  const fresh = p.buildFlow({ now, startedAt: now - 1000, main: { startAt: null, status: 'waiting', marks: [] }, lanes: [] })
  expect(fresh.lanes).toHaveLength(1)
  expect(fresh.lanes[0].startAt).toBe(null)
  expect(now - fresh.t0).toBe(30000) // 아무리 짧아도 30초 폭
})

// ---- 에이전트 구역: Client 에 넘기는 값(crewProps) ------------------------------------------------------------------

test('에이전트 값: 갈래마다 이름(general-purpose 는 general) · 색 · 시작/끝 비율(0–1) · 눈금 · 걸린 시간, 손자는 depth 1', async () => {
  const cp = crewProps(busySession, 54, false)
  expect(cp.lanes.map((l: Any) => l.key)).toEqual(['main', 'a1', 'a3', 'wf-7c1e', 'wf-9d40', 'a2'])
  expect(cp.lanes.map((l: Any) => l.label)).toEqual(['Claude', 'Explore', 'general', '작업자 1', '작업자 2', 'Plan'])
  expect(cp.lanes.map((l: Any) => l.dur)).toEqual(['6분', '5분', '2분', '3분', '2분', '2분'])
  expect(cp.lanes.map((l: Any) => l.status)).toEqual(['running', 'running', 'error', 'running', 'done', 'done'])
  expect(cp.lanes.map((l: Any) => l.color)).toEqual([C.claude, agentColor('Explore'), agentColor('general-purpose'), agentColor('worker'), agentColor('worker'), agentColor('Plan')])
  expect([C.teal, C.blue, C.amber, C.purple]).toEqual([agentColor('Explore'), agentColor('general-purpose'), agentColor('worker'), agentColor('Plan')])
  expect(agentColor('security-auditor')).toBe(agentColor('security-auditor')) // 모르는 종류는 이름으로 늘 같은 색
  // 시각은 0–1 비율: 왼쪽 = 흐름의 시작(t0), 오른쪽 = 지금. 일하는 갈래는 지금(1)까지
  for (const l of cp.lanes) expect(l.s >= 0 && l.s <= 1 && l.e >= l.s && l.e <= 1).toBe(true)
  expect(cp.lanes[0]).toMatchObject({ main: true, s: 15 / 375, e: 1 })
  expect(cp.lanes[2]).toMatchObject({ error: true, s: (375 - 208) / 375, e: (375 - 118) / 375 })
  expect(cp.lanes[0].marks).toHaveLength(17)
  expect(cp.lanes[0].marks.every((x: number) => x >= 0 && x <= 1)).toBe(true)
  expect(cp.axis).toEqual({ left: '6분 전', right: '지금' })
  // 지금 하는 일은 일하는 갈래만 — 데스크톱은 소품 그림 + 대상, 터미널은 짧은 낱말 + 대상
  expect(cp.lanes.map((l: Any) => l.doing)).toEqual(['⌨️ 테스트 돌리기', '🔍 refreshToken', '', '⌨️ npm test -- session', '', ''])
  expect(crewProps(busySession, 54, true).lanes.map((l: Any) => l.doing)).toEqual(['실행 테스트 돌리기', '찾기 refreshToken', '', '실행 npm test -- session', '', ''])
  // 손자 에이전트(부모가 Claude 가 아닌 갈래)는 depth 1
  expect(crewProps(nestedAgents, 54, false).lanes.map((l: Any) => `${l.label}:${l.depth}`)).toEqual(['Claude:0', 'Explore:0', '작업자 1:0', 'reviewer:0', 'Explore:1', 'general:0'])
  // 아직 아무도 일하지 않았다: Claude 의 빈 갈래(s > e) · 걸린 시간 없음 · "방금 전"
  const fresh = crewProps(freshSession, 54, false)
  expect(fresh.lanes).toHaveLength(1)
  expect(fresh.lanes[0]).toMatchObject({ label: 'Claude', s: 1, e: 0, dur: '', state: 'idle', status: 'waiting' })
  expect(fresh.axis.left).toBe('방금 전')
})

// ---- 에이전트 구역 그리기(live-crew.js) -------------------------------------------------------------------------------

const lanesOf = (t: El) => nodesOf(t, (n) => n.type === 'Box' && String(n.props.key ?? '').startsWith('l-'))
/** 갈래 첫 줄: [얼굴, 이름, 지금 하는 일, 걸린 시간] */
const topOf = (lane: El) => (byKey(lane, 'top')!.children as El[]).map(textOf)
/** 데스크톱 막대: 칸마다 펼친 바탕색('' = 칠하지 않은 레일), 끝 기호 칸은 그 글자 */
function stripCells(lane: El): string[] {
  const row = byKey(lane, 'track')!.children[0] as El
  const out: string[] = []
  for (const b of row.children as El[]) {
    if (b.children.length) out.push(textOf(b))
    else for (let i = 0; i < Number(b.props.width); i++) out.push(String(b.props.backgroundColor ?? ''))
  }
  return out
}
/** 터미널 막대: 글자 그대로 */
const glyphTrack = (lane: El) => textOf(byKey(lane, 'track')!)

test('에이전트 구역: 제목 줄, 갈래마다 두 줄(캐릭터 · 이름 · 지금 하는 일 · 걸린 시간 / 시간 막대), 맨 아래 시간 축', async () => {
  const t = drawn(busySession, 'live-crew')
  expect(textOf(byKey(t, 'head')!)).toBe('에이전트2명 일하는 중')
  const lanes = lanesOf(t)
  expect(lanes.map((l) => l.props.key)).toEqual(['l-main', 'l-a1', 'l-a3', 'l-wf-7c1e', 'l-wf-9d40', 'l-a2'])
  expect(lanes.map(topOf)).toEqual([
    ['ᕙ(•ᴗ•)ᕗ', 'Claude', '⌨️ 테스트 돌리기', '6분'],
    ['ᕦ(•ᴗ•)ᕤ', 'Explore', '🔍 refreshToken', '5분'],
    ['(;ᴗ;)', 'general', '', '2분'],
    ['ᕦ(•ᴗ•)ᕤ', '작업자 1', '⌨️ npm test -- session', '3분'],
    ['(^ᴗ^)', '작업자 2', '', '2분'],
    ['(^ᴗ^)✧', 'Plan', '', '2분'],
  ])
  // 얼굴 칸 · 이름 칸은 갈래마다 같은 폭 — 막대가 모두 같은 세로줄에서 시작한다
  expect(new Set(lanes.map((l) => (byKey(l, 'top')!.children[0] as El).props.width))).toEqual(new Set([10]))
  expect(new Set(lanes.map((l) => (byKey(l, 'top')!.children[1] as El).props.width)).size).toBe(1)
  expect(new Set(lanes.map((l) => byKey(l, 'track')!.props.paddingLeft))).toEqual(new Set([11]))
  // Claude 는 굵게, 문제가 생긴 갈래는 얼굴 · 이름이 빨강
  expect(nodesOf(byKey(lanes[0]!, 'top')!, (n) => n.type === 'Text' && textOf(n) === 'Claude')[0]!.props).toMatchObject({ color: C.claude, bold: true })
  expect(nodesOf(byKey(lanes[2]!, 'top')!, (n) => n.type === 'Text' && n.props.color === C.red).map(textOf)).toEqual(['(;ᴗ;)', 'general'])
  // 시간 축: 막대 바로 아래, 막대 폭에 맞춰 양 끝에
  const axis = byKey(t, 'axis')!
  expect(textOf(axis)).toBe('6분 전지금')
  expect(axis.props.paddingLeft).toBe(11)
  expect((axis.children[0] as El).props).toMatchObject({ width: 54 - 11, justifyContent: 'space-between' })
  // 갈래가 넷을 넘으면 갈래 사이 줄 없이(창 높이를 모를 때), 넷 이하면 한 줄씩
  expect(byKey(t, 'lanes')!.props.rowGap).toBe(0)
  expect(byKey(drawn(restingSession, 'live-crew'), 'lanes')!.props.rowGap).toBe(1)
  // 도구 횟수 · 따옴표 · 옛 무대의 안내 줄은 없다
  expect(textOf(t)).not.toMatch(/도구 \d+회|“|”|에이전트를 부르면|쉬는 중 ·/)
})

test('에이전트 구역: 아직 아무도 일하지 않았으면 Claude 의 빈 갈래 하나, 쉬는 Claude 는 ○, 숨은 갈래는 제목 줄에 +N명', async () => {
  // 처음: Claude 한 갈래 — 쉬는 얼굴, 걸린 시간 없이, 막대는 칠하지 않은 레일뿐(끝 기호도 없다), 축은 "방금 전"
  for (const surface of ['desktop', 'terminal'] as const) {
    const t = drawn(freshSession, 'live-crew', surface)
    expect(textOf(byKey(t, 'head')!)).toBe('에이전트')
    const lanes = lanesOf(t)
    expect(lanes).toHaveLength(1)
    expect(topOf(lanes[0]!)).toEqual(['(-ᴗ-)', 'Claude', '', ''])
    expect(textOf(byKey(t, 'axis')!)).toBe('방금 전지금')
    if (surface === 'desktop') expect(stripCells(lanes[0]!).every((c) => c === '')).toBe(true)
    else expect(glyphTrack(lanes[0]!)).toBe('━'.repeat(54 - 11))
  }
  // 쉬는 중: Claude 는 마지막 턴이 끝난 자리에 ○, 에이전트는 모두 ✓, 제목 줄은 "3명 다녀감"
  const resting = drawn(restingSession, 'live-crew', 'terminal')
  expect(textOf(byKey(resting, 'head')!)).toBe('에이전트3명 다녀감')
  expect(lanesOf(resting).map((l) => glyphTrack(l).replace(/━/g, ''))).toEqual(['○', '✓', '✓', '✓'])
  expect(topOf(lanesOf(resting)[0]!)[3]).toBe('10분')
  // 갈래가 많으면: 일곱 갈래까지 그리고 나머지는 제목 줄의 +N명, 넘친 일꾼도 일하는 수에 더한다
  const s = drawn(stress, 'live-crew')
  expect(lanesOf(s)).toHaveLength(8)
  expect(textOf(byKey(s, 'head')!)).toBe('에이전트9명 일하는 중 · +5명')
  // 긴 이름은 이름 칸(최대 12칸)에서 끝을 줄인다
  expect(new Set(lanesOf(s).map((l) => (byKey(l, 'top')!.children[1] as El).props.width))).toEqual(new Set([12]))
  expect((((byKey(lanesOf(s)[4]!, 'top')!.children[1] as El).children[0]) as El).props.wrap).toBe('truncate-end')
})

test('에이전트 구역: 얼굴은 프레임마다 바뀌고(일하는 몸짓 · 쉬는 숨 · 문제의 눈물), 터미널은 그림 문자 없이', async () => {
  const faceAt = (d: Any, i: number, f: number, surface: 'desktop' | 'terminal' = 'desktop') => topOf(lanesOf(drawn(d, 'live-crew', surface, f))[i]!)[0]
  // 세 프레임마다 한 번 바뀐다(갈래마다 박자가 어긋나게 i 만큼 밀려 있다)
  expect([0, 1, 2, 3, 4, 5, 6].map((f) => faceAt(busySession, 0, f))).toEqual(['ᕙ(•ᴗ•)ᕗ', 'ᕙ(•ᴗ•)ᕗ', 'ᕙ(•ᴗ•)ᕗ', 'ᕦ(•ᴗ•)ᕤ', 'ᕦ(•ᴗ•)ᕤ', 'ᕦ(•ᴗ•)ᕤ', 'ᕙ(•ᴗ•)ᕗ'])
  expect([0, 3].map((f) => faceAt(busySession, 2, f))).toEqual(['(;ᴗ;)', '(;ᴗ;)💧'])
  expect([0, 3].map((f) => faceAt(busySession, 2, f, 'terminal'))).toEqual(['(;ᴗ;)', '(;ᴗ;)'])
  expect([0, 3, 6, 9].map((f) => faceAt(restingSession, 0, f))).toEqual(['(-ᴗ-)', '(-ᴗ-)z', '(-ᴗ-)zZ', '(-ᴗ-)zZ'])
  expect(faceAt(nestedAgents, 5, 0)).toBe(FACES.spawning[1]) // 막 출근한 general — 박자가 다섯 칸 밀렸다
  // 손자 갈래의 얼굴은 줄바꿈 없는 빈칸(U+00A0) 두 칸 들여 쓴다
  expect(faceAt(nestedAgents, 4, 0)).toBe('\u00a0\u00a0(•_•)')
  // 같은 얼굴 함수: 음수 프레임도 안전, plain 이면 💧 를 뺀다
  expect(face('working', false, -1)).toBe(FACES.working[1])
  expect(face('done', true, 1, true)).toBe('(;ᴗ;)')
  expect(face('mystery', false, 0)).toBe(FACES.waiting[0])
  for (const f of [0, 1, 2, 3, 4, 5]) expect(EMOJI.test(textOf(drawn(stress, 'live-crew', 'terminal', f)))).toBe(false)
})

test('시간 막대(데스크톱): 색칠한 상자 — 일한 동안만 옅게, 도구를 쓴 칸은 중간 톤, 지금 끝은 진하게, 끝난 자리는 ✓ · ✕ 글자', async () => {
  const lanes = lanesOf(drawn(busySession, 'live-crew'))
  const TW = 54 - 11
  for (const l of lanes) {
    expect(stripCells(l)).toHaveLength(TW)
    expect(textOf(byKey(l, 'track')!)).not.toContain('━') // 데스크톱 막대는 글자가 아니라 상자
  }
  const [claude, explore, general, w1, w2, plan] = lanes.map(stripCells) as string[][]
  // 일하는 Claude: 시작 앞은 칠하지 않은 레일, 그 뒤로 끝까지 Claude 색(옅게 42 · 도구 칸 99 · 지금 끝은 진하게)
  const sc = Math.round((15 / 375) * (TW - 1))
  expect(claude!.slice(0, sc).every((c) => c === '')).toBe(true)
  expect(claude!.slice(sc).every((c) => c.startsWith(C.claude))).toBe(true)
  expect(new Set(claude!.slice(sc))).toEqual(new Set([C.claude, `${C.claude}42`, `${C.claude}99`]))
  expect(claude!.at(-1)).toBe(C.claude) // 프레임 0: 지금 끝이 진하다
  expect(explore!.at(-1)).toBe(`${C.teal}99`) // 갈래마다 박자가 다섯 프레임씩 어긋난다(둘째 갈래는 프레임 5 — 숨을 내쉰 쪽)
  // 끝난 갈래: 끝 자리에 ✓(끝) · ✕(문제) 글자, 그 뒤는 칠하지 않는다
  expect(general!.includes('✕')).toBe(true)
  expect(general!.slice(general!.indexOf('✕') + 1).every((c) => c === '')).toBe(true)
  expect([w2!.indexOf('✓') > 0, plan!.indexOf('✓') > 0]).toEqual([true, true])
  expect(w1!.at(-1)!.startsWith(C.amber)).toBe(true) // 작업자(목록에 없는 갈래)는 주황
  // 끝 글자는 상태 색으로, 한 칸
  const glyph = nodesOf(byKey(lanes[2]!, 'track')!, (n) => n.type === 'Text')[0]!
  expect(glyph.props).toMatchObject({ color: C.red, bold: true })
  const glyphBox = nodesOf(byKey(lanes[5]!, 'track')!, (n) => n.type === 'Box' && n.children.length > 0 && n.props.width === 1)[0]!
  expect(textOf(glyphBox)).toBe('✓')
  expect((glyphBox.children[0] as El).props.color).toBe(C.green)
  // 바탕 레일은 칠하지 않는다(상자 막대가 무겁지 않게) — 색은 모두 #rrggbb 이나 #rrggbbaa
  for (const cells of [claude, explore, general, w1, w2, plan]) for (const c of cells!) expect(c === '' || c === '✓' || c === '✕' || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)).toBe(true)
})

test('시간 막대(터미널): 모든 칸이 같은 글자(━)라 갈래끼리 세로로 맞는다 — 끝 기호(● ✓ ✕ ○)만 다르고, 끝난 자리가 시각 순서대로', async () => {
  const term = lanesOf(drawn(busySession, 'live-crew', 'terminal'))
  const desk = lanesOf(drawn(busySession, 'live-crew'))
  const TW = 54 - 11
  const bars = term.map(glyphTrack)
  for (const b of bars) expect([...b]).toHaveLength(TW)
  expect(bars.map((b) => b.replace(/━/g, ''))).toEqual(['●', '●', '✕', '●', '✓', '✓'])
  expect(term.some((l) => nodesOf(l, (n) => n.type === 'Box' && n.props.backgroundColor != null).length > 0)).toBe(false)
  // 끝난 자리: general(118초 전) < 작업자 2(40초 전) < Plan(8초 전) < 지금(●, 맨 끝)
  const at = (b: string, g: string) => [...b].indexOf(g)
  expect(at(bars[2]!, '✕')).toBeLessThan(at(bars[4]!, '✓'))
  expect(at(bars[4]!, '✓')).toBeLessThan(at(bars[5]!, '✓'))
  expect(at(bars[5]!, '✓')).toBeLessThan(at(bars[0]!, '●'))
  expect(at(bars[0]!, '●')).toBe(TW - 1)
  // 데스크톱 상자 막대와 끝 자리가 같은 칸이다
  expect(at(bars[2]!, '✕')).toBe(stripCells(desk[2]!).indexOf('✕'))
  expect(at(bars[5]!, '✓')).toBe(stripCells(desk[5]!).indexOf('✓'))
  // 터미널은 반투명 색 대신 dim — 레일은 회색 dim, 일한 동안은 갈래 색 dim
  const runs = nodesOf(byKey(term[2]!, 'track')!, (n) => n.type === 'Text' && n.children.every((c) => typeof c === 'string'))
  expect(runs[0]!.props).toMatchObject({ color: C.gray, dimColor: true })
  expect(runs.some((r) => r.props.color === C.blue && r.props.dimColor === true)).toBe(true)
  // 넘치면 앞(옛날)쪽을 잘라 '지금' 쪽이 늘 보인다
  expect((byKey(term[0]!, 'track')!.children[0] as El).props).toMatchObject({ width: TW, height: 1, overflow: 'hidden' })
  expect(((byKey(term[0]!, 'track')!.children[0] as El).children[0] as El).props.wrap).toBe('truncate-start')
})

test('일하는 갈래: 빛이 막대를 따라 한 칸씩 흐르고, 지금 끝은 세 프레임마다 숨 쉰다(데스크톱 옅은 색 · 터미널 dim)', async () => {
  const claudeAt = (f: number) => stripCells(lanesOf(drawn(busySession, 'live-crew', 'desktop', f))[0]!)
  const TW = 54 - 11
  const full = (f: number) => claudeAt(f).flatMap((c, k) => (c === C.claude && k < TW - 1 ? [k] : []))
  const sc = Math.round((15 / 375) * (TW - 1))
  expect(full(0)).toEqual([sc])
  expect(full(5)).toEqual([sc + 3, sc + 4, sc + 5])
  expect(full(6)).toEqual([sc + 4, sc + 5, sc + 6])
  expect([0, 2, 3, 5, 6].map((f) => claudeAt(f).at(-1))).toEqual([C.claude, C.claude, `${C.claude}99`, `${C.claude}99`, C.claude])
  // 끝난 갈래는 움직이지 않는다
  expect(JSON.stringify(stripCells(lanesOf(drawn(busySession, 'live-crew', 'desktop', 0))[5]!))).toBe(JSON.stringify(stripCells(lanesOf(drawn(busySession, 'live-crew', 'desktop', 7))[5]!)))
  // 터미널: 끝의 ● 는 색은 그대로, dim 으로 숨 쉰다(반투명 색 없이)
  const endRun = (f: number) => nodesOf(byKey(lanesOf(drawn(busySession, 'live-crew', 'terminal', f))[0]!, 'track')!, (n) => n.type === 'Text' && textOf(n) === '●')[0]!
  expect(endRun(0).props).toEqual({ color: C.claude, bold: true })
  expect(endRun(3).props).toEqual({ color: C.claude, dimColor: true, bold: true })
})

test('trackCells: 빈 갈래는 레일뿐, 기다리는 갈래는 ○, 비율은 칸 수에 맞춰 반올림', async () => {
  const lane = (o: Record<string, unknown>) => ({ color: C.blue, status: 'done', marks: [], ...o })
  const shape = (cells: Any[]) => cells.map((c) => (c.ch !== '━' ? c.ch : c.color === C.gray || c.color === C.track ? '.' : c.dim || /^#[0-9a-f]{8}$/i.test(c.color) ? '-' : '=')).join('')
  expect(shape(trackCells(lane({ s: 1, e: 0 }), 12, 0, true))).toBe('............')
  expect(shape(trackCells(lane({ s: 0, e: 1 }), 12, 0, true))).toBe('-----------✓')
  expect(shape(trackCells(lane({ s: 0.5, e: 1, status: 'waiting' }), 12, 0, false))).toBe('......-----○')
  expect(shape(trackCells(lane({ s: 0, e: 0.5, status: 'error', marks: [0.2] }), 12, 0, false))).toBe('--=---✕.....')
  // 숫자가 아닌 비율은 빈 갈래로
  expect(shape(trackCells(lane({ s: null, e: 'x' }), 6, 0, true))).toBe('......')
})

test('crewHeight: 제목 1 + 여백 1 + 갈래마다 2줄 + 갈래 사이 줄 + 시간 축 1', async () => {
  const lanes = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}` }))
  expect(crewHeight({ lanes: lanes(1) })).toBe(1 + 1 + 2 + 0 + 1)
  expect(crewHeight({ lanes: lanes(4) })).toBe(1 + 1 + 8 + 3 + 1) // 넷까지는 갈래 사이 한 줄
  expect(crewHeight({ lanes: lanes(5) })).toBe(1 + 1 + 10 + 0 + 1) // 다섯부터는 붙여서
  expect(crewHeight({ lanes: lanes(5), gap: 1 })).toBe(1 + 1 + 10 + 4 + 1) // views.js 가 자리를 보고 정한 값이 먼저
  expect(crewHeight({ lanes: lanes(3), gap: 0 })).toBe(1 + 1 + 6 + 0 + 1)
  expect(crewHeight({})).toBe(3)
})

test('/crew status 의 에이전트 부분: 무대(한 줄씩) → 흐름(글자 막대) 순서', async () => {
  const s = statusText(busySession)
  expect(s.indexOf('■ 에이전트 — 2명 일하는 중')).toBe(0)
  expect(s.indexOf('흐름 — 6분 전 → 지금')).toBeGreaterThan(s.indexOf('Claude: 명령 실행 테스트 돌리기'))
  expect(s).toContain('├ Explore: 내용 검색 refreshToken · 로그인 코드 지도 만들기')
  expect(s).toContain('└ general: 문제가 생겼어요 · 세션 만료 재현 스크립트')
  expect(s).toContain('쉬는 중: 작업자 2')
  expect(s).toMatch(/Plan +▕[▁█]+▏✓ 2분/)
  expect(s).toMatch(/general +▕[▁█]+▏✕ 2분/)
  expect(s).toMatch(/Claude +▕[▁█]+▏● 6분/)
  expect(statusText(freshSession)).toMatch(/Claude +▕▁+▏$/m) // 아직 일하지 않은 Claude 는 빈 막대(기호 · 시간 없이)
  expect(statusText(nestedAgents)).toContain('    └ Explore: 생각하는 중 · CI 기록에서 불안정한 테스트 찾기')
  expect(statusText(nestedAgents)).toMatch(/└ Explore +▕/)
  expect(statusText(stress)).toContain('+ 3명 더 일하는 중')
  expect(statusText(restingSession)).toContain('쉬는 중: Explore ×2, Plan')
})

test('스냅샷: 에이전트 견본도 NOW 기준 시각', async () => {
  expect(busySession.flow.now).toBe(NOW)
  expect(busySession.flow.t0).toBe(NOW - 375000)
  expect(stress.flow.lanes).toHaveLength(8)
})

// ---- 화면 · 이벤트 (엔진을 통해): 에이전트 -------------------------------------------------------------------------------

test('Claude 가 도구를 쓰면 첫 갈래에 지금 하는 일이 보이고, 터미널은 소품(그림 문자) 대신 짧은 낱말', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.turn.start({ text: '상태 봐 줘', turnId: 't1' } as Any)
  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'git 상태 확인' } as Any)
  const deskUi = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const d = await clientText(deskUi, 'live-crew')
  expect(d).toContain('⌨️ git 상태 확인')
  expect(d).toContain('Claude')
  await deskUi.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const t = await clientText(term, 'live-crew')
  expect(t).toContain('실행 git 상태 확인')
  expect(EMOJI.test(t)).toBe(false)
  await term.unmount()
})

test('에이전트가 도구를 쓰면 그 갈래가 생긴다(데스크톱 · 터미널 · 휴대폰), 사실은 $.state 에 비춰 둔다', async ($, on) => {
  const w = world(on, { agents: () => [{ id: 'a1', description: '로그인 코드 지도', type: 'Explore', status: 'running' }] })
  await $.session.start(START)
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts', agentId: 'a1' } as Any)
  await w.clock.advance(1000)
  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const shown = await drawnText(ui)
    expect(shown).toContain('Explore')
    expect(shown).toContain(surface === 'terminal' ? '읽기 a.ts' : '📖 a.ts')
    expect(shown).toMatch(/\d+초/) // 갈래 오른쪽 = 걸린 시간
    expect(shown).toContain('1명 일하는 중')
    await ui.unmount()
  }
  expect(lastFacts(w).agents[0]).toMatchObject({ id: 'a1', listed: true, type: 'Explore', desc: '로그인 코드 지도', tools: 1 })
})

test('목록에 이름이 없는 에이전트 id 는 "작업자 1" 갈래가 된다', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.classic.SubagentStart({ agent_id: 'wf-zz', agent_type: 'general-purpose' } as Any)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트', agentId: 'wf-zz' } as Any)
  await $.classic.SubagentStop({ agent_id: 'wf-zz', agent_type: 'general-purpose', stop_hook_active: false, agent_transcript_path: '' } as Any)
  await w.clock.advance(1000)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = await clientText(ui, 'live-crew')
    expect(text).toContain('작업자 1')
    expect(text).toContain('✓') // 끝난 자리
    await ui.unmount()
  }
  expect(lastFacts(w).agents.find((a: Any) => a.id === 'wf-zz')).toMatchObject({ workerN: 1, status: 'done', listed: false })
})

test('목록에서 빠진 에이전트는 끝난 것으로 본다(기다리는 중으로 남지 않는다)', async ($, on) => {
  let list: unknown[] = [{ id: 'a1', description: '지도', type: 'Explore', name: 'mapper', status: 'running' }]
  const w = world(on, { agents: () => list })
  await $.session.start(START)
  await w.clock.advance(2000)
  list = [{ id: 'a1', description: '지도', type: 'Explore', name: 'mapper', status: 'idle' }]
  await w.clock.advance(2000)
  expect(lastFacts(w).agents.find((x: Any) => x.id === 'a1')).toMatchObject({ status: 'waiting', endAt: null })
  list = []
  await w.clock.advance(2000)
  const a = lastFacts(w).agents.find((x: Any) => x.id === 'a1')
  expect(a).toMatchObject({ status: 'done', rawStatus: 'completed', name: 'mapper' })
  expect(a.endAt != null).toBe(true)
})

test('turn.complete: 목록에 없는 작업자는 자기 턴이 끝나면 끝(오류면 문제), Claude 의 턴이 끝나면 쉰다', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.turn.start({ text: '일해 줘', turnId: 't1' } as Any)
  await $.classic.SubagentStart({ agent_id: 'wf-a', agent_type: 'general-purpose' } as Any)
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'wf-a' } as Any)
  await $.turn.complete({ ...DONE, turnId: 'w1', agentId: 'wf-a', reason: 'error' } as Any)
  await $.turn.complete({ ...DONE, turnId: 't1' } as Any)
  await w.clock.advance(1000)
  expect(lastFacts(w).agents.find((a: Any) => a.id === 'wf-a')).toMatchObject({ status: 'error', workerN: 1 })
  expect(lastFacts(w).main.lastTurnEnd != null).toBe(true)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = await clientText(ui, 'live-crew')
  expect(text).toMatch(/\(-ᴗ-\)[\s\S]*Claude/) // 쉬는 얼굴
  expect(text).toContain('(;ᴗ;)') // 문제가 생긴 작업자
  expect(text).toContain('✕')
  await ui.unmount()
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('작업자 1: 문제가 생겼어요')
})

test('다시 불러와도(같은 세션, v0.4 의 v: 3) 에이전트 · 흐름이 되살아나고, 저절로 열기를 또 하지 않으며, 다음 저장은 v: 4', async ($, on) => {
  const t = Date.now() - 60000
  const w = world(on, {
    open: false,
    facts: {
      v: 3,
      sessionId: 'sess-1',
      savedAt: t,
      startedAt: t - 120000,
      autoOpened: true,
      main: { firstAt: t - 90000, lastTurnEnd: t - 1000, marks: [{ t: t - 50000 }] },
      agents: [{ id: 'p1', seenAt: t - 80000, startAt: t - 80000, endAt: t - 30000, doneAt: t - 30000, stopAt: null, status: 'done', rawStatus: 'completed', listed: true, type: 'Plan', name: null, desc: '되살린 계획', parentKey: 'main', workerN: 0, tools: 3, lastTool: null, lastToolAt: t - 40000, lastActAt: t - 40000, marks: [{ t: t - 60000 }] }],
      workerSeq: 0,
      cleared: [],
    },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = await clientText(ui, 'live-crew')
  expect(text).toContain('1명 다녀감') // 끝낸 지 오래 → 선반(제목 줄의 다녀간 수)
  expect(text).toMatch(/Plan[\s\S]*50초/) // 갈래와 걸린 시간
  expect(text).toContain('✓')
  await ui.unmount()
  await $.turn.start({ text: '이어서', turnId: 't9' } as Any)
  await w.clock.advance(2000)
  expect(w.opened).toEqual([])
  expect(lastFacts(w)).toMatchObject({ v: 4, sessionId: 'sess-1', autoOpened: true, touched: [], commits: [], pushes: [], prs: [] })
  expect(lastFacts(w).agents[0]).toMatchObject({ id: 'p1', type: 'Plan', status: 'done', desc: '되살린 계획' })
})

test('v0.3 이 남긴 사실(v: 2)은 에이전트 · 흐름 부분만 되살리고(이 대화가 한 일은 아니다), 다음 저장은 v: 4 모양이다', async ($, on) => {
  const t = Date.now() - 30000
  const w = world(on, {
    facts: {
      v: 2,
      sessionId: 'sess-1',
      savedAt: t,
      startedAt: t - 60000,
      autoOpened: true,
      prompt: { text: '옛 요청', ts: t },
      todos: null,
      events: [{ ts: t, name: 'Claude', type: 'main', label: '읽는 중 a.ts' }],
      main: { firstAt: t - 50000, lastTurnEnd: null, tools: 4, marks: [{ t: t - 40000, cat: 'read', label: '읽는 중 a.ts' }] },
      agents: [{ id: 'x1', seenAt: t - 40000, startAt: t - 40000, endAt: null, doneAt: null, stopAt: null, status: 'running', rawStatus: 'running', listed: true, type: 'Explore', name: 'mapper', desc: '지도', parentKey: 'main', workerN: 0, tools: 2, lastTool: null, lastToolAt: 0, lastActAt: t - 20000, marks: [{ t: t - 30000, cat: 'search', label: '내용 검색 x' }] }],
      workerSeq: 0,
      cleared: [],
      touched: [{ path: '/work/a.ts', ts: t }],
      commits: [],
      pushes: [],
      prs: [],
      tok: { in: 1, out: 2, cr: 3, cc: 4 },
    },
    agents: () => [{ id: 'x1', description: '지도', type: 'Explore', name: 'mapper', status: 'running' }],
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await clientText(ui, 'live-crew')).toContain('mapper')
  await ui.unmount()
  await $.tool.call({ tool: 'Read', file_path: '/work/b.ts', agentId: 'x1' } as Any)
  await w.clock.advance(1000)
  const f = lastFacts(w)
  expect(f.v).toBe(4)
  for (const k of ['prompt', 'todos', 'events', 'tok']) expect(f).not.toHaveProperty(k)
  expect(f.touched).toEqual([]) // v2 의 편집 기록은 work-status 몫이었다 — 되살리지 않는다
  const x1 = f.agents.find((a: Any) => a.id === 'x1')
  expect(x1.tools).toBe(3)
  expect(x1.marks.every((m: Any) => Object.keys(m).join() === 't')).toBe(true)
  expect(f.main.marks.every((m: Any) => Object.keys(m).join() === 't')).toBe(true)
})

test('v: 4 사실은 에이전트 · 흐름과 이 대화가 한 일(편집 · 커밋 · 푸시 · PR)을 함께 되살린다', async ($, on) => {
  const t = Date.now() - 30000
  const w = world(on, {
    facts: {
      v: 4,
      sessionId: 'sess-1',
      savedAt: t,
      startedAt: t - 60000,
      autoOpened: true,
      main: { firstAt: t - 50000, lastTurnEnd: t - 1000, marks: [{ t: t - 40000 }] },
      agents: [{ id: 'q1', seenAt: t - 40000, startAt: t - 40000, endAt: t - 10000, doneAt: t - 10000, stopAt: null, status: 'done', rawStatus: 'completed', listed: true, type: 'Explore', name: null, desc: '찾기', parentKey: 'main', workerN: 0, tools: 2, lastTool: null, lastToolAt: t - 20000, lastActAt: t - 20000, marks: [{ t: t - 30000 }] }],
      workerSeq: 2,
      cleared: ['gone'],
      touched: [{ path: '/work/work-notes.txt', ts: t }],
      commits: [],
      pushes: [],
      prs: [{ url: 'https://github.com/o/r/pull/5', repo: 'o/r', number: 5, action: 'create', title: 'x', ts: t }],
    },
  })
  await $.session.start(START)
  const text = textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))
  expect(text).toContain('Explore')
  expect(text).toContain('커밋하지 않은 변경 1개가 남아 있어요')
  expect(text).toContain('PR #5 열림 https://github.com/o/r/pull/5')
  await $.tool.call({ tool: 'Read', file_path: '/work/c.ts' } as Any)
  await w.clock.advance(1000)
  expect(lastFacts(w)).toMatchObject({ v: 4, workerSeq: 2, cleared: ['gone'], touched: [{ path: '/work/work-notes.txt' }], prs: [{ number: 5 }] })
})

test('시간이 흐르면 에이전트가 끝나고 네 표면 모두 그린다, 사실은 $.state 에 비춰 둔다', async ($, on) => {
  let agentStatus = 'running'
  const w = world(on, { agents: () => [{ id: 'a1', description: '로그인 코드 지도', type: 'Explore', status: agentStatus }] })
  await $.session.start(START)
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts', agentId: 'a1' } as Any)
  await w.clock.advance(8000)
  agentStatus = 'completed'
  await w.clock.advance(2000)
  for (const surface of ['desktop', 'terminal', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    const text = await drawnText(ui)
    expect(text).toContain('Explore')
    expect(text).toContain('(^ᴗ^)') // 끝낸 얼굴
    expect(text).toContain('✓')
    await ui.unmount()
  }
  expect(lastFacts(w)).toMatchObject({ v: 4, sessionId: 'sess-1' })
  expect(lastFacts(w).agents[0]).toMatchObject({ id: 'a1', status: 'done' })
})

test('/clear 뒤에는 끝난 에이전트 · Claude 의 흐름 · 이 대화가 한 일을 비운다(목록에 남아 있어도 다시 세지 않는다)', async ($, on) => {
  let status = 'running'
  const w = world(on, { agents: () => [{ id: 'a1', description: '지도', type: 'Explore', status }] })
  await $.session.start(START)
  await $.turn.start({ text: '찾아 줘', turnId: 't1' } as Any)
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as Any)
  await $.tool.call({ tool: 'Read', file_path: '/work/b.ts', agentId: 'a1' } as Any)
  await $.classic.PostToolUse({ tool_name: 'Write', tool_input: { file_path: '/work/work-notes.txt' }, tool_response: 'ok', tool_use_id: 'x1' } as Any)
  await w.clock.advance(1000)
  status = 'completed'
  await w.clock.advance(1000)
  expect(lastFacts(w).agents.map((a: Any) => a.id)).toEqual(['a1'])
  expect(lastFacts(w).main.marks.length).toBe(1)
  expect(lastFacts(w).touched).toHaveLength(1)
  await $.classic.SessionStart({ source: 'clear' } as Any)
  await w.clock.advance(2000)
  expect(lastFacts(w).agents).toEqual([])
  expect(lastFacts(w).cleared).toEqual(['a1'])
  expect(lastFacts(w).main).toEqual({ firstAt: null, lastTurnEnd: null, marks: [] })
  expect(lastFacts(w).touched).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await clientText(ui, 'live-crew')).not.toContain('Explore')
  await ui.unmount()
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('이 세션에서 바뀐 코드는 아직 없어요')
})
