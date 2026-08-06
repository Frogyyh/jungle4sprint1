import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const ALLOWED_CHARACTERS = new Set([
  "gunslinger", "bulwark", "sentinel", "soldier", "frog",
  "reaper", "hunter", "ninja", "sniper", "demolitionist",
]);
const ALLOWED_MAPS = new Set(["crossroads", "offset", "open-lanes"]);
const DAMAGE_LIMITS = {
  gunslinger: 34, bulwark: 45, sentinel: 38, soldier: 35, frog: 18,
  reaper: 48, hunter: 55, ninja: 65, sniper: 100, demolitionist: 85,
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: JSON_HEADERS,
});

const cleanText = (value, max = 32) => String(value ?? "").trim().slice(0, max);
const roomName = (id) => `room:${id}`;
const token = () => `${crypto.randomUUID()}-${crypto.randomUUID()}`;
const publicMember = (member) => ({
  id: member.id,
  name: member.name,
  team: member.team,
  ready: member.ready,
  characterId: member.characterId,
  connected: Boolean(member.connected),
  hp: member.hp,
  alive: member.alive,
  x: member.x,
  y: member.y,
  dir: member.dir,
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "breachline-multiplayer", version: 1 });
      }
      if (url.pathname === "/api/rooms" && request.method === "GET") {
        return env.LOBBY.getByName("global").fetch("https://lobby/rooms");
      }
      if (url.pathname === "/api/rooms" && request.method === "POST") {
        return env.LOBBY.getByName("global").fetch("https://lobby/rooms", request);
      }

      const match = url.pathname.match(/^\/api\/rooms\/([a-zA-Z0-9-]+)(?:\/(join|ws))?$/);
      if (!match) return json({ error: "API 경로를 찾을 수 없습니다." }, 404);
      const [, id, action = "state"] = match;
      const target = new URL(`https://room/${action}`);
      for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
      return env.ROOMS.getByName(roomName(id)).fetch(target, request);
    } catch (error) {
      console.error(error);
      return json({ error: "서버 처리 중 오류가 발생했습니다." }, 500);
    }
  },
};

export class Lobby extends DurableObject {
  async fetch(request) {
    if (request.method === "GET") {
      const rooms = (await this.ctx.storage.get("rooms")) || {};
      return json({ rooms: Object.values(rooms).sort((a, b) => b.createdAt - a.createdAt) });
    }
    if (request.method !== "POST") return json({ error: "허용되지 않은 요청입니다." }, 405);

    const input = await request.json();
    if (input?._directoryUpdate) {
      const rooms = (await this.ctx.storage.get("rooms")) || {};
      if (input.remove) delete rooms[input.room.id];
      else rooms[input.room.id] = input.room;
      await this.ctx.storage.put("rooms", rooms);
      return json({ ok: true });
    }

    const title = cleanText(input.title, 30);
    const nickname = cleanText(input.nickname, 12);
    const capacity = Number(input.capacity);
    const password = cleanText(input.password, 4);
    if (!title || nickname.length < 2) return json({ error: "방 제목과 닉네임을 확인해주세요." }, 400);
    if (![2, 4, 6, 8, 10].includes(capacity)) return json({ error: "지원하지 않는 정원입니다." }, 400);
    if (password && !/^\d{4}$/.test(password)) return json({ error: "비밀번호는 숫자 4자리입니다." }, 400);

    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    const response = await this.env.ROOMS.getByName(roomName(id)).fetch("https://room/create", {
      method: "POST",
      body: JSON.stringify({ id, title, nickname, capacity, password }),
    });
    const result = await response.json();
    if (!response.ok) return json(result, response.status);
    const rooms = (await this.ctx.storage.get("rooms")) || {};
    rooms[id] = result.room;
    await this.ctx.storage.put("rooms", rooms);
    return json(result, 201);
  }
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/create" && request.method === "POST") return this.create(request);
    if (path === "/join" && request.method === "POST") return this.join(request);
    if (path === "/state" && request.method === "GET") return this.getState(request);
    if (path === "/ws" && request.headers.get("Upgrade") === "websocket") return this.connect(request);
    return json({ error: "방 요청을 찾을 수 없습니다." }, 404);
  }

  async load() {
    return this.ctx.storage.get("room");
  }

  async save(room, notifyDirectory = true) {
    room.updatedAt = Date.now();
    await this.ctx.storage.put("room", room);
    if (notifyDirectory) await this.updateDirectory(room);
  }

  summary(room) {
    return {
      id: room.id,
      title: room.title,
      host: room.members.find((m) => m.id === room.hostId)?.name || "",
      capacity: room.capacity,
      playerCount: room.members.length,
      locked: Boolean(room.password),
      status: room.status,
      createdAt: room.createdAt,
    };
  }

  publicRoom(room) {
    return {
      id: room.id,
      title: room.title,
      host: room.members.find((m) => m.id === room.hostId)?.name || "",
      hostId: room.hostId,
      capacity: room.capacity,
      locked: Boolean(room.password),
      mapId: room.mapId,
      status: room.status,
      members: room.members.map(publicMember),
      winner: room.winner || null,
    };
  }

  async updateDirectory(room, remove = false) {
    await this.env.LOBBY.getByName("global").fetch("https://lobby/rooms", {
      method: "POST",
      body: JSON.stringify({ _directoryUpdate: true, room: this.summary(room), remove }),
    });
  }

  async create(request) {
    if (await this.load()) return json({ error: "이미 생성된 방입니다." }, 409);
    const input = await request.json();
    const hostToken = token();
    const host = {
      id: crypto.randomUUID(), name: cleanText(input.nickname, 12), team: "A",
      ready: true, characterId: "soldier", token: hostToken,
      connected: false, hp: 100, alive: true, x: -520, y: 0, dir: 0,
    };
    const room = {
      id: input.id, title: cleanText(input.title, 30), capacity: Number(input.capacity),
      password: cleanText(input.password, 4), mapId: "crossroads", status: "lobby",
      hostId: host.id, members: [host], createdAt: Date.now(), updatedAt: Date.now(), winner: null,
    };
    await this.save(room, false);
    return json({ room: this.publicRoom(room), token: hostToken, playerId: host.id });
  }

  async join(request) {
    const room = await this.load();
    if (!room) return json({ error: "존재하지 않는 방입니다." }, 404);
    const input = await request.json();
    const nickname = cleanText(input.nickname, 12);
    if (room.status !== "lobby") return json({ error: "이미 게임이 시작된 방입니다." }, 409);
    if (room.password && room.password !== cleanText(input.password, 4)) return json({ error: "비밀번호가 맞지 않습니다." }, 403);
    const existing = room.members.find((m) => m.name.toLowerCase() === nickname.toLowerCase());
    if (existing) return json({ error: "이미 사용 중인 닉네임입니다." }, 409);
    if (room.members.length >= room.capacity) return json({ error: "정원이 가득 찼습니다." }, 409);
    const perTeam = room.capacity / 2;
    const countA = room.members.filter((m) => m.team === "A").length;
    const team = countA < perTeam ? "A" : "B";
    const member = {
      id: crypto.randomUUID(), name: nickname, team, ready: false,
      characterId: "soldier", token: token(), connected: false,
      hp: 100, alive: true, x: team === "A" ? -520 : 520, y: 0,
      dir: team === "A" ? 0 : Math.PI,
    };
    room.members.push(member);
    await this.save(room);
    this.broadcast(room);
    return json({ room: this.publicRoom(room), token: member.token, playerId: member.id });
  }

  auth(room, request) {
    const supplied = new URL(request.url).searchParams.get("token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return room.members.find((m) => m.token === supplied) || null;
  }

  async getState(request) {
    const room = await this.load();
    if (!room) return json({ error: "존재하지 않는 방입니다." }, 404);
    const member = this.auth(room, request);
    if (!member) return json({ error: "방 인증이 필요합니다." }, 401);
    return json({ room: this.publicRoom(room), playerId: member.id });
  }

  async connect(request) {
    const room = await this.load();
    if (!room) return json({ error: "존재하지 않는 방입니다." }, 404);
    const member = this.auth(room, request);
    if (!member) return json({ error: "방 인증이 필요합니다." }, 401);
    const [client, server] = Object.values(new WebSocketPair());
    const attachment = { playerId: member.id, roomId: room.id };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`player:${member.id}`]);
    member.connected = true;
    await this.save(room);
    server.send(JSON.stringify({ type: "welcome", playerId: member.id, room: this.publicRoom(room) }));
    this.broadcast(room, { type: "presence", playerId: member.id, connected: true }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(room, payload = null, except = null) {
    const message = JSON.stringify(payload || { type: "room", room: this.publicRoom(room) });
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      try { socket.send(message); } catch { /* stale socket */ }
    }
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 4096 || message === "ping") return;
    let data;
    try { data = JSON.parse(message); } catch { return; }
    const attachment = ws.deserializeAttachment();
    const room = await this.load();
    const member = room?.members.find((m) => m.id === attachment?.playerId);
    if (!room || !member) return ws.close(4001, "Unauthorized");

    if (data.type === "state") return this.handleState(room, member, data, ws);
    if (data.type === "hit") return this.handleHit(room, member, data);
    if (data.type !== "action" || room.status !== "lobby") return;
    const changed = this.handleLobbyAction(room, member, data);
    if (!changed) return;
    await this.save(room);
    this.broadcast(room);
    if (data.action === "start" && room.status === "playing") {
      this.broadcast(room, { type: "start", room: this.publicRoom(room) });
    }
  }

  handleLobbyAction(room, member, data) {
    if (data.action === "ready" && member.id !== room.hostId) member.ready = Boolean(data.value);
    else if (data.action === "character" && ALLOWED_CHARACTERS.has(data.value)) {
      member.characterId = data.value;
      if (member.id !== room.hostId) member.ready = false;
    } else if (data.action === "team" && ["A", "B"].includes(data.value)) {
      const count = room.members.filter((m) => m.team === data.value).length;
      if (member.team === data.value || count >= room.capacity / 2) return false;
      member.team = data.value;
      if (member.id !== room.hostId) member.ready = false;
    } else if (data.action === "map" && member.id === room.hostId && ALLOWED_MAPS.has(data.value)) room.mapId = data.value;
    else if (data.action === "kick" && member.id === room.hostId && data.value !== room.hostId) {
      const index = room.members.findIndex((m) => m.id === data.value);
      if (index < 0) return false;
      room.members.splice(index, 1);
      for (const socket of this.ctx.getWebSockets(`player:${data.value}`)) socket.close(4003, "Kicked");
    } else if (data.action === "start" && member.id === room.hostId) {
      const teams = new Set(room.members.map((m) => m.team));
      if (room.members.length < 2 || teams.size < 2 || !room.members.filter((m) => m.id !== room.hostId).every((m) => m.ready)) return false;
      room.status = "playing";
      room.winner = null;
      const teamOffsets = { A: 0, B: 0 };
      for (const player of room.members) {
        const offset = (teamOffsets[player.team]++ - 1) * 85;
        player.hp = 100; player.alive = true;
        player.x = player.team === "A" ? -520 : 520;
        player.y = offset; player.dir = player.team === "A" ? 0 : Math.PI;
      }
    } else return false;
    return true;
  }

  async handleState(room, member, data, ws) {
    if (room.status !== "playing" || !member.alive) return;
    const now = Date.now();
    if (member.lastStateAt && now - member.lastStateAt < 35) return;
    const x = Number(data.x); const y = Number(data.y); const dir = Number(data.dir);
    if (![x, y, dir].every(Number.isFinite)) return;
    member.x = Math.max(-1200, Math.min(1200, x));
    member.y = Math.max(-700, Math.min(700, y));
    member.dir = dir; member.lastStateAt = now;
    await this.ctx.storage.put("room", room);
    this.broadcast(room, { type: "state", player: publicMember(member) }, ws);
  }

  async handleHit(room, attacker, data) {
    if (room.status !== "playing" || !attacker.alive) return;
    const target = room.members.find((m) => m.id === data.targetId);
    if (!target?.alive || target.team === attacker.team) return;
    const dx = attacker.x - target.x; const dy = attacker.y - target.y;
    if (dx * dx + dy * dy > 1600 * 1600) return;
    const now = Date.now();
    if (attacker.lastHitAt && now - attacker.lastHitAt < 35) return;
    attacker.lastHitAt = now;
    const maxDamage = DAMAGE_LIMITS[attacker.characterId] || 40;
    const damage = Math.max(1, Math.min(maxDamage, Number(data.damage) || 1));
    target.hp = Math.max(0, target.hp - damage);
    target.alive = target.hp > 0;
    const slowed = attacker.characterId === "frog";
    const aliveTeams = new Set(room.members.filter((m) => m.alive).map((m) => m.team));
    if (aliveTeams.size <= 1) {
      room.status = "finished";
      room.winner = [...aliveTeams][0] || null;
    }
    await this.save(room);
    this.broadcast(room, { type: "hit", attackerId: attacker.id, targetId: target.id, damage, hp: target.hp, alive: target.alive, slowed });
    if (room.status === "finished") this.broadcast(room, { type: "finish", winner: room.winner, room: this.publicRoom(room) });
  }

  async webSocketClose(ws) {
    await this.disconnect(ws);
  }

  async webSocketError(ws) {
    await this.disconnect(ws);
  }

  async disconnect(ws) {
    const attachment = ws.deserializeAttachment();
    const room = await this.load();
    const member = room?.members.find((m) => m.id === attachment?.playerId);
    if (!member) return;
    member.connected = false;
    if (room.status === "lobby") {
      const wasHost = member.id === room.hostId;
      room.members = room.members.filter((m) => m.id !== member.id);
      if (wasHost && room.members.length) room.hostId = room.members[0].id;
      if (!room.members.length) {
        await this.ctx.storage.delete("room");
        await this.updateDirectory(room, true);
        return;
      }
    }
    await this.save(room);
    this.broadcast(room);
  }
}
