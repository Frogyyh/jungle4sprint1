import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const ALLOWED_CHARACTERS = new Set([
  "gunslinger", "bulwark", "sentinel", "soldier", "frog",
  "reaper", "hunter", "ninja", "sniper", "demolitionist",
]);
const ALLOWED_MAPS = new Set([
  "crossroads", "offset", "open-lanes", "ruined-garden",
  "frost-fortress", "brush-maze", "sunscar-canyon",
]);
const ALLOWED_PROJECTILES = new Set([
  "dual_pistols", "shield_pistol", "rifle", "frog", "frog-auto-bubble",
  "shotgun", "dagger", "bolt_action",
]);
const DAMAGE_LIMITS = {
  gunslinger: 34, bulwark: 45, sentinel: 38, soldier: 35, frog: 18,
  reaper: 48, hunter: 55, ninja: 65, sniper: 100, demolitionist: 85,
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: JSON_HEADERS,
});

const cleanText = (value, max = 32) => String(value ?? "").trim().slice(0, max);
// 전원이 끊긴 방을 지우기까지 기다리는 시간. 화면 이동(방 → 게임) 중의 공백을 넘긴다.
const EMPTY_ROOM_GRACE_MS = 20000;
const BOT_NAMES = ["봇 알파", "봇 브라보", "봇 찰리", "봇 델타", "봇 에코", "봇 폭스"];
const roomName = (id) => `room:${id}`;
const token = () => `${crypto.randomUUID()}-${crypto.randomUUID()}`;
const publicMember = (member) => ({
  id: member.id,
  name: member.name,
  team: member.team,
  ready: member.ready,
  characterId: member.characterId,
  connected: Boolean(member.connected),
  bot: Boolean(member.bot),
  hp: member.hp,
  alive: member.alive,
  x: member.x,
  y: member.y,
  dir: member.dir,
  // 결과창 전적. 킬·딜량·명중은 서버가 세고, 발사 수만 클라이언트가 보고한다.
  kills: member.kills || 0,
  damage: member.damage || 0,
  shots: member.shots || 0,
  hits: member.hits || 0,
});

/* 스킬 효과 중계값. 그림에만 쓰이지만 그대로 흘려보내지 않고 모양을 강제한다.
   t = 개구리 혀끝 [x, y], m = 근접 휘두름 [방향, 사거리, 색]. */
const numbers = (value, count) =>
  Array.isArray(value) && value.length === count && value.every(Number.isFinite)
    ? value.map((n) => Math.round(n * 100) / 100)
    : null;

const numberRows = (value, count, limit) => {
  if (!Array.isArray(value)) return null;
  const rows = value.slice(0, limit).map((row) => numbers(row, count)).filter(Boolean);
  return rows.length ? rows : null;
};

const cleanFx = (fx) => {
  if (!fx || typeof fx !== "object") return null;
  const cleaned = {};
  const tongue = numbers(fx.t, 2);
  const melee = numbers(fx.m, 5); // [방향, 사거리, 색, 측면, 진행률]
  const dash = numbers(fx.d, 3);
  const barrier = numbers(fx.b, 1);
  const railCharge = numbers(fx.r, 1);
  const scythe = numbers(fx.s, 4);
  const summons = numberRows(fx.u, 2, 3);
  const grenades = numberRows(fx.g, 6, 8); // [id, 종류, x, y, 남은 신관, 전체 신관]
  const smokes = numberRows(fx.o, 6, 4);
  const flashShield = numbers(fx.f, 2);
  const railBeam = numbers(fx.l, 3);
  const reveal = numbers(fx.v, 1);
  const launcherLanding = numbers(fx.p, 2); // 유탄 착탄 지점
  if (tongue) cleaned.t = tongue;
  if (melee) cleaned.m = melee;
  if (dash) cleaned.d = dash;
  if (barrier) cleaned.b = barrier;
  if (railCharge) cleaned.r = railCharge;
  if (scythe) cleaned.s = scythe;
  if (summons) cleaned.u = summons;
  if (grenades) cleaned.g = grenades;
  if (smokes) cleaned.o = smokes;
  if (flashShield) cleaned.f = flashShield;
  if (railBeam) cleaned.l = railBeam;
  if (reveal) cleaned.v = reveal;
  if (launcherLanding) cleaned.p = launcherLanding;
  return Object.keys(cleaned).length ? cleaned : null;
};

const clearStats = (member) => {
  member.kills = 0;
  member.damage = 0;
  member.shots = 0;
  member.hits = 0;
};

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
      kills: 0, damage: 0, shots: 0, hits: 0,
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
      kills: 0, damage: 0, shots: 0, hits: 0,
    };
    room.members.push(member);
    await this.save(room);
    this.broadcast(room);
    return json({ room: this.publicRoom(room), token: member.token, playerId: member.id });
  }

  auth(room, request) {
    const supplied = new URL(request.url).searchParams.get("token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    // 봇은 토큰이 없다(null). 빈 토큰이 봇과 맞아떨어지지 않게 먼저 막는다.
    if (!supplied) return null;
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
    // 끝난 방에 다시 들어오면 대기실로 되돌린다 — 그래야 결과창의 "방으로" 가
    // 죽은 방이 아니라 다음 판을 준비할 수 있는 방으로 이어진다.
    if (room.status === "finished") {
      room.status = "lobby";
      room.winner = null;
      for (const player of room.members) {
        player.hp = 100;
        player.alive = true;
        player.ready = player.bot || player.id === room.hostId; // 봇은 언제나 준비 완료
        clearStats(player);
      }
    }
    // 누군가 들어왔으니 빈 방 정리 예약을 취소한다.
    await this.ctx.storage.deleteAlarm();
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
    if (data.type === "shot") return this.handleShot(room, member, data, ws);
    if (data.type === "leave") return this.handleLeave(room, member, ws);
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
    } else if (data.action === "addbot" && member.id === room.hostId) {
      /* 봇은 방 인원을 채우는 가짜 참가자다. 토큰이 없어 접속할 수 없고,
         게임 중에는 방장 화면이 AI 를 돌려 위치·피격을 대신 보고한다. */
      if (room.members.length >= room.capacity) return false;
      const perTeam = room.capacity / 2;
      // 누른 자리의 팀에 넣는다. 그 팀이 꽉 찼으면 자리가 남은 쪽으로.
      const wanted = ["A", "B"].includes(data.value) ? data.value : null;
      const roomFor = (side) => room.members.filter((m) => m.team === side).length < perTeam;
      const team = wanted && roomFor(wanted) ? wanted : roomFor("A") ? "A" : "B";
      const name = BOT_NAMES.find((n) => !room.members.some((m) => m.name === n))
        || `봇 ${room.members.length + 1}`;
      // 직업은 무작위 — 매번 같은 병과만 나오면 연습이 단조롭다.
      const pool = [...ALLOWED_CHARACTERS];
      const characterId = pool[Math.floor(Math.random() * pool.length)];
      room.members.push({
        id: crypto.randomUUID(), name, team, ready: true, characterId,
        token: null, connected: false, bot: true,
        hp: 100, alive: true, x: team === "A" ? -520 : 520, y: 0,
        dir: team === "A" ? 0 : Math.PI,
        kills: 0, damage: 0, shots: 0, hits: 0,
      });
    } else if (data.action === "botcharacter" && member.id === room.hostId) {
      // 방장이 봇의 직업을 바꾼다. 사람의 직업은 본인만 바꿀 수 있다.
      const target = room.members.find((m) => m.id === data.value?.id && m.bot);
      if (!target || !ALLOWED_CHARACTERS.has(data.value?.characterId)) return false;
      target.characterId = data.value.characterId;
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
        clearStats(player); // 새 판이니 전적도 새로 센다
        player.x = player.team === "A" ? -520 : 520;
        player.y = offset; player.dir = player.team === "A" ? 0 : Math.PI;
      }
    } else return false;
    return true;
  }

  /* 보고의 주체. 보통은 보낸 사람 자신이고, 방장이 자기 화면에서 돌리는 봇을
     대신 보고할 때만 그 봇이 된다. 봇이 아닌 남을 사칭하는 건 막는다. */
  subjectOf(room, sender, data) {
    if (!data.playerId || data.playerId === sender.id) return sender;
    if (sender.id !== room.hostId) return null;
    return room.members.find((m) => m.id === data.playerId && m.bot) || null;
  }

  async handleState(room, sender, data, ws) {
    const member = this.subjectOf(room, sender, data);
    if (!member) return;
    if (room.status !== "playing" || !member.alive) return;
    const now = Date.now();
    if (member.lastStateAt && now - member.lastStateAt < 35) return;
    const x = Number(data.x); const y = Number(data.y); const dir = Number(data.dir);
    if (![x, y, dir].every(Number.isFinite)) return;
    member.x = Math.max(-1200, Math.min(1200, x));
    member.y = Math.max(-700, Math.min(700, y));
    member.dir = dir; member.lastStateAt = now;
    // 명중률을 내려면 발사 수가 필요한데 서버는 총알을 모른다. 클라이언트가 세어 보낸다.
    const shots = Number(data.shots);
    if (Number.isFinite(shots) && shots > (member.shots || 0)) member.shots = Math.min(9999, Math.floor(shots));
    const fx = cleanFx(data.fx);
    member.skillFx = fx;
    member.skillFxAt = now;
    if (member.characterId === "bulwark") {
      if (fx?.b) {
        if (!member.barrierActive) member.barrierHp = 250;
        member.barrierActive = true;
        member.barrierHp = Math.min(member.barrierHp ?? 250, fx.b[0]);
      } else {
        member.barrierActive = false;
      }
    }
    await this.ctx.storage.put("room", room);
    this.broadcast(room, { type: "state", player: publicMember(member), fx }, ws);
  }

  /* 발사 중계. 총알은 각 화면이 스스로 만들기 때문에, 쏜 사실을 알려주지 않으면
     남의 총알이 아예 보이지 않는다. 피해 판정은 여전히 handleHit 이 맡는다. */
  async handleShot(room, sender, data, ws) {
    const member = this.subjectOf(room, sender, data);
    if (!member || room.status !== "playing" || !member.alive) return;
    const x = Number(data.x); const y = Number(data.y); const dir = Number(data.dir);
    if (![x, y, dir].every(Number.isFinite)) return;
    const weaponId = ALLOWED_PROJECTILES.has(data.weaponId) ? data.weaponId : null;
    // 샷건은 한 번에 여러 발이라 여유를 두되, 무한 스팸은 막는다.
    const now = Date.now();
    member.shotBurst = now - (member.lastShotAt || 0) < 120 ? (member.shotBurst || 0) + 1 : 0;
    member.lastShotAt = now;
    if (member.shotBurst > 12) return;
    this.broadcast(room, {
      type: "shot",
      playerId: member.id,
      characterId: member.characterId,
      weaponId,
      x, y, dir,
    }, ws);
  }

  /* 방을 아주 떠날 때(결과창 → 로비). 접속만 끊긴 것과 구분해서 바로 정리한다. */
  async handleLeave(room, member, ws) {
    room.members = room.members.filter((m) => m.id !== member.id);
    // 사람이 아무도 남지 않으면 봇만 남은 빈 방이다 — 유예 없이 지운다.
    if (!room.members.some((m) => !m.bot)) {
      await this.ctx.storage.delete("room");
      await this.updateDirectory(room, true);
      try { ws.close(1000, "left"); } catch { /* 이미 닫힘 */ }
      return;
    }
    if (member.id === room.hostId) room.hostId = room.members.find((m) => !m.bot).id;
    await this.save(room);
    this.broadcast(room);
    try { ws.close(1000, "left"); } catch { /* 이미 닫힘 */ }
  }

  async handleHit(room, sender, data) {
    const attacker = this.subjectOf(room, sender, data);
    if (!attacker) return;
    if (room.status !== "playing" || !attacker.alive) return;
    const target = room.members.find((m) => m.id === data.targetId);
    if (!target?.alive || target.team === attacker.team) return;
    const dx = attacker.x - target.x; const dy = attacker.y - target.y;
    if (dx * dx + dy * dy > 1600 * 1600) return;
    const now = Date.now();
    // 같은 순간에 몰려오는 여러 히트(샷건 펠릿, 근접 다중 타격)는 버스트로 묶어 허용한다.
    if (attacker.lastHitAt && now - attacker.lastHitAt < 35) {
      attacker.hitBurst = (attacker.hitBurst || 0) + 1;
      if (attacker.hitBurst > 8) return;
    } else {
      attacker.hitBurst = 0;
    }
    attacker.lastHitAt = now;
    const maxDamage = DAMAGE_LIMITS[attacker.characterId] || 40;
    const damage = Math.max(1, Math.min(maxDamage, Number(data.damage) || 1));
    const recentSkillState = now - (target.skillFxAt || 0) < 250;
    if (target.characterId === "hunter" && recentSkillState && target.skillFx?.d?.[0] === 1) return;
    if (target.characterId === "bulwark" && recentSkillState && target.barrierActive && target.barrierHp > 0) {
      const attackAngle = Math.atan2(attacker.y - target.y, attacker.x - target.x);
      const delta = Math.atan2(Math.sin(attackAngle - target.dir), Math.cos(attackAngle - target.dir));
      if (Math.abs(delta) <= Math.PI / 6) {
        target.barrierHp = Math.max(0, target.barrierHp - damage);
        if (target.barrierHp <= 0) target.barrierActive = false;
        await this.ctx.storage.put("room", room);
        this.broadcast(room, { type: "barrier", playerId: target.id, hp: target.barrierHp, damage });
        return;
      }
    }
    const dealt = Math.min(damage, target.hp);
    target.hp = Math.max(0, target.hp - damage);
    target.alive = target.hp > 0;
    // 결과창 전적 — 실제로 깎인 체력만 딜량으로 센다.
    attacker.hits = (attacker.hits || 0) + 1;
    attacker.damage = (attacker.damage || 0) + dealt;
    if (!target.alive) attacker.kills = (attacker.kills || 0) + 1;
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

  /* 유예 시간이 지난 뒤에도 사람이 없으면 방을 지운다. */
  async alarm() {
    const room = await this.load();
    if (!room) return;
    if (room.members.some((member) => !member.bot && member.connected)) return;
    await this.ctx.storage.delete("room");
    await this.updateDirectory(room, true);
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
      // 방장이 나가면 사람에게만 넘긴다. 봇은 방장이 될 수 없다.
      if (wasHost) room.hostId = room.members.find((m) => !m.bot)?.id || room.hostId;
      // 봇만 남은 방은 빈 방이다.
      if (!room.members.some((m) => !m.bot)) {
        await this.ctx.storage.delete("room");
        await this.updateDirectory(room, true);
        return;
      }
    } else if (room.members.every((m) => m.bot || !m.connected)) {
      /* 게임 중·게임 후에는 잠깐 끊긴 사람을 바로 내보내지 않는다(재접속 여지).
         전원이 끊기면 빈 방이지만, 방 화면 → 게임 화면으로 넘어가는 순간에도
         잠깐 전원이 끊긴 것처럼 보인다. 바로 지우면 그 틈에 방이 사라진다.
         그래서 알람을 걸어 두고, 유예 시간이 지나도 아무도 없으면 지운다. */
      await this.save(room);
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_GRACE_MS);
      return;
    }
    await this.save(room);
    this.broadcast(room);
  }
}
