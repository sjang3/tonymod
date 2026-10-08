// 시험끼리 같이 쓰는 도구 — 가짜 요소 표 · 트리 검사 · 줄 세기 · 엔진 흉내(world) · 마운트한 창 읽기.
// (*.test.ts 가 아니라서 `claude plugin test` 가 따로 돌리지 않는다. 시험 파일이 가져다 쓴다.)
import { mock } from 'claude-code/testing'
import LiveCrew from '../hooks/lib/live-crew.js'
import LiveWork from '../hooks/lib/live-work.js'
import LiveServer from '../hooks/lib/live-server.js'
import { stillSurface } from '../hooks/lib/live-kit.js'
import { paneView } from '../hooks/lib/views.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any
export type El = { type: string; props: Record<string, unknown>; children: Node[] }
export type Node = El | string

export const SURFACES = ['desktop', 'terminal', 'mobile', 'vscode'] as const
export type Surface = (typeof SURFACES)[number]

// ---- 가짜 요소 표 ---------------------------------------------------------------------------------------------
const ELEMENTS = ['Box', 'Text', 'Button', 'Input', 'Select', 'Svg', 'Link', 'Code', 'Markdown', 'Client', 'Raster', 'Image']
/** 표면마다 없는 요소(Elements 표) — 휴대폰은 Input · Select · Client, VS Code 는 Client, 터미널은 Svg 가 없다 */
export const LACKS: Record<Surface, string[]> = { desktop: ['Raster', 'Image'], terminal: ['Svg'], mobile: ['Input', 'Select', 'Client', 'Raster', 'Image'], vscode: ['Client', 'Raster', 'Image'] }
/** Client 모듈이 받는 표(ClientElements) — 터미널 표에서 Client · Raster · Image 를 뺀 것 */
export const CLIENT_LACKS = ['Client', 'Svg', 'Raster', 'Image']

/** $.ui.resolve(e) 흉내 — 요소를 평범한 데이터로 만든다 */
export function table(without: string[] = []): Any {
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
  for (const name of ELEMENTS.filter((n) => !without.includes(n)))
    t[name] = (props = {}) => {
      const { children, ...rest } = props
      return { type: name, props: rest, children: flat(children) }
    }
  return t
}

// ---- 트리 읽기 ------------------------------------------------------------------------------------------------
/** 보이는 글자(Button · Link 는 label) */
export const textOf = (n: Node): string => (typeof n === 'string' ? n : n.type === 'Button' || n.type === 'Link' ? String(n.props.label ?? '') : n.children.map(textOf).join(''))
/** 조건에 맞는 노드를 모두(문서 순서) */
export function nodesOf(tree: Node, pick: (n: El) => boolean = () => true): El[] {
  const out: El[] = []
  const visit = (n: Node) => {
    if (typeof n === 'string') return
    if (pick(n)) out.push(n)
    n.children.forEach(visit)
  }
  visit(tree)
  return out
}
export const byKey = (tree: Node, key: string) => nodesOf(tree, (n) => n.props.key === key)[0]
export const clientsOf = (tree: Node) => nodesOf(tree, (n) => n.type === 'Client')
/** 엔진은 Client 의 module 을 플러그인 기준 경로(hooks/lib/live-crew.js)로 바꿔 넣는다 — 파일 이름으로 견준다 */
export const modName = (n: El) => String(n.props.module).split('/').pop()!
/** 값 속의 글자를 모두(키 · 배열 · 중첩 포함) */
export function stringsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k)
      stringsOf(x, out)
    }
  return out
}

// ---- 창 · Client 그리기(순수) ----------------------------------------------------------------------------------
const MODULES: Record<string, Any> = { 'live-crew.js': LiveCrew, 'live-work.js': LiveWork, 'live-server.js': LiveServer }
/** 창 트리 하나(기본 56칸 — /crew 가 여는 폭) */
export const pane = (d: Any, surface: Surface, extra: Record<string, unknown> = {}) => paneView(table(LACKS[surface]), { ...d, surface, cols: 56, ...extra }) as El
/** Client 노드를 그 모듈로 한 번 그린다(프레임 f — 정지 화면처럼) */
export function drawClient(n: El, f = 0, cols = 54): El {
  return MODULES[modName(n)](n.props.props, stillSurface(table(CLIENT_LACKS), cols, { f })) as El
}
/** 그 표면의 창에서 key 의 Client 를 꺼내 한 프레임 그린다 */
export function drawn(d: Any, key: 'live-crew' | 'live-work' | 'live-server', surface: Surface = 'desktop', f = 0, extra: Record<string, unknown> = {}): El {
  const c = clientsOf(pane(d, surface, extra)).find((n) => n.props.key === key)
  if (!c) throw new Error(`${key} Client 가 없어요`)
  return drawClient(c, f)
}
/** Client 에 넘긴 값(props) */
export function clientProps(d: Any, key: 'live-crew' | 'live-work' | 'live-server', surface: Surface = 'desktop', extra: Record<string, unknown> = {}): Any {
  return clientsOf(pane(d, surface, extra)).find((n) => n.props.key === key)!.props.props
}

// ---- 줄 세기 — 열(column) 상자는 아이 줄 + 여백 + rowGap, 행(row) 상자는 가장 큰 아이, 글자는 한 줄 -------------------------
const vMargin = (p: Record<string, unknown>) => Number(p.marginTop ?? p.marginY ?? p.margin ?? 0) + Number(p.marginBottom ?? p.marginY ?? p.margin ?? 0)
const vPad = (p: Record<string, unknown>) => Number(p.paddingTop ?? p.paddingY ?? p.padding ?? 0) + Number(p.paddingBottom ?? p.paddingY ?? p.padding ?? 0)
export function rowsOf(n: Node): number {
  if (typeof n === 'string') return 1
  if (n.props.display === 'none') return 0
  if (n.type !== 'Box') return 1
  if (typeof n.props.height === 'number') return n.props.height
  const kids = n.children.filter((c): c is El => typeof c !== 'string')
  const column = String(n.props.flexDirection ?? 'row').startsWith('column')
  const gap = Number(n.props.rowGap ?? n.props.gap ?? 0)
  const inner = column ? kids.reduce((a, c) => a + rowsOf(c) + vMargin(c.props), 0) + gap * Math.max(0, kids.length - 1) : kids.reduce((a, c) => Math.max(a, rowsOf(c) + vMargin(c.props)), 0)
  return inner + vPad(n.props)
}

// ---- 계약 검사 ------------------------------------------------------------------------------------------------
export const THEME_KEYS = new Set(['text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide'])
export const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/
export const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i
export const ALPHA = /^#[0-9a-f]{8}$/i
const ODD = /NaN|undefined|\[object Object\]|Infinity/
const PROPS: Record<string, Set<string>> = {
  Box: new Set('key hover position top left right bottom flexDirection flexGrow flexShrink flexWrap alignItems alignSelf justifyContent gap columnGap rowGap width height minWidth minHeight margin marginX marginY marginTop marginBottom marginLeft marginRight padding paddingX paddingY paddingTop paddingBottom paddingLeft paddingRight borderStyle borderColor borderDimColor backgroundColor overflow display'.split(' ')),
  Text: new Set('hover color backgroundColor dimColor bold italic underline strikethrough inverse wrap'.split(' ')),
  Button: new Set('key label hotkey action plain dimColor variant role autoFocus hover onPress'.split(' ')),
  Link: new Set('href label'.split(' ')),
  Client: new Set('key module props width height flexGrow'.split(' ')),
}
const CELL_PROPS = ['width', 'height', 'minWidth', 'minHeight', 'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'gap', 'columnGap', 'rowGap']

/**
 * 트리를 훑어 계약(쓸 수 있는 요소 · 속성 · 정수 칸 · 색 · 글자 · 한도)을 어긴 곳을 모은다.
 * 색은 테마 키나 #rrggbb · #rrggbbaa, 칸 수는 0 이상의 정수(%는 정수만), 글자에는 제어 문자 · NaN · undefined 가 없어야 한다.
 */
export function treeProblems(name: string, tree: Node, allowed: string[]): { problems: string[]; texts: string[]; nodes: El[] } {
  const problems: string[] = []
  const texts: string[] = []
  const nodes: El[] = []
  let count = 0
  let depthMax = 0
  let chars = 0
  const visit = (n: Node, depth: number) => {
    if (typeof n === 'string') {
      chars += n.length
      if (CTRL.test(n)) problems.push(`${name}: 제어 문자가 있어요 ${JSON.stringify(n)}`)
      if (ODD.test(n)) problems.push(`${name}: 이상한 글자 "${n}"`)
      return
    }
    count += 1
    depthMax = Math.max(depthMax, depth)
    nodes.push(n)
    if (!allowed.includes(n.type)) problems.push(`${name}: ${n.type} 는 계약 밖의 요소예요`)
    const ok = PROPS[n.type]
    if (ok) for (const k of Object.keys(n.props)) if (!ok.has(k)) problems.push(`${name}: ${n.type} 의 속성 ${k} 는 없어요`)
    for (const [k, v] of Object.entries(n.props)) if (v === undefined) problems.push(`${name}: ${n.type} 의 ${k} 가 undefined 예요`)
    for (const k of ['color', 'backgroundColor', 'borderColor']) {
      const c = n.props[k]
      if (c != null && !THEME_KEYS.has(String(c)) && !HEX.test(String(c))) problems.push(`${name}: ${n.type} ${k}="${String(c)}" 는 테마 키도 #rrggbb(aa) 도 아니에요`)
    }
    for (const k of CELL_PROPS) {
      const v = n.props[k]
      if (typeof v === 'string' && (!/^\d+%$/.test(v) || Number(v.slice(0, -1)) > 100)) problems.push(`${name}: ${n.type} ${k}="${v}" — % 는 100 이하의 정수만 돼요`)
      if (typeof v === 'number' && (!Number.isInteger(v) || v < 0)) problems.push(`${name}: ${n.type} ${k}=${v} — 칸 수는 0 이상의 정수`)
      if (v != null && typeof v !== 'string' && typeof v !== 'number') problems.push(`${name}: ${n.type} ${k} 는 수나 % 여야 해요`)
    }
    if (n.type === 'Text') texts.push(textOf(n))
    if (n.type === 'Button' || n.type === 'Link') {
      const label = String(n.props.label ?? '')
      texts.push(label)
      chars += label.length
      if (CTRL.test(label) || ODD.test(label)) problems.push(`${name}: ${n.type} label "${label}"`)
    }
    if (n.type === 'Button' && typeof n.props.onPress !== 'function') problems.push(`${name}: Button(${String(n.props.key)}) 에 onPress 가 없어요`)
    if (n.type === 'Link' && !/^https:\/\//.test(String(n.props.href ?? ''))) problems.push(`${name}: Link href ${String(n.props.href)}`)
    if (n.type === 'Client') {
      if (!/^live-(crew|work|server)\.js$/.test(modName(n))) problems.push(`${name}: Client module ${String(n.props.module)}`)
      if (JSON.stringify(n.props.props ?? null).length > 100000) problems.push(`${name}: Client props 가 100000자를 넘어요`)
      if (stringsOf(n.props.props).some((x) => CTRL.test(x) || ODD.test(x))) problems.push(`${name}: Client props 에 제어 문자 · 이상한 글자가 있어요`)
      if (JSON.stringify(n.props.props).includes('function')) problems.push(`${name}: Client props 에 함수가 섞였어요`)
    }
    for (const c of n.children) visit(c, depth + 1)
  }
  visit(tree, 1)
  if (count > 20000) problems.push(`${name}: 노드 ${count} > 20000`)
  if (depthMax > 32) problems.push(`${name}: 깊이 ${depthMax} > 32`)
  if (chars > 100000) problems.push(`${name}: 글자 ${chars} > 100000`)
  return { problems, texts, nodes }
}

/** 그림 문자 소품(데스크톱 · 휴대폰만) — 터미널에는 없어야 한다 */
export const EMOJI = /[📖✏⌨🔍🌐📡📋📜❓🔌💧]/u

// ---- 엔진 흉내 ---------------------------------------------------------------------------------------------------
export const STAT_A = 'cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 50 0 50 400 0 0 0 0 0 0\ncpu1 50 0 50 400 0 0 0 0 0 0\nintr 1'
export const STAT_B = 'cpu  250 0 150 1400 0 0 0 0 0 0\ncpu0 125 0 75 700 0 0 0 0 0 0\ncpu1 125 0 75 700 0 0 0 0 0 0\nintr 2'
export const MEMINFO = `MemTotal:       16384000 kB
MemFree:         6000000 kB
MemAvailable:   11000000 kB
Buffers:          200000 kB
Cached:          4000000 kB
SReclaimable:     300000 kB
SwapTotal:       2000000 kB
SwapFree:         500000 kB`
export const VM = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages wired down:                             110139.
Pages purgeable:                                   4.
File-backed pages:                             66584.
Anonymous pages:                              142201.
Pages occupied by compressor:                 167623.`
const IOSTAT = '      cpu    load average\n us sy id   1m   5m   15m\n  9 14 77  2.2 2.1 2.0\n  9 14 77  2.2 2.1 2.0\n'
const PS = ' 100 1 2.0 200000 /Users/x/.local/share/claude/versions/2.1.292\n 101 100 1.0 5000 ps\n 300 1 30.0 400000 Google Chrome'
/** git status --porcelain=v2: main · origin/main 보다 1 앞섬 · 추적 안 하는 work-notes.txt */
export const GIT_STATUS = ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +1 -0', '? work-notes.txt', ''].join('\0')
const LINUX_HEAD = [
  ['/proc/stat', STAT_B],
  ['/proc/loadavg', '1.10 0.90 0.70 2/300 4000'],
  ['/proc/meminfo', MEMINFO],
  ['/sys/fs/cgroup/memory.max', '4294967296'],
  ['/sys/fs/cgroup/memory.current', '3328599654'],
  ['/sys/fs/cgroup/cpu.max', '200000 100000'],
]
  .map(([k, v]) => `==> ${k} <==\n${v}\n`)
  .join('\n')

export type WorldOpts = {
  agents?: () => unknown[]
  env?: Record<string, string>
  open?: boolean
  shown?: boolean
  facts?: unknown
  store?: Record<string, unknown>
  surfaces?: string[]
  os?: 'Darwin' | 'Linux'
  /** 세션 폴더($.session.cwd) — 기본 /work */
  cwd?: string
  /** `.git` 이 있는 폴더(저장소 · 워크트리의 뿌리) — 기본 [/work] */
  gitDirs?: string[]
  /** $.fs.list 의 답(폴더 → 항목) */
  dirs?: Record<string, { name: string; kind: string }[]>
  git?: (argv: string[]) => string | undefined
  gh?: (argv: string[]) => string | undefined
}
export type World = {
  isOpen: boolean
  opened: string[]
  openArgs: Any[]
  closed: string[]
  storeSets: { key: string; value: unknown }[]
  stateSets: Any[]
  argv: string[][]
  invalidations: number
  clock: ReturnType<typeof mock.clock>
}

/**
 * 플러그인이 부르는 엔진의 모든 것을 메모리로 답한다. 돌려주는 값으로 열고 닫힘 · 저장 · 띄운 명령을 들여다본다.
 * (이 플러그인은 데이터 시각에 Date.now() 를 쓰고, mock.clock 은 $.clock 의 박자만 움직인다)
 */
export function world(on: Any, o: WorldOpts = {}): World {
  const w: World = { isOpen: o.open ?? true, opened: [], openArgs: [], closed: [], storeSets: [], stateSets: [], argv: [], invalidations: 0, clock: mock.clock(on) }
  mock.env(on, { HOME: '/home/x', ...(o.env ?? {}) })
  const cwd = o.cwd ?? '/work'
  const gitDirs = o.gitDirs ?? ['/work']
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}))
  on('store.get', ($: Any, e: Any) => ({ value: store.get(e.key) }))
  on('store.set', ($: Any, e: Any) => {
    store.set(e.key, e.value)
    w.storeSets.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  on('state.get', () => ({ value: { value: o.facts, version: o.facts ? 1 : 0 } }))
  on('state.set', ($: Any, e: Any) => {
    w.stateSets.push(e.value)
    return { value: { isSet: true, version: w.stateSets.length + 1 } }
  })
  on('session.start', () => ({ cwd }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.version', () => ({ value: { version: '2.1.292', base: '2.1.292', builtAt: '2026-10-01T00:00:00Z' } }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['desktop'] }))
  on('session.attach', ($: Any, e: Any) => ({ clientId: e.clientId }))
  on('session.detach', () => ({}))
  on('command.register', () => ({ value: { command: 'crew' } }))
  on('agent.list', () => ({ value: o.agents ? o.agents() : [] }))
  on('ui.panes', () => ({ value: w.isOpen ? [{ id: 'crew', title: '세션', isShown: o.shown ?? true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.open', ($: Any, e: Any) => {
    w.opened.push(e.id)
    w.openArgs.push(e)
    w.isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($: Any, e: Any) => {
    w.closed.push(e.id)
    w.isOpen = false
    return { value: undefined }
  })
  on('ui.invalidate', () => {
    w.invalidations += 1
    return { value: undefined }
  })
  on('ui.message', () => ({}))
  on('fs.exists', ($: Any, e: Any) => ({ value: gitDirs.some((d) => e.path === `${d}/.git`) }))
  on('fs.list', ($: Any, e: Any) => ({ value: o.dirs?.[e.path] ?? [] }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', ($: Any, e: Any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  for (const ev of ['classic.SubagentStart', 'classic.SubagentStop', 'classic.SessionStart', 'classic.PostToolUse', 'classic.PostToolUseFailure']) on(ev, () => ({}))
  on('process.run', ($: Any, e: Any) => {
    const a = e.argv as string[]
    w.argv.push(a)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
    const os = o.os ?? 'Darwin'
    if (a[0] === 'uname') return out(a[1] === '-n' ? 'runner-1\n' : `${os}\n`)
    if (a[0] === 'hostname') return out('mini\n')
    if (a[0] === 'ps') return out(PS)
    if (a[0] === 'df') return out(`Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/d 238000000 118000000 100000000 55% ${os === 'Linux' ? '/work' : '/System/Volumes/Data'}`)
    if (os === 'Darwin') {
      if (a[0] === 'vm_stat') return out(VM)
      if (a[0] === 'iostat') return out(IOSTAT)
      if (a[0] === 'sysctl') {
        const k = a[2]
        return out(k === 'hw.memsize' ? '8589934592' : k === 'hw.ncpu' ? '8' : k === 'vm.swapusage' ? 'total = 7168.00M  used = 5913.94M  free = 1254.06M' : k === 'kern.memorystatus_vm_pressure_level' ? '2' : '')
      }
    } else {
      if (a[0] === 'sh') return out(STAT_A.split('\n')[0] + '\n')
      if (a[0] === 'head') return out(LINUX_HEAD)
      if (a[0] === 'nproc') return out('4\n')
      if (a[0] === 'cat') return out(a[1] === '/proc/cpuinfo' ? 'processor\t: 0\nprocessor\t: 1\nprocessor\t: 2\nprocessor\t: 3\n' : '', a[1] === '/proc/cpuinfo' ? 0 : 1)
    }
    if (a[0] === 'git') {
      const own = o.git?.(a)
      if (own !== undefined) return out(own)
      if (a.includes('status')) return out(GIT_STATUS)
      if (a.includes('symbolic-ref')) return out('', 1)
      if (a.includes('remote')) return out('git@github.com:o/r.git\n')
      if (a.includes('log')) return out('')
      if (a.includes('ls-remote')) return out('abc\trefs/heads/main\n')
      if (a.includes('rev-parse')) return out('abc\n')
      return out('')
    }
    if (a[0] === 'gh') {
      const own = o.gh?.(a)
      if (own !== undefined) return out(own)
    }
    return out('', 1) // gh 등은 쓸 수 없는 것으로
  })
  return w
}

/** 무거운 일(서버 표본 · git 상태) */
export const HEAVY = (a: string[]) => ['vm_stat', 'iostat', 'df', 'ps', 'head'].includes(a[0] ?? '') || (a[0] === 'git' && a.includes('status'))
export const heavyCount = (w: World) => w.argv.filter(HEAVY).length
export const lastFacts = (w: World) => w.stateSets.at(-1) as Any
export const START = { surface: 'desktop', isInteractive: true, cwd: '/work' } as Any
export const DONE = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' }
export const textAt = (r: unknown) => String((r as Any)?.text ?? '')

/** 창 하나를 그리게 하는 마운트 값(탭 이름 "세션", 몸통 56칸 · 44줄) */
export const PANE = {
  plugin: 'crew-mode',
  component: 'Pane',
  requestId: 'crew',
  viewport: { columns: 100, rows: 50 },
  props: { title: '세션', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 44 }, view: {} },
} as const

const SHOWN = new Set(['Text', 'Button', 'Link'])
/** 그려진 글자 전부 — 창의 글자 + 각 Client(에이전트 · 작업 · 서버)가 그린 글자 */
export async function drawnText(ui: Any): Promise<string> {
  const top = (await ui.findAll({})) as Any[]
  const parts = top.filter((x) => SHOWN.has(x.type)).map((x) => x.text)
  for (const c of top.filter((x) => x.type === 'Client')) parts.push(...((await ui.findAll({ in: c.key })) as Any[]).filter((x) => SHOWN.has(x.type)).map((x) => x.text))
  return parts.join('\n')
}
/** 마운트한 Client 하나가 그린 글자 */
export async function clientText(ui: Any, key: string): Promise<string> {
  return ((await ui.findAll({ in: key })) as Any[])
    .filter((x) => SHOWN.has(x.type))
    .map((x) => x.text)
    .join('\n')
}
