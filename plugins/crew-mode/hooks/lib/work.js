// 작업 · 서버 파서와 판정 — 순수 함수($ 없음). register.js 가 `$.process.run` 등으로 읽어 온 글자를 값으로 바꾼다.
// v0.5 에서 work-status 를 다시 합치며 옮겨 왔다(리뷰에서 고친 것 그대로: amend · rebase, ref 줄로 푸시 판정, 새 폴더 접두어,
// gh pr view 로 PR 상태, @{u} 와 원격 비교). 새로 더한 것: 워크트리 목록(git worktree list) · 결과물 한 줄 요약(short).

// ---- 문자열 도우미 ------------------------------------------------------------------
export const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
export const dirnameOf = (p) => {
  const i = String(p).lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
};
export const join = (a, b) => (a.endsWith('/') ? a + b : `${a}/${b}`);
export const trunc = (s, n = 48) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
export const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ---- 도구 결과 → 편집 · 커밋 · 푸시 · PR 사실 -----------------------------------------
const PR_URL = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const PR_URL_G = /https:\/\/github\.com\/([^/\s"'<>)]+\/[^/\s"'<>)]+)\/pull\/(\d+)/g;

/** 도구 결과(문자열 · 배열 · 객체)를 글자 하나로 */
export function flatten(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return resp.map(flatten).join('\n');
  if (typeof resp === 'object') {
    const parts = [];
    for (const k of ['stdout', 'stderr', 'output', 'text', 'content', 'error', 'result', 'html_url', 'url']) if (resp[k] != null) parts.push(flatten(resp[k]));
    return parts.join('\n');
  }
  return String(resp);
}

/** Bash 명령에서 `cd X` 또는 `git -C X` 로 지정한 위치 */
export function commandDir(cmd, fallback) {
  const c = /(?:^|[;&|]\s*|\s)cd\s+("([^"]+)"|'([^']+)'|(\S+))/.exec(cmd);
  const gm = /\bgit\s+-C\s+("([^"]+)"|'([^']+)'|(\S+))/.exec(cmd);
  const m = gm || c;
  const dir = m ? m[2] || m[3] || m[4] : null;
  if (!dir) return fallback;
  if (dir.startsWith('/')) return dir;
  if (dir.startsWith('~')) return null;
  return fallback ? join(fallback, dir) : null;
}

// git 의 하위 명령 자리(`git [-C 경로] [--옵션] commit`)에 온 commit · push 만 — 커밋 메시지 속 "push" · `git stash push` 는 아니다
const GIT_SUB = String.raw`\bgit(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|\s+--?[\w-]+(?:=\S+)?)*\s+`;
const COMMIT_RE = new RegExp(GIT_SUB + String.raw`commit\b([^\n;&|]*)`);
const PUSH_RE = new RegExp(GIT_SUB + String.raw`push\b([^\n;&|]*)`);

/** 어떤 종류의 배송 명령인지 (연쇄 명령이면 여러 개). 옵션은 그 명령 조각에서만 본다 */
export function shipKinds(cmd) {
  const kinds = [];
  const c = COMMIT_RE.exec(cmd);
  if (c && !/--dry-run/.test(c[1])) kinds.push('commit');
  const p = PUSH_RE.exec(cmd);
  if (p && !/--dry-run|--delete|\s-d(?:\s|$)/.test(p[1])) kinds.push('push');
  if (/\bgh\s+pr\s+create\b/.test(cmd)) kinds.push('pr-create');
  if (/\bgh\s+pr\s+merge\b/.test(cmd) && !/--auto\b/.test(cmd)) kinds.push('pr-merge');
  return kinds;
}

const titleArg = (cmd) => /(?:--title|-t)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(cmd);

/**
 * 성공한 Bash 의 결과에서 사실을 뽑는다 → { commits, pushes, prs }.
 * PostToolUse 는 성공한 호출에만 오므로 실패 판정은 git 이 찍는 오류 줄로만 한다.
 */
export function parseShipResult(cmd, text, dir) {
  const out = { commits: [], pushes: [], prs: [] };
  const hardFail = /^(error|fatal):/im.test(text) || /^\s*!\s+\[(remote )?rejected\]/im.test(text);
  for (const kind of shipKinds(cmd)) {
    if (kind === 'commit') {
      for (const m of text.matchAll(/^\[([^\]]+?) ([0-9a-f]{7,40})\] (.*)$/gm)) out.commits.push({ hash: m[2], branch: m[1].replace(/ \(root-commit\)/, ''), subject: trunc(m[3], 80), dir });
    } else if (kind === 'push') {
      // 실제로 올라간 ref 줄(`abc..def  main -> main`, `* [new branch]  x -> x`)이 있을 때만 센다 — 거절된 줄은 실패로
      const ref = /^\s*[+\-*!= ]?\s*(?:\[new branch\]|[0-9a-f]+\.\.+[0-9a-f]+)\s+\S+\s*->\s*(\S+)/m.exec(text);
      const rejected = /^\s*!\s+\[(?:remote )?rejected\]\s+\S+\s*->\s*(\S+)/m.exec(text);
      if (ref) out.pushes.push({ ok: !hardFail, ref: ref[1], dir });
      else if (rejected) out.pushes.push({ ok: false, ref: rejected[1], dir });
    } else if (kind === 'pr-create') {
      const m = PR_URL.exec(text);
      const t = titleArg(cmd);
      if (m && !hardFail) out.prs.push({ url: m[0], repo: m[1], number: Number(m[2]), action: 'create', title: t ? trunc(t[1] ?? t[2] ?? t[3], 70) : null });
    } else if (kind === 'pr-merge') {
      const m = PR_URL.exec(cmd + '\n' + text);
      const n = /\bmerge\s+(?:--?\S+\s+)*#?(\d+)/.exec(cmd)?.[1];
      if (!hardFail && (m || n)) out.prs.push({ url: m ? m[0] : null, repo: m ? m[1] : null, number: m ? Number(m[2]) : Number(n), action: 'merge', title: null });
    }
  }
  return out;
}

/**
 * MCP 도구의 결과에서 PR 사실을 뽑는다.
 * 만들거나 머지하는 도구(create_pull_request · merge_pull_request …)만 센다 — 읽기 · 리뷰 · 수정 도구는 이 세션의 PR 이 아니에요.
 */
export const PR_TOOL = /pull_request|create_pr|merge_pr/i;
export function prFactsFromTool(toolName, input, text) {
  const name = String(toolName || '');
  if (!PR_TOOL.test(name)) return [];
  const own = name.replace(/^mcp__.+?__/, '');
  const action = /^(create_pull_request|create_pr)$/i.test(own) ? 'create' : /^(merge_pull_request|merge_pr)$/i.test(own) ? 'merge' : null;
  if (!action) return [];
  const inp = input && typeof input === 'object' ? input : {};
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(PR_URL_G)) {
    const url = `https://github.com/${m[1]}/pull/${m[2]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, repo: m[1], number: Number(m[2]), action, title: typeof inp.title === 'string' ? trunc(inp.title, 70) : null });
    if (action === 'create') break; // 만든 PR 은 결과의 첫 주소
  }
  // 머지 결과에는 주소가 없을 때가 많다 — 입력의 owner/repo/번호로 만든다
  const num = Number(inp.pull_number ?? inp.pullNumber ?? inp.number);
  if (!out.length && action === 'merge' && inp.owner && inp.repo && Number.isFinite(num) && num > 0) {
    const repo = `${inp.owner}/${inp.repo}`;
    out.push({ url: `https://github.com/${repo}/pull/${num}`, repo, number: num, action, title: null });
  }
  return out;
}

// ---- 시스템(macOS) ----------------------------------------------------------------------
export function parseVmStat(text) {
  const ps = Number(/page size of (\d+) bytes/.exec(text)?.[1]) || 16384;
  const get = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(text)?.[1] ?? 0);
  return { ps, anon: get('Anonymous pages'), purgeable: get('Pages purgeable'), wired: get('Pages wired down'), comp: get('Pages occupied by compressor'), fileBacked: get('File-backed pages') };
}

export function parseSwap(text) {
  const unit = { K: 1024, M: 1048576, G: 1073741824 };
  const v = {};
  for (const m of String(text).matchAll(/(total|used) = ([\d.]+)([KMG])/g)) v[m[1]] = Number(m[2]) * unit[m[3]];
  return { total: v.total ?? 0, used: v.used ?? 0 };
}

/** vm_stat · swap · 압력 → 메모리 구성. 읽은 값이 이상하면 null (호출한 쪽이 다른 값을 쓴다) */
export function buildMem(vm, swap, pressureText, total) {
  const app = Math.max(0, vm.anon - vm.purgeable) * vm.ps;
  const wired = vm.wired * vm.ps;
  const compressed = vm.comp * vm.ps;
  const cached = (vm.fileBacked + vm.purgeable) * vm.ps;
  const used = app + wired + compressed;
  if (!(used > 0) || used > total * 1.05) return null;
  const raw = String(pressureText || '').trim();
  const lvl = Number(raw);
  const free = Math.max(0, total - used - cached);
  const cache = Math.min(cached, Math.max(0, total - used));
  return {
    total,
    used,
    app,
    wired,
    compressed,
    cached,
    free,
    available: free + cache,
    swapTotal: swap.total,
    swapUsed: swap.used,
    pressure: raw === '' || !Number.isFinite(lvl) ? 'unknown' : lvl >= 4 ? 'critical' : lvl >= 2 ? 'warn' : 'normal',
    segments: [
      { key: 'app', label: '앱', bytes: app },
      { key: 'wired', label: '시스템', bytes: wired },
      { key: 'compressed', label: '압축', bytes: compressed },
      { key: 'cache', label: '캐시', bytes: cache },
      { key: 'free', label: '비어 있음', bytes: free },
    ],
  };
}

/** `iostat -n 0 -c 2 -w 1` 의 마지막 줄(us sy id 1m 5m 15m) → CPU 사용률 · 부하 (top 보다 훨씬 가볍다) */
export function parseIostat(text) {
  const last = [...String(text ?? '').matchAll(/^\s*\d+\s+\d+\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/gm)].at(-1);
  return { cpu: last ? clamp(100 - Number(last[1]), 0, 100) : null, load: last ? [Number(last[2]), Number(last[3]), Number(last[4])] : [0, 0, 0] };
}

// ---- 시스템(Linux) ----------------------------------------------------------------------
/** `head -n N a b c` 의 출력(파일마다 "==> 경로 <==" 머리)을 경로 → 내용으로 나눈다 */
export function splitHeadOutput(text) {
  const out = {};
  let cur = null;
  for (const line of String(text ?? '').split('\n')) {
    const m = /^==> (.+) <==$/.exec(line);
    if (m) {
      cur = m[1];
      out[cur] = [];
    } else if (cur) out[cur].push(line);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').replace(/\n+$/, '');
  return out;
}

/** /proc/stat 의 전체 cpu 줄 → { total, idle } (jiffies 누적). 두 번 읽은 차이로 사용률을 낸다 */
export function parseProcStat(text) {
  const m = /^cpu\s+([\d\s]+)$/m.exec(String(text ?? ''));
  if (!m) return null;
  const f = m[1].trim().split(/\s+/).map(Number);
  if (f.length < 4 || f.some((n) => !Number.isFinite(n))) return null;
  const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = f;
  return { total: user + nice + system + idle + iowait + irq + softirq + steal, idle: idle + iowait, cpus: (String(text).match(/^cpu\d+\s/gm) || []).length };
}

export function cpuPctFromStat(prev, cur) {
  if (!prev || !cur) return null;
  const dt = cur.total - prev.total;
  const di = cur.idle - prev.idle;
  if (!(dt > 0) || di < 0) return null;
  return clamp(round1((100 * (dt - di)) / dt), 0, 100);
}

export function parseLoadavg(text) {
  const f = String(text ?? '').trim().split(/\s+/).slice(0, 3).map(Number);
  return f.length === 3 && f.every(Number.isFinite) ? f : null;
}

/** /proc/meminfo → 바이트 값들 (kB 로 적혀 있다) */
export function parseMeminfo(text) {
  const v = {};
  for (const m of String(text ?? '').matchAll(/^(\w+(?:\(\w+\))?):\s+(\d+)(?:\s*kB)?$/gm)) v[m[1]] = Number(m[2]) * 1024;
  return v;
}

/** /proc/pressure/memory (PSI) → { some10, full10 } — 최근 10초 동안 메모리를 기다린 시간의 % */
export function parsePsi(text) {
  const t = String(text ?? '');
  const some = /^some\s+avg10=([\d.]+)/m.exec(t);
  if (!some) return null;
  const full = /^full\s+avg10=([\d.]+)/m.exec(t);
  return { some10: Number(some[1]), full10: full ? Number(full[1]) : null };
}

/** /proc/meminfo + PSI → 메모리 구성. 쓰는 중 = 전체 − 쓸 수 있는 양(MemAvailable) */
export function buildMemLinux(mi, psiSome10 = null) {
  const total = mi.MemTotal || 0;
  if (!(total > 0)) return null;
  const memFree = mi.MemFree ?? 0;
  const avail = mi.MemAvailable ?? memFree + (mi.Buffers ?? 0) + (mi.Cached ?? 0) + (mi.SReclaimable ?? 0);
  const used = clamp(total - avail, 0, total);
  const free = clamp(memFree, 0, total - used);
  const cache = Math.max(0, total - used - free);
  const availPct = (100 * avail) / total;
  const psi = Number.isFinite(psiSome10) ? psiSome10 : null;
  const pressure = availPct < 10 || (psi != null && psi > 20) ? 'critical' : availPct < 20 || (psi != null && psi > 5) ? 'warn' : 'normal';
  const swapTotal = mi.SwapTotal ?? 0;
  return {
    total,
    used,
    free,
    available: avail,
    cached: cache,
    swapTotal,
    swapUsed: Math.max(0, swapTotal - (mi.SwapFree ?? swapTotal)),
    pressure,
    psi,
    segments: [
      { key: 'used', label: '쓰는 중', bytes: used },
      { key: 'cache', label: '캐시', bytes: cache },
      { key: 'free', label: '비어 있음', bytes: free },
    ],
  };
}

/** cgroup 숫자 파일 하나 → 수 (max · 빈 값 · v1 의 "제한 없음" 큰 수는 null) */
export function parseCgroupNum(text) {
  const t = String(text ?? '').trim().split(/\s+/)[0];
  if (!t || t === 'max') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 2 ** 60 ? n : null;
}

/** cgroup v2 cpu.max("200000 100000" = 2코어, "max 100000" = 제한 없음) → 코어 수 */
export function parseCpuMax(text) {
  const [q, p] = String(text ?? '').trim().split(/\s+/);
  if (!q || q === 'max') return null;
  const quota = Number(q);
  const period = Number(p) || 100000;
  return quota > 0 && period > 0 ? round1(quota / period) : null;
}

/** 컨테이너 한도(cgroup v2, 없으면 v1). 한도가 하나도 없으면 null */
export function cgroupLimits(parts, hostTotal = 0) {
  const p = parts || {};
  let memLimit = parseCgroupNum(p['/sys/fs/cgroup/memory.max']);
  let memUsed = parseCgroupNum(p['/sys/fs/cgroup/memory.current']);
  let cpuCores = parseCpuMax(p['/sys/fs/cgroup/cpu.max']);
  if (memLimit == null) memLimit = parseCgroupNum(p['/sys/fs/cgroup/memory/memory.limit_in_bytes']);
  if (memUsed == null) memUsed = parseCgroupNum(p['/sys/fs/cgroup/memory/memory.usage_in_bytes']);
  // 페이지 캐시(곧 비울 수 있는 파일 내용)는 빼고 센다 — docker stats 와 같은 셈
  const statNum = (t, k) => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(String(t ?? ''))?.[1] ?? 0);
  if (memUsed != null) memUsed = Math.max(0, memUsed - (statNum(p['/sys/fs/cgroup/memory.stat'], 'inactive_file') || statNum(p['/sys/fs/cgroup/memory/memory.stat'], 'total_inactive_file')));
  if (cpuCores == null) {
    const q = Number(String(p['/sys/fs/cgroup/cpu/cpu.cfs_quota_us'] ?? '').trim());
    const per = Number(String(p['/sys/fs/cgroup/cpu/cpu.cfs_period_us'] ?? '').trim());
    if (q > 0 && per > 0) cpuCores = round1(q / per);
  }
  // 기계 전체보다 큰 한도는 실제로 막는 게 아니다
  if (memLimit != null && hostTotal > 0 && memLimit >= hostTotal) memLimit = null;
  if (memLimit == null && cpuCores == null) return null;
  return { memLimit, memUsed: memLimit != null ? memUsed : null, cpuCores };
}

/** /proc/cpuinfo → 코어 수 */
export function parseCpuinfo(text) {
  return { count: (String(text ?? '').match(/^processor\s*:/gm) || []).length };
}

/** head 로 한 번에 읽은 /proc · cgroup 파일들 → 한 번의 표본 (CPU 는 직전 표본과의 차이) */
export function linuxSample(parts, prevStat) {
  const p = parts || {};
  const stat = parseProcStat(p['/proc/stat']);
  const psiA = parsePsi(p['/proc/pressure/memory']);
  const psiB = parsePsi(p['/sys/fs/cgroup/memory.pressure']);
  const psiVals = [psiA?.some10, psiB?.some10].filter(Number.isFinite);
  const psi = psiVals.length ? Math.max(...psiVals) : null;
  const mem = buildMemLinux(parseMeminfo(p['/proc/meminfo']), psi);
  return {
    stat,
    cpu: cpuPctFromStat(prevStat, stat),
    load: parseLoadavg(p['/proc/loadavg']) || [0, 0, 0],
    mem,
    container: cgroupLimits(p, mem?.total ?? 0),
  };
}

// ---- 시스템(공통) ------------------------------------------------------------------------
export function parsePs(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], cpu: +m[3], rss: +m[4] * 1024, comm: m[5].trim() });
  }
  return rows;
}

/** 이 세션을 돌리는 프로세스 = 우리가 띄운 `ps` 의 부모. 그와 자손의 합 */
export function sessionGroup(rows) {
  const me = rows.find((r) => base(r.comm) === 'ps');
  if (!me) return null;
  const hostPid = me.ppid;
  const kids = new Map();
  for (const r of rows) {
    if (!kids.has(r.ppid)) kids.set(r.ppid, []);
    kids.get(r.ppid).push(r);
  }
  const root = rows.find((r) => r.pid === hostPid);
  if (!root) return null;
  let cpu = 0;
  let rss = 0;
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    // 방금 띄운 ps 자신은 빼고 센다
    if (p.pid !== me.pid) {
      cpu += p.cpu;
      rss += p.rss;
      count += 1;
    }
    for (const k of kids.get(p.pid) || []) stack.push(k);
  }
  return { pid: hostPid, cpu: round1(cpu), rss, count };
}

/** `df -kP <경로>` 의 마지막 줄 → { total, used, mount } */
export function parseDf(text) {
  const line = String(text).trim().split('\n').pop() || '';
  const f = line.trim().split(/\s+/);
  const total = Number(f[1]) * 1024;
  const used = Number(f[2]) * 1024;
  return total > 0 ? { total, used, mount: f.length >= 6 ? f.slice(5).join(' ') : null } : null;
}

const VERDICT_TEXT = { good: '여유 있어요', warn: '빠듯해요', bad: '모자라요' };
/**
 * 서버 판정. 나쁨: 메모리 압력 위험 · CPU 90% 넘는 표본 3번 연속 · 컨테이너 메모리 95% 넘음.
 * 빠듯: 압력 주의 · 스왑 절반 넘게 씀 · CPU 75% 넘음 · 컨테이너 메모리 85% 넘음. 나머지는 여유.
 */
export function verdictOf({ mem, cpu, history = [], container = null }) {
  const last3 = history.slice(-3);
  const hot3 = last3.length >= 3 && last3.every((h) => h.cpu > 90);
  const box = container && container.memLimit > 0 && container.memUsed != null ? container.memUsed / container.memLimit : null;
  const pressure = mem?.pressure ?? 'unknown';
  let level = 'good';
  if (pressure === 'critical' || hot3 || (box != null && box > 0.95)) level = 'bad';
  else if (pressure === 'warn' || (mem?.swapTotal > 0 && mem.swapUsed > mem.swapTotal * 0.5) || (cpu ?? 0) > 75 || (box != null && box > 0.85)) level = 'warn';
  return { level, text: VERDICT_TEXT[level] };
}

const SURF = { desktop: '데스크톱 앱', mobile: '휴대폰 앱', vscode: 'VS Code', terminal: '터미널' };
/**
 * 세션이 어디서 돌고 어떻게 보고 있는지 → { label(긴 말, 글자 요약용), short(창 머리 오른쪽용), remote, … }.
 * kind: CLAUDE_CODE_ENVIRONMENT_KIND (bridge = 이 컴퓨터에 원격 제어로 접속, 그 밖의 클라우드 값 = 클라우드 컨테이너)
 */
export function whereView({ kind = null, entrypoint = null, surfaces = [], host = '', os = '' } = {}) {
  const k = kind ? String(kind).trim().toLowerCase() : '';
  const viewers = [...new Set((surfaces || []).filter((s) => s !== 'terminal').map((s) => SURF[s] || s))];
  if (!viewers.length && /desktop/i.test(entrypoint || '')) viewers.push(SURF.desktop);
  if (!viewers.length && /vscode/i.test(entrypoint || '')) viewers.push(SURF.vscode);
  const via = viewers.length ? ` (${viewers.join(' · ')})` : '';
  const osName = os === 'Darwin' ? 'macOS' : os || '';
  const out = { host: host || '', kind: kind || null, surfaces: [...(surfaces || [])] };
  if (k === 'bridge') return { ...out, remote: true, label: `${host ? `${host} 에서` : '이 컴퓨터에서'} 돌고 있어요 · 원격 제어로 접속 중${via}`, short: host ? `${host} · 원격 제어` : '원격 제어' };
  if (k && (/ccr|cloud|remote|container|sandbox|web/.test(k) || os === 'Linux')) {
    return { ...out, remote: true, label: `클라우드 컨테이너${osName ? `(${osName})` : ''}에서 돌고 있어요${via ? ` · 보는 곳${via}` : ''}`, short: '클라우드 컨테이너' };
  }
  return { ...out, remote: false, label: '이 컴퓨터에서 돌고 있어요', short: host ? `${host} · 이 컴퓨터` : '이 컴퓨터' };
}

// ---- git ------------------------------------------------------------------------------------
export function parseGitStatus(out) {
  const res = { oid: null, branch: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [], staged: 0, unstaged: 0, untracked: 0, conflicts: 0 };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    if (s.startsWith('# branch.oid ')) res.oid = s.slice(13);
    else if (s.startsWith('# branch.head ')) {
      res.branch = s.slice(14);
      res.detached = res.branch === '(detached)';
    } else if (s.startsWith('# branch.upstream ')) res.upstream = s.slice(18);
    else if (s.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(s);
      if (m) {
        res.ahead = +m[1];
        res.behind = +m[2];
      }
    } else if (s[0] === '1' || s[0] === '2') {
      const f = s.split(' ');
      const xy = f[1];
      const path = f.slice(s[0] === '1' ? 8 : 9).join(' ');
      if (s[0] === '2') i += 1;
      if (xy[0] !== '.') res.staged += 1;
      if (xy[1] !== '.') res.unstaged += 1;
      res.files.push({ path, xy, kind: xy[0] !== '.' && xy[1] !== '.' ? 'both' : xy[0] !== '.' ? 'staged' : 'unstaged' });
    } else if (s[0] === 'u') {
      const f = s.split(' ');
      res.conflicts += 1;
      res.files.push({ path: f.slice(10).join(' '), xy: f[1], kind: 'conflict' });
    } else if (s[0] === '?') {
      res.untracked += 1;
      res.files.push({ path: s.slice(2), xy: '??', kind: 'untracked' });
    }
  }
  return res;
}

/**
 * `git worktree list --porcelain` → [{ path, head, branch, detached, bare, locked, prunable }].
 * 첫째가 본 작업 트리, 나머지가 연결된 워크트리(데스크톱 · `claude --worktree` 가 만든 `.claude/worktrees/…` 포함).
 */
export function parseWorktreeList(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9).trim(), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim();
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
    else if (line === 'locked' || line.startsWith('locked ')) cur.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true;
  }
  return out.filter((w) => w.path);
}

/** Claude 가 만든 워크트리인가 — 데스크톱 · `claude --worktree` 의 기본 자리(<프로젝트>/.claude/worktrees/<이름>) */
export const isClaudeWorktree = (path) => /\/\.claude\/worktrees\/[^/]+/.test(String(path || ''));

/** 경로 견주기용 — macOS 의 /tmp · /var 는 /private/… 와 같은 곳 */
export const samePathKey = (p) => String(p || '').replace(/\/+$/, '').replace(/^\/private(?=\/(?:tmp|var)\/)/, '');

export const slugOf = (url) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(url || '')?.[1] ?? null;
export const cleanRemoteUrl = (url) => String(url ?? '').replace(/\/\/[^/@\s]+@/, '//');

export function summarizeChecks(rollup) {
  const c = { pass: 0, fail: 0, pending: 0 };
  for (const x of rollup || []) {
    const v = (x.conclusion || x.state || x.status || '').toUpperCase();
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v)) c.pass += 1;
    else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) c.fail += 1;
    else c.pending += 1;
  }
  return c;
}

/** `gh pr list --json …` (또는 `[gh pr view --json …]`) → 가장 알맞은 PR 하나. 열린 것 먼저, 그다음 최근 */
export function parsePrList(json) {
  let rows = [];
  try {
    rows = JSON.parse(json);
  } catch {
    return { unavailable: true };
  }
  if (!Array.isArray(rows)) return { unavailable: true };
  rows.sort((a, b) => (a.state === 'OPEN' ? -1 : 0) - (b.state === 'OPEN' ? -1 : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const pr = rows[0];
  if (!pr) return { none: true };
  return { number: pr.number, title: trunc(pr.title, 70), state: pr.mergedAt ? 'MERGED' : pr.state, draft: Boolean(pr.isDraft), url: pr.url, base: pr.baseRefName, review: pr.reviewDecision || null, checks: summarizeChecks(pr.statusCheckRollup) };
}

export function commonDir(paths) {
  if (!paths.length) return null;
  const parts = paths.map((p) => dirnameOf(p).split('/'));
  const common = [];
  for (let i = 0; i < parts[0].length; i++) {
    if (parts.every((p) => p[i] === parts[0][i])) common.push(parts[0][i]);
    else break;
  }
  return common.join('/') || '/';
}

// ---- 이 세션의 결과물 (편집 → 커밋 → 푸시 → PR → 머지) -------------------------------------------------
const STAGES = [
  { id: 'edit', label: '편집' },
  { id: 'commit', label: '커밋' },
  { id: 'push', label: '푸시' },
  { id: 'pr', label: 'PR' },
  { id: 'merge', label: '머지' },
];

/** 이 세션이 남긴 PR(대화 기록 · 도구 결과)과 gh 로 읽은 저장소 PR 을 하나로 — 같은 번호면 gh 가 최신 */
export function mergePrs(logPrs, repos) {
  const out = new Map();
  for (const p of logPrs || []) {
    if (!p || !p.number) continue;
    const key = `${p.repo || ''}#${p.number}`;
    const prev = out.get(key);
    out.set(key, { number: p.number, url: p.url ?? prev?.url ?? null, title: p.title ?? prev?.title ?? null, state: p.state ?? (p.action === 'merge' || prev?.state === 'MERGED' ? 'MERGED' : 'OPEN'), draft: Boolean(p.draft), checks: p.checks ?? null, repo: p.repo ?? null, source: 'log' });
  }
  for (const r of repos || []) {
    const pr = r.pr;
    if (!pr || !pr.number) continue;
    const slug = r.remote?.slug ?? null;
    const key = `${slug || ''}#${pr.number}`;
    out.delete(`#${pr.number}`); // 주소 없이 번호만 남긴 기록(gh pr merge 42)
    out.set(key, { number: pr.number, url: pr.url ?? null, title: pr.title ?? null, state: pr.state, draft: Boolean(pr.draft), checks: pr.checks ?? null, repo: slug, source: 'gh' });
  }
  return [...out.values()].reverse().slice(0, 5);
}

/**
 * facts: { touchedCount, prs: 기록된 PR [{ number, url, repo, action, title }], pushes?: [{ ts, ok, ref, repo }] }
 * repos: git 상태(관련 저장소 표시 포함) · commits: 세션 동안의 커밋 · outside: git 밖 파일 경로
 */
export function shipSummary(facts, repos, commits, leftover, outside, home = '') {
  const touched = facts.touchedCount;
  const relevantRepos = repos.filter((r) => r.relevant && !r.error);
  const unpushed = commits.filter((c) => c.pushed === false).length;
  const pushedAny = commits.some((c) => c.pushed);
  const commitsCount = commits.length;

  const prRepos = relevantRepos.filter((r) => r.branch);
  // 기본 브랜치에 바로 올렸다 = 지금 기본 브랜치에 있고, 이 세션의 푸시(있다면)도 그 브랜치로 갔다
  const pushRefs = (facts.pushes || []).filter((p) => p.ok && p.ref).map((p) => p.ref);
  const allOnDefault = prRepos.length > 0 && prRepos.every((r) => r.onDefault) && (!pushRefs.length || pushRefs.some((ref) => prRepos.some((r) => r.branch === ref)));
  const logPrs = facts.prs || [];
  const transcriptPrs = logPrs.filter((p) => p.action !== 'merge');
  const transcriptMerged = logPrs.some((p) => p.action === 'merge' || p.state === 'MERGED');
  const ghPr = prRepos.map((r) => r.pr).find((p) => p && p.number);
  const last = transcriptPrs.at(-1);
  const pr = ghPr ?? (last ? { number: last.number, url: last.url, title: last.title ?? null, state: last.state ?? (transcriptMerged ? 'MERGED' : 'OPEN'), draft: Boolean(last.draft), checks: last.checks ?? null, fromLog: true } : null);
  // gh 로 PR 을 묻지 못한 저장소가 있으면 'PR 이 없다'고 단정하지 않는다
  const prUnknown = !pr && prRepos.some((r) => !r.onDefault && r.pr && r.pr.unavailable);

  const stages = {};
  stages.edit = touched > 0 ? { state: 'done', detail: `파일 ${touched}개를 고쳤어요` } : { state: 'none', detail: '고친 파일이 없어요' };

  if (touched === 0 && commitsCount === 0) stages.commit = { state: 'none', detail: '아직 커밋할 게 없어요' };
  else if (leftover > 0) stages.commit = { state: commitsCount > 0 ? 'partial' : 'todo', detail: `${leftover}개 파일이 아직 커밋 전이에요` };
  else if (commitsCount > 0) stages.commit = { state: 'done', detail: `커밋 ${commitsCount}개` };
  else stages.commit = { state: 'none', detail: touched > 0 ? 'git 이 추적하는 변경이 없어요' : '아직 커밋할 게 없어요' };

  // 이 세션의 커밋만 센다 — 앞선 세션이 남긴 푸시 전 커밋(ahead)은 Git 저장소 칸의 몫
  if (commitsCount === 0) stages.push = { state: 'none', detail: '푸시할 커밋이 없어요' };
  else if (unpushed > 0) stages.push = { state: pushedAny ? 'partial' : 'todo', detail: `커밋 ${unpushed}개가 이 컴퓨터에만 있어요` };
  else stages.push = { state: 'done', detail: '원격에 올라갔어요' };

  if (stages.push.state === 'none' && !pr) stages.pr = { state: 'none', detail: '아직이에요' };
  else if (allOnDefault && !pr && stages.push.state === 'done') stages.pr = { state: 'skip', detail: `${prRepos[0].branch} 에 바로 올렸어요` };
  else if (pr && pr.number) stages.pr = { state: 'done', detail: `#${pr.number} ${pr.state === 'MERGED' ? '머지됨' : pr.state === 'CLOSED' ? '닫힘' : pr.draft ? '초안' : '열림'}`, ...(pr.url ? { url: pr.url } : {}) };
  else if (stages.push.state === 'done') stages.pr = prUnknown ? { state: 'none', detail: '확인 못 함' } : { state: 'todo', detail: 'PR 이 아직 없어요' };
  else stages.pr = { state: 'none', detail: '푸시 뒤에 만들 수 있어요' };

  if (stages.pr.state === 'skip') stages.merge = { state: 'skip', detail: '필요 없어요' };
  else if (pr?.state === 'MERGED' || (transcriptMerged && !ghPr)) stages.merge = { state: 'done', detail: '머지됐어요' };
  else if (pr && pr.number) stages.merge = { state: 'todo', detail: pr.checks?.fail ? '검사 실패가 있어요' : pr.checks?.pending ? '검사 진행 중이에요' : '머지를 기다려요' };
  else stages.merge = { state: 'none', detail: '아직이에요' };

  // 고친 파일이 전부 git 밖이면 커밋 · 푸시를 따라갈 수 없다 — 반영됐다고 말하지 않는다
  const onlyOutside = outside.length > 0 && touched - outside.length === 0 && commitsCount === 0;
  if (onlyOutside) {
    stages.commit = { state: 'none', detail: 'git 이 추적하지 않는 폴더예요' };
    stages.push = { state: 'none', detail: '커밋이 있어야 올릴 수 있어요' };
    stages.pr = { state: 'none', detail: '아직이에요' };
    stages.merge = { state: 'none', detail: '아직이에요' };
  }
  const out = STAGES.map((s) => ({ ...s, ...stages[s.id] }));
  const firstOpen = out.find((s) => s.state === 'todo' || s.state === 'partial');
  let headline;
  let tone;
  if (touched === 0 && commitsCount === 0) {
    headline = '이 세션에서 바뀐 코드는 아직 없어요';
    tone = 'calm';
  } else if (onlyOutside) {
    headline = `고친 파일 ${outside.length}개가 git 저장소 밖에 있어요`;
    tone = 'info';
  } else if (!firstOpen) {
    headline = stages.merge.state === 'done' ? '머지까지 끝났어요' : stages.pr.state === 'skip' ? `${prRepos[0]?.branch ?? '기본 브랜치'} 에 바로 올라갔어요` : prUnknown && stages.push.state === 'done' ? '푸시까지 끝났어요' : '지금까지의 변경은 모두 반영됐어요';
    tone = 'good';
  } else if (firstOpen.id === 'commit') {
    headline = `커밋하지 않은 변경 ${leftover}개가 남아 있어요`;
    tone = 'warn';
  } else if (firstOpen.id === 'push') {
    headline = `커밋 ${unpushed}개가 아직 푸시 전이에요`;
    tone = 'warn';
  } else if (firstOpen.id === 'pr') {
    headline = '푸시까지 끝났어요. PR 은 아직 없어요';
    tone = 'info';
  } else {
    headline = pr?.number ? `PR #${pr.number} 이 머지를 기다려요` : '머지를 기다려요';
    tone = 'info';
  }
  // 창 제목 줄 오른쪽에 붙는 한 마디(색은 tone) — 머리말(headline)의 짧은 꼴
  let short;
  if (touched === 0 && commitsCount === 0) short = '변경 없음';
  else if (onlyOutside) short = 'git 밖 파일';
  else if (!firstOpen) short = stages.merge.state === 'done' ? '머지 완료' : stages.pr.state === 'skip' ? '바로 반영' : prUnknown && stages.push.state === 'done' ? '푸시 완료' : '모두 반영';
  else if (firstOpen.id === 'commit') short = `커밋 전 ${leftover}`;
  else if (firstOpen.id === 'push') short = `푸시 전 ${unpushed}`;
  else if (firstOpen.id === 'pr') short = 'PR 없음';
  else short = pr?.number ? `#${pr.number} 머지 대기` : '머지 대기';
  const sub = onlyOutside ? `${outside.length ? commonDirShort(outside, home) : ''} 는 git 저장소가 아니어서 커밋 · 푸시를 따라갈 수 없어요` : [touched ? `고친 파일 ${touched}개` : '', commitsCount ? `커밋 ${commitsCount}개` : '', outside.length ? `git 밖 파일 ${outside.length}개` : ''].filter(Boolean).join(', ') || 'Claude 가 파일을 고치면 여기서 따라가요';
  return {
    stages: out,
    headline,
    short,
    tone,
    sub,
    touched,
    leftover,
    outside: outside.length,
    commits: commits.slice(0, 8).map((c) => ({ sha: c.sha, short: c.short, subject: c.subject, ts: c.ts, pushed: Boolean(c.pushed), repo: c.repo ?? '', byClaude: Boolean(c.byClaude ?? c.claude) })),
    pushes: (facts.pushes || [])
      .slice(-6)
      .reverse()
      .map((p) => ({ ts: p.ts, ok: Boolean(p.ok), ref: p.ref ?? null, repo: p.repo ?? null })),
    prs: mergePrs(logPrs, relevantRepos),
  };
}

function commonDirShort(paths, home) {
  const d = commonDir(paths);
  return home && d && d.startsWith(home) ? '~' + d.slice(home.length) : d;
}
