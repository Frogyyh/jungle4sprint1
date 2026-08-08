import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGameContext, loadScript } from "../test-helpers.mjs";

function bootQualityPass() {
  const { context, game } = makeGameContext();
  loadScript(context, "balance.js");
  loadScript(context, "operators.js");
  loadScript(context, "map-data.js");
  loadScript(context, "shared-utils.js");
  loadScript(context, "quality-pass.js");
  return { context, game };
}

test("quality-pass 는 시야/HUD 폴리시를 패치한다", () => {
  const { game } = bootQualityPass();

  assert.equal(game.viewScale, 1.25, "기본 확대는 balance.js 의 defaultScale");
  assert.equal(game.canvas.dataset.flashRadius, "200");
  assert.equal(typeof game._grenadeTelegraphs?.set, "function", "텔레그래프 레지스트리가 있어야 한다");
  assert.equal(game._activeMapId, "crossroads", "맵 레이아웃이 적용되어야 한다");
  assert.ok(game.walls.length > 0, "차단 오브젝트가 벽으로 등록되어야 한다");
});

test("updateCameraFrustum 패치는 병과별 확대를 balance.js 에서 읽는다", () => {
  const { game } = bootQualityPass();
  game.camera.left = -960;
  game.camera.right = 960;
  game.camera.top = 640;
  game.camera.bottom = -640;
  game.activeOperatorId = "soldier";

  game.updateCameraFrustum();
  assert.equal(game.viewScale, 1.25);
  assert.equal(game.camera.left, -960 * 1.25);
  assert.equal(game.canvas.dataset.viewScale, "1.25");

  game.activeOperatorId = "sniper";
  game.updateCameraFrustum();
  assert.equal(game.viewScale, 1.5);
  assert.equal(game.canvas.dataset.viewScale, "1.50");
});

test("isVisible 패치: 아군은 항상, 적은 시야 안에서만 식별된다", () => {
  const { game } = bootQualityPass();
  const player = game.player;
  const ally = { ...player, id: "ally", pos: player.pos.clone().set(5000, 0, 0) };
  const enemyFar = { ...player, id: "far", team: "enemy", pos: player.pos.clone().set(5000, 0, 0) };
  const enemyNear = { ...player, id: "near", team: "enemy", pos: player.pos.clone().set(50, 0, 0) };
  const enemyInCone = { ...player, id: "cone", team: "enemy", pos: player.pos.clone().set(300, 0, 0) };
  const originalCalls = () => game._isVisibleCalls || 0;

  assert.equal(game.isVisible(player, ally, 45, 10000), true, "아군은 항상 식별");
  assert.equal(originalCalls(), 0, "아군 판정은 코어를 호출하지 않는다");

  assert.equal(game.isVisible(player, enemyFar, 45, 10000), false, "화면 밖 적은 비식별");
  assert.equal(originalCalls(), 0, "화면 밖 판정도 코어를 호출하지 않는다");

  assert.equal(game.isVisible(player, enemyNear, 45, 500), true, "원형 근접 시야 안은 식별");
  assert.equal(originalCalls(), 0, "근접 시야 판정도 코어를 호출하지 않는다");

  assert.equal(game.isVisible(player, enemyInCone, 45, 500), true, "시야 안 적은 코어 판정에 맡긴다");
  assert.equal(originalCalls(), 1, "시야 안 적은 코어 isVisible 을 호출해야 한다");
});

test("isVisible 패치: 적→플레이어 투사는 fairRange 로 거리를 제한한다", () => {
  const { game } = bootQualityPass();
  const player = game.player;
  const enemy = { ...player, id: "enemy", team: "enemy", pos: player.pos.clone().set(300, 0, 0) };
  game.isVisible(enemy, player, 45, 10000);
  assert.equal(game._isVisibleCalls || 0, 1, "코어 호출은 fairRange 로 깎여야 한다");
});

test("updateVisibility 는 원형 근접 시야 다각형을 덧붙인다", () => {
  const { game } = bootQualityPass();

  game.updateVisibility();
  const geometry = game.visibilityMesh.geometry;
  assert.equal(geometry.userData.breachlineNearVision, true, "근접 시야 태그가 붙어야 한다");
  const positions = geometry._attributes.position.array;
  assert.equal(positions.length, 40 * 9, "40세그먼트 × 3정점 × 3좌표");
  assert.ok(Math.abs(positions[3] - 100) < 1e-6, "첫 정점은 반경 100 거리");
});

test("makeGrenadeTelegraph 는 공용 텔레그래프 요소를 만든다", () => {
  const { game, context } = bootQualityPass();

  const element = game.makeGrenadeTelegraph();
  assert.equal(element.className, "throw-telegraph");
  assert.ok(element.innerHTML.includes("telegraph-sweep"));
  assert.equal(typeof game.positionGrenadeTelegraph, "function", "위치 지정 함수가 노출되어야 한다");
  assert.ok(context.document._registry.has("#throw-telegraphs"), "텔레그래프 컨테이너가 조회되어야 한다");
});

test("연막 활성 시 renderUi 가 TypeError 없이 완주한다 (프리즈 회귀 방지)", () => {
  const { game } = bootQualityPass();
  const smoke = {
    id: 1,
    pos: game.player.pos.clone().set(0, 0, 0),
    radius: 225,
    endAt: game.now + 5,
    mesh: { userData: {} },
    owner: game.player,
    _breachlineSmokeStartedAt: game.now,
  };
  game.smokes.push(smoke);

  assert.doesNotThrow(() => {
    game.renderUi();
    game.renderUi();
  });
  assert.equal(game.canvas.dataset.smokeTimerRemaining, "5.00");
});

test("연막 내부 시점엔 퍼프 드리프트를 생략해도 무해하다", () => {
  const { game } = bootQualityPass();
  const puffs = [];
  for (let i = 0; i < 3; i++) {
    puffs.push({
      userData: { breachlineSmokePuff: true, breachlineSmokeLayer: 0, breachlineSmokeSeed: i },
      position: { x: 0, y: 0 },
      scale: { x: 0.3, setScalar() {} },
      material: { opacity: 0.4 },
      visible: true,
    });
  }
  const smoke = {
    id: 1,
    pos: game.player.pos.clone().set(0, 0, 0),
    radius: 225,
    endAt: game.now + 5,
    mesh: {
      userData: { breachlineSmokeCluster: true },
      rotation: { z: 0 },
      scale: { x: 1.5 },
      children: puffs,
    },
    owner: game.player,
  };
  game.smokes.push(smoke);

  assert.doesNotThrow(() => game.updateSmokes());
  assert.equal(puffs[0].visible, false, "플레이어가 연막 안이면 퍼프는 숨겨진다");

  game.player.pos.set(500, 0, 0);
  assert.doesNotThrow(() => game.updateSmokes());
  assert.equal(puffs[0].visible, true, "연막 밖이면 퍼프가 보인다");
});
