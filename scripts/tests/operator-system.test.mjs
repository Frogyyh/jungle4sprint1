import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGameContext, loadGameChain, makeMesh } from "../test-helpers.mjs";

function bootOperatorSystem() {
  const { context, game } = makeGameContext();
  loadGameChain(context);
  return { context, game };
}

function selectOperator(game, id) {
  game.selectedOperatorId = id;
  game.startRound();
}

test("operator-system 은 frog 를 포함해 한 번만 설치된다", () => {
  const { context, game } = bootOperatorSystem();

  assert.equal(game.__operatorSystemInstalled, true);
  assert.equal(game.canvas.dataset.operatorSystem, "10-class-v2");
  assert.equal(game.frogWeapon, context.BREACHLINE_BALANCE.operators.frog.weapon);
  assert.equal(typeof game.getTongueCooldown, "undefined", "죽은 스텁은 설치되지 않아야 한다");
});

test("startRound(soldier) 는 병과 장착을 적용한다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "soldier");

  assert.equal(game.activeOperatorId, "soldier");
  assert.equal(game.player.maxHp, 200);
  assert.equal(game.player.flashGrenades, Infinity);
  assert.equal(game.player.fragGrenades, 0);
  assert.equal(game.player.smokeGrenades, 0);
  assert.equal(game.canvas.dataset.operatorId, "soldier");
  assert.equal(game.viewScale, 1.25, "확대는 quality-pass 의 frustum 패치가 결정한다");
});

test("startRound(sniper) 는 방어구·덫 상태를 초기화한다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "sniper");

  assert.equal(game.player.maxHp, 100);
  assert.equal(game.player.radius, 20);
  assert.equal(game._traps.length, 0);
  assert.equal(game.viewScale, 1.5);
  assert.equal(game._trapPreview, undefined, "죽은 미리보기 상태는 없어야 한다");
});

test("startRound(bulwark) 는 방벽을 balance.js 상수로 초기화한다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "bulwark");

  assert.equal(game._barrier.active, false);
  assert.equal(game._barrier.activeUntil, 0);
});

test("아이언 방벽 쿨다운은 우클릭(secondary) 슬롯에 반영된다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "bulwark");
  game._operatorCooldowns.barrier = game.now + 10;

  game.renderUi();
  assert.equal(game.canvas.dataset.secondaryCooldown, "10.00", "방벽 10초 쿨다운이 표시되어야 한다");
});

test("장탄수는 (현재)/(최대장탄수) 로 표시하고 예비 탄약을 쓰지 않는다", () => {
  const { game, context } = bootOperatorSystem();
  selectOperator(game, "soldier"); // rifle magSize 30
  game.player.ammo = 5;

  game.renderUi();
  assert.equal(context.document.querySelector("#ammo").textContent, "5");
  assert.equal(context.document.querySelector("#reserve").textContent, "30", "예비가 아닌 최대 장탄수 표시");

  // 근접 병과는 무한 표시
  selectOperator(game, "reaper");
  game.renderUi();
  assert.equal(context.document.querySelector("#ammo").textContent, "∞");
  assert.equal(context.document.querySelector("#reserve").textContent, "∞");
});

test("방벽 시각화는 balance.js 의 inner/outer 를 그대로 쓴다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "bulwark");
  game._barrier.active = true;
  game._barrier.activeUntil = 10;
  game.now = 5;
  game.player.pos.set(0, 0, 0);
  game.player.dir = 0;

  game.step(0.016);
  const group = game.fxGroup.children[0];
  assert.ok(group, "방벽 그룹이 생성되어야 한다");
  assert.equal(group.children.length, 24, "fan 12 + arc 10 + edges 2");

  const origin = game.player.pos;
  const fanMidDistance = (strip) => Math.hypot(strip.position.x - origin.x, strip.position.y - origin.y);
  const inner = 55;
  const outer = 100;
  for (let index = 0; index < 12; index++) {
    const distance = fanMidDistance(group.children[index]);
    assert.ok(distance > inner && distance < outer,
      `fan ${index} 중심 거리(${distance.toFixed(1)})가 inner~outer 사이여야 한다`);
  }
  for (let index = 22; index < 24; index++) {
    const distance = fanMidDistance(group.children[index]);
    assert.ok(Math.abs(distance - (inner + outer) / 2) < 1.5,
      `edge ${index} 중심 거리(${distance.toFixed(1)})는 중간값이어야 한다`);
  }
});

test("renderUi 는 스테일 dataset 을 더 이상 쓰지 않는다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "soldier");
  game.renderUi();

  const dataset = game.canvas.dataset;
  assert.equal(dataset.soldierGadgets, undefined);
  assert.equal(dataset.sniperGadgets, undefined);
  assert.equal(dataset.ninjaSmokeRadius, undefined);
  assert.equal(dataset.healthRegenRate, undefined);
  assert.equal(dataset.operatorCooldown, "0.00");
});

test("renderUi(frog) 는 혀 쿨타임을 0 으로 표시한다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "frog");

  assert.equal(game.canvas.dataset.frogInstalled, "true");
  game.renderUi();
  assert.equal(game.canvas.dataset.playerKind, "frog");
  assert.equal(game.canvas.dataset.tongueCooldown, "0.00");
  assert.equal(game.canvas.dataset.abilityCooldown, "0.00");
});

test("renderUi 는 cooldown 을 남은 초로 표시한다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "soldier");
  game._operatorCooldowns.enhance = game.now + 10;

  game.renderUi();
  assert.equal(game.canvas.dataset.operatorCooldown, "10.00");
  assert.equal(game.canvas.dataset.abilityCooldown, "10.00");
});

test("투척물 표시는 병과별 정책을 따른다", () => {
  const { game, context } = bootOperatorSystem();
  const document = context.document;

  selectOperator(game, "soldier");
  game.renderUi();
  assert.equal(document.querySelector("#flash-gadget").classList.contains("hidden"), false);
  assert.equal(document.querySelector("#smoke-gadget").classList.contains("hidden"), true);
  assert.equal(document.querySelector("#frag-gadget").classList.contains("hidden"), true);

  selectOperator(game, "demolitionist");
  game.renderUi();
  assert.equal(document.querySelector("#frag-gadget").classList.contains("hidden"), false);
  assert.equal(document.querySelector("#flash-gadget").classList.contains("hidden"), true);
});

test("근접 공격은 적 팀 소환수를 피격한다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "reaper");
  game.player.pos.set(0, 0, 0);
  game.player.dir = 0;
  game._summons.push({
    id: 1,
    team: "enemy",
    pos: game.player.pos.clone().set(50, 0, 0),
    hp: 1,
    mesh: makeMesh(),
  });

  game.fire(game.player, 0);
  assert.equal(game._summons.length, 0, "사거리 안 적 소환수는 근접 공격으로 파괴된다");
});

test("근접 공격은 아군 소환수를 피격하지 않는다", () => {
  const { game } = bootOperatorSystem();
  selectOperator(game, "reaper");
  game.player.pos.set(0, 0, 0);
  game.player.dir = 0;
  game._summons.push({
    id: 1,
    team: "player",
    pos: game.player.pos.clone().set(50, 0, 0),
    hp: 1,
    mesh: makeMesh(),
  });

  game.fire(game.player, 0);
  assert.equal(game._summons.length, 1, "아군 소환수는 근접 공격에 무해하다");
});
