import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGameContext, loadScript } from "../test-helpers.mjs";

function loadUtils() {
  const { context, game } = makeGameContext();
  loadScript(context, "shared-utils.js");
  return { context, game, utils: context.BREACHLINE_UTIL };
}

test("순수 수학 헬퍼가 정확하다", () => {
  const { utils } = loadUtils();

  assert.equal(utils.clamp(5, 0, 1), 1);
  assert.equal(utils.clamp(-5, 0, 1), 0);
  assert.equal(utils.clamp(0.5, 0, 1), 0.5);
  assert.ok(Math.abs(utils.angleDelta(Math.PI, -Math.PI)) < 1e-12, "각도 차이는 모듈로 π");
  assert.equal(utils.easeSwing(0), 0);
  assert.equal(utils.easeSwing(1), 1);
  assert.equal(utils.easeSwing(0.5), 0.5);
});

test("segmentCircleHit 는 세그먼트-원 충돌을 판정한다", () => {
  const { utils } = loadUtils();

  assert.equal(utils.segmentCircleHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, 2), true);
  assert.equal(utils.segmentCircleHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, 2), false);
  assert.equal(utils.segmentCircleHit({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 5), true, "길이 0 세그먼트");
});

test("cameraHalfExtents 는 카메라 반폭을 준다", () => {
  const { utils } = loadUtils();
  const camera = { left: -1000, right: 1000, top: 600, bottom: -600 };

  const extents = utils.cameraHalfExtents(camera);
  assert.equal(extents.halfWidth, 1000);
  assert.equal(extents.halfHeight, 600);
});

test("wrap 은 이전 구현을 감싸 체인을 쌓는다", () => {
  const { game, utils } = loadUtils();
  const calls = [];
  game.foo = function foo(value) {
    calls.push(`core:${value}`);
    return value * 2;
  };

  utils.wrap(game, "foo", (original, ctx, args) => {
    calls.push(`first:${args[0]}`);
    const result = original(args[0]);
    calls.push(`first-after:${result}`);
    return result + 1;
  });
  utils.wrap(game, "foo", (original, ctx, args) => {
    calls.push(`second:${args[0]}`);
    return original(args[0]) * 10;
  });

  assert.equal(game.foo(3), 70, "등록 순서대로 겹겹이 쌓인다");
  assert.deepEqual(calls, ["second:3", "first:3", "core:3", "first-after:6"]);
});

test("createFxPool 은 스트립/마커를 만들고 배치한다", () => {
  const { game, utils } = loadUtils();
  const pool = utils.createFxPool(game);

  const strip = pool.strip(0xff0000, 0.5);
  assert.ok(game.fxGroup.children.includes(strip), "스트립은 fxGroup 에 추가된다");
  pool.place(strip, { x: 0, y: 0 }, { x: 100, y: 0 }, 5);
  assert.equal(strip.position.x, 50);
  assert.equal(strip.rotation.z, 0);
  assert.equal(strip.scale.x, 100 / 2600);
  assert.equal(strip.scale.y, 5 / 1800);

  const marker = pool.marker(0x00ff00, 0.6, 0.9);
  assert.equal(marker.scale.x, 0.6);
  assert.equal(marker.material.opacity, 0.9);

  pool.dispose(strip);
  assert.ok(!game.fxGroup.children.includes(strip), "dispose 는 부모에서 제거한다");
});
