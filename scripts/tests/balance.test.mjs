import { test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, loadScript } from "../test-helpers.mjs";

test("balance.js는 단일 원본 데이터를 노출한다", () => {
  const context = createSandbox();
  loadScript(context, "balance.js");
  const balance = context.BREACHLINE_BALANCE;

  assert.ok(balance, "BREACHLINE_BALANCE 가 정의되어야 한다");
  assert.ok(Object.isFrozen(balance), "밸런스 객체는 동결되어야 한다");
  assert.equal(balance.player.hp, 100);
  assert.equal(balance.vision.camera.defaultScale, 1.25);
  assert.equal(balance.vision.camera.sniperScale, 1.5);
});

test("balance.js는 10개 병과 전부를 가진다", () => {
  const context = createSandbox();
  loadScript(context, "balance.js");
  const balance = context.BREACHLINE_BALANCE;

  const ids = Object.keys(balance.operators).sort();
  assert.deepEqual(ids, [
    "bulwark", "demolitionist", "frog", "gunslinger",
    "hunter", "ninja", "reaper", "sentinel", "sniper", "soldier",
  ]);
  for (const id of ids) {
    assert.ok(balance.operators[id].weapon, `${id} 에는 무기가 있어야 한다`);
    assert.ok(balance.operators[id].hp > 0, `${id} 의 체력이 정의되어야 한다`);
  }
});

test("balance.js 방벽/시야 상수는 로컬·원격 렌더러의 기준이다", () => {
  const context = createSandbox();
  loadScript(context, "balance.js");
  const balance = context.BREACHLINE_BALANCE;

  assert.equal(balance.operators.bulwark.barrier.inner, 55);
  assert.equal(balance.operators.bulwark.barrier.outer, 100);
  assert.equal(balance.operators.bulwark.barrier.halfAngleDeg, 60);
  assert.equal(balance.vision.nearRadius, 100);
  assert.equal(balance.ai.fairRange, 620);
});

test("balance.js 격발 지연/투척 속도는 단일 원본이다", () => {
  const context = createSandbox();
  loadScript(context, "balance.js");
  const balance = context.BREACHLINE_BALANCE;

  assert.equal(balance.gadgets.frag.fuse, 1.5, "수류탄 격발 지연 1.5초");
  assert.equal(balance.gadgets.frag.radius, 200, "수류탄 폭발 반경 2배 확장");
  assert.equal(balance.gadgets.flash.fuse, 1.0, "섬광탄 격발 지연 1.0초");
  assert.equal(balance.gadgets.flash.duration, 2, "섬광탄 지속 2초");
  assert.equal(balance.gadgets.smoke.fuse, 1.0, "연막탄 격발 지연 1.0초");
  assert.ok(balance.gadgets.throwSpeed >= 1000, "투척 초기 속도는 충분히 빨라야 한다");
  assert.equal(balance.gadgets.launcher.fuse, undefined, "유탄은 격발 지연 변경 제외");
});
