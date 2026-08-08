import WebSocket from "ws";

const base = process.env.BREACHLINE_TEST_URL || "http://127.0.0.1:8787";

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error || response.status}`);
  return data;
}

function socketFor(roomId, token) {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/rooms/${roomId}/ws?token=${encodeURIComponent(token)}`);
  const queue = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const waiter = waiters.splice(index, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
    else queue.push(message);
  });
  ws.next = (predicate, timeout = 3000) => {
    const index = queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiters.push(waiter);
      waiter.timer = setTimeout(() => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error("WebSocket message timeout"));
      }, timeout);
    });
  };
  return ws;
}

const health = await api("/api/health");
if (!health.ok) throw new Error("health check failed");

const created = await api("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ title: "integration-test", nickname: "Host", capacity: 2 }),
});
const joined = await api(`/api/rooms/${created.room.id}/join`, {
  method: "POST",
  body: JSON.stringify({ nickname: "Guest" }),
});

const host = socketFor(created.room.id, created.token);
const guest = socketFor(created.room.id, joined.token);
const hostWelcome = await host.next((message) => message.type === "welcome");
await guest.next((message) => message.type === "welcome");

const selectableMaps = [
  "crossroads", "offset", "open-lanes", "ruined-garden",
  "frost-fortress", "brush-maze", "sunscar-canyon",
];
for (const mapId of selectableMaps) {
  host.send(JSON.stringify({ type: "action", action: "map", value: mapId }));
  await guest.next((message) => message.type === "room" && message.room.mapId === mapId);
}

guest.send(JSON.stringify({ type: "action", action: "character", value: "bulwark" }));
await host.next((message) => message.type === "room" && message.room.members.find((m) => m.id === joined.playerId)?.characterId === "bulwark");
host.send(JSON.stringify({ type: "action", action: "character", value: "reaper" }));
await guest.next((message) => message.type === "room" && message.room.members.find((m) => m.id === created.playerId)?.characterId === "reaper");
guest.send(JSON.stringify({ type: "action", action: "ready", value: true }));
await host.next((message) => message.type === "room" && message.room.members.find((m) => m.id === joined.playerId)?.ready);
host.send(JSON.stringify({ type: "action", action: "start" }));
await Promise.all([
  host.next((message) => message.type === "start"),
  guest.next((message) => message.type === "start"),
]);

const skillFx = {
  t: [-320, 80], m: [0.25, 120, 0xff739f, 1, 0.5], d: [0, 0.25, 0.5], b: [210], r: [0.75],
  s: [-280, 30, 1, 1.25], u: [[1, -360, 30, 1], [2, -350, 55, 1], [3, -340, 80, 1]],
  g: [[101, 0, -300, 20, 0.8, 1.5], [102, 3, -260, 25, 0, 0]],
  o: [[201, -240, 25, 225, 1, 4.5]], f: [1.25, 0.25], l: [3, 0.25, 1300], v: [6.5, 920],
  p: [-250, 25],
};
host.send(JSON.stringify({ type: "state", x: -400, y: 25, dir: 0.25, fx: skillFx }));
const state = await guest.next((message) => message.type === "state" && message.player.id === created.playerId);
if (state.player.x !== -400 || state.player.y !== 25) throw new Error("state relay mismatch");
for (const key of Object.keys(skillFx)) {
  if (!state.fx?.[key]) throw new Error(`skill effect relay missing: ${key}`);
}
if (state.fx.v[1] !== 920) throw new Error("reveal range relay mismatch");

guest.send(JSON.stringify({
  type: "summon-hit", ownerId: created.playerId, summonId: 1, damage: 10,
}));
const summonHit = await host.next((message) => message.type === "summon-hit" && message.summonId === 1);
if (summonHit.ownerId !== created.playerId || summonHit.damage !== 10) {
  throw new Error("summon hit relay mismatch");
}

host.send(JSON.stringify({ type: "shot", x: -390, y: 25, dir: 0.25, weaponId: "dagger" }));
const shot = await guest.next((message) => message.type === "shot" && message.playerId === created.playerId);
if (shot.weaponId !== "dagger") throw new Error("projectile type relay mismatch");

guest.send(JSON.stringify({ type: "state", x: 400, y: 25, dir: Math.PI, fx: { b: [250] } }));
await host.next((message) => message.type === "state" && message.player.id === joined.playerId && message.fx?.b);
host.send(JSON.stringify({ type: "hit", targetId: joined.playerId, damage: 20 }));
const barrier = await guest.next((message) => message.type === "barrier" && message.playerId === joined.playerId);
if (barrier.active !== true) throw new Error("barrier synchronization mismatch");

await new Promise((resolve) => setTimeout(resolve, 50));
guest.send(JSON.stringify({ type: "state", x: 400, y: 25, dir: Math.PI }));
await host.next((message) => message.type === "state" && message.player.id === joined.playerId && !message.fx);
await new Promise((resolve) => setTimeout(resolve, 50));
host.send(JSON.stringify({ type: "hit", targetId: joined.playerId, damage: 20 }));
const hit = await guest.next((message) => message.type === "hit" && message.targetId === joined.playerId);
if (hit.hp !== 280) throw new Error(`hit synchronization mismatch: ${hit.hp}`);
if (hit.sourceX !== -400 || hit.sourceY !== 25) throw new Error("damage direction source mismatch");

host.terminate(); guest.terminate();
console.log(`OK room=${created.room.id} host=${hostWelcome.playerId} guestHp=${hit.hp}`);
