# usage-bar — 입력창 위 사용량 띠 (mod) v0.2

Claude Code **입력창 바로 위**에 사용량을 세 줄로 보여 주는 mod예요. 터미널과 데스크톱 앱(Code 탭)에서 그려져요.

```
5시간    ▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱    62% 남음   2시간 10분 뒤
이번 주  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱    39% 남음   ⚑ 63% 지남
이 대화  ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱    82% 남음   412k 토큰  ·  약 $3.20
```

- 세 줄이 한 표예요: 이름 · 막대 · 숫자(오른쪽 맞춤) + 단위 · 설명. 칸마다 폭이 정해져 숫자와 설명이 세 줄 모두 같은 세로줄에서 시작하고, 칸 사이는 3칸씩 띄워요(v0.2).
- 막대 = **남은 양**. 35% 이상 파랑 · 12% 이상 주황 · 그 아래 빨강. 두 표면 모두 `▰` 글자 막대(데스크톱은 빈 칸도 옅은 ▰, 터미널은 ▱).
- 이 대화의 막대 = 이 대화의 **컨텍스트에서 남은 양**(위 두 줄과 같은 "남은 양"). 컨텍스트 값이 아직 없으면 막대 자리는 비우고 숫자 칸에 토큰을 적어요.
- `⚑ 63% 지남` = 한 주가 지난 만큼. 쓴 양이 그보다 5 넘게 앞서면(빨리 쓰는 중) 주황색이 돼요.
- 이 대화의 토큰 = 새로 쓴 토큰(입력 + 출력 + 캐시 쓰기, 서브에이전트 포함). 캐시에서 다시 읽은 양은 빼고 세요.
- 값을 모르면(첫 응답 전 · API 키처럼 구독이 아닐 때 · 창이 막 리셋됐을 때) %를 지어내지 않고 `값 없음` 이라고 옅게 적어요.
- 자리가 세 줄이 안 되면 한 줄(`5시간 62%   이번 주 39%   이 대화 82%`)로, 설문이 뜨면 자리를 내줘요.

```
/usage-bar          띠 숨기기 · 보이기 (선택은 다음 세션에도 남아요)
/usage-bar status   같은 세 줄을 글자로 (/usage-bar 상태 도 돼요)
```

원격 제어(`claude remote`)로 붙은 화면은 mod 를 그리지 않아요. 그때는 `/usage-bar status` 로 보세요.

## 설치

`tonymod` 마켓플레이스(github.com/sjang3/tonymod)에 들어 있어요.

```
claude plugin marketplace add sjang3/tonymod
claude plugin install usage-bar@tonymod
```

## 무엇을 하나

- 읽는 것: `session.measure`(응답마다 오는 공식 한도 · 컨텍스트 · 비용), `$.session.usage()`(시작할 때), `turn.complete` 의 토큰.
- 쓰는 것: `$.state` 에 띠의 값(리로드 뒤에도 이 대화의 토큰 합이 남아요), `$.store` 에 숨김 선택 하나.
- 프로세스 · 네트워크는 쓰지 않아요. 타이머는 1분에 한 번 다시 그리기(리셋까지 남은 시간) 하나뿐이에요.

## 구조

```
.claude-plugin/plugin.json
hooks/register.js     $ 를 쓰는 코드는 전부 여기
hooks/lib/usage.js    계산 · 글자(순수 함수)
hooks/lib/band.js     띠 트리(순수 함수)
types/index.d.ts      $.state 계약
tests/usage.test.ts   시험 · tests/fixtures.js 견본 값
```

검증: `claude plugin validate --strict .` · 시험: `claude plugin test .`
