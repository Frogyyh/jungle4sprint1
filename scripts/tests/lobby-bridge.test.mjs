import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGameContext, loadGameChain, loadScript, makeActor } from "../test-helpers.mjs";

function bootLobbyBridge() {
  const { context, game } = makeGameContext();
  game.bots = [makeActor("bot-1", 200, 0, "enemy")];
  loadGameChain(context);
  loadScript(context, "lobby-bridge.js");
  return { context, game };
}

test("오프라인 딜량은 damageActor 를 감싸 기록한다", () => {
  const { game } = bootLobbyBridge();
  const source = game.bots[0];
  const target = game.player;

  game.damageActor(source, target, 30);
  assert.equal(target.hp, 70);
  assert.equal(source._damageDealt, 30, "가해자에게 딜량이 쌓여야 한다");
});

test("resetRound 는 딜량 기록을 초기화한다", () => {
  const { game } = bootLobbyBridge();
  game.damageActor(game.bots[0], game.player, 10);
  assert.equal(game.bots[0]._damageDealt, 10);

  game.resetRound(true);
  assert.equal(game.bots[0]._damageDealt, 0);
  assert.equal(game.player._damageDealt, 0);
});

test("endRound 는 전적표를 팀 단위로 그린다", () => {
  const { game, context } = bootLobbyBridge();
  game.endRound(true, "MISSION SUCCESS");

  const scoreboard = context.document.querySelector("#scoreboard");
  assert.ok(scoreboard.children.length >= 3, "모드 라벨 + 두 팀 보드");
  assert.ok(scoreboard.children[0].textContent.includes("프로토타입"));
  assert.ok(scoreboard.children[1].className.includes("win"), "우리 팀은 WIN 표시");
});

test("startRound 는 관전 바를 닫고 라운드를 시작한다", () => {
  const { game, context } = bootLobbyBridge();
  game.startRound();

  const spectateBar = context.document.querySelector("#spectate-bar");
  assert.equal(spectateBar.classList.contains("hidden"), true);
  assert.equal(game.phase, "playing");
});
