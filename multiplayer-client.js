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
  const hostBots = []; // 방장이 직접 돌리는 봇 액터
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
    hostBots.length = 0;
    const own = findMember(playerId);
    const iAmHost = room?.hostId === playerId;
    game.player.pos.set(own?.x ?? -520, own?.y ?? 0);
    game.player.dir = own?.dir ?? 0;
    game.player.hp = own?.hp ?? 100;
    game.player.alive = own?.alive !== false;
    game.player.syncMesh();

    for (const member of room.members) {
      if (member.id === playerId) continue;
      const position = game.player.pos.clone().set(member.x ?? 0, member.y ?? 0);
      const actor = new Bot(`net-${member.id.slice(0, 6)}`, position, game.player.weapon);
      /* 봇은 방장 화면에서만 AI 로 움직인다(_bot). 나머지 참가자에게는
         다른 사람과 똑같이 서버가 보내주는 위치를 따라가는 액터(_remote)다. */
      const myBot = Boolean(member.bot) && iAmHost;
      actor._bot = myBot;
      actor._remote = !myBot;
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
      // 코어의 투사체 판정과 AI 순회는 game.bots 만 훑는다.
      if (actor.team === "enemy" || myBot) game.bots.push(actor);
      if (myBot) hostBots.push(actor);
      actors.set(member.id, actor);
    }
    game.visibilityDirty = true;
    const restart = document.querySelector("#restart-button");
    if (restart) restart.style.display = "none";
  }

  function syncRemoteActors(dt) {
    for (const actor of actors.values()) {
      if (actor._bot) continue; // 방장이 직접 돌리는 봇은 보간 대상이 아니다
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
    if (!actor || actor._bot) return; // 내가 돌리는 봇은 내 화면이 기준이다
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

    /* 피격은 서버가 확정한다. 내가 조종하는 쪽(나 · 방장이면 봇)이 상대를 맞히면
       서버에 보고하고, 체력은 서버가 보내주는 hit 메시지로 맞춘다. */
    const controlledId = (actor) => {
      if (actor === game.player) return playerId;
      return actor?._bot ? actor._networkPlayerId : null;
    };
    const networkIdOf = (actor) =>
      actor === game.player ? playerId : actor?._networkPlayerId || null;

    const originalDamage = game.damageActor.bind(game);
    game.damageActor = function networkDamage(source, target, amount) {
      const attackerId = controlledId(source);
      const targetId = networkIdOf(target);
      if (attackerId && targetId && attackerId !== targetId && source.team !== target.team) {
        const before = target.hp;
        // 내 화면에 있는 봇은 즉시 반영해도 서버가 곧 정정한다. 남(_remote)과 나는 서버에 맡긴다.
        if (target._bot) originalDamage(source, target, amount);
        const dealt = target._bot ? before - target.hp : amount;
        if (dealt > 0) {
          send({ type: "hit", playerId: attackerId, targetId, damage: dealt });
        }
        return;
      }
      if (target === this.player && (source?._remote || source?._bot)) return;
      originalDamage(source, target, amount);
    };

    /* 코어 AI 는 표적이 this.player 로 못박혀 있다. 봇마다 표적을 골라
       잠깐 바꿔치기해서 원본 AI 를 그대로 쓴다. */
    const foesOf = (bot) =>
      [game.player, ...actors.values()].filter(
        (actor) => actor !== bot && actor.alive && actor.team !== bot.team
      );

    const nearestFoe = (bot) => {
      let best = null;
      let bestDistance = Infinity;
      for (const foe of foesOf(bot)) {
        const distance = bot.pos.distanceToSquared(foe.pos) * (bot._aiTarget === foe ? 0.6 : 1);
        if (distance < bestDistance) { bestDistance = distance; best = foe; }
      }
      return best;
    };

    /* 화면 밖 교전을 막는 규칙(quality-pass 의 카메라 제한)은 AI 가 플레이어를
       화면 밖에서 저격하지 못하게 하는 장치다. 봇끼리 붙을 때까지 걸리면
       서로를 못 보고 굳어서, 표적이 내가 아닐 때만 시야 경계를 넓혀 둔다. */
    const widenCamera = () => {
      const camera = game.camera;
      const saved = { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom };
      camera.left = -1e6; camera.right = 1e6; camera.top = 1e6; camera.bottom = -1e6;
      return () => Object.assign(camera, saved);
    };

    const originalUpdateBots = game.updateBots.bind(game);
    game.updateBots = function updateBotsPerTarget(dt) {
      if (!hostBots.length) { originalUpdateBots(dt); return; }
      const realPlayer = this.player;
      const realBots = this.bots;
      try {
        for (const bot of hostBots) {
          if (!bot.alive) continue;
          const target = nearestFoe(bot);
          if (!target) continue;
          bot._aiTarget = target;
          this.player = target;
          this.bots = [bot];
          const restoreCamera = target === realPlayer ? null : widenCamera();
          try { originalUpdateBots(dt); } finally { restoreCamera?.(); }
        }
      } finally {
        this.player = realPlayer;
        this.bots = realBots;
      }
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
      // 방장이 돌리는 봇의 위치도 같은 주기로 대신 보고한다.
      for (const bot of hostBots) {
        if (!bot.alive || now - (bot._sentAt || 0) < 66) continue;
        bot._sentAt = now;
        send({
          type: "state",
          playerId: bot._networkPlayerId,
          x: bot.pos.x,
          y: bot.pos.y,
          dir: bot.dir,
          shots: bot.shots,
        });
      }
      if (now - lastStateSentAt < 66) return;
      lastStateSentAt = now;
      // shots 는 결과창 명중률용 — 서버는 총알을 모른다.
      send({
        type: "state",
        x: this.player.pos.x,
        y: this.player.pos.y,
        dir: this.player.dir,
        shots: this.player.shots,
      });
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

  /* actors: 원격 플레이어의 화면상 액터(playerId → actor).
     아군 관전(lobby-bridge.js)에서 따라갈 대상을 찾는 데 쓴다. */
  window.__multiplayer = {
    ready,
    actors,
    get room() { return room; },
    get playerId() { return playerId; },
  };
  waitForGame();
})();
