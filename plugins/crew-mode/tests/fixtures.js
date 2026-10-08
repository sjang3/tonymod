// 시험 · 미리보기용 창 하나 분량의 스냅샷 — 에이전트 부분(fixtures-agents.js)과 작업 · 서버 부분(fixtures-work.js)을 합친다.
// views.js 가 받는 `d`(데이터 계약) 그대로. 시각은 모두 NOW 기준(같은 파일이면 언제 돌려도 같은 그림).
import * as A from './fixtures-agents.js';
import * as W from './fixtures-work.js';

export const NOW = A.NOW;
const cpuHist = (base, swing) => Array.from({ length: 24 }, (_, i) => Math.max(0, Math.min(100, base + Math.round(Math.sin(i / 2.3) * swing + ((i * 37) % 11) - 5))));

/** 일이 한창: 에이전트 여럿 + 커밋 전 변경 · PR 열림 · 워크트리 + 메모리 빠듯 */
export const busySession = { ...W.busySession, ...A.busySession, version: '0.5.0', cpuHist: cpuHist(38, 18) };
/** 창을 막 열었다: 에이전트 없음 · 작업 · 서버 읽는 중 */
export const freshSession = { ...W.freshSession, ...A.freshSession, version: '0.5.0', cpuHist: [] };
/** 쉬는 중: 에이전트는 다녀갔고 이 대화는 아직 바꾼 게 없다 · 서버 여유 */
export const restingSession = { ...W.emptySession, ...A.restingSession, version: '0.5.0', cpuHist: cpuHist(6, 4) };
/** 손자 에이전트 + 리눅스 컨테이너(푸시까지 끝) */
export const nestedAgents = { ...W.linuxContainer, ...A.nestedAgents, version: '0.5.0', cpuHist: cpuHist(52, 25) };
/** 크기 한도: 긴 글 · 많은 갈래 · 저장소 7 · 메모리 모자람 */
export const stress = { ...W.stress, ...A.stress, version: '0.5.0', cpuHist: cpuHist(90, 8) };

export const FIXTURES = { busySession, freshSession, restingSession, nestedAgents, stress };
