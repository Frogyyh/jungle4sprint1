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
/* 병과별 단일 히트 피해 상한 — 클라이언트 balance.js 의 무기/스킬 데미지와 일치시킨다.
   (건슬링거 건카타 50, 센티널 레일건 40, 군인 35, 개구리 18, ...) */
const DAMAGE_LIMITS = {
  gunslinger: 50, bulwark: 45, sentinel: 40, soldier: 35, frog: 18,
  reaper: 48, hunter: 55, ninja: 65, sniper: 100, demolitionist: 85,
};
const CHARACTER_HP = Object.freeze({
  gunslinger: 150, bulwark: 300, sentinel: 100, soldier: 200, frog: 150,
  reaper: 200, hunter: 200, ninja: 150, sniper: 100, demolitionist: 150,
});
const maxHpFor = (characterId) => CHARACTER_HP[characterId] || 100;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: JSON_HEADERS,
});

const cleanText = (value, max = 32) => String(value ?? "").trim().slice(0, max);
// 전원이 끊긴 방을 지우기까지 기다리는 시간. 화면 이동(방 → 게임) 중의 공백을 넘긴다.
const EMPTY_ROOM_GRACE_MS = 20000;
// 게임 종료 → 방 복귀 전환 구간: 소켓이 잠깐 끊겨도 멤버를 지우지 않는다(강제 퇴장 방지).
const TRANSITION_GRACE_MS = 15000;
// 게임 시작 → 게임 화면 전환 구간: 이 시간 안의 이탈은(로딩 지연 포함) 전투 이탈로 보지 않는다.
const START_GRACE_MS = 12000;
// 라운드 제한 시간(클라이언트 03:00 과 동일). 지나면 점수로 승자를 정하고 종료한다.
const ROUND_DURATION_MS = 180000;
// 로비에서 아무 동작 없이 5분 지나면 자동 퇴장.
const IDLE_LIMIT_MS = 300000;
// 로비 유휴 점검 주기.
const IDLE_CHECK_INTERVAL_MS = 60000;
// 목록에서 이 시간 이상 갱신이 없던 방은 유령 방으로 보고 지운다.
// 활성 로비 방은 유휴 알람(60초)마다 저장돼 갱신되고, 게임은 3분 안에 끝나므로 안전하다.
const STALE_ROOM_MS = 360000;
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
  maxHp: maxHpFor(member.characterId),
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
  const summons = numberRows(fx.u, 4, 3);
  const grenades = numberRows(fx.g, 6, 8); // [id, 종류, x, y, 남은 신관, 전체 신관]
  const smokes = numberRows(fx.o, 6, 4);
  const flashShield = numbers(fx.f, 2);
  const railBeam = numbers(fx.l, 3);
  const heavyLaser = numbers(fx.L, 4); // [시리얼, 방향, 사거리, 반폭]
  const netFx = numbers(fx.N, 2); // 투망 비행 위치 [x, y]
  const traps = numberRows(fx.T, 2, 3); // 덫 위치 [[x, y], ...]
  const reveal = numbers(fx.v, 2);
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
  if (heavyLaser) cleaned.L = heavyLaser;
  if (netFx) cleaned.N = netFx;
  if (traps) cleaned.T = traps;
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
      // 유령 방 자가 치유: 오랫동안 갱신이 없던(= 죽었거나 삭제 통지가 누락된) 방을 목록에서 지운다.
      const now = Date.now();
      let pruned = false;
      for (const [id, entry] of Object.entries(rooms)) {
        if (now - (entry.updatedAt || entry.createdAt || 0) > STALE_ROOM_MS) {
          delete rooms[id];
          pruned = true;
        }
      }
      if (pruned) await this.ctx.storage.put("rooms", rooms);
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
    this.roomCache = null;
    this.lastRealtimePersistAt = 0;
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
    if (this.roomCache) return this.roomCache;
    this.roomCache = await this.ctx.storage.get("room");
    return this.roomCache;
  }

  async save(room, notifyDirectory = true) {
    room.updatedAt = Date.now();
    this.roomCache = room;
    await this.ctx.storage.put("room", room);
    if (notifyDirectory) await this.updateDirectory(room);
  }

  async persistRealtime(room, force = false) {
    this.roomCache = room;
    const now = Date.now();
    if (!force && now - this.lastRealtimePersistAt < 30000) return;
    this.lastRealtimePersistAt = now;
    room.updatedAt = now;
    await this.ctx.storage.put("room", room);
  }

  summary(room) {
    return {
      id: room.id,
      title: room.title,
      host: room.members.find((m) => m.id === room.hostId)?.name || "",
      capacity: room.capacity,
      playerCount: room.members.length,
      // 접속 중인 사람 수 — 목록에서 유령 방(전원 나감) 판별에 쓴다.
      humanCount: room.members.filter((m) => !m.bot && m.connected).length,
      locked: Boolean(room.password),
      status: room.status,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt || room.createdAt,
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
    const now = Date.now();
    const host = {
      id: crypto.randomUUID(), name: cleanText(input.nickname, 12), team: "A",
      ready: true, characterId: "soldier", token: hostToken,
      connected: false, hp: maxHpFor("soldier"), alive: true, x: -520, y: 0, dir: 0,
      kills: 0, damage: 0, shots: 0, hits: 0, lastActiveAt: now,
    };
    const room = {
      id: input.id, title: cleanText(input.title, 30), capacity: Number(input.capacity),
      password: cleanText(input.password, 4), mapId: "crossroads", status: "lobby",
      hostId: host.id, members: [host], createdAt: now, updatedAt: now, winner: null,
      emptyAt: now, // 아직 아무도 접속 안 함 — 유예 후 자동 삭제 기준
    };
    await this.save(room, false);
    // 만들고 접속하지 않은 방은 유예 후 자동 삭제(방장이 접속하면 connect 가 취소).
    await this.scheduleAlarm(room);
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
      hp: maxHpFor("soldier"), alive: true, x: team === "A" ? -520 : 520, y: 0,
      dir: team === "A" ? 0 : Math.PI,
      kills: 0, damage: 0, shots: 0, hits: 0, lastActiveAt: Date.now(),
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
      room.reopenedAt = Date.now(); // 방 복귀 전환 구간 시작 — 이탈로 인한 강제 퇴장 방지
      for (const player of room.members) {
        player.hp = maxHpFor(player.characterId);
        player.alive = true;
        player.ready = player.bot || player.id === room.hostId; // 봇은 언제나 준비 완료
        clearStats(player);
      }
    }
    const [client, server] = Object.values(new WebSocketPair());
    const attachment = { playerId: member.id, roomId: room.id };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`player:${member.id}`]);
    member.connected = true;
    member.lastActiveAt = Date.now(); // 방금 접속 = 활동으로 간주(유휴 타이머 리셋)
    room.emptyAt = null;              // 사람이 접속했으니 빈 방 기준 해제
    await this.save(room);
    // 라운드 종료·유휴·빈 방 정리를 위한 알람을 상태에 맞게 다시 건다.
    await this.scheduleAlarm(room);
    server.send(JSON.stringify({ type: "welcome", playerId: member.id, room: this.publicRoom(room) }));
    this.broadcast(room, { type: "presence", playerId: member.id, connected: true }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /* 상태에 맞는 다음 알람을 설정한다: 라운드 종료 시각 / 로비 유휴 점검 / 빈 방 삭제 중 가장 이른 것. */
  async scheduleAlarm(room) {
    const now = Date.now();
    const deadlines = [];
    if (room.status === "playing" && room.roundEndsAt) deadlines.push(room.roundEndsAt);
    if (room.status === "lobby" && room.members.some((m) => !m.bot)) deadlines.push(now + IDLE_CHECK_INTERVAL_MS);
    if (room.emptyAt) deadlines.push(room.emptyAt + EMPTY_ROOM_GRACE_MS);
    if (!deadlines.length) { await this.ctx.storage.deleteAlarm(); return; }
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
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
    if (data.type === "snare") return this.handleSnare(room, member, data);
    if (data.type === "summon-hit") return this.handleSummonHit(room, member, data);
    if (data.type === "shot") return this.handleShot(room, member, data, ws);
    if (data.type === "leave") return this.handleLeave(room, member, ws);
    if (data.type !== "action" || room.status !== "lobby") return;
    member.lastActiveAt = Date.now(); // 로비 동작 = 활동(유휴 타이머 리셋)
    const changed = this.handleLobbyAction(room, member, data);
    if (!changed) return;
    await this.save(room);
    this.broadcast(room);
    if (data.action === "start" && room.status === "playing") {
      this.broadcast(room, { type: "start", room: this.publicRoom(room) });
    }
    // 상태가 바뀌었을 수 있으니 알람(라운드 종료/유휴) 재설정.
    await this.scheduleAlarm(room);
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
      // 봇은 항상 군인(SOLDIER) 병과만 사용한다.
      const characterId = "soldier";
      room.members.push({
        id: crypto.randomUUID(), name, team, ready: true, characterId,
        token: null, connected: false, bot: true,
        hp: maxHpFor(characterId), alive: true, x: team === "A" ? -520 : 520, y: 0,
        dir: team === "A" ? 0 : Math.PI,
        kills: 0, damage: 0, shots: 0, hits: 0,
      });
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
      room.playStartedAt = Date.now(); // 게임 시작 전환 구간 기준
      room.roundEndsAt = Date.now() + ROUND_DURATION_MS; // 제한 시간 종료 시각
      const teamOffsets = { A: 0, B: 0 };
      for (const player of room.members) {
        const offset = (teamOffsets[player.team]++ - 1) * 85;
        player.hp = maxHpFor(player.characterId); player.alive = true;
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
    await this.persistRealtime(room);
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

  async handleSummonHit(room, sender, data) {
    const attacker = this.subjectOf(room, sender, data);
    if (!attacker || room.status !== "playing" || !attacker.alive) return;
    const owner = room.members.find((member) => member.id === data.ownerId);
    const summonId = Number(data.summonId);
    if (!owner || owner.team === attacker.team || owner.characterId !== "reaper" || !Number.isFinite(summonId)) return;
    const summon = owner.skillFx?.u?.find((row) => row[0] === summonId);
    if (!summon || Date.now() - (owner.skillFxAt || 0) > 350) return;
    const dx = attacker.x - summon[1];
    const dy = attacker.y - summon[2];
    if (dx * dx + dy * dy > 1600 * 1600) return;
    const damage = Math.max(1, Math.min(DAMAGE_LIMITS[attacker.characterId] || 40, Number(data.damage) || 1));
    this.broadcast(room, {
      type: "summon-hit",
      attackerId: attacker.id,
      ownerId: owner.id,
      summonId,
      damage,
    });
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
    if (!room.members.some((m) => !m.bot && m.connected)) room.emptyAt = room.emptyAt || Date.now();
    else room.emptyAt = null;
    await this.save(room);
    this.broadcast(room);
    await this.scheduleAlarm(room);
    try { ws.close(1000, "left"); } catch { /* 이미 닫힘 */ }
  }

  async handleHit(room, sender, data) {
    const attacker = this.subjectOf(room, sender, data);
    if (!attacker) return;
    if (room.status !== "playing" || !attacker.alive) return;
    const target = room.members.find((m) => m.id === data.targetId);
    if (!target?.alive || target.team === attacker.team) return;
    const dx = attacker.x - target.x; const dy = attacker.y - target.y;
    // 맵 대각선(약 3200)보다 넉넉히 — 원거리 저격/레일건이 부당하게 무효화되지 않게.
    if (dx * dx + dy * dy > 3600 * 3600) return;
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
        await this.persistRealtime(room);
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
    await this.persistRealtime(room);
    // 클라 라이브 전적이 맞도록 실제 깎인 피해(dealt)를 보낸다.
    this.broadcast(room, {
      type: "hit", attackerId: attacker.id, targetId: target.id,
      damage: dealt, hp: target.hp, alive: target.alive, slowed,
      sourceX: attacker.x, sourceY: attacker.y,
    });
    await this.checkFinish(room);
  }

  /* 한 팀만 생존하면 게임을 종료하고 모두에게 알린다. 여러 경로(피격·이탈)에서 재사용. */
  async checkFinish(room) {
    if (room.status !== "playing") return false;
    const aliveTeams = new Set(room.members.filter((m) => m.alive).map((m) => m.team));
    if (aliveTeams.size > 1) return false;
    room.status = "finished";
    room.winner = [...aliveTeams][0] || null;
    await this.save(room);
    this.broadcast(room, { type: "finish", winner: room.winner, room: this.publicRoom(room) });
    return true;
  }

  /* 제한 시간 종료 시: 팀 킬 합 → 딜량 합 순으로 승자를 정하고 종료한다(동점이면 무승부). */
  async finishByScore(room) {
    if (room.status !== "playing") return false;
    const teamStat = (team) => room.members
      .filter((m) => m.team === team)
      .reduce((sum, m) => ({ kills: sum.kills + (m.kills || 0), damage: sum.damage + (m.damage || 0) }), { kills: 0, damage: 0 });
    const a = teamStat("A");
    const b = teamStat("B");
    let winner = null;
    if (a.kills !== b.kills) winner = a.kills > b.kills ? "A" : "B";
    else if (a.damage !== b.damage) winner = a.damage > b.damage ? "A" : "B";
    room.status = "finished";
    room.winner = winner;
    await this.save(room);
    this.broadcast(room, { type: "finish", winner, room: this.publicRoom(room) });
    return true;
  }

  /* 스나이퍼 투망(둔화)·덫(포박) — 대상 이동 제어를 상대 화면에 전파한다.
     피해가 없으므로 hit 과 분리해 처리한다. */
  handleSnare(room, sender, data) {
    const attacker = this.subjectOf(room, sender, data);
    if (!attacker || room.status !== "playing" || !attacker.alive) return;
    const target = room.members.find((m) => m.id === data.targetId);
    if (!target?.alive || target.team === attacker.team) return;
    const dx = attacker.x - target.x; const dy = attacker.y - target.y;
    if (dx * dx + dy * dy > 3600 * 3600) return;
    const mult = Math.max(0, Math.min(1, Number(data.mult)));
    const ms = Math.max(200, Math.min(3000, Number(data.ms) || 1000));
    this.broadcast(room, { type: "snare", targetId: target.id, mult, ms });
  }

  /* 알람: 라운드 시간 종료 / 로비 유휴 강제 퇴장 / 빈 방 삭제 를 처리하고 다음 알람을 재설정한다. */
  async alarm() {
    const room = await this.load();
    if (!room) return;
    const now = Date.now();

    // 1) 라운드 제한 시간 종료 → 점수로 승자 결정 후 종료.
    if (room.status === "playing" && room.roundEndsAt && now >= room.roundEndsAt) {
      await this.finishByScore(room);
      await this.scheduleAlarm(room);
      return;
    }

    // 2) 로비에서 5분 이상 아무 동작 없는 사람은 강제 퇴장.
    let changed = false;
    if (room.status === "lobby") {
      const kicked = room.members.filter((m) => !m.bot && m.lastActiveAt && now - m.lastActiveAt >= IDLE_LIMIT_MS);
      if (kicked.length) {
        const kickedIds = new Set(kicked.map((m) => m.id));
        room.members = room.members.filter((m) => !kickedIds.has(m.id));
        if (kickedIds.has(room.hostId)) room.hostId = room.members.find((m) => !m.bot)?.id || room.hostId;
        for (const k of kicked) {
          for (const socket of this.ctx.getWebSockets(`player:${k.id}`)) {
            try { socket.close(4004, "idle"); } catch { /* 이미 닫힘 */ }
          }
        }
        changed = true;
      }
    }

    // 3) 사람이 하나도 없으면(봇만 남음) 방을 지운다.
    if (!room.members.some((m) => !m.bot)) {
      await this.ctx.storage.delete("room");
      await this.updateDirectory(room, true);
      return;
    }

    // 4) 접속한 사람이 없고 유예가 지났으면 방을 지운다.
    if (!room.members.some((m) => !m.bot && m.connected)) {
      room.emptyAt = room.emptyAt || now;
      if (now - room.emptyAt >= EMPTY_ROOM_GRACE_MS) {
        await this.ctx.storage.delete("room");
        await this.updateDirectory(room, true);
        return;
      }
    } else {
      room.emptyAt = null;
    }

    if (changed) { await this.save(room); this.broadcast(room); }
    else await this.save(room);
    await this.scheduleAlarm(room);
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
    // 게임 종료 직후 방으로 복귀하는 전환 구간에는 소켓이 잠깐 끊긴다.
    // 이 구간에는 로비 상태여도 멤버를 지우지 않는다(강제 퇴장/방인증 오류 방지).
    const transitioning = room.reopenedAt && Date.now() - room.reopenedAt < TRANSITION_GRACE_MS;
    if (room.status === "lobby" && !transitioning) {
      const wasHost = member.id === room.hostId;
      room.members = room.members.filter((m) => m.id !== member.id);
      // 방장이 나가면 사람에게만 넘긴다. 봇은 방장이 될 수 없다.
      if (wasHost) room.hostId = room.members.find((m) => !m.bot)?.id || room.hostId;
    } else if (room.status === "playing" && !member.bot
      && room.playStartedAt && Date.now() - room.playStartedAt > START_GRACE_MS) {
      /* 게임이 충분히 진행된 뒤(시작 전환 구간 이후)의 사람 이탈은 전투 불능으로 처리한다.
         그래야 상대가 나가버려 종료 판정이 안 나고 무한 진행되는 상황을 막는다. */
      member.alive = false;
      if (await this.checkFinish(room)) return; // 종료됐으면 save+broadcast 완료
    }
    // 사람이 하나도 없으면(봇만 남음) 방을 즉시 지운다.
    if (!room.members.some((m) => !m.bot)) {
      await this.ctx.storage.delete("room");
      await this.updateDirectory(room, true);
      return;
    }
    // 접속한 사람이 없으면 빈 방 삭제 기준 시각을 기록한다(유예 후 알람이 지운다).
    if (!room.members.some((m) => !m.bot && m.connected)) room.emptyAt = room.emptyAt || Date.now();
    else room.emptyAt = null;
    await this.save(room);
    this.broadcast(room);
    await this.scheduleAlarm(room);
  }
}
