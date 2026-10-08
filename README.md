# tonymod — Claude Code mods

Claude Code **mods**(JS 함수 훅으로 화면을 그리는 플러그인) 두 개를 담은 마켓플레이스예요.

| 플러그인 | 무엇 |
|---|---|
| [`crew-mode`](plugins/crew-mode) | 오른쪽 탭 **"세션"** — 에이전트(귀여운 캐릭터 + 시간 막대) · 작업(이 대화의 커밋 · 푸시 · PR, git 저장소 · 워크트리) · 서버(CPU · 메모리) |
| [`usage-bar`](plugins/usage-bar) | 입력창 바로 위 세 줄 표 — 5시간 · 이번 주 · 이 대화(컨텍스트)의 남은 양과 토큰 · 비용 |

## 설치

```
claude plugin marketplace add sjang3/tonymod
claude plugin install crew-mode@tonymod
claude plugin install usage-bar@tonymod
```

세션 안에서는 `/plugin marketplace add sjang3/tonymod` 로도 돼요. 새 세션부터 보여요.
데스크톱 앱의 SSH 세션에서 쓰려면 세션이 도는 컴퓨터(SSH 로 붙는 쪽)에 설치하세요.

업데이트: `claude plugin update crew-mode@tonymod` (또는 `/plugin` → Marketplaces 에서 자동 업데이트 켜기).

## 필요한 것

- mods 를 지원하는 Claude Code (데스크톱 2.1.286 · 터미널 2.1.287 이상)
- `git` (저장소 상태), `gh` 는 있으면 PR 상태까지
- 서버 CPU · 메모리는 macOS · Linux 에서만 읽어요
- 원격 제어(`claude remote`)로 붙은 화면에는 mod 창이 그려지지 않아요 — `/crew status` · `/usage-bar status` 로 글자 요약을 보세요

mod 는 여러분 컴퓨터에서 `git` · `ps` 같은 명령을 실행해요(읽기만). 코드는 `plugins/*/hooks/` 에 있어요.

## 개발

```
claude plugin validate --strict plugins/crew-mode
claude plugin test plugins/crew-mode
```
