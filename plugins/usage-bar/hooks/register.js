// usage-bar — 입력창 바로 위의 사용량 띠(세 줄): 5시간 · 이번 주 · 이 대화.
//
// `$` 를 쓰는 코드는 이 파일에만 있다. 계산은 lib/usage.js, 그리는 일은 lib/band.js(둘 다 순수 함수).
// 띠가 그리는 값은 $.state 에 둔다(계약: types/index.d.ts). 값이 바뀌면 띠가 저절로 다시 그려지고,
// 핫 리로드 · /reload-plugins 뒤에도 같은 세션이면 이 대화의 토큰 합이 남는다. 숨김 선택은 $.store 에(다음 세션에도).
// 프로세스는 띄우지 않는다. 타이머는 "리셋까지 남은 시간" 글자 때문에 1분에 한 번 다시 그리는 것 하나뿐.
import { atom, read, update } from 'claude-code';
import { bandView } from './lib/band.js';
import { addUsage, adoptConvo, bandModel, emptyConvo, measureOf, prettyModel, statusText } from './lib/usage.js';

/** 공식 값(한도 창 · 컨텍스트 · 비용) — session.measure 가 올 때마다 */
const MEASURE = atom({ plugin: 'usage-bar', key: 'measure' }, null);
/** 이 대화의 토큰 합(서브에이전트 포함) — turn.complete 의 usage 를 더한다 */
const CONVO = atom({ plugin: 'usage-bar', key: 'convo' }, emptyConvo(null));
/** 띠를 숨겼는지 — /usage-bar 로 바꾸고, $.store 에도 남긴다 */
const HIDDEN = atom({ plugin: 'usage-bar', key: 'hidden' }, false);

const PREF_HIDDEN = 'pref:hidden';
const TICK_MS = 60000;
/** 띠(AbovePrompt)를 그리는 표면 */
const BAND_SURFACES = ['terminal', 'desktop'];
const NO_SURFACE_NOTE = '이 연결에는 띠를 그릴 화면이 붙어 있지 않아요(원격 제어로 붙은 화면은 mod 를 그리지 않아요). 대신 같은 세 줄을 글자로 보여 드려요.';
const HELP = '/usage-bar — 띠 숨기기 · 보이기 · /usage-bar status — 같은 세 줄을 글자로';

// ---- $ 를 쓰는 도우미(모두 `$` 를 인자로 받는다) ---------------------------------------------------------

async function currentId($) {
  try {
    return (await $.session.id()) || null;
  } catch {
    return null;
  }
}

/** 지금 엔진이 가진 공식 값($.session.usage — 값을 읽기만 하고 비용이 없다). 못 읽으면 null */
async function usageNow($) {
  try {
    return measureOf(await $.session.usage());
  } catch {
    return null;
  }
}

async function refreshMeasure($) {
  const m = await usageNow($);
  if (m) await update($, MEASURE, () => m);
}

/** 같은 세션이면 토큰 합을 그대로 둔다(리로드), 다른 세션이면 0 에서 */
async function adoptSession($) {
  const id = await currentId($);
  await update($, CONVO, (c) => adoptConvo(c, id));
}

async function loadHidden($) {
  let v;
  try {
    v = await $.store.get(PREF_HIDDEN);
  } catch {
    return;
  }
  if (typeof v === 'boolean' && (await read($, HIDDEN)) !== v) await update($, HIDDEN, () => v);
}

async function setHidden($, value) {
  await update($, HIDDEN, () => value);
  try {
    await $.store.set(PREF_HIDDEN, value);
  } catch {
    /* 기억하지 못해도 이번 세션에는 적용된다 */
  }
}

async function modelName($) {
  try {
    return prettyModel(await $.session.model());
  } catch {
    return null;
  }
}

/** /usage-bar status 의 글자 — 지금 값으로 */
async function statusNow($) {
  const [fresh, stored, convo, now, name] = await Promise.all([usageNow($), read($, MEASURE), read($, CONVO), $.clock.now(), modelName($)]);
  return statusText(bandModel({ measure: fresh ?? stored, convo, now }), { modelName: name });
}

// ---- 훅 ------------------------------------------------------------------------------------------------------

export function register(on) {
  /** 1분 박자 — 같은 환경에서 session.start 가 다시 와도 하나만 돈다 */
  let tick = null;

  on('session.start', async ($, e, next) => {
    // 리셋까지 남은 시간("2시간 10분 뒤") · 한 주가 지난 만큼(⚑)은 시간만 흘러도 바뀐다 — 1분에 한 번 다시 그린다
    if (tick) tick.cancel();
    tick = $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'));
    // 하나가 실패해도 나머지는 한다(띠는 값이 없어도 그려진다)
    await Promise.allSettled([
      $.command.register({ name: 'usage-bar', description: '입력창 위 사용량 띠 숨기기 · 보이기 (status: 같은 세 줄을 글자로)', argumentHint: '[status|hide|show]', immediate: true }),
      adoptSession($),
      refreshMeasure($),
      loadHidden($),
    ]);
    return next(e);
  });

  // 공식 값(한도 창 · 컨텍스트 · 비용)은 응답이 올 때마다 여기로 온다
  on('session.measure', async ($, e, next) => {
    const m = measureOf(e);
    if (m) await update($, MEASURE, () => m);
    return next(e);
  });

  // 이 대화의 토큰: 턴마다(메인 · 서브에이전트 모두 — 서브에이전트의 턴은 agentId 를 달고 따로 온다).
  // 메인 턴이 끝나면 공식 값도 한 번 다시 읽는다(measure 를 놓쳤어도 띠가 낡지 않게 — 읽기만, 비용 없음)
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await refreshMeasure($);
    if (e.usage) await update($, CONVO, (c) => addUsage(c, e.usage));
    return next(e);
  });

  // /clear · /resume · 갈래(fork) 뒤에는 다른 대화 — 토큰 합을 0 에서 다시 센다
  // 세기를 못 해도 세션 시작은 막지 않는다(.catch 가 그대로 넘긴다)
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const id = e.session_id || (await currentId($));
    await update($, CONVO, () => emptyConvo(id));
    await refreshMeasure($);
    return next(e);
  }).catch(($, e, next) => next(e));

  // `/usage-bar` 숨기기 · 보이기, `/usage-bar status` 같은 세 줄을 글자로
  on('command.run', { command: 'usage-bar' }, async ($, e) => {
    const arg = String(e.args || '').trim().toLowerCase();
    if (/^(status|text|상태)$/.test(arg)) return { text: await statusNow($) };
    let hide;
    if (arg === '') hide = !(await read($, HIDDEN));
    else if (/^(hide|off|숨기기|숨김)$/.test(arg)) hide = true;
    else if (/^(show|on|보이기|보기)$/.test(arg)) hide = false;
    else return { text: `모르는 말이에요: ${arg.slice(0, 40)}\n${HELP}` };
    await setHidden($, hide);
    const said = hide ? '입력창 위 사용량 띠를 숨겼어요. 다시 보려면 /usage-bar' : '입력창 위에 사용량 띠를 보여 드려요. 숨기려면 /usage-bar';
    // 원격 제어(claude remote)로 붙은 화면은 띠를 그리지 않는다 — 지금 값을 글자로 같이 돌려준다
    const surfaces = await $.session.surfaces();
    if (!surfaces.some((s) => BAND_SURFACES.includes(s))) return { text: `${said}\n\n${NO_SURFACE_NOTE}\n\n${await statusNow($)}` };
    return { text: said };
  });

  // 입력창 바로 위의 띠
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const props = e.props || {};
    if (props.hasSurvey) return next(e); // 설문에 자리를 내준다
    if (await read($, HIDDEN)) return next(e);
    const [stored, convo, now] = await Promise.all([read($, MEASURE), read($, CONVO), $.clock.now()]);
    // 아직 measure 가 한 번도 오지 않았으면(시작 직후) 엔진에 지금 값을 묻는다 — 그리는 중에는 쓰지 않고 읽기만
    const measure = stored ?? (await usageNow($));
    const model = bandModel({ measure, convo, now });
    const rows = Number(props.maxRows);
    return bandView($.ui.resolve(e), model, { surface: e.surface, cols: props.bodyColumns, compact: Number.isFinite(rows) && rows < 3 });
  });
}
