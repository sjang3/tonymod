import { expect, test } from 'claude-code/testing'
import { C } from '../hooks/lib/live-kit.js'
import { crewHeight } from '../hooks/lib/live-crew.js'
import { workHeight } from '../hooks/lib/live-work.js'
import { serverHeight } from '../hooks/lib/live-server.js'
import { crewProps, paneView, serverProps, spacing, statusText, workProps } from '../hooks/lib/views.js'
import { FIXTURES, busySession, freshSession, nestedAgents, restingSession, stress } from './fixtures.js'
import type { Any, El } from './kit.js'
import { ALPHA, CTRL, EMOJI, LACKS, PANE, SURFACES, START, byKey, clientsOf, drawClient, drawn, drawnText, lastFacts, modName, nodesOf, pane, rowsOf, stringsOf, table, textAt, textOf, treeProblems, world } from './kit.js'

const FX = FIXTURES as Record<string, Any>
const KEYS = ['live-crew', 'live-work', 'live-server']
const HEIGHT: Record<string, (p: Any) => number> = { 'live-crew.js': crewHeight, 'live-work.js': workHeight, 'live-server.js': serverHeight }

// ---- 창 트리(순수): 세 구역 ------------------------------------------------------------------------------------

test('창 트리: 데스크톱 · 터미널은 Client 셋(에이전트 → 작업 → 서버)과 그 사이 간격 상자뿐 — 창의 글자는 모두 Client 안에', async () => {
  for (const [name, d] of Object.entries(FX)) {
    for (const surface of ['desktop', 'terminal'] as const) {
      const tree = pane(d, surface)
      const { problems, texts } = treeProblems(`${name}/${surface}`, tree, ['Box', 'Text', 'Client'])
      expect(problems).toEqual([])
      expect(texts).toEqual([])
      expect(tree.props).toEqual({ flexDirection: 'column', paddingX: 1, paddingTop: 1 })
      expect(tree.children.map((c) => `${(c as El).type}:${(c as El).props.key}`)).toEqual(['Client:live-crew', 'Box:gap-a', 'Client:live-work', 'Box:gap-b', 'Client:live-server'])
      const clients = clientsOf(tree)
      expect(clients).toHaveLength(3)
      // 열쇠는 늘 같다(다시 그려도 상태 · 타이머 유지), module 은 그 Client 모듈 파일, 칸은 창 폭 전체
      expect(clients.map((c) => c.props.key)).toEqual(KEYS)
      expect(clients.map(modName)).toEqual(KEYS.map((k) => `${k}.js`))
      for (const c of clients) expect(String(c.props.module)).toMatch(/(^|\/)hooks\/lib\/live-(crew|work|server)\.js$|^\.\/live-(crew|work|server)\.js$/)
      for (const c of clients) expect(c.props.width).toBe('100%')
      // 값은 JSON 그대로(함수 없음), 폭은 창 폭에서 좌우 한 칸씩 뺀 것, 터미널이면 plain
      for (const c of clients) expect(JSON.parse(JSON.stringify(c.props.props))).toEqual(c.props.props)
      for (const c of clients) expect(c.props.props).toMatchObject({ cols: 54, plain: surface === 'terminal' })
      // 간격 상자: 내용 없이 높이만(창 높이를 모르면 2줄), 줄어들지 않는다
      for (const k of ['gap-a', 'gap-b']) expect(byKey(tree, k)).toEqual({ type: 'Box', props: { key: k, height: 2, flexShrink: 0 }, children: [] })
      // 구역 이름: 에이전트 → 작업 → 서버
      const heads = clients.map((c) => textOf((byKey(drawClient(c), 'head')!.children[0] as El).children[0] as El))
      expect(heads).toEqual(['에이전트', '작업', '서버'])
    }
  }
  // 창 폭을 모르면 48칸으로, 아주 좁아도 안쪽은 24칸 이상
  expect(clientsOf(paneView(table(LACKS.desktop), { ...busySession, surface: 'desktop' }))[0]!.props.props).toMatchObject({ cols: 46 })
  expect(clientsOf(paneView(table(LACKS.desktop), { ...busySession, surface: 'desktop', cols: 10 }))[0]!.props.props).toMatchObject({ cols: 24 })
  expect(clientsOf(paneView(table(LACKS.desktop), { ...busySession, surface: 'desktop', cols: 70.6 }))[0]!.props.props).toMatchObject({ cols: 68 })
})

test('휴대폰 · VS Code 는 Client 없이 같은 모듈의 정지 화면을 넣는다(표에 Client 가 있어도 표면으로 가른다)', async () => {
  for (const surface of ['mobile', 'vscode'] as const) {
    for (const t of [table(LACKS[surface]), table()]) {
      const tree = paneView(t, { ...busySession, surface, cols: 56 }) as El
      expect(clientsOf(tree)).toEqual([])
      expect(tree.children.map((c) => (c as El).props.key ?? null)).toEqual([null, 'gap-a', null, 'gap-b', null])
      const text = textOf(tree)
      for (const w of ['에이전트', 'Claude', 'Explore', '작업자 1', '6분 전', '지금', '작업', '커밋 전 3', '#128 열림', 'auth-service', '서버', '빠듯', '39%']) expect(text).toContain(w)
      // 정지 화면은 긴 시간이 흐른 뒤의 한 프레임 — 서버 막대는 목표 칸 그대로
      const cpuBar = (byKey(tree, 'b-cpu')!.children[1] as El).children[0] as El
      expect((cpuBar.children[0] as El).props.color).toBe(C.blue)
      expect([...textOf(cpuBar.children[0] as El)].length).toBe(6)
      // 정지 화면에도 소품(그림 문자)은 그린다
      expect(text).toContain('⌨️')
    }
  }
  // 정지 화면의 다시 확인(↻)은 paneView 가 받은 actions.post 로 간다(Client 의 post 대신) — actions 가 없어도 눌러서 깨지지 않는다
  const posted: unknown[] = []
  const withActions = paneView(table(LACKS.mobile), { ...busySession, surface: 'mobile', cols: 56 }, { post: (x: unknown) => posted.push(x) })
  const verify = nodesOf(withActions, (n) => n.type === 'Button' && n.props.key === 'verify')
  expect(verify).toHaveLength(1)
  ;(verify[0]!.props.onPress as () => void)()
  expect(posted).toEqual([{ action: 'verify' }])
  const bare = nodesOf(paneView(table(LACKS.vscode), { ...busySession, surface: 'vscode', cols: 56 }), (n) => n.type === 'Button')[0]!
  expect(() => (bare.props.onPress as () => void)()).not.toThrow()
  // 표면 이름을 모르면(순수 호출) 표에 Client 가 있는지로 본다
  expect(clientsOf(paneView(table(), { ...busySession, cols: 56 }))).toHaveLength(3)
  expect(clientsOf(paneView(table(['Client']), { ...busySession, cols: 56 }))).toHaveLength(0)
  // 터미널 표에 Client 가 없으면(옛 빌드) 정지 화면으로 — 터미널 모양(소품 없이)은 그대로
  const oldTerm = paneView(table(['Client', 'Svg']), { ...busySession, surface: 'terminal', cols: 56 })
  expect(clientsOf(oldTerm)).toEqual([])
  expect(textOf(oldTerm)).toContain('실행 테스트 돌리기')
  expect(EMOJI.test(textOf(oldTerm))).toBe(false)
})

test('Client 셋: 모든 스냅샷 · 여러 프레임 · 여러 폭에서 계약을 지키고, 같은 프레임이면 같은 그림이다', async () => {
  const problems: string[] = []
  for (const [name, d] of Object.entries(FX)) {
    for (const surface of ['desktop', 'terminal'] as const) {
      for (const cl of clientsOf(pane(d, surface))) {
        for (const f of [0, 1, 2, 3, 4, 7, 600]) {
          for (const cols of [24, 48, 80]) {
            const a = drawClient(cl, f, cols)
            problems.push(...treeProblems(`${name}/${surface}/${modName(cl)}/f${f}/c${cols}`, a, ['Box', 'Text', 'Button', 'Link']).problems)
            if (JSON.stringify(drawClient(cl, f, cols)) !== JSON.stringify(a)) problems.push(`${name}/${surface}/${modName(cl)}/f${f}: 같은 프레임인데 그림이 달라요`)
          }
        }
      }
    }
  }
  expect(problems).toEqual([])
})

test('모든 스냅샷: 네 표면의 트리가 계약 요소 · 정수 칸 · 색 규칙을 지키고, 결정적이며, 입력을 바꾸지 않는다', async () => {
  const problems: string[] = []
  for (const [name, d0] of Object.entries(FX)) {
    for (const surface of SURFACES) {
      for (const cols of [30, 48, 56, 70]) {
        for (const rows of [0, 30, 60]) {
          const d = { ...d0, surface, cols, rows }
          const before = JSON.stringify(d)
          const tree = paneView(table(LACKS[surface]), d)
          // 창 트리: 데스크톱 · 터미널은 상자 · 글자 · Client, 휴대폰 · VS Code 의 정지 화면은 상자 · 글자 · 단추 · 링크
          const allowed = surface === 'desktop' || surface === 'terminal' ? ['Box', 'Text', 'Client'] : ['Box', 'Text', 'Button', 'Link']
          problems.push(...treeProblems(`${name}/${surface}/${cols}x${rows}`, tree, allowed).problems)
          if (JSON.stringify(paneView(table(LACKS[surface]), d)) !== JSON.stringify(tree)) problems.push(`${name}/${surface}: 결정적이지 않아요`)
          if (JSON.stringify(d) !== before) problems.push(`${name}/${surface}: 스냅샷을 바꿨어요`)
        }
      }
    }
    const st = statusText(d0)
    if (typeof st !== 'string' || !st.trim()) problems.push(`${name}/status: 글자가 비었어요`)
    if (statusText(d0) !== st) problems.push(`${name}/status: 결정적이지 않아요`)
  }
  expect(problems).toEqual([])
})

test('터미널: 그림 문자 소품 · 반투명 색 · 색칠한 상자 없이 ━ 글자 막대와 ▱ 빈 칸으로, 데스크톱은 색칠한 상자 막대와 소품으로', async () => {
  for (const [name, d] of Object.entries(FX)) {
    for (const f of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const term = clientsOf(pane(d, 'terminal')).map((c) => drawClient(c, f))
      for (const t of term) {
        expect(EMOJI.test(textOf(t)), `${name}/f${f}: 터미널에 그림 문자`).toBe(false)
        expect(nodesOf(t, (n) => n.type === 'Box' && n.props.backgroundColor != null), `${name}/f${f}: 터미널에 색칠한 상자`).toEqual([])
        expect(nodesOf(t, (n) => ALPHA.test(String(n.props.color ?? ''))).map((n) => n.props.color), `${name}/f${f}: 터미널에 반투명 색`).toEqual([])
      }
      // 에이전트 갈래의 막대는 모두 ━ 와 끝 기호 하나
      for (const tr of nodesOf(term[0]!, (n) => n.props.key === 'track')) expect(textOf(tr)).toMatch(/^━*[●✓✕○]?━*$/)
    }
  }
  // 데스크톱: 일한 동안의 막대는 상자(바탕색), 글자 막대(━)는 없다 — 소품은 일하는 갈래에
  const desk = drawn(busySession, 'live-crew')
  expect(nodesOf(desk, (n) => n.type === 'Box' && typeof n.props.backgroundColor === 'string').length).toBeGreaterThan(0)
  for (const tr of nodesOf(desk, (n) => n.props.key === 'track')) expect(textOf(tr)).toMatch(/^[✓✕○]?$/)
  expect(textOf(desk)).toContain('⌨️')
  expect(textOf(desk)).toContain('🔍')
  expect(textOf(drawn(busySession, 'live-crew', 'desktop', 3))).toContain('💧')
  // 서버 막대의 빈 칸: 데스크톱은 옅은 바탕색의 ▰, 터미널은 회색 dim 의 ▱
  expect(textOf(drawn(busySession, 'live-server'))).not.toContain('▱')
  expect(textOf(drawn(busySession, 'live-server', 'terminal'))).toContain('▱')
})

// ---- 간격 · 높이 ------------------------------------------------------------------------------------------------------

test('간격(spacing): 창 높이를 알면 남는 줄을 두 간격에 고르게(2–5줄), 모르면 2줄 — 갈래 사이 한 줄은 넷 이하이거나 자리가 남을 때만', async () => {
  const cp = (n: number) => ({ lanes: Array.from({ length: n }, (_, i) => ({ key: `k${i}` })) })
  const wp = { stages: [1, 2, 3, 4, 5], pr: null, repos: [], loading: true } // 6줄
  const sp = { rows: [] } // 3줄
  expect([workHeight(wp), serverHeight(sp)]).toEqual([6, 3])
  // 창 높이를 모르면(0 · 음수) 간격 2줄, 갈래 사이는 넷 이하일 때만
  for (const rows of [0, -3, NaN]) {
    expect(spacing(rows, cp(1), wp, sp)).toEqual({ laneGap: 1, gap: 2 })
    expect(spacing(rows, cp(4), wp, sp)).toEqual({ laneGap: 1, gap: 2 })
    expect(spacing(rows, cp(5), wp, sp)).toEqual({ laneGap: 0, gap: 2 })
  }
  // 남는 줄(창 높이 − 위 여백 − 안전 한 줄 − 내용)을 둘로 나눈다: 2 → 3 → 5 에서 멈춘다
  expect([16, 20, 22, 24, 26, 40, 90].map((r) => spacing(r, cp(1), wp, sp).gap)).toEqual([2, 2, 3, 4, 5, 5, 5])
  // 갈래가 다섯 이상이면 갈래 사이 줄은 그 줄들과 간격 2줄씩이 들어갈 때만(6갈래: 내용 24줄 + 사이 5줄 + 4)
  expect([33, 34, 35, 36, 37, 40, 60].map((r) => spacing(r, cp(6), wp, sp))).toEqual([
    { laneGap: 0, gap: 3 },
    { laneGap: 0, gap: 4 },
    { laneGap: 1, gap: 2 },
    { laneGap: 1, gap: 2 },
    { laneGap: 1, gap: 3 },
    { laneGap: 1, gap: 4 },
    { laneGap: 1, gap: 5 },
  ])
  // 늘 2–5줄, 넷 이하는 늘 갈래 사이 한 줄
  for (let n = 1; n <= 8; n++)
    for (let r = 0; r <= 90; r += 3) {
      const s = spacing(r, cp(n), wp, sp)
      expect(s.gap >= 2 && s.gap <= 5 && Number.isInteger(s.gap)).toBe(true)
      if (n <= 4) expect(s.laneGap).toBe(1)
    }
})

test('창 높이에 맞추면 전체가 창 안에 든다(넘칠 만큼 많을 때만 간격 2줄로 붙인다), 갈래 사이 줄은 Client 에 넘긴다', async () => {
  for (const [name, d] of Object.entries(FX)) {
    for (const rows of [20, 30, 40, 50, 60, 90]) {
      const tree = pane(d, 'desktop', { rows })
      const clients = clientsOf(tree)
      const gap = Number(byKey(tree, 'gap-a')!.props.height)
      expect(byKey(tree, 'gap-b')!.props.height).toBe(gap)
      const content = clients.reduce((a, c) => a + HEIGHT[modName(c)]!(c.props.props), 0)
      const total = 1 + content + 2 * gap
      const s = spacing(rows, crewProps(d, 54, false), workProps(d, 54, false), serverProps(d, 54, false))
      expect([gap, (clients[0]!.props.props as Any).gap]).toEqual([s.gap, s.laneGap])
      if (gap > 2) expect(total <= rows - 1, `${name}@${rows}: ${total}줄`).toBe(true)
    }
  }
  // 갈래 여섯(busySession)은 창이 낮으면 붙이고, 높으면 갈래 사이에 한 줄씩
  expect((clientsOf(pane(busySession, 'desktop', { rows: 40 }))[0]!.props.props as Any).gap).toBe(0)
  expect((clientsOf(pane(busySession, 'desktop', { rows: 60 }))[0]!.props.props as Any).gap).toBe(1)
  expect(byKey(drawn(busySession, 'live-crew', 'desktop', 0, { rows: 60 }), 'lanes')!.props.rowGap).toBe(1)
})

test('세 구역의 줄 수 셈(crewHeight · workHeight · serverHeight)이 실제로 그린 줄 수와 같다 — 모든 견본 · 네 표면 · 여러 폭 · 창 높이 · 프레임', async () => {
  const problems: string[] = []
  for (const [name, d] of Object.entries(FX)) {
    for (const surface of SURFACES) {
      for (const cols of [30, 48, 56, 80]) {
        for (const rows of [0, 20, 40, 60, 90]) {
          const tree = pane(d, surface, { cols, rows })
          const parts = tree.children as El[]
          if (surface === 'desktop' || surface === 'terminal') {
            for (const c of clientsOf(tree))
              for (const f of [0, 1, 5, 600]) {
                const got = rowsOf(drawClient(c, f, cols))
                const want = HEIGHT[modName(c)]!(c.props.props)
                if (got !== want) problems.push(`${name}/${surface}/${cols}x${rows}/${modName(c)}/f${f}: 그린 줄 ${got} ≠ 셈 ${want}`)
              }
          } else {
            // 정지 화면: 구역마다 그린 줄 = 같은 값으로 센 줄
            const props = [crewProps({ ...d, cols }, Math.max(24, cols - 2), false), workProps(d, Math.max(24, cols - 2), false), serverProps(d, Math.max(24, cols - 2), false)]
            const s = spacing(rows, props[0], props[1], props[2])
            const want = [crewHeight({ ...props[0], gap: s.laneGap }), workHeight(props[1]), serverHeight(props[2])]
            const got = [parts[0]!, parts[2]!, parts[4]!].map(rowsOf)
            if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}/${surface}/${cols}x${rows}: 그린 줄 ${got} ≠ 셈 ${want}`)
            if (rowsOf(tree) !== 1 + want.reduce((a, b) => a + b, 0) + 2 * s.gap) problems.push(`${name}/${surface}/${cols}x${rows}: 창 전체 줄 수`)
          }
        }
      }
    }
  }
  expect(problems).toEqual([])
  // 견본 하나는 숫자로: 에이전트 6갈래 15줄(1 + 1 + 12 + 1) · 작업 12줄(1 + 3 + 2 + 1 + 저장소 5) · 서버 6줄(1 + 1 + 막대 4)
  const busy = clientsOf(pane(busySession, 'desktop')).map((c) => HEIGHT[modName(c)]!(c.props.props))
  expect(busy).toEqual([15, 12, 6])
  expect(clientsOf(pane(freshSession, 'desktop')).map((c) => HEIGHT[modName(c)]!(c.props.props))).toEqual([5, 6, 3])
})

// ---- 글자 · 제어 문자 ------------------------------------------------------------------------------------------------

test('제어 문자(ESC · NUL · BEL)는 Client 에 넘기는 값 · 정지 화면 · 글자 요약에서 빠진다', async () => {
  const d = {
    ...busySession,
    agents: {
      ...busySession.agents,
      main: { state: 'working', tool: { name: 'Bash', verb: '명령 실행', target: 'a\u001b[31mb\u0000c', prop: 'terminal' }, error: false },
      crew: [{ ...busySession.agents.crew[0], name: 'x\u0007y', desc: 'd\u001be' }],
    },
    session: { ...busySession.session, short: '커밋\u0000 전 3', headline: 'a\u001b[31mb' },
    git: { ...busySession.git, repos: [{ ...busySession.git.repos[0], name: 'r\u0007epo', branch: 'b\u001b[0m' }] },
    where: { ...busySession.where, short: 'h\u0000ost', label: 'l\u001babel' },
    sysNote: 'n\u0000ote',
  }
  for (const surface of SURFACES) {
    const tree = paneView(table(LACKS[surface]), { ...d, surface, cols: 56 })
    for (const c of clientsOf(tree)) {
      expect(stringsOf(c.props.props).filter((x) => CTRL.test(x))).toEqual([])
      expect(treeProblems(`${surface}/${modName(c)}`, drawClient(c, 0), ['Box', 'Text', 'Button', 'Link']).problems).toEqual([])
    }
    const allowed = surface === 'desktop' || surface === 'terminal' ? ['Box', 'Text', 'Client'] : ['Box', 'Text', 'Button', 'Link']
    expect(treeProblems(surface, tree, allowed).problems).toEqual([])
  }
  expect(textOf(drawn(d, 'live-work'))).toContain('커밋 전 3')
  expect(textOf(drawn(d, 'live-work'))).toContain('repo')
  const st = statusText(d)
  expect(CTRL.test(st)).toBe(false)
  expect(st).toContain('명령 실행 a[31mbc')
  expect(st).toContain('a[31mb')
})

test('/crew status 글자: 에이전트 → 이 대화의 결과물 → Git 저장소 → 서버, 블록 사이 빈 줄 한 줄', async () => {
  for (const [name, d] of Object.entries(FX)) {
    const s = statusText(d)
    const at = ['■ 에이전트', '■ 이 대화의 결과물', '■ Git 저장소', '■ 서버'].map((h) => s.indexOf(h))
    expect(at[0], name).toBe(0)
    expect(at.every((x, i) => i === 0 || x > at[i - 1]!), name).toBe(true)
    for (const x of at.slice(1)) expect(s.slice(0, x).endsWith('\n\n') && !s.slice(0, x).endsWith('\n\n\n'), name).toBe(true)
    for (const gone of ['사용량', '토큰', '지금 요청']) expect(s).not.toContain(gone)
  }
  const busy = statusText(busySession)
  expect(busy).toContain('■ 이 대화의 결과물 — 커밋 전 3')
  expect(busy).toContain('▲ 커밋하지 않은 변경 3개가 남아 있어요')
  expect(busy).toContain('편집 ✓ → 커밋 ◐ → 푸시 ◐ → PR ✓ → 머지 ●')
  expect(busy).toContain('  푸시 — 커밋 1개가 이 컴퓨터에만 있어요') // 남은 단계의 설명
  expect(busy).not.toContain('커밋 — 3개 파일이 아직 커밋 전이에요') // 첫 단계는 머리말이 말한다
  expect(busy).toContain('PR #128 열림 · 검사 통과 https://github.com/acme/auth-service/pull/128')
  expect(busy).toContain('■ Git 저장소 — 누가 바꿨든 저장소의 지금 상태 · 워크트리는 └')
  expect(busy).toContain('auth-service (⎇ fix/session-expiry) · 이 대화가 만짐\n  작업 폴더 ● 변경 4개 → 커밋 ● 푸시 전 1개 → 원격 ● 푸시를 기다려요')
  expect(busy).toContain('  └ ✻ fix-login-a1b2 (⎇ claude/fix-login-a1b2)\n      작업 폴더 ✓ 깨끗해요 → 커밋 ● 푸시 전 2개 → 원격 ● 푸시를 기다려요')
  expect(busy).toContain('  └ auth-service-hotfix (⎇ hotfix/token-ttl)')
  expect(busy.indexOf('└ auth-service-hotfix')).toBeLessThan(busy.indexOf('landing (⎇ main)')) // 워크트리는 본 저장소 바로 아래
  expect(busy).toContain('■ 서버 — 빠듯해요 · dev-mac 에서 돌고 있어요 · 원격 제어로 접속 중 (데스크톱 앱)')
  expect(busy).toContain('CPU 39% · 메모리 7.1 / 8 GB · 스왑 5.2 / 7 GB · 디스크 131 / 228 GB')
  expect(busy).toContain('이 세션 958 MB')
  const nested = statusText(nestedAgents)
  expect(nested).toContain('원격 ○ 확인 못 함')
  expect(nested).toContain('컨테이너 한도: 메모리 3.1 / 4 GB · CPU 2코어')
  const fresh = statusText(freshSession)
  for (const w of ['살펴보는 중이에요…', 'git 상태를 읽는 중이에요…', '서버 상태를 읽는 중…']) expect(fresh).toContain(w)
  const s = statusText(stress)
  expect(s).toContain('repository-number-5-with-a-long-name\n  ✖ git 상태를 읽지 못했어요')
  expect(s).toContain('■ 서버 — 모자라요')
  expect(statusText(restingSession)).toContain('■ 이 대화의 결과물 — 변경 없음\n· 이 세션에서 바뀐 코드는 아직 없어요')
})

// ---- 화면 · 이벤트 (엔진을 통해): 창 ---------------------------------------------------------------------------------

test('아무 일도 없을 때: 네 표면 모두 유효한 트리 — 데스크톱 · 터미널은 Client 셋, 휴대폰 · VS Code 는 정지 화면', async ($) => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    const clients = ((await ui.findAll({ type: 'Client' })) as Any[])
    if (surface === 'desktop' || surface === 'terminal') {
      expect(clients.map((c) => c.key)).toEqual(KEYS)
      expect(clients.map((c) => String(c.props.module).split('/').pop())).toEqual(KEYS.map((k) => `${k}.js`))
    } else expect(clients).toEqual([])
    const text = await drawnText(ui)
    for (const w of ['에이전트', 'Claude', '방금 전', '작업', 'git 상태를 읽는 중…', '서버', '서버 상태를 읽는 중…']) expect(text).toContain(w)
    await ui.unmount()
  }
})

test('/crew 가 창을 열고(탭 이름 "세션" · 56칸), 열려 있으면 닫고, 닫은 선택을 기억한다', async ($, on) => {
  const w = world(on, { open: false })
  await $.session.start(START)
  await $.command.run({ command: 'crew', args: '' } as Any)
  expect(w.opened).toEqual(['crew'])
  expect(w.openArgs[0]).toEqual({ id: 'crew', title: '세션', closeOnEscape: true, columns: 56 })
  expect(w.storeSets.at(-1)).toEqual({ key: 'pref:autoOpen', value: true })
  await $.command.run({ command: 'crew', args: '' } as Any)
  expect(w.closed).toEqual(['crew'])
  expect(w.storeSets.at(-1)).toEqual({ key: 'pref:autoOpen', value: false })
})

test('첫 턴에 데스크톱이 붙어 있으면 기다리지 않고 바로 한 번 연다(다음 턴에는 또 열지 않고, 열었다는 것을 사실에 남긴다)', async ($, on) => {
  const w = world(on, { open: false })
  await $.session.start(START)
  await $.turn.start({ text: '안녕', turnId: 't1' } as Any)
  expect(w.opened).toEqual(['crew']) // 시계를 움직이지 않아도
  expect(w.openArgs[0]).toMatchObject({ title: '세션', columns: 56 })
  w.isOpen = false // 사람이 Esc 로 닫았다 — 저절로 열기는 한 번뿐
  await $.turn.start({ text: '또', turnId: 't2' } as Any)
  await w.clock.advance(2000)
  expect(w.opened).toEqual(['crew'])
  expect(lastFacts(w).autoOpened).toBe(true)
  expect(w.storeSets.some((s) => s.key === 'pref:autoOpen')).toBe(false) // 저절로 연 것은 선택으로 기억하지 않는다
})

test('첫 턴: 사람이 /crew 로 닫아 둔 적이 있으면(pref:autoOpen=false) 열지 않는다', async ($, on) => {
  const w = world(on, { open: false, store: { 'pref:autoOpen': false } })
  await $.session.start(START)
  await $.turn.start({ text: '안녕', turnId: 't1' } as Any)
  await w.clock.advance(2000)
  expect(w.opened).toEqual([])
})

test('첫 턴: 터미널만 붙어 있으면 열지 않고, 데스크톱이 붙은 뒤의 턴에 연다', async ($, on) => {
  const surfaces = ['terminal']
  const w = world(on, { open: false, surfaces })
  await $.session.start(START)
  await $.turn.start({ text: '안녕', turnId: 't1' } as Any)
  await w.clock.advance(2000)
  expect(w.opened).toEqual([])
  surfaces.push('desktop')
  await $.turn.start({ text: '이제 데스크톱', turnId: 't2' } as Any)
  expect(w.opened).toEqual(['crew'])
})

test('/crew status · 상태 · text 는 창을 건드리지 않고 에이전트 → 결과물 → Git → 서버 글자 요약을 돌려준다', async ($, on) => {
  const w = world(on, { agents: () => [{ id: 'a1', description: '로그인 코드 지도', type: 'Explore', status: 'running' }] })
  await $.session.start(START)
  await $.tool.call({ tool: 'Grep', pattern: 'refreshToken', agentId: 'a1' } as Any)
  await $.classic.PostToolUse({ tool_name: 'Write', tool_input: { file_path: '/work/work-notes.txt' }, tool_response: 'ok', tool_use_id: 't1' } as Any)
  for (const args of ['status', '상태', 'text', '  status  더']) {
    const text = textAt(await $.command.run({ command: 'crew', args } as Any))
    expect(text.startsWith('■ 에이전트 — 1명 일하는 중')).toBe(true)
    expect(text).toContain('Explore: 내용 검색 refreshToken · 로그인 코드 지도')
    const a = text.indexOf('■ 이 대화의 결과물')
    const b = text.indexOf('■ Git 저장소')
    const c = text.indexOf('■ 서버')
    expect(a > 0 && b > a && c > b).toBe(true)
    expect(text.slice(a, b)).toContain('커밋하지 않은 변경 1개가 남아 있어요')
    expect(text.slice(b, c)).toContain('work (⎇ main) · 이 대화가 만짐')
    expect(text.slice(c)).toContain('빠듯해요') // 압력 2 = 빠듯
    expect(text.slice(c)).toContain('CPU 23%')
    expect(text.slice(c)).toContain('이 세션 195 MB')
  }
  expect(w.opened).toEqual([])
  expect(w.closed).toEqual([])
})

test('/crew debug 는 붙은 화면 · 창 열기 시도를 글자로 돌려주고 창은 건드리지 않는다', async ($, on) => {
  const w = world(on, { open: false, surfaces: ['terminal'], env: { CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge' } })
  await $.session.start(START)
  await $.session.attach({ surface: 'terminal', clientId: 'term-1', viewport: { columns: 120, rows: 40, isFullscreen: true } } as Any)
  await $.turn.start({ text: '안녕', turnId: 't1' } as Any)
  for (const args of ['debug', '진단']) {
    const text = textAt(await $.command.run({ command: 'crew', args } as Any))
    expect(text).toContain('crew-mode 0.5.0 진단 — 세션 sess-1 · Claude Code 2.1.292')
    expect(text).toContain('환경: bridge')
    expect(text).toContain('붙은 화면($.session.surfaces): terminal')
    expect(text).toContain('terminal/term-1 옆창=true')
    expect(text).toContain('저절로 열지 않았어요')
    expect(text).toContain('창 열기: 시도 안 함')
  }
  expect(w.opened).toEqual([])
  expect(w.closed).toEqual([])
})

test('그릴 화면이 하나도 없으면(원격 제어) /crew 는 창을 열되 안내와 글자 요약(네 블록)을 돌려준다', async ($, on) => {
  const w = world(on, { open: false, surfaces: [] })
  await $.session.start(START)
  const text = textAt(await $.command.run({ command: 'crew', args: '' } as Any))
  expect(text).toContain('창을 그릴 화면이 붙어 있지 않아요')
  const at = ['■ 에이전트', '■ 이 대화의 결과물', '■ Git 저장소', '■ 서버'].map((h) => text.indexOf(h))
  expect(at[0]! > 0 && at.every((x, i) => i === 0 || x > at[i - 1]!)).toBe(true)
  expect(w.opened).toEqual(['crew'])
  // 열기 시도는 진단에 남는다
  expect(textAt(await $.command.run({ command: 'crew', args: 'debug' } as Any))).toContain('창 열기: /crew→놓임')
})

test('창이 보일 때만 다시 그리기를 청한다(닫힌 창 · 그릴 화면이 없으면 쉰다)', async ($, on) => {
  const w = world(on, { open: false })
  await $.session.start(START)
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as Any)
  await w.clock.advance(5000)
  expect(w.invalidations).toBe(0)
  await $.command.run({ command: 'crew', args: '' } as Any)
  await w.clock.advance(1000)
  expect(w.invalidations).toBeGreaterThan(0)
  // 창을 닫으면 다시 쉰다
  await $.command.run({ command: 'crew', args: '' } as Any)
  await w.clock.settle()
  const n = w.invalidations
  await w.clock.advance(15000)
  expect(w.invalidations).toBe(n)
})

test('창 폭 · 높이(bodyColumns · bodyRows)를 받아 구역 폭과 구역 사이 간격을 정한다', async ($) => {
  const tall = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 70, scroll: { offset: 0, bodyRows: 60 } } })
  expect((await tall.findAll({ type: 'Client' })).map((c: Any) => c.props.props.cols)).toEqual([68, 68, 68])
  expect((await tall.find({ key: 'gap-a' }))?.props.height).toBe(5)
  expect((await tall.find({ key: 'gap-b' }))?.props.height).toBe(5)
  await tall.unmount()
  const short = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 12 } } })
  expect((await short.find({ key: 'gap-a' }))?.props.height).toBe(2)
  expect((await short.findAll({ type: 'Client' })).map((c: Any) => c.props.props.cols)).toEqual([54, 54, 54])
  await short.unmount()
})

test('마운트한 세 구역은 자기 타이머로 다음 프레임을 그린다(플러그인이 다시 그리지 않아도)', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.classic.PostToolUse({ tool_name: 'Write', tool_input: { file_path: '/work/work-notes.txt' }, tool_response: 'ok', tool_use_id: 'x1' } as Any)
  await $.command.run({ command: 'crew', args: 'status' } as Any) // git · 서버를 먼저 채운다(커밋 전 1 — 다음 단계가 숨 쉰다)
  await $.turn.start({ text: '일해 줘', turnId: 't1' } as Any)
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as Any)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const snap = async (key: string) => JSON.stringify(await ui.drawn({ in: key }))
    const crew0 = await snap('live-crew')
    const work0 = await snap('live-work')
    const inv = w.invalidations
    await ui.advance(surface === 'desktop' ? 150 : 200) // 한 프레임: 작업 구역의 빛이 다음 단계 쪽으로 한 칸
    expect(await snap('live-work')).not.toBe(work0)
    await ui.advance(surface === 'desktop' ? 450 : 400) // 세 프레임마다: 일하는 Claude 의 몸짓이 바뀐다
    expect(await snap('live-crew')).not.toBe(crew0)
    expect(w.invalidations).toBe(inv) // 플러그인은 다시 그리지 않았다
    await ui.unmount()
  }
})

test('서버 막대는 처음 열 때 빈 막대에서 몇 칸씩 차올라 목표에서 멈춘다(휴대폰 정지 화면과 같은 칸)', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.command.run({ command: 'crew', args: 'status' } as Any) // 서버 표본을 먼저 채운다
  /** 줄마다 찬 칸 수(옅은 바탕색 · 회색이 아닌 ▰ 조각) */
  const filled = async (ui: Any, scope: Record<string, string>) => {
    const out: Record<string, number> = {}
    for (const k of ['cpu', 'mem', 'swap', 'disk']) {
      const row = await ui.find({ key: `b-${k}`, ...scope })
      const leaves: Any[] = []
      const walk = (n: Any) => {
        if (!n || typeof n !== 'object') return
        const kids = n.children ?? []
        if (n.type === 'Text' && kids.every((c: unknown) => typeof c === 'string')) leaves.push(n)
        kids.forEach(walk)
      }
      walk(row)
      out[k] = leaves.filter((l) => /^▰+$/.test(l.children.join('')) && l.props?.color !== C.track && l.props?.color !== C.gray).reduce((a, l) => a + [...l.children.join('')].length, 0)
    }
    return out
  }
  const still = await $.ui.mount({ ...PANE, surface: 'mobile' })
  const target = await filled(still, {})
  await still.unmount()
  expect(Object.values(target).every((n) => n > 0 && n <= 16)).toBe(true)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const scope = { in: 'live-server' }
    expect(await filled(ui, scope)).toEqual({ cpu: 0, mem: 0, swap: 0, disk: 0 }) // 처음엔 빈 막대
    await ui.advance(90)
    const one = await filled(ui, scope)
    for (const k of Object.keys(target)) expect(one[k]! > 0 && one[k]! < target[k]!, `${surface}/${k}: ${one[k]} / ${target[k]}`).toBe(true)
    await ui.advance(90)
    const two = await filled(ui, scope)
    for (const k of Object.keys(target)) expect(two[k]! >= one[k]!).toBe(true)
    await ui.advance(2000)
    expect(await filled(ui, scope)).toEqual(target)
    const settled = JSON.stringify(await ui.drawn({ in: 'live-server' }))
    await ui.advance(900)
    expect(JSON.stringify(await ui.drawn({ in: 'live-server' }))).toBe(settled) // 목표에 닿으면 멈춘다
    await ui.unmount()
  }
})
