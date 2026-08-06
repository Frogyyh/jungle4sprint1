(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("multiplayer") !== "1") return;

  const roomId = params.get("room");
  const stored = JSON.parse(sessionStorage.getItem("breachline.multiplayerSession") || "null");
  let socket = null;
  let game = null;
  let room = null;
  let playerId = stored?.playerId || null;
  let active = false;
  let serverEnding = false;
  let lastStateSentAt = 0;
  const actors = new Map();
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  const send = (payload) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  function wsUrl() {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${location.host}/api/rooms/${encodeURIComponent(roomId)}/ws?token=${encodeURIComponent(stored.token)}`;
  }

  function findMember(id) {
    return room?.members.find((member) => member.id === id);
  }

  function paintActor(actor, member) {
    const own = findMember(playerId);
    const color = member.team === own?.team ? 0x6de6df : 0xff6b66;
    actor.mesh?.traverse((part) => {
      if (!part.material?.color) return;
      part.material = part.material.clone();
      part.material.color.setHex(color);
    });
    if (actor.ring?.material?.color) actor.ring.material.color.setHex(color);
  }

  function removeActor(actor) {
    actor.mesh?.parent?.remove(actor.mesh);
    const index = game.bots.indexOf(actor);
    if (index >= 0) game.bots.splice(index, 1);
  }

  function createRemoteActors() {
    const template = game.bots[0];
    const Bot = template?.constructor;
    if (!Bot) throw new Error("원격 플레이어 액터를 만들 수 없습니다.");
    for (const bot of [...game.bots]) removeActor(bot);
    game.bots.length = 0;
    actors.clear();
    const own = findMember(playerId);
    game.player.pos.set(own?.x ?? -520, own?.y ?? 0);
    game.player.dir = own?.dir ?? 0;
    game.player.hp = own?.hp ?? 100;
    game.player.alive = own?.alive !== false;
    game.player.syncMesh();

    for (const member of room.members) {
      if (member.id === playerId) continue;
      const position = game.player.pos.clone().set(member.x ?? 0, member.y ?? 0);
      const actor = new Bot(`net-${member.id.slice(0, 6)}`, position, game.player.weapon);
      actor._remote = true;
      actor._networkPlayerId = member.id;
      actor._targetPos = position.clone();
      actor._targetDir = member.dir ?? 0;
      actor.team = member.team === own?.team ? "player" : "enemy";
      actor.maxHp = 100; actor.hp = member.hp ?? 100; actor.alive = member.alive !== false;
      actor.dir = member.dir ?? 0;
      actor.mesh.visible = actor.alive;
      paintActor(actor, member);
      actor.syncMesh();
      game.entityGroup.add(actor.mesh);
      if (actor.team === "enemy") game.bots.push(actor);
      actors.set(member.id, actor);
    }
    game.visibilityDirty = true;
    const restart = document.querySelector("#restart-button");
    if (restart) restart.style.display = "none";
  }

  function syncRemoteActors(dt) {
    for (const actor of actors.values()) {
      const blend = Math.min(1, dt * 14);
      actor.pos.lerp(actor._targetPos, blend);
      const delta = Math.atan2(Math.sin(actor._targetDir - actor.dir), Math.cos(actor._targetDir - actor.dir));
      actor.dir += delta * blend;
      actor.syncMesh();
    }
  }

  function applyMemberState(member) {
    if (member.id === playerId) return;
    const actor = actors.get(member.id);
    if (!actor) return;
    actor._targetPos.set(member.x, member.y);
    actor._targetDir = member.dir;
    actor.hp = member.hp;
    actor.alive = member.alive;
    actor.mesh.visible = member.alive;
  }

  function installGameHooks() {
    if (!game || game._multiplayerHooksInstalled) return;
    game._multiplayerHooksInstalled = true;
    const originalStart = game.startRound.bind(game);
    game.startRound = function startMultiplayerRound() {
      originalStart();
      createRemoteActors();
      active = true;
      this.showToast(`ONLINE // TEAM ${findMember(playerId)?.team || "?"}`);
    };

    const originalDamage = game.damageActor.bind(game);
    game.damageActor = function networkDamage(source, target, amount) {
      if (target?._remote && source?.team === "player" && target.team === "enemy") {
        const before = target.hp;
        originalDamage(source, target, amount);
        if (target.hp < before) send({ type: "hit", targetId: target._networkPlayerId, damage: before - target.hp });
        return;
      }
      if (target === this.player && source?._remote) return;
      originalDamage(source, target, amount);
    };

    const originalMoveActor = game.moveActor.bind(game);
    game.moveActor = function networkSlow(actor, delta) {
      const movement = actor === this.player && performance.now() < (this._networkSlowUntil || 0)
        ? delta.clone().multiplyScalar(0.7) : delta;
      originalMoveActor(actor, movement);
    };

    const originalStep = game.step.bind(game);
    game.step = function networkStep(dt) {
      if (active) syncRemoteActors(dt);
      originalStep(dt);
      if (!active || this.phase !== "playing") return;
      const now = performance.now();
      if (now - lastStateSentAt < 66) return;
      lastStateSentAt = now;
      send({ type: "state", x: this.player.pos.x, y: this.player.pos.y, dir: this.player.dir });
    };

    const originalEnd = game.endRound.bind(game);
    game.endRound = function networkEnd(success, reason) {
      if (!serverEnding) return;
      originalEnd(success, reason);
    };
  }

  function finish(winner) {
    if (!game || serverEnding) return;
    serverEnding = true;
    const own = findMember(playerId);
    game.endRound(winner === own?.team, winner === own?.team ? "상대 팀을 전멸시켰습니다." : "우리 팀이 전투불능 상태가 되었습니다.");
  }

  function onMessage(message) {
    if (message.type === "welcome") {
      room = message.room; playerId = message.playerId;
      resolveReady(message.room); return;
    }
    if (message.room) room = message.room;
    if (message.type === "state") applyMemberState(message.player);
    if (message.type === "hit") {
      const actor = actors.get(message.targetId);
      if (actor) { actor.hp = message.hp; actor.alive = message.alive; actor.mesh.visible = message.alive; }
      if (message.targetId === playerId && game) {
        game.player.hp = message.hp; game.player.alive = message.alive;
        if (message.slowed) game._networkSlowUntil = performance.now() + 1000;
        game.renderUi();
      }
    }
    if (message.type === "finish") finish(message.winner);
  }

  function connect() {
    if (!roomId || !stored?.token) return rejectReady(new Error("멀티플레이어 세션이 없습니다."));
    socket = new WebSocket(wsUrl());
    socket.addEventListener("message", (event) => {
      try { onMessage(JSON.parse(event.data)); } catch (error) { console.error(error); }
    });
    socket.addEventListener("close", (event) => {
      if (!serverEnding && game) game.showToast(`NETWORK DISCONNECTED (${event.code})`);
    });
    socket.addEventListener("error", () => rejectReady(new Error("멀티플레이어 서버에 연결할 수 없습니다.")));
  }

  function waitForGame() {
    game = window.__breachline;
    if (!game) return requestAnimationFrame(waitForGame);
    installGameHooks();
    connect();
  }

  window.__multiplayer = { ready, get room() { return room; }, get playerId() { return playerId; } };
  waitForGame();
})();
