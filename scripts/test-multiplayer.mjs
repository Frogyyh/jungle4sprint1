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

guest.send(JSON.stringify({ type: "action", action: "ready", value: true }));
await host.next((message) => message.type === "room" && message.room.members.find((m) => m.id === joined.playerId)?.ready);
host.send(JSON.stringify({ type: "action", action: "start" }));
await Promise.all([
  host.next((message) => message.type === "start"),
  guest.next((message) => message.type === "start"),
]);

host.send(JSON.stringify({ type: "state", x: -400, y: 25, dir: 0.25 }));
const state = await guest.next((message) => message.type === "state" && message.player.id === created.playerId);
if (state.player.x !== -400 || state.player.y !== 25) throw new Error("state relay mismatch");

host.send(JSON.stringify({ type: "hit", targetId: joined.playerId, damage: 20 }));
const hit = await guest.next((message) => message.type === "hit" && message.targetId === joined.playerId);
if (hit.hp !== 80) throw new Error(`hit synchronization mismatch: ${hit.hp}`);

host.terminate(); guest.terminate();
console.log(`OK room=${created.room.id} host=${hostWelcome.playerId} guestHp=${hit.hp}`);
