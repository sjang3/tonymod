// 시험 · 미리보기용 스냅샷(작업 · 서버 부분) — 순수 데이터. views.js 가 받는 `d`(데이터 계약)의 session · git · sys · where.
// v0.5 에서 work-status 의 견본을 옮겨 왔다(+ shipSummary 의 short · 워크트리). 에이전트 부분은 fixtures-agents.js, 둘을 합친 것은 fixtures.js.
// 시각은 모두 NOW 기준으로 고정(Date.now() 없음) — 같은 파일이면 언제 돌려도 같은 그림이 나온다.

export const NOW = 1791360000000; // 2026-10-07 17:00 KST

const S = 1000;
const M = 60 * S;
const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const bytes = (n) => Math.round(n);

const none = (id, label, detail) => ({ id, label, state: 'none', detail });

// =================================================================================================
// 1) busySession — 일이 한창: 이 대화가 파일 5개를 고치고 커밋 2(1개 푸시) · PR 열림(검사 통과),
//    저장소 3 (관련 · 변경 + 푸시 전 / 깨끗 · 같음 / 원격 브랜치 없음), macOS 메모리 빠듯 + 스왑, 원격 제어
// =================================================================================================
const BUSY_PR_URL = 'https://github.com/acme/auth-service/pull/128';
const BUSY_PR_TITLE = 'fix: 만료된 세션에서 500 대신 401 을 돌려줘요';

export const busySession = {
  now: NOW,
  version: '0.5.0',
  session: {
    stages: [
      { id: 'edit', label: '편집', state: 'done', detail: '파일 5개를 고쳤어요' },
      { id: 'commit', label: '커밋', state: 'partial', detail: '3개 파일이 아직 커밋 전이에요' },
      { id: 'push', label: '푸시', state: 'partial', detail: '커밋 1개가 이 컴퓨터에만 있어요' },
      { id: 'pr', label: 'PR', state: 'done', detail: '#128 열림', url: BUSY_PR_URL },
      { id: 'merge', label: '머지', state: 'todo', detail: '머지를 기다려요' },
    ],
    headline: '커밋하지 않은 변경 3개가 남아 있어요',
    short: '커밋 전 3',
    tone: 'warn',
    sub: '고친 파일 5개, 커밋 2개',
    touched: 5,
    leftover: 3,
    outside: 0,
    commits: [
      { sha: 'e4f1c2a8b7d60f13a9c24e5d6b7a8f9012c3d4e5', short: 'e4f1c2a', subject: 'test: 세션 만료 재현 테스트 추가', ts: NOW - 64 * S, pushed: false, repo: 'auth-service', byClaude: true },
      { sha: '9b2d7e14c0a3f8d2b61e5a7c9d04f3b8e2a1c6d7', short: '9b2d7e1', subject: BUSY_PR_TITLE, ts: NOW - 154 * S, pushed: true, repo: 'auth-service', byClaude: true },
    ],
    pushes: [{ ts: NOW - 146 * S, ok: true, ref: 'fix/session-expiry', repo: 'auth-service' }],
    prs: [{ number: 128, url: BUSY_PR_URL, title: BUSY_PR_TITLE, state: 'OPEN', draft: false, checks: { pass: 6, fail: 0, pending: 0 }, repo: 'acme/auth-service', source: 'gh' }],
  },
  git: {
    at: NOW - 3 * S,
    repos: [
      {
        root: '/home/dev/work/auth-service',
        name: 'auth-service',
        branch: 'fix/session-expiry',
        detached: false,
        upstream: 'origin/fix/session-expiry',
        unpushed: null,
        ahead: 1,
        behind: 0,
        staged: 1,
        unstaged: 2,
        untracked: 1,
        conflicts: 0,
        dirty: 4,
        remote: { url: 'https://github.com/acme/auth-service.git', slug: 'acme/auth-service' },
        remoteCheck: { ok: true, exists: true, same: true, at: NOW - 45 * S }, // 원격 = 추적 ref (로컬이 1개 앞섬)
        relevant: true,
        mine: 5,
        mineDirty: 3,
        onDefault: false,
        pr: { number: 128, url: BUSY_PR_URL, state: 'OPEN', draft: false, title: BUSY_PR_TITLE, checks: { pass: 6, fail: 0, pending: 0 } },
      },
      {
        root: '/home/dev/work/acme/landing',
        name: 'landing',
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        unpushed: null,
        ahead: 0,
        behind: 0,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicts: 0,
        dirty: 0,
        remote: { url: 'https://github.com/acme/landing.git', slug: 'acme/landing' },
        remoteCheck: { ok: true, exists: true, same: true, at: NOW - 90 * S },
        relevant: false,
        mine: 0,
        mineDirty: 0,
        onDefault: true,
        pr: null,
      },
      {
        root: '/home/dev/work/acme/tot',
        name: 'tot',
        branch: 'feat/species-cards',
        detached: false,
        upstream: null,
        unpushed: 3,
        ahead: 0,
        behind: 0,
        staged: 0,
        unstaged: 0,
        untracked: 2,
        conflicts: 0,
        dirty: 2,
        remote: { url: 'git@github.com:acme/tot.git', slug: 'acme/tot' },
        remoteCheck: null,
        relevant: false,
        mine: 0,
        mineDirty: 0,
        onDefault: false,
        pr: { none: true },
      },
      // 워크트리 둘: Claude 가 만든 것(.claude/worktrees/ — 푸시 전 커밋 2) · 손으로 만든 것(깨끗)
      {
        root: '/home/dev/work/auth-service/.claude/worktrees/fix-login-a1b2',
        name: 'fix-login-a1b2',
        main: '/home/dev/work/auth-service',
        claude: true,
        branch: 'claude/fix-login-a1b2',
        detached: false,
        upstream: 'origin/claude/fix-login-a1b2',
        unpushed: null,
        ahead: 2,
        behind: 0,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicts: 0,
        dirty: 0,
        remote: { url: 'https://github.com/acme/auth-service.git', slug: 'acme/auth-service' },
        remoteCheck: { ok: true, exists: true, same: true, at: NOW - 40 * S },
        relevant: false,
        mine: 0,
        mineDirty: 0,
        onDefault: false,
        pr: null,
      },
      {
        root: '/home/dev/work/auth-service-hotfix',
        name: 'auth-service-hotfix',
        main: '/home/dev/work/auth-service',
        claude: false,
        branch: 'hotfix/token-ttl',
        detached: false,
        upstream: 'origin/hotfix/token-ttl',
        unpushed: null,
        ahead: 0,
        behind: 0,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicts: 0,
        dirty: 0,
        remote: { url: 'https://github.com/acme/auth-service.git', slug: 'acme/auth-service' },
        remoteCheck: { ok: true, exists: true, same: true, at: NOW - 40 * S },
        relevant: false,
        mine: 0,
        mineDirty: 0,
        onDefault: false,
        pr: null,
      },
    ],
  },
  verifying: false,
  sys: {
    os: 'Darwin',
    host: 'dev-mac',
    cpu: 38.5,
    cores: 8,
    load: [3.12, 2.84, 2.51],
    mem: {
      total: 8 * GB,
      used: bytes(7.1 * GB),
      free: bytes(0.3 * GB),
      swapTotal: 7 * GB,
      swapUsed: bytes(5.2 * GB),
      pressure: 'warn',
      segments: [
        { key: 'app', label: '앱', bytes: bytes(3.1 * GB) },
        { key: 'wired', label: '시스템', bytes: bytes(1.7 * GB) },
        { key: 'compressed', label: '압축', bytes: bytes(2.3 * GB) },
        { key: 'cache', label: '캐시', bytes: bytes(0.6 * GB) },
        { key: 'free', label: '비어 있음', bytes: bytes(0.3 * GB) },
      ],
    },
    disk: { total: 228 * GB, used: 131 * GB, mount: '/System/Volumes/Data' },
    container: null,
    session: { cpu: 31.2, rss: 958 * MB, count: 12 },
    verdict: { level: 'warn', text: '빠듯해요' },
  },
  sysNote: '',
  where: { label: 'dev-mac 에서 돌고 있어요 · 원격 제어로 접속 중 (데스크톱 앱)', short: 'dev-mac · 원격 제어', host: 'dev-mac', kind: 'bridge', surfaces: ['desktop'], remote: true },
};

// =================================================================================================
// 2) emptySession — 다 읽었지만 이 대화는 아직 아무것도 바꾸지 않았다: 저장소 2(깨끗), 서버 여유, 이 컴퓨터
// =================================================================================================
const cleanRepo = (name, root, slug) => ({
  root,
  name,
  branch: 'main',
  detached: false,
  upstream: 'origin/main',
  unpushed: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicts: 0,
  dirty: 0,
  remote: { url: `https://github.com/${slug}.git`, slug },
  remoteCheck: { ok: true, exists: true, same: true, at: NOW - 30 * S },
  relevant: false,
  mine: 0,
  mineDirty: 0,
  onDefault: true,
  pr: null,
});

export const emptySession = {
  now: NOW,
  version: '0.5.0',
  session: {
    stages: [none('edit', '편집', '고친 파일이 없어요'), none('commit', '커밋', '아직 커밋할 게 없어요'), none('push', '푸시', '푸시할 커밋이 없어요'), none('pr', 'PR', '아직이에요'), none('merge', '머지', '아직이에요')],
    headline: '이 세션에서 바뀐 코드는 아직 없어요',
    short: '변경 없음',
    tone: 'calm',
    sub: 'Claude 가 파일을 고치면 여기서 따라가요',
    touched: 0,
    leftover: 0,
    outside: 0,
    commits: [],
    pushes: [],
    prs: [],
  },
  git: {
    at: NOW - 2 * S,
    repos: [cleanRepo('landing', '/home/dev/work/acme/landing', 'acme/landing'), cleanRepo('clearml-web', '/home/dev/work/clearml-web', 'acme/clearml-web')],
  },
  verifying: false,
  sys: {
    os: 'Darwin',
    host: 'dev-mac',
    cpu: 12.4,
    cores: 8,
    load: [1.42, 1.61, 1.7],
    mem: {
      total: 8 * GB,
      used: bytes(5.2 * GB),
      free: bytes(1.1 * GB),
      swapTotal: 2 * GB,
      swapUsed: bytes(0.4 * GB),
      pressure: 'normal',
      segments: [
        { key: 'app', label: '앱', bytes: bytes(2.6 * GB) },
        { key: 'wired', label: '시스템', bytes: bytes(1.5 * GB) },
        { key: 'compressed', label: '압축', bytes: bytes(1.1 * GB) },
        { key: 'cache', label: '캐시', bytes: bytes(1.7 * GB) },
        { key: 'free', label: '비어 있음', bytes: bytes(1.1 * GB) },
      ],
    },
    disk: { total: 228 * GB, used: 131 * GB, mount: '/System/Volumes/Data' },
    container: null,
    session: { cpu: 2.1, rss: 412 * MB, count: 4 },
    verdict: { level: 'good', text: '여유 있어요' },
  },
  sysNote: '',
  where: { label: '이 컴퓨터에서 돌고 있어요', short: 'dev-mac · 이 컴퓨터', host: 'dev-mac', kind: null, surfaces: ['desktop'], remote: false },
};

// =================================================================================================
// 3) linuxContainer — 클라우드 컨테이너(Linux, cgroup 한도): 푸시까지 끝 · PR 은 gh 로 확인 못 함,
//    원격이 2 앞섬 · 원격 확인 실패, 호스트 4코어에 컨테이너 2코어 한도
// =================================================================================================
export const linuxContainer = {
  now: NOW,
  version: '0.5.0',
  session: {
    stages: [
      { id: 'edit', label: '편집', state: 'done', detail: '파일 2개를 고쳤어요' },
      { id: 'commit', label: '커밋', state: 'done', detail: '커밋 1개' },
      { id: 'push', label: '푸시', state: 'done', detail: '원격에 올라갔어요' },
      { id: 'pr', label: 'PR', state: 'none', detail: '확인 못 함' },
      { id: 'merge', label: '머지', state: 'none', detail: '아직이에요' },
    ],
    headline: '푸시까지 끝났어요',
    short: '푸시 완료',
    tone: 'good',
    sub: '고친 파일 2개, 커밋 1개',
    touched: 2,
    leftover: 0,
    outside: 0,
    commits: [{ sha: 'c0de5a1f00d2b3c4d5e6f708192a3b4c5d6e7f80', short: 'c0de5a1', subject: 'test: make payments retry deterministic', ts: NOW - 300 * S, pushed: true, repo: 'payments', byClaude: true }],
    pushes: [{ ts: NOW - 290 * S, ok: true, ref: 'fix/flaky-payments', repo: 'payments' }],
    prs: [],
  },
  git: {
    at: NOW - 5 * S,
    repos: [
      {
        root: '/workspace/payments',
        name: 'payments',
        branch: 'fix/flaky-payments',
        detached: false,
        upstream: 'origin/fix/flaky-payments',
        unpushed: null,
        ahead: 0,
        behind: 2,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicts: 0,
        dirty: 0,
        remote: { url: 'https://github.com/acme/payments.git', slug: 'acme/payments' },
        remoteCheck: { ok: false, at: NOW - 20 * S, error: '원격에 닿지 못했어요' },
        relevant: true,
        mine: 2,
        mineDirty: 0,
        onDefault: false,
        pr: { unavailable: true },
      },
    ],
  },
  verifying: false,
  sys: {
    os: 'Linux',
    host: 'runner-7f9c2',
    cpu: 64.2,
    cores: 4,
    load: [2.91, 2.47, 1.83],
    mem: {
      total: 16 * GB,
      used: bytes(5.3 * GB),
      free: bytes(6.9 * GB),
      swapTotal: 0,
      swapUsed: 0,
      pressure: 'normal',
      segments: [
        { key: 'used', label: '쓰는 중', bytes: bytes(5.3 * GB) },
        { key: 'cache', label: '캐시', bytes: bytes(3.8 * GB) },
        { key: 'free', label: '비어 있음', bytes: bytes(6.9 * GB) },
      ],
    },
    disk: { total: 100 * GB, used: 61 * GB, mount: '/workspace' },
    container: { memLimit: 4 * GB, memUsed: bytes(3.1 * GB), cpuCores: 2 },
    session: { cpu: 52.1, rss: bytes(1.42 * GB), count: 9 },
    verdict: { level: 'good', text: '여유 있어요' },
  },
  sysNote: '',
  where: { label: '클라우드 컨테이너(Linux)에서 돌고 있어요 · 보는 곳 (데스크톱 앱 · 휴대폰 앱)', short: '클라우드 컨테이너', host: 'runner-7f9c2', kind: 'anthropic_cloud', surfaces: ['desktop', 'mobile'], remote: true },
};

// =================================================================================================
// 4) freshSession — 창을 막 열었다: 결과물 · git · 서버 모두 읽는 중
// =================================================================================================
export const freshSession = {
  now: NOW,
  version: '0.5.0',
  session: null,
  git: null,
  verifying: false,
  sys: null,
  sysNote: '서버 상태를 읽는 중…',
  where: { label: '이 컴퓨터에서 돌고 있어요', short: '이 컴퓨터', host: '', kind: null, surfaces: ['desktop'], remote: false },
};

// =================================================================================================
// 5) stress — 크기 한도 시험: 긴 한국어 · 영어 문자열, 저장소 7(충돌 · detached · 오류 · 원격 없음 포함),
//    메모리 모자람, PR 셋(초안 · 머지 · 닫힘), 원격에 묻는 중
// =================================================================================================
const LONG_KO = '아주아주 긴 설명이 여기에 들어가서 한 줄에 다 들어가지 않고 계속 이어지는 문장이에요 정말로 길어요';
const LONG_EN = 'Investigate intermittently failing end-to-end checkout tests across every supported locale and currency';

const stressRepo = (i, over) => ({
  root: `/home/dev/work/very/deeply/nested/workspace/folder/repository-number-${i}-with-a-long-name`,
  name: `repository-number-${i}-with-a-long-name`,
  branch: `feature/${LONG_EN.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 70)}-${i}`,
  detached: false,
  upstream: `origin/feature/long-branch-${i}`,
  unpushed: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicts: 0,
  dirty: 0,
  remote: { url: `https://github.com/acme-organization-with-long-name/repository-number-${i}.git`, slug: `acme-organization-with-long-name/repository-number-${i}` },
  remoteCheck: { ok: true, exists: true, same: true, at: NOW - 30 * S },
  relevant: i < 3,
  mine: 0,
  mineDirty: 0,
  onDefault: false,
  pr: null,
  ...over,
});

export const stress = {
  now: NOW,
  version: '0.5.0',
  session: {
    stages: [
      { id: 'edit', label: '편집', state: 'done', detail: '파일 248개를 고쳤어요' },
      { id: 'commit', label: '커밋', state: 'partial', detail: '131개 파일이 아직 커밋 전이에요' },
      { id: 'push', label: '푸시', state: 'partial', detail: '커밋 6개가 이 컴퓨터에만 있어요' },
      { id: 'pr', label: 'PR', state: 'done', detail: '#10482 초안', url: 'https://github.com/acme-organization-with-long-name/repository-number-0/pull/10482' },
      { id: 'merge', label: '머지', state: 'todo', detail: '검사 진행 중이에요' },
    ],
    headline: `커밋하지 않은 변경 131개가 남아 있어요 — ${LONG_KO}`,
    short: '커밋 전 131',
    tone: 'warn',
    sub: `고친 파일 248개, 커밋 8개, git 밖 파일 12개 — ${LONG_EN}`,
    touched: 248,
    leftover: 131,
    outside: 12,
    commits: Array.from({ length: 8 }, (_, i) => ({
      sha: `${(0xabc0000 + i * 4097).toString(16)}0123456789abcdef0123456789abcdef`.slice(0, 40),
      short: (0xabc0000 + i * 4097).toString(16).slice(0, 7),
      subject: `${i % 2 ? 'feat' : 'fix'}(checkout): ${i % 2 ? LONG_EN : LONG_KO}`,
      ts: NOW - (i + 1) * 90 * S,
      pushed: i >= 6,
      repo: `repository-number-${i % 3}-with-a-long-name`,
      byClaude: i !== 4,
    })),
    pushes: [
      { ts: NOW - 14 * M, ok: true, ref: 'feature/long-branch-0', repo: 'repository-number-0-with-a-long-name' },
      { ts: NOW - 12 * M, ok: false, ref: null, repo: 'repository-number-1-with-a-long-name' },
    ],
    prs: [
      { number: 10482, url: 'https://github.com/acme-organization-with-long-name/repository-number-0/pull/10482', title: `${LONG_EN} — ${LONG_KO}`, state: 'OPEN', draft: true, checks: { pass: 31, fail: 0, pending: 12 }, repo: 'acme-organization-with-long-name/repository-number-0', source: 'gh' },
      { number: 10411, url: 'https://github.com/acme-organization-with-long-name/repository-number-1/pull/10411', title: LONG_KO, state: 'MERGED', draft: false, checks: { pass: 40, fail: 0, pending: 0 }, repo: 'acme-organization-with-long-name/repository-number-1', source: 'gh' },
      { number: 77, url: null, title: null, state: 'CLOSED', draft: false, checks: null, repo: null, source: 'log' },
    ],
  },
  git: {
    at: NOW - 2 * S,
    repos: [
      stressRepo(0, { ahead: 6, behind: 3, staged: 40, unstaged: 71, untracked: 20, dirty: 131, mine: 131, mineDirty: 120, remoteCheck: { ok: true, exists: true, same: false, at: NOW - 30 * S }, pr: { number: 10482, url: 'https://github.com/acme-organization-with-long-name/repository-number-0/pull/10482', state: 'OPEN', draft: true, title: LONG_EN, checks: { pass: 31, fail: 2, pending: 12 } } }),
      stressRepo(1, { conflicts: 3, unstaged: 2, dirty: 5, mine: 3, mineDirty: 3, pr: { number: 10411, url: 'https://github.com/acme-organization-with-long-name/repository-number-1/pull/10411', state: 'MERGED', draft: false, title: LONG_KO, checks: { pass: 40, fail: 0, pending: 0 } } }),
      stressRepo(2, { branch: '(detached)', detached: true, upstream: null, remoteCheck: null, onDefault: false, pr: null, mine: 1 }),
      stressRepo(3, { upstream: null, unpushed: 0, remoteCheck: null, untracked: 9, dirty: 9, pr: { none: true } }),
      stressRepo(4, { branch: 'main', upstream: 'origin/main', onDefault: true, remoteCheck: { ok: false, at: NOW - 3 * M, error: `${LONG_EN} — ssh: connect to host github.com port 22: Operation timed out` } }),
      stressRepo(5, { branch: null, upstream: null, remote: null, remoteCheck: null, pr: null, error: 'git 상태를 읽지 못했어요' }),
      stressRepo(6, { upstream: null, remote: null, remoteCheck: null, unpushed: null, behind: 250 }),
    ],
  },
  verifying: true,
  sys: {
    os: 'Darwin',
    host: 'dev-mac-mini-with-a-very-long-host-name.local',
    cpu: 97.3,
    cores: 8,
    load: [14.82, 12.4, 9.97],
    mem: {
      total: 8 * GB,
      used: bytes(7.86 * GB),
      free: bytes(0.02 * GB),
      swapTotal: 12 * GB,
      swapUsed: bytes(11.7 * GB),
      pressure: 'critical',
      segments: [
        { key: 'app', label: '앱', bytes: bytes(3.9 * GB) },
        { key: 'wired', label: '시스템', bytes: bytes(1.36 * GB) },
        { key: 'compressed', label: '압축', bytes: bytes(2.6 * GB) },
        { key: 'cache', label: '캐시', bytes: bytes(0.12 * GB) },
        { key: 'free', label: '비어 있음', bytes: bytes(0.02 * GB) },
      ],
    },
    disk: { total: 228 * GB, used: 221 * GB, mount: '/System/Volumes/Data' },
    container: null,
    session: { cpu: 412.6, rss: bytes(5.9 * GB), count: 48 },
    verdict: { level: 'bad', text: '모자라요' },
  },
  sysNote: '',
  where: { label: 'dev-mac-mini-with-a-very-long-host-name.local 에서 돌고 있어요 · 원격 제어로 접속 중 (데스크톱 앱 · 휴대폰 앱 · VS Code)', short: 'dev-mac-mini-with-a-very-long-host-name.local · 원격 제어', host: 'dev-mac-mini-with-a-very-long-host-name.local', kind: 'bridge', surfaces: ['desktop', 'mobile', 'vscode'], remote: true },
};

/** 이름 → 스냅샷 (미리보기 · 시험이 돌며 쓴다) */
export const FIXTURES = { busySession, emptySession, linuxContainer, freshSession, stress };
