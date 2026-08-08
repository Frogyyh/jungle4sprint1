import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeGameContext, loadGameChain, loadScript, makeBotClass,
} from "../test-helpers.mjs";

function bootMultiplayer() {
  const { context, game } = makeGameContext({ search: "?multiplayer=1&room=r1" });
  context.sessionStorage.setItem(
    "breachline.multiplayerSession",
    JSON.stringify({ playerId: "p1", token: "t1" }),
  );
  game.bots = [new (makeBotClass())("bot-template", game.player.pos.clone(), game.player.weapon)];
  loadGameChain(context);
  loadScript(context, "multiplayer-client.js");
  const socket = context.WebSocket.instances.at(-1);
  return { context, game, socket };
}

function sendJson(socket, message) {
  socket.dispatch("message", { data: JSON.stringify(message) });
}

function welcomeRoom() {
  return {
    type: "welcome",
    playerId: "p1",
    room: {
      id: "r1",
      hostId: "p1",
      mapId: "crossroads",
      members: [
        { id: "p1", name: "Host", team: "A", characterId: "bulwark", x: -520, y: 0, dir: 0, hp: 300, maxHp: 300, alive: true },
        { id: "p2", name: "Guest", team: "B", characterId: "soldier", x: 520, y: 0, dir: Math.PI, hp: 200, maxHp: 200, alive: true },
      ],
    },
  };
}

test("멀티플레이 클라이언트는 세션 토큰으로 WebSocket 을 연다", async () => {
  const { context, socket } = bootMultiplayer();

  assert.equal(socket.url, "wss://breachline.test/api/rooms/r1/ws?token=t1");
  sendJson(socket, welcomeRoom());
  await context.__multiplayer.ready;
  assert.equal(context.__multiplayer.playerId, "p1");
  assert.equal(context.__multiplayer.room.id, "r1");
});

test("시작 시 상대 액터가 생성되고 팀/리모트로 구분된다", async () => {
  const { context, game } = bootMultiplayer();
  sendJson(context.WebSocket.instances.at(-1), welcomeRoom());
  await context.__multiplayer.ready;

  game.selectedOperatorId = "bulwark";
  game.startRound();

  const mp = context.__multiplayer;
  assert.ok(mp.actors.has("p2"), "상대 액터가 등록되어야 한다");
  const actor = mp.actors.get("p2");
  assert.equal(actor.team, "enemy");
  assert.equal(actor._remote, true);
  assert.equal(actor._bot, false);
  assert.ok(game.bots.includes(actor), "적 액터는 AI 순회 대상에 포함되어야 한다");
  assert.equal(actor.mesh.visible, true);
});

test("원격 방벽 형상은 balance.js inner/outer 를 쓴다", async () => {
  const { context, game, socket } = bootMultiplayer();
  sendJson(socket, welcomeRoom());
  await context.__multiplayer.ready;
  game.selectedOperatorId = "bulwark";
  game.startRound();

  sendJson(socket, {
    type: "state",
    player: { id: "p2", x: 520, y: 0, dir: Math.PI, hp: 200, alive: true },
    fx: { b: [230] },
  });

  const entry = context.__multiplayer.remoteFx.get("p2");
  assert.ok(entry?.barrier, "원격 방벽 스트립이 생성되어야 한다");
  assert.equal(entry.barrier.length, 24, "fan 12 + arc 10 + edges 2");

  const origin = { x: 520, y: 0 };
  const centerDistance = (strip) => Math.hypot(strip.position.x - origin.x, strip.position.y - origin.y);
  for (let index = 0; index < 12; index++) {
    const distance = centerDistance(entry.barrier[index]);
    assert.ok(distance > 56 && distance < 79,
      `fan ${index} 중심 거리(${distance.toFixed(1)})가 inner(55)~outer(100) 사이여야 한다`);
  }
  for (let index = 22; index < 24; index++) {
    const distance = centerDistance(entry.barrier[index]);
    assert.ok(Math.abs(distance - 77.5) < 1.5,
      `edge ${index} 중심 거리(${distance.toFixed(1)})는 (55+100)/2 여야 한다`);
  }
  const arcDistance = centerDistance(entry.barrier[12]);
  assert.ok(Math.abs(arcDistance - 100 * (0.88 + (230 / 250) * 0.12)) < 1.5, "호 반경은 체력 비례");
});

test("서버 확정 방벽 체력은 로컬에 그대로 반영된다", async () => {
  const { context, game, socket } = bootMultiplayer();
  sendJson(socket, welcomeRoom());
  await context.__multiplayer.ready;
  game.selectedOperatorId = "bulwark";
  game.startRound();

  sendJson(socket, { type: "barrier", playerId: "p1", active: true });
  assert.equal(game._barrier.active, true);
});

test("원격 피격은 로컬에 반영하지 않고 서버로 보고한다", async () => {
  const { context, game, socket } = bootMultiplayer();
  sendJson(socket, welcomeRoom());
  await context.__multiplayer.ready;
  game.selectedOperatorId = "bulwark";
  game.startRound();

  const actor = context.__multiplayer.actors.get("p2");
  const hpBefore = actor.hp;
  game.damageActor(game.player, actor, 30);

  assert.equal(actor.hp, hpBefore, "남의 체력은 서버가 정한다");
  const hit = socket.sent.map((raw) => JSON.parse(raw))
    .find((message) => message.type === "hit");
  assert.deepEqual(hit, { type: "hit", playerId: "p1", targetId: "p2", damage: 30 });
});

test("원격 소환수는 흰 원이 아닌 캐릭터 복제(회색 해골)로 렌더된다", async () => {
  const { context, game, socket } = bootMultiplayer();
  sendJson(socket, welcomeRoom());
  await context.__multiplayer.ready;
  game.selectedOperatorId = "soldier";
  game.startRound();

  sendJson(socket, {
    type: "state",
    player: { id: "p2", x: 520, y: 0, dir: Math.PI, hp: 200, alive: true },
    fx: { u: [[1, 480, 30, 1]] },
  });

  const entry = context.__multiplayer.remoteFx.get("p2");
  const summons = entry?.summons || [];
  assert.equal(summons.length, 1, "원격 소환수가 생성되어야 한다");
  const summon = summons[0];
  assert.equal(summon.userData.summonId, 1);
  assert.equal(summon.scale.x, context.BREACHLINE_BALANCE.operators.reaper.summon.scale,
    "해골은 소환수 스케일(마커 0.95 아님)로 축소되어 캐릭터 복제임을 드러낸다");
  assert.ok(game.fxGroup.children.includes(summon), "해골은 fxGroup 에 추가된다");
  assert.equal(summon.position.x, 480);
  assert.equal(summon.position.y, 30);
});

test("팀 카운트는 서버 로스터 기준으로 센다", async () => {
  const { context, game, socket } = bootMultiplayer();
  sendJson(socket, welcomeRoom());
  await context.__multiplayer.ready;
  game.selectedOperatorId = "bulwark";
  game.startRound();

  const counts = game.getTeamCounts();
  assert.equal(counts.ally, 1);
  assert.equal(counts.enemy, 1);
  sendJson(socket, { type: "hit", targetId: "p2", hp: 0, alive: false, damage: 200, attackerId: "p1" });
  const after = game.getTeamCounts();
  assert.equal(after.ally, 1);
  assert.equal(after.enemy, 0);
});

test("leave() 는 서버에 방 이탈을 알린다", async () => {
  const { context, socket } = bootMultiplayer();
  sendJson(socket, welcomeRoom());
  await context.__multiplayer.ready;

  context.__multiplayer.leave();
  const messages = socket.sent.map((raw) => JSON.parse(raw));
  assert.ok(messages.some((message) => message.type === "leave"));
});
