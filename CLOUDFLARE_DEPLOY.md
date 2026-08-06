# Breachline 멀티플레이 / Cloudflare 배포

## 구성

- 정적 게임·UI: Cloudflare Workers Static Assets
- 방 목록: `Lobby` Durable Object
- 방 상태·WebSocket·체력·승패: 방마다 하나의 `GameRoom` Durable Object
- 위치 전송: 약 15Hz, 원격 화면에서는 보간 렌더링
- 공격 판정: 공격한 클라이언트가 피격을 보고하고 서버가 팀·거리·캐릭터별 최대 피해·최소 간격을 검증한 뒤 체력과 승패를 확정

현재 버전은 플레이 가능한 알파입니다. 이동, 팀, 준비, 캐릭터/맵 선택, 위치, 체력, 개구리 물총 슬로우, 사망과 팀 승패가 동기화됩니다. 캐릭터별 투사체·연막·소환물 같은 시각 효과는 다른 플레이어 화면에 완전히 복제되지 않으며, 랭크 게임 수준의 부정행위 방지를 위해서는 추후 서버 권한형 이동/투사체 시뮬레이션이 필요합니다.

## 로컬 실행

Node.js 20 이상을 설치한 뒤 프로젝트 루트에서 실행합니다.

```bash
npm install
npm run dev:cloudflare
```

브라우저 두 개(또는 일반 창과 시크릿 창)에서 `http://localhost:8787`을 열고 서로 다른 닉네임으로 접속합니다.

자동 프로토콜 테스트는 개발 서버가 실행 중일 때 별도 터미널에서 실행합니다.

```bash
npm run test:multiplayer
```

## 최초 배포 — 사용자가 해야 하는 작업

1. [Cloudflare 계정](https://dash.cloudflare.com/sign-up)을 만들거나 로그인합니다.
2. 프로젝트 루트에서 `npx wrangler login`을 실행하고 브라우저 권한 요청을 승인합니다.
3. 아래 명령으로 정적 파일 빌드와 Worker 배포를 한 번에 수행합니다.

```bash
npm run deploy:cloudflare
```

성공하면 Wrangler가 `https://breachline.<계정>.workers.dev` 형태의 주소를 출력합니다. `wrangler.jsonc`의 SQLite Durable Object 마이그레이션도 최초 배포 때 자동 적용됩니다.

## 사용자 도메인 연결(선택)

Cloudflare 대시보드의 **Workers & Pages → breachline → Settings → Domains & Routes → Add → Custom Domain**에서 Cloudflare에 등록된 도메인을 선택합니다. 도메인이 없다면 `workers.dev` 주소만으로도 게임을 공개할 수 있습니다.

## 운영 전에 권장하는 다음 단계

- 방 정리용 Durable Object alarm(오래된 종료 방 자동 삭제)
- 재접속 유예 시간과 관전자 모드
- 투사체·스킬 이벤트의 서버 권한형 판정
- 매치메이킹/계정 인증/신고 및 제재
- Cloudflare Analytics에서 오류율과 Durable Object 사용량 모니터링
