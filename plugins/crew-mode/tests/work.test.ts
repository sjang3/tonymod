import { expect, test } from 'claude-code/testing'
// work.js · fmt.js 는 이름이 자주 바뀌므로 통째로 가져온다(없는 이름 하나 때문에 파일 전체가 깨지지 않게)
import * as W from '../hooks/lib/work.js'
import * as F from '../hooks/lib/fmt.js'
import { C } from '../hooks/lib/live-kit.js'
import { serverLayout } from '../hooks/lib/live-server.js'
import { NOW, busySession, freshSession, nestedAgents, restingSession, stress } from './fixtures.js'
import { emptySession, linuxContainer } from './fixtures-work.js'
import type { Any, El } from './kit.js'
import { MEMINFO, PANE, START, STAT_A, STAT_B, VM, byKey, clientProps, drawn, drawnText, heavyCount, lastFacts, nodesOf, textAt, textOf, world } from './kit.js'

const p = W as Any
const f = F as Any
const GB = 1073741824

// ---- 순수 함수: 서버(macOS) -----------------------------------------------------------------------------------

test('vm_stat · swap · 압력으로 메모리 구성을 만든다', async () => {
  const vm = p.parseVmStat(VM)
  const swap = p.parseSwap('total = 7168.00M  used = 5913.94M  free = 1254.06M  (encrypted)')
  const m = p.buildMem(vm, swap, '2\n', 8589934592)
  expect(m).toBeDefined()
  expect(m.pressure).toBe('warn')
  expect(Math.round((m.used / GB) * 10) / 10).toBe(6.4)
  expect(Math.round(m.swapUsed / 1048576)).toBe(5914)
  // 막대 조각(앱 · 시스템 · 압축 · 캐시 · 비어 있음)을 다 더하면 전체
  const sum = m.segments.reduce((n: number, s: { bytes: number }) => n + s.bytes, 0)
  expect(Math.abs(sum - m.total) < 16384).toBe(true)
})

test('읽은 메모리 값이 이상하면 null, 압력 값이 없으면 "unknown"', async () => {
  expect(p.buildMem(p.parseVmStat('nothing here'), p.parseSwap(''), '', 8589934592)).toBe(null)
  const vm = p.parseVmStat('page size of 16384 bytes\nAnonymous pages: 1000.\nPages wired down: 1000.\nPages occupied by compressor: 1000.')
  expect(p.buildMem(vm, p.parseSwap(''), '', 8589934592).pressure).toBe('unknown')
})

test('iostat 의 마지막 줄에서 CPU 사용률 · 부하를 읽는다', async () => {
  const t = p.parseIostat('      cpu    load average\n us sy id   1m   5m   15m\n  5  3 92  4.96 5.51 5.32\n 12 15 73  4.96 5.51 5.32\n')
  expect(t.cpu).toBe(27)
  expect(t.load).toEqual([4.96, 5.51, 5.32])
  expect(p.parseIostat('').cpu).toBe(null)
})

test('ps 에서 이 세션의 몫(우리가 띄운 ps 의 부모와 자손, ps 자신은 빼고)을 센다', async () => {
  const rows = p.parsePs(`  1     0  0.1  1000 /sbin/launchd
 100     1  2.0 2000 /Users/x/.local/share/claude/versions/2.1.286
 101   100  5.0 3000 /bin/zsh
 102   101  1.0 4000 node
 103   100  0.0 1000 ps
 200     1 50.0 9000 Google Chrome`)
  const g = p.sessionGroup(rows)
  expect(g.pid).toBe(100)
  expect(g.count).toBe(3)
  expect(g.rss).toBe((2000 + 3000 + 4000) * 1024)
  expect(p.sessionGroup(p.parsePs(' 1 0 0.1 1000 launchd'))).toBe(null)
})

test('df 한 줄에서 사용량과 마운트 위치를 읽는다', async () => {
  expect(p.parseDf('Filesystem 1024-blocks Used Available\n/dev/disk3s5 238000000 118000000 100000000 55% /').used).toBe(118000000 * 1024)
  expect(p.parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 238000000 118000000 100000000 55% /System/Volumes/Data').mount).toBe('/System/Volumes/Data')
  expect(p.parseDf('')).toBe(null)
})

// ---- 순수 함수: 서버(Linux) · 판정 · 어디서 --------------------------------------------------------------------

test('Linux: /proc/stat 두 번 읽은 차이로 CPU % 를 낸다', async () => {
  const a = p.parseProcStat(STAT_A)
  const b = p.parseProcStat(STAT_B)
  expect(a.total).toBe(1000)
  expect(a.cpus).toBe(2)
  expect(p.cpuPctFromStat(a, b)).toBe(25) // Δtotal 800, Δidle 600
  expect(p.cpuPctFromStat(null, b)).toBe(null) // 첫 표본은 값을 지어내지 않는다
  expect(p.cpuPctFromStat(b, a)).toBe(null) // 거꾸로 가면 버린다
  expect(p.parseProcStat('garbage')).toBe(null)
})

test('Linux: /proc/meminfo → 쓰는 중 · 캐시 · 비어 있음, 압력은 MemAvailable 과 PSI 로', async () => {
  const mi = p.parseMeminfo(MEMINFO)
  expect(mi.MemTotal).toBe(16384000 * 1024)
  const m = p.buildMemLinux(mi, null)
  expect(m.used).toBe((16384000 - 11000000) * 1024)
  expect(m.swapUsed).toBe(1500000 * 1024)
  expect(m.pressure).toBe('normal')
  expect(m.segments.map((s: { key: string }) => s.key)).toEqual(['used', 'cache', 'free'])
  expect(m.segments.reduce((n: number, s: { bytes: number }) => n + s.bytes, 0)).toBe(m.total)
  const tight = (avail: number) => p.buildMemLinux({ ...mi, MemAvailable: avail * 1024 }, null).pressure
  expect(tight(16384000 * 0.15)).toBe('warn')
  expect(tight(16384000 * 0.05)).toBe('critical')
  expect(p.buildMemLinux(mi, 6).pressure).toBe('warn')
  expect(p.buildMemLinux(mi, 25).pressure).toBe('critical')
  expect(p.parsePsi('some avg10=6.50 avg60=1.00 avg300=0.10 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0').some10).toBe(6.5)
  expect(p.buildMemLinux({}, null)).toBe(null)
})

test('Linux: cgroup 한도(v2 · v1)를 읽고, 한도가 없으면 null, 페이지 캐시는 빼고 센다', async () => {
  const host = 64 * GB
  expect(p.cgroupLimits({ '/sys/fs/cgroup/memory.max': '4294967296\n', '/sys/fs/cgroup/memory.current': '3328599654\n', '/sys/fs/cgroup/cpu.max': '200000 100000\n' }, host)).toEqual({ memLimit: 4294967296, memUsed: 3328599654, cpuCores: 2 })
  expect(p.cgroupLimits({ '/sys/fs/cgroup/memory.max': 'max\n', '/sys/fs/cgroup/cpu.max': 'max 100000\n' }, host)).toBe(null)
  expect(p.cgroupLimits({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': '2147483648', '/sys/fs/cgroup/memory/memory.usage_in_bytes': '1073741824', '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '150000', '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000' }, host)).toEqual({ memLimit: 2147483648, memUsed: 1073741824, cpuCores: 1.5 })
  expect(p.cgroupLimits({ '/sys/fs/cgroup/memory.max': String(128 * GB) }, host)).toBe(null) // 기계보다 큰 한도는 막지 않는다
  expect(p.parseCpuMax('50000 100000')).toBe(0.5)
  const c = p.cgroupLimits({ '/sys/fs/cgroup/memory.max': '4294967296', '/sys/fs/cgroup/memory.current': '4160000000', '/sys/fs/cgroup/memory.stat': 'anon 900000000\ninactive_file 3200000000\nactive_file 10' }, host)
  expect(c.memUsed).toBe(960000000)
  expect(p.verdictOf({ mem: { pressure: 'normal', swapUsed: 0, swapTotal: 0 }, cpu: 10, history: [], container: c }).level).toBe('good')
})

test('Linux: head 한 번에 읽은 파일들 → 표본 하나 (CPU 는 직전 표본과의 차이)', async () => {
  const head = (files: Record<string, string>) =>
    Object.entries(files)
      .map(([k, v]) => `==> ${k} <==\n${v}\n`)
      .join('\n')
  const out = head({ '/proc/stat': STAT_B, '/proc/loadavg': '0.52 0.48 0.40 1/234 5678', '/proc/meminfo': MEMINFO, '/sys/fs/cgroup/memory.max': '8589934592', '/sys/fs/cgroup/memory.current': '4294967296', '/sys/fs/cgroup/cpu.max': '400000 100000' })
  const parts = p.splitHeadOutput(out)
  expect(Object.keys(parts)).toContain('/proc/meminfo')
  const s = p.linuxSample(parts, p.parseProcStat(STAT_A))
  expect(s.cpu).toBe(25)
  expect(s.load).toEqual([0.52, 0.48, 0.4])
  expect(s.mem.pressure).toBe('normal')
  expect(s.container).toEqual({ memLimit: 8589934592, memUsed: 4294967296, cpuCores: 4 })
  expect(p.parseCpuinfo('processor\t: 0\nmodel name\t: Intel(R) Xeon(R)\nprocessor\t: 1\n').count).toBe(2)
})

test('서버 판정: 여유 있어요 · 빠듯해요 · 모자라요, 창 제목 줄에는 짧은 말(여유 · 빠듯 · 모자람)', async () => {
  const mem = (pressure: string, swapUsed = 0, swapTotal = 0) => ({ pressure, swapUsed, swapTotal })
  const h = (...xs: number[]) => xs.map((cpu, i) => ({ t: i, cpu }))
  expect(p.verdictOf({ mem: mem('normal'), cpu: 30, history: h(30, 30, 30) })).toEqual({ level: 'good', text: '여유 있어요' })
  expect(p.verdictOf({ mem: mem('warn'), cpu: 30, history: [] }).level).toBe('warn')
  expect(p.verdictOf({ mem: mem('normal', 6, 10), cpu: 30, history: [] }).level).toBe('warn') // 스왑 절반 넘게
  expect(p.verdictOf({ mem: mem('normal'), cpu: 80, history: [] }).text).toBe('빠듯해요')
  expect(p.verdictOf({ mem: mem('critical'), cpu: 10, history: [] })).toEqual({ level: 'bad', text: '모자라요' })
  expect(p.verdictOf({ mem: mem('normal'), cpu: 95, history: h(95, 96, 97) }).level).toBe('bad') // 90% 넘게 3번 연속
  expect(p.verdictOf({ mem: mem('normal'), cpu: 95, history: h(20, 96, 97) }).level).toBe('warn')
  const box = (used: number) => p.verdictOf({ mem: mem('normal'), cpu: 10, history: [], container: { memLimit: 100, memUsed: used, cpuCores: 2 } }).level
  expect([box(50), box(90), box(97)]).toEqual(['good', 'warn', 'bad'])
  expect(F.VERDICT_SHORT).toEqual({ good: '여유', warn: '빠듯', bad: '모자람', unknown: '' })
})

test('어디서 돌고 있는지: 긴 말(글자 요약) · 짧은 말(서버 제목 줄) — 원격 제어 · 클라우드 컨테이너 · 이 컴퓨터', async () => {
  const bridge = p.whereView({ kind: 'bridge', surfaces: ['desktop'], host: 'dev-mac', os: 'Darwin' })
  expect(bridge.label).toBe('dev-mac 에서 돌고 있어요 · 원격 제어로 접속 중 (데스크톱 앱)')
  expect(bridge.short).toBe('dev-mac · 원격 제어')
  expect(bridge.remote).toBe(true)
  expect(p.whereView({ kind: 'bridge', surfaces: [] }).short).toBe('원격 제어')
  const cloud = p.whereView({ kind: 'ccr', surfaces: ['desktop', 'mobile'], host: 'runner', os: 'Linux' })
  expect(cloud.label).toBe('클라우드 컨테이너(Linux)에서 돌고 있어요 · 보는 곳 (데스크톱 앱 · 휴대폰 앱)')
  expect(cloud.short).toBe('클라우드 컨테이너')
  expect(p.whereView({ kind: 'anthropic_cloud', os: 'Linux' }).remote).toBe(true)
  const local = p.whereView({ kind: null, surfaces: ['terminal'], host: 'mini', os: 'Darwin' })
  expect(local).toMatchObject({ label: '이 컴퓨터에서 돌고 있어요', short: 'mini · 이 컴퓨터', remote: false })
  expect(p.whereView({}).short).toBe('이 컴퓨터')
  // 화면이 붙기 전이면 진입점으로 짐작한다
  expect(p.whereView({ kind: 'bridge', entrypoint: 'claude-desktop', host: 'm' }).label).toContain('(데스크톱 앱)')
})

// ---- 순수 함수: git · 워크트리 ------------------------------------------------------------------------------------

test('git status v2(-z)를 읽는다', async () => {
  const out = ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a b src/a.ts', '2 R. N... 100644 100644 100644 a b R100 new.ts', 'old.ts', '? notes.txt', 'u UU N... 100644 100644 100644 100644 a b c conflict.ts', ''].join('\0')
  const s = p.parseGitStatus(out)
  expect(s.branch).toBe('main')
  expect(s.oid).toBe('abc')
  expect([s.ahead, s.behind]).toEqual([2, 1])
  expect([s.staged, s.unstaged, s.untracked, s.conflicts]).toEqual([1, 1, 1, 1])
  expect(s.files.map((x: { path: string }) => x.path)).toEqual(['src/a.ts', 'new.ts', 'notes.txt', 'conflict.ts'])
  expect(p.parseGitStatus(['# branch.oid (initial)', '# branch.head (detached)', ''].join('\0'))).toMatchObject({ oid: '(initial)', detached: true })
})

test('원격 주소: 비밀은 지우고 GitHub slug 를 읽는다, gh pr 목록은 열린 것 먼저', async () => {
  expect(p.cleanRemoteUrl('https://user:tok@github.com/o/r.git')).toBe('https://github.com/o/r.git')
  expect(p.slugOf('git@github.com:o/r.git')).toBe('o/r')
  expect(p.slugOf('https://github.com/o/r')).toBe('o/r')
  expect(p.slugOf('https://gitlab.com/o/r')).toBe(null)
  const pr = p.parsePrList(JSON.stringify([{ number: 1, state: 'CLOSED', updatedAt: '2026-10-07' }, { number: 2, title: 't', state: 'OPEN', url: 'u', updatedAt: '2026-10-01', statusCheckRollup: [{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }] }]))
  expect(pr).toMatchObject({ number: 2, state: 'OPEN', checks: { pass: 1, fail: 0, pending: 1 } })
  expect(p.parsePrList('[{"number":3,"state":"CLOSED","mergedAt":"2026-10-07T00:00:00Z"}]').state).toBe('MERGED')
  expect(p.parsePrList('[]')).toEqual({ none: true })
  expect(p.parsePrList('not json')).toEqual({ unavailable: true })
})

test('git worktree list --porcelain: 본 작업 트리 · 연결된 워크트리 · detached · bare · prunable · locked 줄을 읽는다', async () => {
  const out = [
    'worktree /Users/x/proj',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /Users/x/proj/.claude/worktrees/fix-a1b2',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/claude/fix-a1b2',
    'locked',
    '',
    'worktree /Users/x/proj-hotfix',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    'locked 다른 디스크에 있어요',
    '',
    'worktree /tmp/gone',
    'HEAD 4444444444444444444444444444444444444444',
    'branch refs/heads/feature/gone',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\r\n')
  const list = p.parseWorktreeList(out)
  expect(list.map((x: Any) => x.path)).toEqual(['/Users/x/proj', '/Users/x/proj/.claude/worktrees/fix-a1b2', '/Users/x/proj-hotfix', '/tmp/gone'])
  expect(list[0]).toEqual({ path: '/Users/x/proj', head: '1111111111111111111111111111111111111111', branch: 'main', detached: false, bare: false, locked: false, prunable: false })
  expect(list[1]).toMatchObject({ branch: 'claude/fix-a1b2', locked: true, detached: false, prunable: false })
  expect(list[2]).toMatchObject({ branch: null, detached: true, locked: true }) // 이유가 붙은 locked 도
  expect(list[3]).toMatchObject({ branch: 'feature/gone', prunable: true, locked: false })
  // bare 본 저장소: HEAD · 브랜치 없이 bare 한 줄
  const bare = p.parseWorktreeList('worktree /srv/proj.git\nbare\n\nworktree /srv/proj-a\nHEAD 5555\nbranch refs/heads/a\n')
  expect(bare.map((x: Any) => [x.path, x.bare, x.branch])).toEqual([
    ['/srv/proj.git', true, null],
    ['/srv/proj-a', false, 'a'],
  ])
  // 빈 글 · 머리(worktree) 없는 줄 · 경로 없는 머리는 버린다
  expect(p.parseWorktreeList('')).toEqual([])
  expect(p.parseWorktreeList(undefined)).toEqual([])
  expect(p.parseWorktreeList('HEAD 1\nbranch refs/heads/x\n')).toEqual([])
  expect(p.parseWorktreeList('worktree \nHEAD 1\n')).toEqual([])
})

test('Claude 워크트리(<프로젝트>/.claude/worktrees/<이름>)를 알아보고, 경로 견주기는 /private · 끝의 / 를 맞춘다', async () => {
  expect(p.isClaudeWorktree('/Users/x/proj/.claude/worktrees/fix-a1b2')).toBe(true)
  expect(p.isClaudeWorktree('/Users/x/proj/.claude/worktrees/fix-a1b2/src')).toBe(true)
  expect(p.isClaudeWorktree('/Users/x/proj/.claude/worktrees/')).toBe(false) // 이름이 없다
  expect(p.isClaudeWorktree('/Users/x/proj/claude/worktrees/x')).toBe(false)
  expect(p.isClaudeWorktree('/Users/x/proj-hotfix')).toBe(false)
  expect(p.isClaudeWorktree(null)).toBe(false)
  expect(p.samePathKey('/private/tmp/proj')).toBe('/tmp/proj')
  expect(p.samePathKey('/private/var/folders/x/')).toBe('/var/folders/x')
  expect(p.samePathKey('/Users/x/proj/')).toBe('/Users/x/proj')
  expect(p.samePathKey('/private/etc/hosts')).toBe('/private/etc/hosts') // /tmp · /var 만
  expect(p.samePathKey('/privatefoo/tmp/x')).toBe('/privatefoo/tmp/x')
  expect(p.samePathKey(undefined)).toBe('')
  expect(p.samePathKey('/private/tmp/a')).toBe(p.samePathKey('/tmp/a/'))
})

// ---- 순수 함수: 배송(편집 · 커밋 · 푸시 · PR) 기록 --------------------------------------------------------------------

test('한 명령의 git commit && git push 를 둘 다 기록한다', async () => {
  const cmd = 'git add -A && git commit -m "fix: rejected promise" && git push origin main'
  expect(p.shipKinds(cmd)).toEqual(['commit', 'push'])
  const r = p.parseShipResult(cmd, '[main abc1234] fix: rejected promise\n 1 file changed\n   111..222  main -> main', '/w')
  expect(r.commits.length).toBe(1)
  expect(r.commits[0]).toMatchObject({ hash: 'abc1234', branch: 'main', subject: 'fix: rejected promise', dir: '/w' }) // 제목에 "rejected" 가 있어도 성공
  expect(r.pushes[0]).toMatchObject({ ok: true, ref: 'main' })
  expect(p.parseShipResult('git commit -m init', '[main (root-commit) 0a1b2c3] init', '/w').commits[0].branch).toBe('main')
})

test('올라간 ref 줄이 있어야 푸시로 센다: 조용한 푸시 · 이미 최신은 기록 없음, 거절은 실패', async () => {
  expect(p.parseShipResult('git push -q', '', '/w').pushes).toEqual([])
  expect(p.parseShipResult('git push', 'Everything up-to-date', '/w').pushes).toEqual([])
  expect(p.parseShipResult('git push -u origin feat', 'To github.com:o/r.git\n * [new branch]      feat -> feat', '/w').pushes[0]).toMatchObject({ ok: true, ref: 'feat' })
  expect(p.parseShipResult('git push', ' ! [rejected]  main -> main (fetch first)\nerror: failed to push', '/w').pushes[0]).toMatchObject({ ok: false, ref: 'main' })
  expect(p.parseShipResult('git push --force', ' + 111...222 main -> main (forced update)', '/w').pushes[0]).toMatchObject({ ok: true, ref: 'main' })
})

test('커밋 메시지 속 "push" · git stash push · --dry-run · --auto 머지는 세지 않는다', async () => {
  expect(p.shipKinds('git stash push -m "wip"')).toEqual([])
  expect(p.shipKinds('git add a.txt && git commit -m "Show push state in the pane"')).toEqual(['commit'])
  expect(p.parseShipResult('git commit -m "Show push state"', '[main abc1234] Show push state', '/r').pushes).toEqual([])
  expect(p.shipKinds('git commit -m x && git push --dry-run')).toEqual(['commit'])
  expect(p.shipKinds('git push --dry-run')).toEqual([])
  expect(p.shipKinds('git push origin --delete old')).toEqual([])
  expect(p.shipKinds('git -C /a push')).toEqual(['push'])
  expect(p.shipKinds('git push -u origin x')).toEqual(['push'])
  expect(p.shipKinds('gh pr merge 42 --auto')).toEqual([])
  expect(p.shipKinds('gh pr merge 42 --squash')).toEqual(['pr-merge'])
})

test('gh pr create · merge 결과에서 PR 을 기록한다', async () => {
  const c = p.parseShipResult('gh pr create --title "fix: x" --body y', 'https://github.com/o/r/pull/12\n', '/w')
  expect(c.prs[0]).toMatchObject({ number: 12, repo: 'o/r', action: 'create', title: 'fix: x' })
  expect(p.parseShipResult('gh pr merge 42 --squash', '✓ Squashed and merged pull request #42', '/w').prs[0]).toMatchObject({ number: 42, action: 'merge', url: null })
  expect(p.parseShipResult('gh pr create --title t', 'error: no commits between main and x', '/w').prs).toEqual([])
})

test('MCP PR 도구: 만들기 · 머지만 세고, 읽기 · 리뷰 · 수정은 세지 않는다', async () => {
  const out = 'https://github.com/someone/other/pull/42'
  expect(p.prFactsFromTool('mcp__github__pull_request_read', {}, out)).toEqual([])
  expect(p.prFactsFromTool('mcp__github__update_pull_request', {}, out)).toEqual([])
  expect(p.prFactsFromTool('mcp__github__pull_request_review_write', {}, out)).toEqual([])
  expect(p.prFactsFromTool('mcp__github__create_pull_request', { title: 't' }, out)[0]).toMatchObject({ number: 42, action: 'create', title: 't' })
  expect(p.prFactsFromTool('mcp__github__merge_pull_request', { owner: 'o', repo: 'r', pull_number: 7 }, '')[0]).toMatchObject({ number: 7, action: 'merge', url: 'https://github.com/o/r/pull/7' })
})

test('cd 와 git -C 로 지정한 위치를 찾고, 도구 결과는 글자 하나로 편다', async () => {
  expect(p.commandDir('cd /a/b && git commit -m x', '/w')).toBe('/a/b')
  expect(p.commandDir('git -C /c/d push', '/w')).toBe('/c/d')
  expect(p.commandDir('git commit -m x', '/w')).toBe('/w')
  expect(p.commandDir('cd sub && git push', '/w')).toBe('/w/sub')
  expect(p.commandDir('cd ~/x && git push', '/w')).toBe(null)
  expect(p.flatten({ stdout: 'a', stderr: 'b' })).toBe('a\nb')
  expect(p.flatten([{ text: 'x' }, 'y'])).toBe('x\ny')
})

// ---- 순수 함수: 이 대화의 결과물 판정 (회귀) ------------------------------------------------------------------------

const repo = (over: Record<string, unknown> = {}) => ({ name: 'r', root: '/r', branch: 'main', onDefault: true, relevant: true, ahead: 0, behind: 0, upstream: 'origin/main', ...over })

test('배송 판정: 커밋 전 → 푸시 전 → 모두 반영', async () => {
  const a = p.shipSummary({ touchedCount: 3, prs: [] }, [repo()], [], 3, [])
  expect(a.headline).toBe('커밋하지 않은 변경 3개가 남아 있어요')
  expect(a.stages[1].state).toBe('todo')
  const b = p.shipSummary({ touchedCount: 3, prs: [] }, [repo({ ahead: 1 })], [{ sha: 'a', pushed: false }], 0, [])
  expect(b.headline).toBe('커밋 1개가 아직 푸시 전이에요')
  const c = p.shipSummary({ touchedCount: 3, prs: [] }, [repo()], [{ sha: 'a', pushed: true }], 0, [])
  expect(c.stages.map((s: { state: string }) => s.state)).toEqual(['done', 'done', 'done', 'skip', 'skip'])
  expect(c.tone).toBe('good')
  const nothing = p.shipSummary({ touchedCount: 0, prs: [] }, [repo()], [], 0, [])
  expect(nothing).toMatchObject({ headline: '이 세션에서 바뀐 코드는 아직 없어요', tone: 'calm' })
})

test('배송 판정: 앞선 세션이 남긴 푸시 전 커밋(ahead)은 이 세션의 푸시 몫으로 세지 않는다', async () => {
  expect(p.shipSummary({ touchedCount: 1, prs: [] }, [repo({ ahead: 2 })], [], 1, []).stages[2].state).toBe('none')
  expect(p.shipSummary({ touchedCount: 1, prs: [] }, [repo({ ahead: 3 })], [{ sha: 'a', pushed: false }], 0, []).headline).toBe('커밋 1개가 아직 푸시 전이에요')
})

test('배송 판정: main 에서 다른 브랜치로 푸시했으면 "main 에 바로 올라갔어요"가 아니다', async () => {
  const s = p.shipSummary({ touchedCount: 1, prs: [], pushes: [{ ts: 1, ok: true, ref: 'claude/u', repo: 'r' }] }, [repo()], [{ sha: 'a', pushed: true }], 0, [])
  expect(s.headline).toBe('푸시까지 끝났어요. PR 은 아직 없어요')
  const m = p.shipSummary({ touchedCount: 1, prs: [], pushes: [{ ts: 1, ok: true, ref: 'main', repo: 'r' }] }, [repo()], [{ sha: 'a', pushed: true }], 0, [])
  expect(m.headline).toBe('main 에 바로 올라갔어요')
})

test('배송 판정: 기록된 PR 의 지금 상태(세션 밖에서 머지)를 따른다', async () => {
  const s = p.shipSummary({ touchedCount: 1, prs: [{ number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r', action: 'create', state: 'MERGED' }] }, [repo()], [{ sha: 'a', pushed: true }], 0, [])
  expect(s.headline).toBe('머지까지 끝났어요')
  expect(s.prs[0].state).toBe('MERGED')
})

test('배송 판정: 고친 파일이 전부 git 밖이면 "반영됐다"고 하지 않는다', async () => {
  const s = p.shipSummary({ touchedCount: 2, prs: [] }, [repo()], [], 0, ['/home/x/a.txt', '/home/x/b.txt'], '/home')
  expect(s.headline).toBe('고친 파일 2개가 git 저장소 밖에 있어요')
  expect(s.tone).toBe('info')
  expect(s.sub).toContain('~/x')
})

test('배송 판정: gh 로 PR 을 못 물으면 "PR 이 없다"고 하지 않는다', async () => {
  const s = p.shipSummary({ touchedCount: 1, prs: [] }, [repo({ branch: 'feat-x', onDefault: false, upstream: 'origin/feat-x', pr: { unavailable: true } })], [{ sha: 'a', pushed: true }], 0, [])
  expect(s.stages[3]).toMatchObject({ state: 'none', detail: '확인 못 함' })
  expect(s.headline).toBe('푸시까지 끝났어요')
  expect(s.tone).toBe('good')
  const none = p.shipSummary({ touchedCount: 1, prs: [] }, [repo({ branch: 'feat-x', onDefault: false, upstream: 'origin/feat-x', pr: { none: true } })], [{ sha: 'a', pushed: true }], 0, [])
  expect(none.stages[3].state).toBe('todo')
})

test('배송 판정: main 에 푸시 전이면 PR 을 "건너뜀"으로 말하지 않는다', async () => {
  expect(p.shipSummary({ touchedCount: 1, prs: [] }, [repo({ ahead: 1 })], [{ sha: 'a', pushed: false }], 0, []).stages[3].state).not.toBe('skip')
})

test('배송 판정은 계약의 d.session 모양(단계 · 머리말 · 한 마디 · PR 목록)으로 나온다', async () => {
  const s = p.shipSummary(
    { touchedCount: 1, prs: [{ number: 12, url: 'https://github.com/o/r/pull/12', repo: 'o/r', action: 'create', title: 'fix: x' }], pushes: [{ ts: 5, ok: true, ref: 'feat-x', repo: 'r' }] },
    [repo({ branch: 'feat-x', onDefault: false, upstream: 'origin/feat-x' })],
    [{ sha: 'abc1234def', short: 'abc1234', subject: 'fix: x', ts: 4, pushed: true, repo: 'r', byClaude: true }],
    0,
    [],
  )
  for (const k of ['stages', 'headline', 'short', 'tone', 'sub', 'touched', 'leftover', 'outside', 'commits', 'pushes', 'prs']) expect(s).toHaveProperty(k)
  expect(s.stages.map((x: { id: string }) => x.id)).toEqual(['edit', 'commit', 'push', 'pr', 'merge'])
  expect(s.prs[0]).toMatchObject({ number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN', source: 'log' })
  expect(s.stages[3]).toMatchObject({ state: 'done', url: 'https://github.com/o/r/pull/12' })
  expect(s.headline).toBe('PR #12 이 머지를 기다려요')
  expect(s.short).toBe('#12 머지 대기')
})

test('결과물 한 마디(short): 머리말의 짧은 꼴 — 창 제목 줄에 어조 색으로 붙는다', async () => {
  const S = (...args: unknown[]) => p.shipSummary(...args)
  const feat = repo({ branch: 'feat-x', onDefault: false, upstream: 'origin/feat-x' })
  const cases: [Any, string, string][] = [
    [S({ touchedCount: 0, prs: [] }, [repo()], [], 0, []), '변경 없음', 'calm'],
    [S({ touchedCount: 3, prs: [] }, [repo()], [], 3, []), '커밋 전 3', 'warn'],
    [S({ touchedCount: 3, prs: [] }, [repo({ ahead: 2 })], [{ sha: 'a', pushed: false }, { sha: 'b', pushed: false }], 0, []), '푸시 전 2', 'warn'],
    [S({ touchedCount: 1, prs: [], pushes: [{ ts: 1, ok: true, ref: 'claude/u', repo: 'r' }] }, [repo()], [{ sha: 'a', pushed: true }], 0, []), 'PR 없음', 'info'],
    [S({ touchedCount: 1, prs: [{ number: 128, url: 'https://github.com/o/r/pull/128', repo: 'o/r', action: 'create' }] }, [feat], [{ sha: 'a', pushed: true }], 0, []), '#128 머지 대기', 'info'],
    [S({ touchedCount: 1, prs: [{ number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r', action: 'create', state: 'MERGED' }] }, [feat], [{ sha: 'a', pushed: true }], 0, []), '머지 완료', 'good'],
    [S({ touchedCount: 3, prs: [] }, [repo()], [{ sha: 'a', pushed: true }], 0, []), '바로 반영', 'good'],
    [S({ touchedCount: 1, prs: [] }, [{ ...feat, pr: { unavailable: true } }], [{ sha: 'a', pushed: true }], 0, []), '푸시 완료', 'good'],
    [S({ touchedCount: 2, prs: [] }, [repo()], [], 0, ['/home/x/a.txt', '/home/x/b.txt'], '/home'), 'git 밖 파일', 'info'],
  ]
  expect(cases.map(([s]) => s.short)).toEqual(cases.map(([, short]) => short))
  expect(cases.map(([s]) => s.tone)).toEqual(cases.map(([, , tone]) => tone))
  // 모두 반영: 고친 파일이 git 이 추적하지 않는(무시된) 파일뿐이라 커밋할 게 없을 때 — 머리말의 짧은 꼴
  const all = S({ touchedCount: 2, prs: [] }, [repo()], [], 0, [])
  expect([all.short, all.tone, all.headline]).toEqual(['모두 반영', 'good', '지금까지의 변경은 모두 반영됐어요'])
  // 견본의 short 도 같은 규칙으로 만든 값
  expect([busySession.session.short, emptySession.session.short, linuxContainer.session.short, stress.session.short]).toEqual(['커밋 전 3', '변경 없음', '푸시 완료', '커밋 전 131'])
})

// ---- 순수 함수: 저장소 세 지점 · 묶기 · 막대 조각 ----------------------------------------------------------------------

test('저장소 판정: 작업 폴더 → 커밋 → 원격, 원격에 직접 물은 값이 먼저', async () => {
  const [auth, landing, tot] = busySession.git.repos.map((r: Any) => F.repoChecks(r).map((c: Any) => c.detail).join(' | '))
  expect(auth).toBe('변경 4개 | 푸시 전 1개 | 푸시를 기다려요')
  expect(landing).toBe('깨끗해요 | 다 올라감 | origin/main 과 같음')
  expect(tot).toBe('변경 2개 | 원격 브랜치 없음 | 아직 안 올림')
  expect(F.repoChecks({ ...linuxContainer.git.repos[0], remoteCheck: null })[2]?.detail).toBe('원격이 2개 앞섬')
  const base = { name: 'r', branch: 'main', upstream: 'origin/main', remote: { url: 'u', slug: 'o/r' }, ahead: 1, behind: 0, dirty: 0, conflicts: 0 }
  const remoteOf = (r: Any) => F.repoChecks(r)[2]?.detail
  expect(remoteOf({ ...base, remoteCheck: { ok: true, exists: true, same: false } })).toBe('원격에 새 커밋')
  expect(remoteOf({ ...base, remoteCheck: { ok: true, exists: false, same: false } })).toBe('원격에 브랜치 없음')
  expect(remoteOf({ ...base, remoteCheck: { ok: true, exists: true, same: true } })).toBe('푸시를 기다려요')
  expect(remoteOf({ ...base, ahead: 2, remoteCheck: { ok: false } })).toBe('확인 못 함')
  expect(remoteOf({ ...base, ahead: 2, behind: 3, remoteCheck: null })).toBe('갈라짐 ↑2 ↓3')
  const pushed = F.repoChecks({ ...base, upstream: null, ahead: 0, unpushed: 0 })
  expect(pushed[1]?.detail).toBe('다 올라감')
  expect(pushed[2]?.detail).toBe('추적 설정 없음')
  expect(F.repoChecks({ ...base, upstream: null, ahead: 0, unpushed: 2 })[2]?.detail).toBe('아직 안 올림')
  expect(F.repoChecks({ ...base, conflicts: 2, dirty: 5 })[0]).toMatchObject({ level: 'bad', detail: '충돌 2개' })
  expect(F.repoChecks({ ...base, detached: true })[1]).toMatchObject({ level: 'warn', detail: '브랜치 없음(detached)' })
  expect(F.repoChecks({ ...base, remote: null, upstream: null })[2]).toMatchObject({ level: 'unknown', detail: '원격 없음' })
})

test('저장소 줄의 짧은 말: 좋지 않은 지점만, 같은 사실은 한 번만', async () => {
  const [auth, landing, tot, wt, hotfix] = busySession.git.repos.map((r: Any) => F.repoNote(r))
  expect(auth).toBe('변경 4 · 푸시 전 1') // 원격의 "푸시를 기다려요" 는 커밋 지점이 이미 말한다
  expect(landing).toBe('')
  expect(tot).toBe('변경 2 · 원격 브랜치 없음') // "아직 안 올림" 을 되풀이하지 않는다
  expect(wt).toBe('푸시 전 2')
  expect(hotfix).toBe('')
  expect(F.repoNote({ name: 'r', remote: null, upstream: null, dirty: 0, conflicts: 0, ahead: 0, behind: 0 })).toBe('원격 없음')
  expect(F.repoNote(linuxContainer.git.repos[0])).toBe('원격 확인 못 함')
})

test('여러 판정 중 가장 나쁜 것: 나쁨 > 주의 > 모름 > 좋음, 비면 좋음', async () => {
  expect(f.worstLevel(['good', 'good', 'good'])).toBe('good')
  expect(f.worstLevel(['good', 'unknown', 'good'])).toBe('unknown')
  expect(f.worstLevel(['unknown', 'warn', 'good'])).toBe('warn')
  expect(f.worstLevel(['warn', 'bad', 'unknown'])).toBe('bad')
  expect(f.worstLevel(['bad', 'warn'])).toBe('bad')
  expect(f.worstLevel([])).toBe('good')
  expect(f.worstLevel(undefined)).toBe('good')
  expect(f.worstLevel(['good', 'mystery'])).toBe('good') // 모르는 말은 좋음과 같은 자리
})

test('저장소 묶기: 워크트리는 본 저장소 바로 뒤에 depth 1 로, 본 저장소가 없으면 제자리에 depth 0, 묶음 순서는 처음 나온 자리', async () => {
  const r = (root: string, main?: string) => ({ root, name: root.split('/').pop(), ...(main ? { main } : {}) })
  const out = f.groupRepos([r('/a'), r('/b/.claude/worktrees/x', '/b'), r('/c'), r('/b'), r('/a-wt', '/a'), r('/lost-wt', '/gone'), r('/b-wt', '/b')])
  expect(out.map((x: Any) => `${x.root}:${x.depth}`)).toEqual(['/a:0', '/a-wt:1', '/b:0', '/b/.claude/worktrees/x:1', '/b-wt:1', '/c:0', '/lost-wt:0'])
  // 들어온 값은 바꾸지 않고, 원래 필드는 그대로
  const input = [r('/m'), r('/m-wt', '/m')]
  const before = JSON.stringify(input)
  expect(f.groupRepos(input)[1]).toMatchObject({ root: '/m-wt', name: 'm-wt', main: '/m', depth: 1 })
  expect(JSON.stringify(input)).toBe(before)
  // 자기 자신을 main 으로 가리키는 값 · 빈 값 · 배열이 아닌 값
  expect(f.groupRepos([r('/s', '/s'), null, r('/t')]).map((x: Any) => `${x.root}:${x.depth}`)).toEqual(['/s:0', '/t:0'])
  expect(f.groupRepos(undefined)).toEqual([])
  // 견본: auth-service 아래에 워크트리 둘(Claude 것 먼저 — 들어온 순서), 그다음 landing · tot
  expect(f.groupRepos(busySession.git.repos).map((x: Any) => `${x.name}:${x.depth}`)).toEqual(['auth-service:0', 'fix-login-a1b2:1', 'auth-service-hotfix:1', 'landing:0', 'tot:0'])
})

test('막대 조각: 정수 % 로 나누고, 합은 실제 비율을 넘지 않으며, 작은 조각도 1% 는 보인다', async () => {
  const total = 8 * GB
  const segs = busySession.sys.mem.segments.filter((s: Any) => s.key !== 'free').map((s: Any) => s.bytes)
  const pcts = f.segmentPcts(segs, total)
  expect(pcts.every((x: number) => Number.isInteger(x) && x >= 0)).toBe(true)
  expect(pcts.reduce((a: number, b: number) => a + b, 0)).toBe(Math.round((100 * segs.reduce((a: number, b: number) => a + b, 0)) / total))
  expect(f.segmentPcts([0.001 * GB, 7.9 * GB], total)).toEqual([1, 98])
  expect(f.segmentPcts([GB], 0)).toEqual([0])
  const cells = f.segmentCells([39, 50], 24)
  expect(cells.reduce((a: number, b: number) => a + b, 0)).toBe(Math.round((89 * 24) / 100))
  expect(f.pairText(7.1 * GB, 8 * GB)).toBe('7.1 / 8 GB')
  expect(f.pairText(131 * GB, 228 * GB)).toBe('131 / 228 GB')
  expect(f.pairText(11.7 * GB, 12 * GB)).toBe('11.7 / 12 GB') // 꽉 찬 것처럼 "12 / 12" 로 반올림하지 않는다
  expect(f.pairText(61 * GB, 100 * GB)).toBe('61 / 100 GB')
  expect(f.pairText(300 * 1048576, 512 * 1048576)).toBe('300 / 512 MB')
  expect(f.fmtBytes(958 * 1048576)).toBe('958 MB')
})

// ---- 작업 구역(live-work.js) ----------------------------------------------------------------------------------------

const BUSY_PR_URL = 'https://github.com/acme/auth-service/pull/128'
const STAGE_IDS = ['edit', 'commit', 'push', 'pr', 'merge']
/** 단계 점(●◐○) — n-<id> 상자 가운데 칸의 글자 */
const stageNode = (t: El, id: string) => (byKey(t, `n-${id}`)!.children[1] as El).children[0] as El
/** 저장소 줄들(r-<경로>) */
const repoRows = (t: El) => nodesOf(t, (n) => n.type === 'Box' && String(n.props.key ?? '').startsWith('r-'))
/** 저장소 줄의 세 점 — 이음줄(━)을 뺀 점 글자와 색 */
const dots = (row: El) =>
  nodesOf(byKey(row, 'chain')!, (n) => n.type === 'Text' && /^[●○]$/.test(textOf(n))).map((n) => ({ ch: textOf(n), color: n.props.color }))

test('작업 구역: 제목 줄에 한 마디(어조 색) · 다시 확인, 결과물 다섯 단계, PR 한 줄 — 커밋 · 파일 목록 · 긴 머리말은 없다', async () => {
  const t = drawn(busySession, 'live-work')
  expect(textOf(byKey(t, 'head')!)).toBe('작업커밋 전 3↻')
  const short = nodesOf(byKey(t, 'head')!, (n) => n.type === 'Text' && textOf(n) === '커밋 전 3')[0]!
  expect(short.props.color).toBe('warning')
  expect(nodesOf(t, (n) => n.type === 'Button')).toHaveLength(1)
  expect(nodesOf(t, (n) => n.type === 'Button')[0]!.props).toMatchObject({ key: 'verify', label: '↻', dimColor: true })
  expect(nodesOf(t, (n) => n.type === 'Button')[0]!.props.hotkey).toBeUndefined()
  // 단계: 끝 ● 초록 · 반쯤 ◐ 주황 · 다음 할 일 ● 주황(숨 쉰다), 이름은 아래 줄에
  expect(STAGE_IDS.map((id) => textOf(stageNode(t, id)))).toEqual(['●', '◐', '◐', '●', '●'])
  expect(STAGE_IDS.map((id) => stageNode(t, id).props.color)).toEqual([C.green, C.amber, C.amber, C.green, C.amber])
  expect(STAGE_IDS.map((id) => textOf(byKey(t, `t-${id}`)!))).toEqual(['편집', '커밋', '푸시', 'PR', '머지'])
  expect(STAGE_IDS.map((id) => (byKey(t, `t-${id}`)!.children[0] as El).props.color ?? null)).toEqual([null, 'warning', 'warning', null, 'warning'])
  // 단계 칸은 모두 같은 폭
  expect(new Set(STAGE_IDS.map((id) => byKey(t, `n-${id}`)!.props.width)).size).toBe(1)
  // PR: ⑂ 기호(검사 통과 = 초록) · 링크 · 옅은 검사 말
  const pr = byKey(t, 'pr')!
  expect(textOf(pr)).toBe('⑂#128 열림검사 통과')
  expect(nodesOf(pr, (n) => n.type === 'Link')[0]!.props).toEqual({ href: BUSY_PR_URL, label: '#128 열림' })
  expect((pr.children[0] as El).props.color).toBe(C.green)
  const all = textOf(t)
  for (const gone of ['e4f1c2a', '9b2d7e1', 'refresh.ts', '고친 파일 5개', busySession.session.headline, '이 컴퓨터에만 있어요']) expect(all).not.toContain(gone)
  // 아무것도 안 했을 때: 단계는 모두 옅은 ○, PR 줄 없음, 한 마디는 옅게
  const rest = drawn(restingSession, 'live-work')
  expect(STAGE_IDS.map((id) => textOf(stageNode(rest, id))).join('')).toBe('○○○○○')
  expect(STAGE_IDS.every((id) => (byKey(rest, `t-${id}`)!.children[0] as El).props.dimColor === true)).toBe(true)
  expect(byKey(rest, 'pr')).toBeUndefined()
  expect(nodesOf(byKey(rest, 'head')!, (n) => n.type === 'Text' && textOf(n) === '변경 없음')[0]!.props).toMatchObject({ dimColor: true })
  // PR 이 여럿이면 첫 PR + 옅은 "외 N개", 초안은 회색
  const sp = byKey(drawn(stress, 'live-work'), 'pr')!
  expect(textOf(sp)).toBe('⑂#10482 초안검사 중 12 · 외 2개')
  expect((sp.children[0] as El).props.color).toBe(C.gray)
  // 링크는 https 정규형 주소만 — 아니면(http · 계정이 든 주소 · 주소 아님) 글자로만
  for (const url of ['http://github.com/o/r/pull/1', 'https://user:tok@github.com/o/r/pull/1', 'javascript:alert(1)', 'not a url', null]) {
    const d = { ...busySession, session: { ...busySession.session, prs: [{ ...busySession.session.prs[0], url }] } }
    const row = byKey(drawn(d, 'live-work'), 'pr')!
    expect(nodesOf(row, (n) => n.type === 'Link'), String(url)).toEqual([])
    expect(textOf(row)).toBe('⑂#128 열림검사 통과')
  }
})

test('좁은 창: 이름 칸 · 막대가 줄어도 칸 수는 양수, 넘치는 말은 끝을 줄인다', async () => {
  for (const cols of [24, 30]) {
    const work = drawn(stress, 'live-work', 'desktop', 0, { cols })
    const names = repoRows(work).map((r) => Number((r.children[0] as El).props.width))
    expect(names.every((n) => Number.isInteger(n) && n >= 8)).toBe(true)
    const server = drawn(stress, 'live-server', 'desktop', 0, { cols })
    for (const k of ['cpu', 'mem', 'swap', 'disk']) expect(barCells(server, k)).toBe(8)
    const crew = drawn(stress, 'live-crew', 'desktop', 0, { cols })
    for (const l of nodesOf(crew, (n) => n.props.key === 'track')) expect(Number((l.children[0] as El).props.width) >= 12).toBe(true)
  }
  const nameText = (repoRows(drawn(stress, 'live-work'))[0]!.children[0] as El).children[0] as El
  expect(nameText.props.wrap).toBe('truncate-end')
  expect(nodesOf(drawn(stress, 'live-work'), (n) => n.type === 'Text' && textOf(n).startsWith('feature/'))[0]!.props.wrap).toBe('truncate-end')
})

test('작업 구역: 저장소마다 한 줄 — 이름 · 브랜치 · 좋지 않을 때만 짧은 말 · 세 점(폴더 → 커밋 → 원격)', async () => {
  const t = drawn(busySession, 'live-work')
  const rows = repoRows(t)
  expect(rows.map(textOf)).toEqual([
    'auth-servicefix/session-expiry변경 4 · 푸시 전 1●━●━●',
    '└ ✻ fix-login-a1b2claude/fix-login-a1b2푸시 전 2●━●━●',
    '└ auth-service-hotfixhotfix/token-ttl●━●━●',
    'landingmain●━●━●',
    'totfeat/species-cards변경 2 · 원격 브랜치 없음●━●━○',
  ])
  expect(rows[0]!.props.key).toBe('r-/home/dev/work/auth-service')
  // 점 색은 수준별 중간 톤, 모름은 ○
  expect(dots(rows[0]!)).toEqual([C.amber, C.amber, C.amber].map((color) => ({ ch: '●', color })))
  expect(dots(rows[3]!)).toEqual([C.green, C.green, C.green].map((color) => ({ ch: '●', color })))
  expect(dots(rows[4]!).map((d) => d.ch).join('')).toBe('●●○')
  // 이름 칸은 모두 같은 폭(8–18칸), 이 대화가 만진 저장소는 굵게
  const nameBoxes = rows.map((r) => r.children[0] as El)
  expect(new Set(nameBoxes.map((b) => b.props.width)).size).toBe(1)
  expect(Number(nameBoxes[0]!.props.width) >= 8 && Number(nameBoxes[0]!.props.width) <= 18).toBe(true)
  const nameText = (i: number) => nodesOf(nameBoxes[i]!, (n) => n.type === 'Text' && !n.children.some((c) => typeof c !== 'string'))
  expect(nameText(0).find((n) => textOf(n) === 'auth-service')!.props.bold).toBe(true)
  expect(nameText(3).find((n) => textOf(n) === 'landing')!.props.bold).toBeUndefined()
  // 짧은 말: 주의는 warning, 나쁨은 error, 모름은 옅게
  const note = (row: El) => nodesOf(row, (n) => n.type === 'Text' && n.props.wrap === 'truncate-end' && !n.props.dimColor && n.children.every((c) => typeof c === 'string'))
  expect(note(rows[0]!)[0]!.props.color).toBe('warning')
  const stressRows = repoRows(drawn(stress, 'live-work'))
  expect(note(stressRows[1]!).find((n) => textOf(n) === '충돌 3')!.props.color).toBe('error')
  const payments = repoRows(drawn(nestedAgents, 'live-work'))[0]!
  expect(nodesOf(payments, (n) => n.type === 'Text' && textOf(n) === '원격 확인 못 함')[0]!.props.dimColor).toBe(true)
})

test('작업 구역: 워크트리는 본 저장소 바로 아래에 옅은 └ 로 들여 쓰고, Claude 가 만든 워크트리에는 ✻ 를 붙인다', async () => {
  const wp = clientProps(busySession, 'live-work')
  expect(wp.repos.map((r: Any) => [r.name, r.depth, r.claude])).toEqual([
    ['auth-service', 0, false],
    ['fix-login-a1b2', 1, true],
    ['auth-service-hotfix', 1, false],
    ['landing', 0, false],
    ['tot', 0, false],
  ])
  for (const surface of ['desktop', 'terminal'] as const) {
    const rows = repoRows(drawn(busySession, 'live-work', surface))
    const pieces = (row: El) => nodesOf(row.children[0] as El, (n) => n.type === 'Text' && n.children.every((c) => typeof c === 'string'))
    const wt = pieces(rows[1]!)
    expect(wt.map(textOf)).toEqual(['└ ', '✻ ', 'fix-login-a1b2'])
    expect(wt[0]!.props.dimColor).toBe(true)
    expect(wt[1]!.props).toMatchObject({ color: C.claude, bold: true })
    expect(pieces(rows[2]!).map(textOf)).toEqual(['└ ', 'auth-service-hotfix'])
    expect(pieces(rows[0]!).map(textOf)).toEqual(['auth-service'])
  }
  // 본 저장소가 목록에 없는 워크트리는 들여 쓰지 않는다(└ 없이), Claude 워크트리 표시는 그대로
  const orphan = { ...busySession, git: { ...busySession.git, repos: busySession.git.repos.filter((r: Any) => r.name !== 'auth-service') } }
  const orphanRows = repoRows(drawn(orphan, 'live-work')).map(textOf)
  expect(orphanRows).toEqual(['landingmain●━●━●', 'totfeat/species-cards변경 2 · 원격 브랜치 없음●━●━○', '✻ fix-login-a1b2claude/fix-login-a1b2푸시 전 2●━●━●', 'auth-service-hotfixhotfix/token-ttl●━●━●'])
})

test('작업 구역: 읽는 중 · 저장소 없음 · 읽기 오류 · 여섯 줄 넘으면 "+ 저장소 N개 더", 다시 확인은 원격이 있을 때만', async () => {
  const fresh = drawn(freshSession, 'live-work')
  expect(textOf(fresh)).toContain('git 상태를 읽는 중…')
  expect(nodesOf(fresh, (n) => n.type === 'Button')).toEqual([])
  expect(byKey(fresh, 'pr')).toBeUndefined()
  const none = drawn({ ...restingSession, git: { at: NOW, repos: [] } }, 'live-work')
  expect(textOf(none)).toContain('살펴볼 git 저장소가 없어요')
  expect(nodesOf(none, (n) => n.type === 'Button')).toEqual([])
  const broken = drawn({ ...restingSession, session: null, git: { at: NOW, error: 'spawn git ENOENT', repos: [] } }, 'live-work')
  expect(textOf(byKey(broken, 'head')!)).toBe('작업읽지 못함')
  expect(nodesOf(broken, (n) => n.type === 'Text' && textOf(n) === '✖ spawn git ENOENT')[0]!.props.color).toBe('error')
  expect(textOf(broken)).not.toContain('살펴볼 git 저장소가 없어요')
  // 원격 없는 저장소뿐이면 다시 확인 단추가 없다
  const local = { ...restingSession, git: { at: NOW, repos: [{ ...restingSession.git.repos[0], upstream: null, remote: null }] } }
  expect(nodesOf(drawn(local, 'live-work'), (n) => n.type === 'Button')).toEqual([])
  // 저장소 7개: 여섯 줄 + "+ 저장소 1개 더", 읽지 못한 저장소는 한 줄, 원격에 묻는 중이면 "확인 중…"
  const s = drawn(stress, 'live-work')
  const rows = repoRows(s)
  expect(rows).toHaveLength(6)
  expect(textOf(rows[5]!)).toBe('repository-number-5-with-a-long-name✖ 읽지 못했어요')
  expect(textOf(s)).toContain('+ 저장소 1개 더')
  expect(nodesOf(s, (n) => n.type === 'Button')[0]!.props.label).toBe('확인 중…')
  // 터미널은 다시 확인을 v 키로도
  expect(nodesOf(drawn(busySession, 'live-work', 'terminal'), (n) => n.type === 'Button')[0]!.props.hotkey).toBe('v')
})

// ---- 서버 구역(live-server.js) --------------------------------------------------------------------------------------

/** 막대 줄(b-<key>)의 ▰ 조각들 — [{ n: 칸 수, color }] (마지막 빈 칸 조각 포함) */
function barRuns(t: El, key: string): { n: number; color: unknown; dim: boolean }[] {
  const bar = (byKey(t, `b-${key}`)!.children[1] as El).children[0] as El
  return (bar.children as El[]).map((k) => ({ n: [...textOf(k)].length, color: k.props.color, dim: k.props.dimColor === true }))
}
const barCells = (t: El, key: string) => barRuns(t, key).reduce((a, r) => a + r.n, 0)

test('서버 구역: 제목 줄(판정 점 · 짧은 말 · 어디서) 아래 ▰ 막대 — CPU · 메모리(쓰는 조각만 쌓기) · 스왑 · 디스크, 모두 같은 칸 수', async () => {
  const t = drawn(busySession, 'live-server')
  expect(textOf(byKey(t, 'head')!)).toBe('서버●빠듯dev-mac · 원격 제어')
  expect((byKey(t, 'verdict')!.children[0] as El).props).toMatchObject({ color: C.amber, bold: true })
  expect(textOf(t)).not.toContain(busySession.where.label) // 긴 말은 글자 요약에만
  const keys = nodesOf(t, (n) => String(n.props.key ?? '').startsWith('b-')).map((n) => n.props.key)
  expect(keys).toEqual(['b-cpu', 'b-mem', 'b-swap', 'b-disk'])
  // 막대는 usage-bar 와 같은 16칸, 빈 칸은 같은 ▰ 를 옅은 바탕색으로
  for (const k of ['cpu', 'mem', 'swap', 'disk']) {
    expect(barCells(t, k)).toBe(16)
    expect(barRuns(t, k).at(-1)!.color).toBe(C.track)
    expect(/^▰+$/.test(textOf((byKey(t, `b-${k}`)!.children[1] as El)))).toBe(true)
  }
  expect(barRuns(t, 'cpu')[0]).toEqual({ n: f.segmentCells([39], 16)[0], color: C.blue, dim: false })
  expect(barRuns(t, 'mem').slice(0, 3).map((r) => r.color)).toEqual([C.blue, C.purple, C.teal]) // 앱 · 시스템 · 압축(캐시 · 빈 곳은 빈 칸)
  expect(barRuns(t, 'mem').slice(0, 3).map((r) => r.n)).toEqual(f.segmentCells([39, 21, 29], 16))
  // 오른쪽 숫자: 쓰는 중 / 전체, 주의 수준은 warning
  const value = (k: string) => (byKey(t, `b-${k}`)!.children[2] as El).children[0] as El
  expect(['cpu', 'mem', 'swap', 'disk'].map((k) => textOf(value(k)))).toEqual(['39%', '7.1 / 8 GB', '5.2 / 7 GB', '131 / 228 GB'])
  expect(value('mem').props.color).toBe('warning')
  expect(value('cpu').props.color).toBeUndefined()
  // 이름 · 막대 · 숫자 칸은 줄마다 같은 폭(세로로 맞는다), 가운데 맞춤
  const widths = (i: number) => ['cpu', 'mem', 'swap', 'disk'].map((k) => (byKey(t, `b-${k}`)!.children[i] as El).props.width)
  expect(new Set(widths(0)).size).toBe(1)
  expect(new Set(widths(2)).size).toBe(1)
  expect(byKey(t, 'b-cpu')!.props.alignItems).toBe('center')
  // 프로세스 목록 · 이 세션의 메모리 · 압력 말 · 기종 줄은 없다(이 세션 메모리는 글자 요약에만)
  for (const gone of ['Google Chrome', '프로세스', '958 MB', '압력', '부하', 'Apple']) expect(textOf(t)).not.toContain(gone)
})

test('서버 구역: 넓으면 CPU 줄 끝에 지난 흐름(▁▂▅), 터미널은 빈 칸을 ▱ 로 · 흐름 없이', async () => {
  const wide = drawn(busySession, 'live-server', 'desktop', 0, { cols: 80 })
  const spark = textOf(byKey(wide, 'spark')!)
  expect([...spark]).toHaveLength(8)
  expect(/^[▁▂▃▄▅▆▇█]+$/.test(spark)).toBe(true)
  expect(byKey(drawn(busySession, 'live-server'), 'spark')).toBeUndefined() // 56칸 창에는 자리가 없다
  const term = drawn(busySession, 'live-server', 'terminal', 0, { cols: 80 })
  expect(byKey(term, 'spark')).toBeUndefined()
  for (const k of ['cpu', 'mem', 'swap', 'disk']) {
    const runs = barRuns(term, k)
    expect(runs.reduce((a, r) => a + r.n, 0)).toBe(16)
    expect(runs.at(-1)).toMatchObject({ color: C.gray, dim: true })
    expect(/^▰+▱+$/.test(textOf((byKey(term, `b-${k}`)!.children[1] as El)))).toBe(true)
  }
  expect([...textOf((byKey(term, 'b-cpu')!.children[1] as El))].filter((c) => c === '▰').length).toBe(f.segmentCells([39], 16)[0])
  // 칸 계산: 막대는 16칸까지 · 좁으면 8칸까지 줄고, 흐름은 데스크톱에 자리가 남을 때만
  const rows = clientProps(busySession, 'live-server').rows
  expect(serverLayout(rows, 54, false)).toEqual({ LW: 7, VW: 12, BW: 16, SPW: 0 })
  expect(serverLayout(rows, 78, false)).toEqual({ LW: 7, VW: 12, BW: 16, SPW: 8 })
  expect(serverLayout(rows, 78, true).SPW).toBe(0)
  expect(serverLayout(rows, 30, false)).toEqual({ LW: 7, VW: 12, BW: 8, SPW: 0 })
  expect(serverLayout([], 54, false)).toMatchObject({ LW: 4, VW: 3 })
})

test('서버 구역(Linux 컨테이너): 컨테이너 메모리 줄, 스왑이 없으면 스왑 줄도 없다, 판정이 나쁘면 빨간 점', async () => {
  const t = drawn(nestedAgents, 'live-server')
  expect(textOf(byKey(t, 'head')!)).toBe('서버●여유클라우드 컨테이너')
  expect(nodesOf(t, (n) => String(n.props.key ?? '').startsWith('b-')).map((n) => n.props.key)).toEqual(['b-cpu', 'b-mem', 'b-disk', 'b-ctr'])
  expect(textOf(byKey(t, 'b-ctr')!)).toContain('컨테이너')
  expect(textOf(byKey(t, 'b-ctr')!)).toContain('3.1 / 4 GB')
  expect(barRuns(t, 'ctr')[0]).toEqual({ n: f.segmentCells([77], 16)[0], color: C.amber, dim: false }) // 77% — 주황
  expect(barRuns(t, 'mem').slice(0, -1).map((r) => r.color)).toEqual([C.blue]) // 쓰는 중 조각 하나
  const bad = drawn(stress, 'live-server')
  expect((byKey(bad, 'verdict')!.children[0] as El).props.color).toBe(C.red)
  expect(textOf(byKey(bad, 'verdict')!)).toBe('●모자람')
  // 읽기 전: 막대 대신 옅은 한 줄
  const fresh = drawn(freshSession, 'live-server')
  expect(textOf(fresh)).toBe('서버이 컴퓨터서버 상태를 읽는 중…')
  expect(byKey(fresh, 'note')).toBeDefined()
})

// ---- 화면 · 이벤트 (엔진을 통해): 결과물 · git · 서버 ------------------------------------------------------------------

test('창이 보일 때만 서버 · git 을 읽는다(열면 바로, 닫으면 멈춤)', async ($, on) => {
  const w = world(on, { open: false })
  await $.session.start(START)
  await $.classic.PostToolUse({ tool_name: 'Write', tool_input: { file_path: '/work/a.txt' }, tool_response: 'ok', tool_use_id: 't1' } as Any)
  await w.clock.advance(15000)
  expect(heavyCount(w)).toBe(0) // 편집이 있어도 창이 닫혀 있으면 git 을 띄우지 않는다
  await $.command.run({ command: 'crew', args: '' } as Any)
  await w.clock.advance(15000)
  expect(w.argv.filter((a) => a[0] === 'iostat').length >= 3).toBe(true) // 4초마다
  expect(w.argv.filter((a) => a[0] === 'git' && a.includes('status')).length >= 2).toBe(true) // 7초마다
  expect(w.invalidations > 0).toBe(true)
  await $.command.run({ command: 'crew', args: '' } as Any)
  await w.clock.settle()
  const before = heavyCount(w)
  await w.clock.advance(20000)
  expect(heavyCount(w)).toBe(before)
})

test('다른 탭 뒤에 있으면(isShown false) 무거운 일을 쉰다', async ($, on) => {
  const w = world(on, { open: true, shown: false })
  await $.session.start(START)
  await w.clock.advance(15000)
  expect(heavyCount(w)).toBe(0)
})

test('다른 탭에서 돌아와 다시 그려지면 다음 박자에 바로 새로 읽는다', async ($, on) => {
  const w = world(on, { open: true, shown: false })
  await $.session.start(START)
  await w.clock.advance(5000)
  expect(heavyCount(w)).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' }) // 탭을 눌러 다시 보인다
  expect(heavyCount(w)).toBe(0) // 그리는 동안에는 무거운 일을 하지 않는다
  await w.clock.advance(1000)
  expect(w.argv.some((a) => a[0] === 'iostat')).toBe(true)
  expect(w.argv.some((a) => a[0] === 'git' && a.includes('status'))).toBe(true)
  await ui.unmount()
})

test('클라우드 컨테이너(Linux): /proc · cgroup 으로 CPU · 메모리 · 한도를 읽는다', async ($, on) => {
  world(on, { os: 'Linux', env: { CLAUDE_CODE_ENVIRONMENT_KIND: 'ccr' } })
  await $.session.start(START)
  const text = textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))
  expect(text).toContain('클라우드 컨테이너(Linux)에서 돌고 있어요')
  expect(text).toMatch(/CPU 25%/)
  expect(text).toContain('컨테이너 한도: 메모리 3.1 / 4 GB · CPU 2코어')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = await drawnText(ui)
  expect(shown).toContain('클라우드 컨테이너')
  expect(shown).toContain('컨테이너')
  expect(shown).toContain('3.1 / 4 GB')
  expect(shown).toContain('25%')
  await ui.unmount()
})

test('KIND 없이 CLAUDE_CODE_REMOTE 만 있으면 클라우드에서 도는 것으로 본다', async ($, on) => {
  world(on, { os: 'Linux', env: { CLAUDE_CODE_REMOTE: 'true' } })
  await $.session.start(START)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('클라우드 컨테이너(Linux)에서 돌고 있어요')
})

test('원격 제어(bridge)면 서버 제목 줄에 "호스트 · 원격 제어" 를 짧게', async ($, on) => {
  world(on, { env: { CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge' } })
  await $.session.start(START)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('mini 에서 돌고 있어요 · 원격 제어로 접속 중 (데스크톱 앱)')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await drawnText(ui)).toContain('mini · 원격 제어')
  await ui.unmount()
})

test('시간이 흐르면 결과물 · git · 서버가 채워지고 네 표면 모두 그리며, 이 대화가 한 일은 $.state(v: 4)에 비춰 둔다', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.classic.PostToolUse({ tool_name: 'Write', tool_input: { file_path: '/work/work-notes.txt' }, tool_response: 'ok', tool_use_id: 't1' } as Any)
  await w.clock.advance(9000)
  for (const surface of ['desktop', 'terminal', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const live = surface === 'desktop' || surface === 'terminal'
    const scope = live ? { in: 'live-work' } : {}
    expect(await ui.find({ type: 'Text', text: '커밋 전 1', ...scope })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'verify', ...scope })).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'r-/work', ...scope })).toBeDefined()
    const t = await drawnText(ui)
    expect(t).toContain('빠듯')
    expect(t).toContain('23%')
    expect(t).toContain('6.4 / 8 GB')
    expect(t).not.toContain('Google Chrome')
    await ui.unmount()
  }
  const facts = lastFacts(w)
  expect(facts).toMatchObject({ v: 4, sessionId: 'sess-1' })
  expect(Object.keys(facts).sort()).toEqual(['agents', 'autoOpened', 'cleared', 'commits', 'main', 'prs', 'pushes', 'savedAt', 'sessionId', 'startedAt', 'touched', 'v', 'workerSeq'])
  expect(facts.touched.map((t: Any) => t.path)).toEqual(['/work/work-notes.txt'])
  expect(facts).toMatchObject({ commits: [], pushes: [], prs: [] })
})

test('다시 불러와도(같은 세션, v: 4) 이 대화가 한 일이 되살아난다', async ($, on) => {
  const t = Date.now() - 60000
  const facts = (sessionId: string) => ({ v: 4, sessionId, savedAt: t, startedAt: t - 60000, autoOpened: true, main: { firstAt: null, lastTurnEnd: null, marks: [] }, agents: [], workerSeq: 0, cleared: [], touched: [{ path: '/work/work-notes.txt', ts: t }], commits: [], pushes: [], prs: [] })
  world(on, { facts: facts('sess-1') })
  await $.session.start(START)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('커밋하지 않은 변경 1개가 남아 있어요')
})

test('모르는 모양(v: 1 — work-status 의 것)의 사실은 되살리지 않는다', async ($, on) => {
  const t = Date.now() - 60000
  world(on, { facts: { v: 1, sessionId: 'sess-1', savedAt: t, startedAt: t, autoOpened: true, touched: [{ path: '/work/work-notes.txt', ts: t }], commits: [], pushes: [], prs: [] } })
  await $.session.start(START)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('이 세션에서 바뀐 코드는 아직 없어요')
})

test('앞으로의 모양(v: 5)도 되살리지 않고 새로 시작한다', async ($, on) => {
  const t = Date.now() - 60000
  const w = world(on, { open: false, facts: { v: 5, sessionId: 'sess-1', savedAt: t, startedAt: t, autoOpened: true, main: { firstAt: null, lastTurnEnd: null, marks: [] }, agents: [], workerSeq: 0, cleared: [], touched: [{ path: '/work/work-notes.txt', ts: t }], commits: [], pushes: [], prs: [] } })
  await $.session.start(START)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('이 세션에서 바뀐 코드는 아직 없어요')
  await $.turn.start({ text: '안녕', turnId: 't1' } as Any)
  expect(w.opened).toEqual(['crew']) // 되살리지 않았으니 저절로 열기도 처음처럼
})

test('다른 세션이 남긴 사실은 되살리지 않는다', async ($, on) => {
  const t = Date.now() - 60000
  world(on, { facts: { v: 4, sessionId: 'other', savedAt: t, startedAt: t, autoOpened: true, main: { firstAt: null, lastTurnEnd: null, marks: [] }, agents: [], workerSeq: 0, cleared: [], touched: [{ path: '/work/work-notes.txt', ts: t }], commits: [], pushes: [], prs: [] } })
  await $.session.start(START)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('이 세션에서 바뀐 코드는 아직 없어요')
})

// ---- 회귀 (리뷰에서 찾은 문제) ----------------------------------------------------------------

test('새 폴더 안에만 만든 파일도 "커밋 전" 으로 센다(git 은 폴더 한 줄로만 보여 준다)', async ($, on) => {
  world(on, { git: (a) => (a.includes('status') ? ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +0 -0', '? pkg/', ''].join('\0') : undefined) })
  await $.session.start(START)
  await $.classic.PostToolUse({ tool_name: 'Write', tool_input: { file_path: '/work/pkg/sub/index.js' }, tool_response: 'ok', tool_use_id: 't1' } as Any)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('커밋하지 않은 변경 1개가 남아 있어요')
})

test('amend · rebase 로 버려진 커밋은 "푸시 전" 으로 남지 않는다', async ($, on) => {
  const ct = String(Math.floor(Date.now() / 1000))
  const w = world(on, {
    git: (a) => {
      if (a.includes('rev-list') && a.includes('--all')) return 'def5678aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
      if (a.includes('show')) return a.at(-1) === 'def5678' ? ['def5678aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'def5678', 'new', ct].join('\x1f') : ''
      if (a.includes('branch') && a.includes('-r')) return '  origin/main\n'
      if (a.includes('status')) return ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +0 -0', ''].join('\0')
      return undefined
    },
  })
  await $.session.start(START)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: { command: 'git commit -m old' }, tool_response: { stdout: '[main abc1234] old' }, tool_use_id: 'b1', cwd: '/work' } as Any)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: { command: 'git commit --amend -m new' }, tool_response: { stdout: '[main def5678] new' }, tool_use_id: 'b2', cwd: '/work' } as Any)
  const text = textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))
  expect(text).toContain('main 에 바로 올라갔어요')
  expect(text).not.toContain('푸시 전이에요')
  expect(w.argv.some((a) => a.includes('show') && a.at(-1) === 'abc1234')).toBe(false)
})

test('git commit && push 에서 푸시만 실패해도 커밋은 기록된다', async ($, on) => {
  const ct = String(Math.floor(Date.now() / 1000))
  world(on, {
    git: (a) => {
      if (a.includes('rev-list') && a.includes('--all')) return 'abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
      if (a.includes('show')) return ['abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'abc1234', 'feat: x', ct].join('\x1f')
      if (a.includes('status')) return ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +1 -0', ''].join('\0')
      return undefined
    },
  })
  await $.session.start(START)
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command: 'git commit -m x && git push' }, error: 'Exit code 1\n ! [rejected] main -> main (fetch first)\n[main abc1234] feat: x', tool_use_id: 'b1', cwd: '/work' } as Any)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('커밋 1개가 아직 푸시 전이에요')
})

test('기록된 PR 은 gh pr view 로 지금 상태를 다시 읽는다(세션 밖에서 머지)', async ($, on) => {
  const ct = String(Math.floor(Date.now() / 1000))
  const w = world(on, {
    git: (a) => {
      if (a.includes('rev-list') && a.includes('--all')) return 'abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
      if (a.includes('show')) return ['abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'abc1234', 'feat: x', ct].join('\x1f')
      if (a.includes('branch') && a.includes('-r')) return '  origin/feat-x\n'
      if (a.includes('status')) return ['# branch.oid abc', '# branch.head feat-x', '# branch.upstream origin/feat-x', '# branch.ab +0 -0', ''].join('\0')
      if (a.includes('ls-remote')) return 'abc\trefs/heads/feat-x\n'
      return undefined
    },
    gh: (a) => {
      if (a[1] === 'auth') return ''
      if (a[1] === 'pr' && a[2] === 'list') return '[]'
      if (a[1] === 'pr' && a[2] === 'view') return JSON.stringify({ number: 7, title: 'feat: x', state: 'MERGED', url: 'https://github.com/o/r/pull/7', isDraft: false, mergedAt: '2026-10-07T00:00:00Z', statusCheckRollup: [], updatedAt: '2026-10-07' })
      return undefined
    },
  })
  await $.session.start(START)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: x"' }, tool_response: { stdout: '[feat-x abc1234] feat: x' }, tool_use_id: 'b1', cwd: '/work' } as Any)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: { command: 'gh pr create --title "feat: x"' }, tool_response: { stdout: 'https://github.com/o/r/pull/7\n' }, tool_use_id: 'b2', cwd: '/work' } as Any)
  const text = textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))
  expect(text).toContain('머지까지 끝났어요')
  expect(text).toContain('PR #7 머지됨')
  expect(w.argv.some((a) => a[0] === 'gh' && a[2] === 'view' && a[3] === 'https://github.com/o/r/pull/7')).toBe(true)
})

test('원격 확인은 추적 ref(@{u})와 원격의 같은 전체 ref 를 견준다', async ($, on) => {
  let remoteSha = 'bbb222'
  const w = world(on, {
    git: (a) => {
      if (a.includes('status')) return ['# branch.oid aaa', '# branch.head feature/main', '# branch.upstream origin/feature/main', '# branch.ab +0 -0', ''].join('\0')
      if (a.includes('rev-parse')) return 'aaa111\n'
      // 꼬리가 같은 다른 브랜치(refs/heads/main)가 먼저 나와도 섞이지 않는다
      if (a.includes('ls-remote')) return `ccc333\trefs/heads/main\n${remoteSha}\trefs/heads/feature/main\n`
      return undefined
    },
  })
  await $.session.start(START)
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('원격 ● 원격에 새 커밋')
  const ls = w.argv.find((a) => a.includes('ls-remote'))!
  expect(ls.slice(-2)).toEqual(['origin', 'refs/heads/feature/main'])
  remoteSha = 'aaa111'
  expect(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))).toContain('원격 ✓ origin/feature/main 과 같음')
})

test('MCP 로 만든 PR 도 이 대화의 결과물에 들어간다', async ($, on) => {
  world(on, { git: (a) => (a.includes('status') ? ['# branch.oid abc', '# branch.head feat-y', '# branch.upstream origin/feat-y', '# branch.ab +0 -0', ''].join('\0') : undefined) })
  await $.session.start(START)
  await $.classic.PostToolUse({ tool_name: 'Write', tool_input: { file_path: '/work/x.txt' }, tool_response: 'ok', tool_use_id: 't1' } as Any)
  await $.classic.PostToolUse({ tool_name: 'mcp__github__create_pull_request', tool_input: { title: 'feat: y', owner: 'o', repo: 'r' }, tool_response: { content: [{ type: 'text', text: '{"html_url":"https://github.com/o/r/pull/31"}' }] }, tool_use_id: 'm1' } as Any)
  const text = textAt(await $.command.run({ command: 'crew', args: 'status' } as Any))
  expect(text).toContain('PR #31 열림 https://github.com/o/r/pull/31')
})

// ---- 다시 확인(↻): Client 의 post → ui.message, 정지 화면은 actions.post ---------------------------------------------------

test('다시 확인(↻)을 누르면 Client 가 { action: "verify" } 를 보내고, 기억해 둔 값 대신 원격에 다시 묻는다', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'crew', args: '' } as Any) // 이미 열려 있으면 닫히므로 한 번 더
  await $.command.run({ command: 'crew', args: '' } as Any)
  await w.clock.advance(2000)
  const asked = () => w.argv.filter((a) => a.includes('ls-remote')).length
  expect(asked()).toBe(1)
  await w.clock.advance(8000) // 박자마다 git 을 다시 읽어도 원격 확인은 기억해 둔 값(2분)
  expect(w.argv.filter((a) => a[0] === 'git' && a.includes('status')).length >= 2).toBe(true)
  expect(asked()).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // 단추는 작업 구역 Client 안에 있다(창 트리에는 없다)
  expect(await ui.find({ type: 'Button', key: 'verify' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'verify', in: 'live-work' }))?.props.label).toBe('↻')
  await ui.press({ key: 'verify' })
  await w.clock.advance(1000)
  expect(asked()).toBe(2)
  // 같은 Client 가 보낸 다른 값 · 다른 행동은 원격에 묻지 않는다
  await ui.post({ action: 'other' }, { in: 'live-work' })
  await ui.post('verify', { in: 'live-work' })
  await w.clock.advance(1000)
  expect(asked()).toBe(2)
  await ui.post({ action: 'verify' }, { in: 'live-work' })
  await w.clock.advance(1000)
  expect(asked()).toBe(3)
  await ui.unmount()
})

test('휴대폰 · VS Code 의 정지 화면에서도 다시 확인 단추가 actions.post 로 원격에 다시 묻는다', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'crew', args: 'status' } as Any) // git · 원격 확인을 한 번 채운다
  const asked = () => w.argv.filter((a) => a.includes('ls-remote')).length
  let n = asked()
  expect(n).toBe(1)
  for (const surface of ['mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'verify' }))?.props.label).toBe('↻')
    await ui.press({ key: 'verify' })
    await w.clock.advance(1000)
    expect(asked()).toBe(n + 1)
    n = asked()
    await ui.unmount()
  }
})

// ---- 저장소 찾기: git worktree list ------------------------------------------------------------------------------------

const WORKTREES = [
  'worktree /work',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /work/.claude/worktrees/x',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/claude/x',
  '',
  'worktree /elsewhere/wt-feature',
  'HEAD 3333333333333333333333333333333333333333',
  'branch refs/heads/feature',
  '',
  'worktree /gone/old',
  'HEAD 4444444444444444444444444444444444444444',
  'detached',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n')
/** 저장소마다 다른 브랜치를 답하는 git status — argv 의 `-C <뿌리>` 로 가른다 */
const statusBy = (branches: Record<string, string>) => (a: string[]) => {
  if (!a.includes('status')) return undefined
  const root = a[a.indexOf('-C') + 1] ?? ''
  const b = branches[root]
  return b ? ['# branch.oid abc', `# branch.head ${b}`, `# branch.upstream origin/${b}`, '# branch.ab +0 -0', ''].join('\0') : undefined
}
const gitSection = (text: string) => text.slice(text.indexOf('■ Git 저장소'), text.indexOf('■ 서버'))

test('저장소 찾기: 숨은 .claude/worktrees 워크트리 · 다른 곳의 워크트리를 git worktree list 로 찾아 본 저장소 아래에 둔다(Claude 표시는 앞의 것만)', async ($, on) => {
  const branches = { '/work': 'main', '/work/.claude/worktrees/x': 'claude/x', '/elsewhere/wt-feature': 'feature' }
  const status = statusBy(branches)
  const w = world(on, { gitDirs: Object.keys(branches), git: (a) => (a.includes('worktree') ? WORKTREES : status(a)) })
  await $.session.start(START)
  const git = gitSection(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any)))
  const lines = git.split('\n').filter((l) => /\(⎇ /.test(l))
  expect(lines).toEqual(['work (⎇ main)', '  └ ✻ x (⎇ claude/x)', '  └ wt-feature (⎇ feature)'])
  expect(git).not.toContain('old') // 지워진(prunable) 워크트리는 빼고
  // 워크트리 목록은 세션 폴더의 저장소에 한 번 묻는다(git -C <뿌리> worktree list --porcelain)
  expect(w.argv.filter((a) => a.includes('worktree')).map((a) => a[3])).toEqual(['/work'])
  expect(w.argv.find((a) => a.includes('worktree'))!.slice(4)).toEqual(['worktree', 'list', '--porcelain'])
  // 본 저장소 폴더 안의 워크트리는 본 저장소의 git status 에서 뺀다(새 폴더 .claude/ 로 잡히지 않게) — 밖의 워크트리는 그대로
  const statusOf = (root: string) => w.argv.find((a) => a[0] === 'git' && a[3] === root && a.includes('status'))!
  expect(statusOf('/work').slice(-3)).toEqual(['--', '.', ':(exclude,literal).claude/worktrees/x'])
  expect(statusOf('/work/.claude/worktrees/x').some((x) => x.startsWith(':(exclude') || x === '--')).toBe(false)
  expect(statusOf('/elsewhere/wt-feature').some((x) => x.startsWith(':(exclude'))).toBe(false)
  // 창이 받는 값: 워크트리 둘 다 본 저장소 아래(depth 1), Claude 표시는 .claude/worktrees 의 것만
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const repos = ((await ui.find({ type: 'Client', key: 'live-work' }))!.props.props as Any).repos
  expect(repos.map((r: Any) => [r.name, r.depth, r.claude])).toEqual([
    ['work', 0, false],
    ['x', 1, true],
    ['wt-feature', 1, false],
  ])
  expect(await ui.find({ type: 'Text', text: '✻ ', in: 'live-work' })).toBeDefined()
  await ui.unmount()
  // 워크트리 목록은 1분 동안 기억한다 — 바로 다시 읽어도 git worktree list 를 또 띄우지 않는다
  await $.command.run({ command: 'crew', args: 'status' } as Any)
  expect(w.argv.filter((a) => a.includes('worktree'))).toHaveLength(1)
})

test('저장소 찾기: 세션이 워크트리 안에서 돌면 본 저장소도 함께 보이고, 그 아래에 워크트리들이 묶인다', async ($, on) => {
  const branches = { '/work': 'main', '/work/.claude/worktrees/x': 'claude/x', '/elsewhere/wt-feature': 'feature' }
  const status = statusBy(branches)
  const w = world(on, { cwd: '/work/.claude/worktrees/x', gitDirs: Object.keys(branches), git: (a) => (a.includes('worktree') ? WORKTREES : status(a)) })
  await $.session.start(START)
  const git = gitSection(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any)))
  expect(git.split('\n').filter((l) => /\(⎇ /.test(l))).toEqual(['work (⎇ main)', '  └ ✻ x (⎇ claude/x)', '  └ wt-feature (⎇ feature)'])
  // 워크트리에서 물어도 같은 목록 — 본 저장소에 다시 묻지 않는다
  expect(w.argv.filter((a) => a.includes('worktree')).map((a) => a[3])).toEqual(['/work/.claude/worktrees/x'])
  expect(w.argv.some((a) => a[3] === '/work' && a.includes('status'))).toBe(true)
})

test('저장소 찾기: bare 본 저장소는 목록에 넣지 않고(읽기 오류 줄 없이), 그 워크트리들은 제자리에 그대로', async ($, on) => {
  const list = ['worktree /srv/proj.git', 'bare', '', 'worktree /srv/proj-a', 'HEAD 5555', 'branch refs/heads/a', '', 'worktree /srv/proj-b', 'HEAD 6666', 'branch refs/heads/b', ''].join('\n')
  const branches = { '/srv/proj-a': 'a', '/srv/proj-b': 'b' }
  const status = statusBy(branches)
  const w = world(on, { cwd: '/srv/proj-a', gitDirs: Object.keys(branches), git: (a) => (a.includes('worktree') ? list : status(a)) })
  await $.session.start(START)
  const git = gitSection(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any)))
  expect(git.split('\n').filter((l) => /\(⎇ /.test(l))).toEqual(['proj-a (⎇ a)', 'proj-b (⎇ b)'])
  expect(git).not.toContain('proj.git')
  expect(git).not.toContain('✖')
  expect(w.argv.some((a) => a[3] === '/srv/proj.git')).toBe(false)
})

test('저장소 찾기: 저장소를 /tmp 로 찾았는데 git 은 /private/tmp 라고 말해도 워크트리를 같은 본 저장소 아래에 묶는다', async ($, on) => {
  const list = ['worktree /private/tmp/proj', 'HEAD 1', 'branch refs/heads/main', '', 'worktree /private/tmp/proj/.claude/worktrees/x', 'HEAD 2', 'branch refs/heads/claude/x', ''].join('\n')
  const status = statusBy({ '/tmp/proj': 'main', '/private/tmp/proj/.claude/worktrees/x': 'claude/x' })
  const w = world(on, { cwd: '/tmp/proj', gitDirs: ['/tmp/proj', '/private/tmp/proj/.claude/worktrees/x'], git: (a) => (a.includes('worktree') ? list : status(a)) })
  await $.session.start(START)
  const git = gitSection(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any)))
  expect(git.split('\n').filter((l) => /\(⎇ /.test(l))).toEqual(['proj (⎇ main)', '  └ ✻ x (⎇ claude/x)'])
  // 같은 저장소를 두 번 넣지 않고, 본 저장소의 git status 는 안쪽 워크트리를 뺀다
  expect(w.argv.filter((a) => a[0] === 'git' && a.includes('status')).map((a) => a[3])).toEqual(['/tmp/proj', '/private/tmp/proj/.claude/worktrees/x'])
  expect(w.argv.find((a) => a[3] === '/tmp/proj' && a.includes('status'))!.at(-1)).toBe(':(exclude,literal).claude/worktrees/x')
})

test('저장소 찾기: 연결된 워크트리가 없는 저장소는 그대로 한 줄(워크트리 · 제외 경로 없이)', async ($, on) => {
  const w = world(on, { git: (a) => (a.includes('worktree') ? 'worktree /work\nHEAD 1\nbranch refs/heads/main\n' : undefined) })
  await $.session.start(START)
  const git = gitSection(textAt(await $.command.run({ command: 'crew', args: 'status' } as Any)))
  expect(git.split('\n').filter((l) => /\(⎇ /.test(l))).toEqual(['work (⎇ main)'])
  expect(w.argv.find((a) => a[3] === '/work' && a.includes('status'))!.includes('--')).toBe(false)
})

test('스냅샷 시각은 NOW 기준(미리보기와 시험이 같은 그림)', async () => {
  expect(busySession.now).toBe(NOW)
  expect(stress.git.repos.length).toBe(7)
  expect(busySession.git.repos.filter((r: Any) => r.main).map((r: Any) => r.main)).toEqual(['/home/dev/work/auth-service', '/home/dev/work/auth-service'])
})
