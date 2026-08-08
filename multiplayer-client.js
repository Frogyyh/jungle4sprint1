(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("multiplayer") !== "1") return;

  // 밸런스 모듈 — 원격 효과/판정 수치도 balance.js 단일 원본을 참조한다.
  const B = window.BREACHLINE_BALANCE;

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
  const remoteFx = new Map(); // playerId → 원격 스킬 효과 메시
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

  function maxHpFor(characterId) {
    return B.operators?.[characterId]?.hp || B.player.hp;
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
    game.player.maxHp = own?.maxHp ?? maxHpFor(own?.characterId);
    game.player.hp = own?.hp ?? game.player.maxHp;
    game.player.alive = own?.alive !== false;
    game.player.syncMesh();

    for (const member of room.members) {
      if (member.id === playerId) continue;
      const position = game.player.pos.clone().set(member.x ?? 0, member.y ?? 0);
      /* 상대의 병과를 그대로 입힌다 — 스프라이트(operatorId)와 무기가 여기서 갈린다.
         이게 없으면 모두가 내 무기를 든 군인으로 보인다. */
      const weapon = member.characterId === "frog"
        ? (game.frogWeapon || game.operatorWeapons?.frog || game.player.weapon)
        : (game.operatorWeapons?.[member.characterId] || game.player.weapon);
      const actor = new Bot(`net-${member.id.slice(0, 6)}`, position, weapon);
      actor.operatorId = member.characterId || "soldier";
      actor.ammo = weapon.magSize;
      actor.reserve = weapon.reserve;
      /* 봇은 방장 화면에서만 AI 로 움직인다(_bot). 나머지 참가자에게는
         다른 사람과 똑같이 서버가 보내주는 위치를 따라가는 액터(_remote)다. */
      const myBot = Boolean(member.bot) && iAmHost;
      actor._bot = myBot;
      actor._remote = !myBot;
      actor._networkPlayerId = member.id;
      actor._targetPos = position.clone();
      actor._targetDir = member.dir ?? 0;
      actor.team = member.team === own?.team ? "player" : "enemy";
      actor.maxHp = member.maxHp ?? maxHpFor(member.characterId);
      actor.hp = member.hp ?? actor.maxHp;
      actor.alive = member.alive !== false;
      actor.dir = member.dir ?? 0;
      actor.mesh.visible = actor.alive;
      paintActor(actor, member);
      actor.syncMesh();
      game.entityGroup.add(actor.mesh);
      // 스프라이트·무기 모델을 실제로 붙인다.
      game.applyWeaponVisual?.(actor, weapon.id);
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
      if (actor._remoteGunKataActive) actor.mesh.rotation.z = actor._remoteGunKataRotation;
    }
  }

  function applyMemberState(member) {
    if (member.id === playerId) return;
    const actor = actors.get(member.id);
    if (!actor || actor._bot) return; // 내가 돌리는 봇은 내 화면이 기준이다
    actor._targetPos.set(member.x, member.y);
    actor._targetDir = member.dir;
    actor.maxHp = member.maxHp ?? maxHpFor(member.characterId);
    actor.hp = member.hp;
    actor.alive = member.alive;
    actor.mesh.visible = member.alive;
  }

  function installGameHooks() {
    if (!game || game._multiplayerHooksInstalled) return;
    game._multiplayerHooksInstalled = true;
    const originalRendererRender = game.renderer.render.bind(game.renderer);
    game.renderer.render = function renderWithRemoteFxVisibility(scene, camera) {
      syncRemoteFxVisibility();
      return originalRendererRender(scene, camera);
    };
    const originalStart = game.startRound.bind(game);
    game.startRound = function startMultiplayerRound() {
      originalStart();
      clearRemoteFx();
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
      // 남의 총알이 준 피해는 서버가 정한다 — 화면에서 미리 깎지 않는다.
      if (source?._remote) return;
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

    /* 총알은 각 화면이 스스로 만든다. 내가(또는 내 봇이) 쏜 사실을 서버로 보내
       다른 화면에서도 같은 총알이 생기게 한다. 이게 없으면 상대 총알이 보이지 않는다. */
    const originalSpawn = game.spawnProjectile.bind(game);
    game.spawnProjectile = function networkSpawn(source, position, direction, weapon) {
      originalSpawn(source, position, direction, weapon);

      /* 총알 색으로 편을 가른다 — 병과별 색은 예쁘지만 교전 중에는
         "내 편이 쏜 것인가"가 먼저 보여야 한다. */
      const shooterId = controlledId(source);
      if (!shooterId || !active || this.phase !== "playing") return;
      send({
        type: "shot",
        playerId: shooterId,
        x: position.x,
        y: position.y,
        dir: Math.atan2(direction.y, direction.x),
        weaponId: weapon?.id || source.weapon?.id || null,
      });
    };

    const segmentHitsCircle = (start, end, center, radius) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSq = dx * dx + dy * dy;
      const amount = lengthSq > 1e-9
        ? Math.max(0, Math.min(1, ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSq))
        : 0;
      const px = start.x + dx * amount;
      const py = start.y + dy * amount;
      return (center.x - px) ** 2 + (center.y - py) ** 2 <= radius * radius;
    };

    const originalUpdateProjectiles = game.updateProjectiles.bind(game);
    game.updateProjectiles = function updateProjectilesAgainstRemoteSummons(dt) {
      originalUpdateProjectiles(dt);
      for (let index = this.projectiles.length - 1; index >= 0; index--) {
        const projectile = this.projectiles[index];
        const attackerId = controlledId(projectile.source);
        if (!attackerId || !projectile._prevPos) continue;
        let hit = null;
        for (const [ownerId, entry] of remoteFx) {
          if (entry.actor?.team !== "enemy") continue;
          const marker = (entry.summons || []).find((summon) => segmentHitsCircle(
            projectile._prevPos,
            projectile.pos,
            summon.position,
            21,
          ));
          if (marker) {
            hit = { ownerId, marker };
            break;
          }
        }
        if (!hit) continue;
        send({
          type: "summon-hit",
          playerId: attackerId,
          ownerId: hit.ownerId,
          summonId: hit.marker.userData.summonId,
          damage: projectile.damage,
        });
        this.removeProjectile(index);
      }
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
      const slowed = actor === this.player && performance.now() < (this._networkSlowUntil || 0);
      const movement = slowed ? delta.clone().multiplyScalar(this._networkSlowMult ?? 0.7) : delta;
      originalMoveActor(actor, movement);
    };

    /* 투망 둔화·덫 포박을 상대(사람)에게 전파한다. operator-system.js 의
       applyControlEffect 가 이 훅을 호출한다(있을 때만). */
    game._onControlEffect = (target, factor, seconds) => {
      if (!active || game.phase !== "playing") return;
      const targetId = networkIdOf(target);
      if (targetId && targetId !== playerId && target.team !== game.player.team) {
        send({ type: "snare", targetId, mult: factor, ms: Math.round(seconds * 1000) });
      }
    };

    /* 상단 인원 표시용 팀 카운트 — 아군(사람)은 game.bots 에 없어 누락되므로,
       서버 기준 전체 로스터(room.members)를 팀·생존 기준으로 센다. */
    game.getTeamCounts = () => {
      if (!active || !room?.members?.length) return null;
      const myTeam = findMember(playerId)?.team;
      if (!myTeam) return null;
      let ally = 0;
      let enemy = 0;
      for (const member of room.members) {
        if (member.alive === false) continue;
        if (member.team === myTeam) ally += 1;
        else enemy += 1;
      }
      return { ally, enemy };
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
        fx: localFx(),
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

  /* ---------------- 남의 스킬 그리기 ----------------
     스킬 효과는 각 화면이 자기 것만 만든다. 그래서 남의 개구리 혀나 근접 휘두름이
     전혀 보이지 않았다. 쓰는 쪽이 위치 갱신에 효과 상태를 얹어 보내고,
     받는 쪽이 같은 자리에 같은 모양을 그린다(판정은 서버 몫, 이건 그림뿐이다). */

  const stripMesh = (color, opacity = 0.9) => {
    const strip = game.floor.clone(false);
    strip.geometry = game.floor.geometry.clone();
    strip.material = game.floor.material.clone();
    strip.material.color.setHex(color);
    strip.material.transparent = true;
    strip.material.depthWrite = false;
    strip.material.opacity = opacity;
    game.fxGroup.add(strip);
    return strip;
  };

  const placeStrip = (strip, from, to, width) => {
    const params = game.floor.geometry?.parameters || {};
    const baseWidth = params.width || 2600;
    const baseHeight = params.height || 1800;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    strip.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, 22);
    strip.rotation.z = Math.atan2(dy, dx);
    strip.scale.set(length / baseWidth, width / baseHeight, 1);
  };

  const disposeStrip = (strip) => {
    strip.parent?.remove(strip);
    strip.geometry?.dispose?.();
    strip.material?.dispose?.();
  };

  /* 내 화면에서 지금 켜져 있는 효과를 요약한다. 위치 전송에 함께 실린다. */
  function localFx() {
    const fx = {};
    const tip = game._tongueTip;
    if (tip) fx.t = [Math.round(tip.x), Math.round(tip.y)];
    const swing = game._meleeSwing;
    if (swing && game.now < swing.until) {
      const progress = Math.min(1, Math.max(0, (game.now - swing.startedAt) / Math.max(0.01, swing.until - swing.startedAt)));
      fx.m = [
        Number(swing.direction.toFixed(2)), Math.round(swing.range), swing.color,
        swing.side, Number(progress.toFixed(2)),
      ];
    }
    const dash = game._operatorDash;
    if (dash && game.now < dash.until) {
      const kind = { gunslinger: 0, hunter: 1, ninja: 2 }[dash.kind];
      if (kind !== undefined) {
        const progress = Math.min(1, Math.max(0, (game.now - dash.startedAt) / Math.max(0.01, dash.until - dash.startedAt)));
        fx.d = [kind, Number(game.player.dir.toFixed(2)), Number(progress.toFixed(2))];
      }
    }
    if (game._barrier?.active) fx.b = [Math.max(0, Math.round(game._barrier.hp))];
    if (game._railChargeStartedAt !== null && !game._railNeedsRelease) {
      fx.r = [Math.min(1, Math.max(0, Number((game.now - game._railChargeStartedAt).toFixed(2))))];
    }
    const scythe = game._scytheThrow;
    if (scythe) {
      fx.s = [
        Math.round(scythe.pos.x), Math.round(scythe.pos.y), scythe.out ? 1 : 0,
        Number((scythe.rot || 0).toFixed(2)),
      ];
    }
    if (game._summons?.length) {
      fx.u = game._summons.slice(0, 3).map((summon) => [
        summon.id, Math.round(summon.pos.x), Math.round(summon.pos.y), Math.max(0, Math.round(summon.hp)),
      ]);
    }
    const grenadeType = { flash: 0, smoke: 1, frag: 2, launcher: 3 };
    const ownGrenades = (game.grenades || []).filter((grenade) => grenade.owner === game.player && grenadeType[grenade.type] !== undefined);
    if (ownGrenades.length) {
      fx.g = ownGrenades.slice(0, 8).map((grenade) => [
        Math.floor(Number(grenade.id) || 0), grenadeType[grenade.type],
        Math.round(grenade.pos.x), Math.round(grenade.pos.y),
        Number(Math.max(0, grenade.fuse || 0).toFixed(2)),
        Number(Math.max(0, grenade.initialFuse || grenade.fuse || 0).toFixed(2)),
      ]);
    }
    // 유탄발사기 직사 유탄의 착탄 지점 — 받는 쪽에 폭발 범위를 그린다
    const directFire = (game.grenades || []).find((grenade) => grenade.directFire && grenade.owner === game.player);
    if (directFire) fx.p = [Math.round(directFire.targetPos.x), Math.round(directFire.targetPos.y)];
    const ownSmokes = (game.smokes || []).filter((smoke) => smoke.owner === game.player && smoke.endAt > game.now);
    if (ownSmokes.length) {
      fx.o = ownSmokes.slice(0, 4).map((smoke) => [
        Math.floor(Number(smoke.id) || (smoke.pos.x * 100003 + smoke.pos.y)),
        Math.round(smoke.pos.x), Math.round(smoke.pos.y), Math.round(smoke.radius),
        smoke.radius >= 200 ? 1 : 0, Number(Math.max(0, smoke.endAt - game.now).toFixed(2)),
      ]);
    }
    const flashSerial = Number.parseFloat(game.canvas.dataset.lastFlashShield || "");
    if (Number.isFinite(flashSerial)) fx.f = [flashSerial, Number(game.player.dir.toFixed(2))];
    const railSerial = game.activeOperatorId === "sentinel" ? game.player.shots : 0;
    if (railSerial > 0) {
      const halfWidth = (game.camera.right - game.camera.left) / 2;
      const halfHeight = (game.camera.top - game.camera.bottom) / 2;
      fx.l = [railSerial, Number(game.player.dir.toFixed(2)), Math.round(Math.hypot(halfWidth, halfHeight))];
    }
    if (game._revealUntil > game.now) {
      fx.v = [Number((game._revealUntil - game.now).toFixed(2)), game._revealRange || B.operators.sentinel.reveal.range];
    }
    // 스나이퍼 투망 비행 위치 — [x, y]
    if (game._net) fx.N = [Math.round(game._net.pos.x), Math.round(game._net.pos.y)];
    // 스나이퍼 덫 위치 — 아군·적군 모두에게 보인다. [[x, y], ...]
    if (game._traps?.length) fx.T = game._traps.slice(0, 3).map((trap) => [Math.round(trap.pos.x), Math.round(trap.pos.y)]);
    // RB-08 헤비 레이저 발사 — [발사 시리얼, 방향, 사거리, 반폭]
    if (game.activeOperatorId === "sentinel" && (game._heavyLaserShots || 0) > 0) {
      const halfWidth = (game.camera.right - game.camera.left) / 2;
      const halfHeight = (game.camera.top - game.camera.bottom) / 2;
      fx.L = [game._heavyLaserShots, Number(game.player.dir.toFixed(2)), Math.round(Math.hypot(halfWidth, halfHeight)), B.operators.sentinel.heavyLaser.halfWidth];
    }
    return Object.keys(fx).length ? fx : null;
  }

  const markerMesh = (color, scale = 0.45, opacity = 0.8) => {
    const marker = game.player.body.clone(false);
    marker.geometry = game.player.body.geometry.clone();
    marker.material = game.player.body.material.clone();
    marker.material.color.setHex(color);
    marker.material.transparent = true;
    marker.material.depthWrite = false;
    marker.material.opacity = opacity;
    marker.scale.setScalar(scale);
    game.fxGroup.add(marker);
    return marker;
  };

  const disposeMarker = (marker) => {
    marker?.parent?.remove(marker);
    marker?.geometry?.dispose?.();
    marker?.material?.dispose?.();
  };

  const syncPointMarkers = (entry, key, points, color, scale, xIndex = 0, yIndex = 1) => {
    const markers = entry[key] || [];
    while (markers.length < points.length) markers.push(markerMesh(color, scale));
    while (markers.length > points.length) disposeMarker(markers.pop());
    points.forEach((point, index) => markers[index].position.set(point[xIndex], point[yIndex], 24));
    entry[key] = markers;
  };

  /* 덫 위험 구역 링(반경 radius)을 선명한 선으로 그린다. 덫은 정적이라 위치가
     바뀔 때만 재배치하면 된다. 색/투명도는 visibility 단계에서 팀별로 준다. */
  const TRAP_RING_SEGMENTS = 20;
  const syncTrapRings = (entry, points) => {
    const rings = entry.trapRings || [];
    const need = points.length * TRAP_RING_SEGMENTS;
    while (rings.length < need) rings.push(stripMesh(B.operators.sniper.trap.color, 0.4));
    while (rings.length > need) disposeStrip(rings.pop());
    const radius = B.operators.sniper.trap.radius;
    points.forEach((point, trapIndex) => {
      for (let seg = 0; seg < TRAP_RING_SEGMENTS; seg++) {
        const angleA = seg / TRAP_RING_SEGMENTS * Math.PI * 2;
        const angleB = (seg + 1) / TRAP_RING_SEGMENTS * Math.PI * 2;
        placeStrip(rings[trapIndex * TRAP_RING_SEGMENTS + seg],
          { x: point[0] + Math.cos(angleA) * radius, y: point[1] + Math.sin(angleA) * radius },
          { x: point[0] + Math.cos(angleB) * radius, y: point[1] + Math.sin(angleB) * radius }, 3);
      }
    });
    entry.trapRings = rings;
  };

  const detonateRemoteGrenade = (actor, grenade) => {
    grenade.telegraph?.remove();
    const type = ["flash", "smoke", "frag", "launcher"][grenade.type];
    if (!type) return disposeMarker(grenade.mesh);
    const previousChildren = new Set(game.fxGroup.children);
    game.explode({ type, pos: actor.pos.clone().set(grenade.x, grenade.y), owner: actor, mesh: grenade.mesh });
    for (const child of game.fxGroup.children) {
      if (!previousChildren.has(child)) child.userData.remoteFxOwner = actor;
    }
  };

  const syncRemoteGrenades = (actor, entry, rows = []) => {
    entry.grenades ||= new Map();
    const activeIds = new Set();
    for (const [id, type, x, y, fuse, initialFuse] of rows) {
      activeIds.add(id);
      let grenade = entry.grenades.get(id);
      if (!grenade) {
        const colors = [0xffe67d, 0x9bb5ff, 0xff6b67, 0xffa8f0];
        const mesh = markerMesh(colors[type] || 0xffffff, type === 3 ? 0.5 : 0.34, 0.95);
        game.styleGrenadeMesh?.({ type: ["flash", "smoke", "frag", "launcher"][type], mesh });
        let telegraph = null;
        if (type !== 3) {
          telegraph = document.createElement("div");
          telegraph.className = "throw-telegraph";
          telegraph.innerHTML = '<div class="telegraph-sweep"></div><div class="telegraph-core"><span class="telegraph-icon">!</span></div><span class="telegraph-time">0.0s</span>';
          document.querySelector("#throw-telegraphs")?.appendChild(telegraph);
        }
        grenade = {
          id, type, x, y, fuse, initialFuse, mesh, telegraph,
          trail: type === 3 ? stripMesh(0xffa8f0, 0.55) : null, // 직사 유탄 비행 궤적
          prevX: x,
          prevY: y,
        };
        entry.grenades.set(id, grenade);
      }
      if (grenade.trail) {
        placeStrip(grenade.trail, { x: grenade.prevX, y: grenade.prevY }, { x, y }, 2.6);
      }
      grenade.prevX = x;
      grenade.prevY = y;
      grenade.x = x;
      grenade.y = y;
      grenade.fuse = fuse;
      grenade.initialFuse = initialFuse;
      grenade.mesh.position.set(x, y, 19);
      grenade.mesh.rotation.z += 0.24;
      if (grenade.telegraph && game.positionGrenadeTelegraph) {
        const kind = ["flash", "smoke", "frag", "launcher"][type];
        const radius = game.getGadgetRadius?.(kind) || 100;
        const progress = initialFuse > 0 ? 1 - fuse / initialFuse : 0;
        game.positionGrenadeTelegraph(
          grenade.telegraph,
          actor.pos.clone().set(x, y),
          kind,
          radius,
          progress,
          `${Math.max(0, fuse).toFixed(1)}s`,
          actor.team === "enemy"
        );
      }
    }
    for (const [id, grenade] of [...entry.grenades]) {
      if (activeIds.has(id)) continue;
      if (grenade.trail) disposeStrip(grenade.trail);
      detonateRemoteGrenade(actor, grenade);
      entry.grenades.delete(id);
    }
  };

  const syncRemoteSmokes = (actor, entry, rows = []) => {
    entry.smokeKeys ||= new Set();
    for (const [id, x, y, radius, ninja, remaining] of rows) {
      if (entry.smokeKeys.has(id)) continue;
      const point = actor.pos.clone().set(x, y);
      const existing = (game.smokes || []).find((smoke) => smoke.owner === actor && smoke.pos.distanceTo(point) < 24);
      if (existing) {
        existing.ninjaSmoke = Boolean(ninja);
        existing.radius = radius;
        existing.endAt = game.now + remaining;
        existing.mesh?.scale?.setScalar(radius / 150);
        entry.smokeKeys.add(id);
        continue;
      }
      const mesh = markerMesh(0x9bb5ff, 0.3, 0.35);
      mesh.position.set(x, y, 18);
      const before = game.smokes.length;
      game.explode({ type: "smoke", pos: point, owner: actor, ninjaSmoke: Boolean(ninja), mesh });
      const smoke = game.smokes.length > before ? game.smokes[game.smokes.length - 1] : null;
      if (smoke) {
        smoke.ninjaSmoke = Boolean(ninja);
        smoke.owner = actor;
        smoke.radius = radius;
        smoke.endAt = game.now + remaining;
        smoke.mesh?.scale?.setScalar(radius / 150);
      }
      entry.smokeKeys.add(id);
    }
  };

  const syncBarrier = (actor, entry, barrier) => {
    const strips = entry.barrier || [];
    if (!barrier || !actor.alive) {
      strips.forEach(disposeStrip);
      entry.barrier = [];
      return;
    }
    while (strips.length < 24) {
      const index = strips.length;
      strips.push(stripMesh(0x9bd0ff, index < 12 ? 0.14 : index < 22 ? 0.85 : 0.9));
    }
    const half = B.operators.bulwark.barrier.halfAngleDeg * Math.PI / 360;
    const hpFraction = Math.max(0, Math.min(1, barrier[0] / B.operators.bulwark.barrier.maxHp));
    strips.forEach((strip) => strip.material.color.setHex(hpFraction > 0.35 ? 0x9bd0ff : 0xff8a7a));
    for (let index = 0; index < 12; index++) {
      const a = actor.dir - half + index / 12 * half * 2;
      const b = actor.dir - half + (index + 1) / 12 * half * 2;
      placeStrip(strips[index],
        { x: actor.pos.x + Math.cos(a) * 82, y: actor.pos.y + Math.sin(a) * 82 },
        { x: actor.pos.x + Math.cos(b) * 100, y: actor.pos.y + Math.sin(b) * 100 }, 9);
    }
    for (let index = 0; index < 10; index++) {
      const a = actor.dir - half + index / 10 * half * 2;
      const b = actor.dir - half + (index + 1) / 10 * half * 2;
      const radius = 100 * (0.88 + hpFraction * 0.12);
      placeStrip(strips[12 + index],
        { x: actor.pos.x + Math.cos(a) * radius, y: actor.pos.y + Math.sin(a) * radius },
        { x: actor.pos.x + Math.cos(b) * radius, y: actor.pos.y + Math.sin(b) * radius }, 3);
    }
    [-half, half].forEach((offset, index) => {
      const angle = actor.dir + offset;
      placeStrip(strips[22 + index],
        { x: actor.pos.x + Math.cos(angle) * 55, y: actor.pos.y + Math.sin(angle) * 55 },
        { x: actor.pos.x + Math.cos(angle) * 100, y: actor.pos.y + Math.sin(angle) * 100 }, 3.4);
    });
    entry.barrier = strips;
  };

  const syncRailCharge = (actor, entry, charge) => {
    const strips = entry.railCharge || [];
    if (!charge || !actor.alive) {
      strips.forEach(disposeStrip);
      entry.railCharge = [];
      return;
    }
    while (strips.length < 4) strips.push(stripMesh(strips.length > 1 ? 0x9ef0ff : 0x55f0b0, 0.7));
    const amount = charge[0];
    const direction = { x: Math.cos(actor.dir), y: Math.sin(actor.dir) };
    const perpendicular = { x: -direction.y, y: direction.x };
    const muzzle = { x: actor.pos.x + direction.x * 42, y: actor.pos.y + direction.y * 42 };
    const spread = 54 * (1 - amount) + 14;
    [-1, -0.45, 0.45, 1].forEach((side, index) => {
      const source = {
        x: actor.pos.x + direction.x * (4 + Math.abs(side) * 8) + perpendicular.x * spread * side,
        y: actor.pos.y + direction.y * (4 + Math.abs(side) * 8) + perpendicular.y * spread * side,
      };
      strips[index].material.opacity = 0.35 + amount * 0.5;
      placeStrip(strips[index], source, muzzle, 1.8 + amount * 1.4);
    });
    entry.railCharge = strips;
  };

  const showRemoteBurst = (actor, direction, color, range, halfAngle = 0) => {
    // A rail beam can cross the local vision polygon while its shooter is hidden.
    // Split it into short pieces so only the pieces inside vision are rendered.
    if (!halfAngle) {
      const segmentLength = 42;
      const startDistance = actor.radius + 10;
      const segmentCount = Math.ceil(Math.max(0, range - startDistance) / segmentLength);
      for (let segment = 0; segment < segmentCount; segment++) {
        const fromDistance = startDistance + segment * segmentLength;
        const toDistance = Math.min(range, fromDistance + segmentLength + 1);
        for (const [beamColor, width, opacity] of [[color, 13, 0.82], [0xffffff, 4, 0.92]]) {
          const strip = stripMesh(beamColor, opacity);
          strip.userData.remoteFxOwner = actor;
          placeStrip(strip, {
            x: actor.pos.x + Math.cos(direction) * fromDistance,
            y: actor.pos.y + Math.sin(direction) * fromDistance,
          }, {
            x: actor.pos.x + Math.cos(direction) * toDistance,
            y: actor.pos.y + Math.sin(direction) * toDistance,
          }, width);
          window.setTimeout(() => disposeStrip(strip), 220);
        }
      }
      return;
    }
    const count = 7;
    for (let index = 0; index < count; index++) {
      const angle = direction + (halfAngle ? -halfAngle + index / (count - 1) * halfAngle * 2 : 0);
      const strip = stripMesh(index % 2 ? color : 0xffffff, 0.85);
      strip.userData.remoteFxOwner = actor;
      const start = actor.pos;
      placeStrip(strip, start, {
        x: actor.pos.x + Math.cos(angle) * range,
        y: actor.pos.y + Math.sin(angle) * range,
      }, 5);
      window.setTimeout(() => disposeStrip(strip), 340);
    }
  };

  // RB-08 헤비 레이저 — 넓은 보라색 관통 빔(시야에 걸친 조각만 보이도록 분할)
  const showRemoteHeavyBeam = (actor, direction, range, halfWidth = B.operators.sentinel.heavyLaser.halfWidth) => {
    const segmentLength = 60;
    const startDistance = actor.radius + 10;
    const segmentCount = Math.ceil(Math.max(0, range - startDistance) / segmentLength);
    for (let segment = 0; segment < segmentCount; segment++) {
      const fromDistance = startDistance + segment * segmentLength;
      const toDistance = Math.min(range, fromDistance + segmentLength + 1);
      for (const [beamColor, width, opacity] of [[0xb26cff, halfWidth * 2, 0.4], [0xe6c6ff, halfWidth, 0.6], [0xffffff, 6, 0.9]]) {
        const strip = stripMesh(beamColor, opacity);
        strip.userData.remoteFxOwner = actor;
        placeStrip(strip, {
          x: actor.pos.x + Math.cos(direction) * fromDistance,
          y: actor.pos.y + Math.sin(direction) * fromDistance,
        }, {
          x: actor.pos.x + Math.cos(direction) * toDistance,
          y: actor.pos.y + Math.sin(direction) * toDistance,
        }, width);
        window.setTimeout(() => disposeStrip(strip), 300);
      }
    }
  };

  const syncGunKata = (actor, entry, dash) => {
    const active = dash?.[0] === 0 && actor.alive;
    if (!active) {
      for (const strip of [...(entry.gunKataRing || []), ...(entry.gunKataSpin || [])]) disposeStrip(strip);
      disposeMarker(entry.gunKataPulse);
      entry.gunKataRing = [];
      entry.gunKataSpin = [];
      entry.gunKataPulse = null;
      if (actor._remoteGunKataActive) game.applyWeaponVisual?.(actor, actor.weapon?.id);
      actor._remoteGunKataActive = false;
      actor.mesh.rotation.z = actor.dir;
      return;
    }

    const direction = dash[1];
    const progress = dash[2];
    const radius = 115;
    entry.gunKataRing ||= [];
    entry.gunKataSpin ||= [];
    while (entry.gunKataRing.length < 28) {
      const strip = stripMesh(0xffd166, 0.72);
      strip.userData.remoteFxOwner = actor;
      entry.gunKataRing.push(strip);
    }
    while (entry.gunKataSpin.length < 2) {
      const strip = stripMesh(0xffd166, 0.85);
      strip.userData.remoteFxOwner = actor;
      entry.gunKataSpin.push(strip);
    }
    if (!entry.gunKataPulse) {
      entry.gunKataPulse = markerMesh(0xffd166, 4.8, 0.11);
      entry.gunKataPulse.userData.remoteFxOwner = actor;
    }
    for (let index = 0; index < entry.gunKataRing.length; index++) {
      const a = Math.PI * 2 * index / entry.gunKataRing.length;
      const b = Math.PI * 2 * (index + 1) / entry.gunKataRing.length;
      placeStrip(entry.gunKataRing[index],
        { x: actor.pos.x + Math.cos(a) * radius, y: actor.pos.y + Math.sin(a) * radius },
        { x: actor.pos.x + Math.cos(b) * radius, y: actor.pos.y + Math.sin(b) * radius }, 3.2);
    }
    const spin = direction + progress * Math.PI * 8;
    [-1, 1].forEach((side, index) => {
      const angle = spin + side * Math.PI / 2;
      placeStrip(entry.gunKataSpin[index],
        { x: actor.pos.x + Math.cos(angle) * 13, y: actor.pos.y + Math.sin(angle) * 13 },
        { x: actor.pos.x + Math.cos(angle) * 64, y: actor.pos.y + Math.sin(angle) * 64 }, 3.5);
    });
    entry.gunKataPulse.position.set(actor.pos.x, actor.pos.y, 11);
    entry.gunKataPulse.scale.setScalar(4.4 + Math.sin(progress * Math.PI) * 0.8);
    actor._remoteGunKataActive = true;
    actor._remoteGunKataRotation = spin;
    actor.mesh.rotation.z = spin;
  };

  const applyFlashShield = (actor, entry, flash) => {
    if (!flash || entry.flashSerial === flash[0]) return;
    entry.flashSerial = flash[0];
    const direction = flash[1];
    showRemoteBurst(actor, direction, 0xffe67d, B.operators.bulwark.flashShield.range, B.operators.bulwark.flashShield.halfAngleDeg * Math.PI / 360);
    if (actor.team !== "enemy" || !game.player.alive) return;
    const dx = game.player.pos.x - actor.pos.x;
    const dy = game.player.pos.y - actor.pos.y;
    const delta = Math.atan2(Math.sin(Math.atan2(dy, dx) - direction), Math.cos(Math.atan2(dy, dx) - direction));
    if (Math.hypot(dx, dy) <= B.operators.bulwark.flashShield.range && Math.abs(delta) <= B.operators.bulwark.flashShield.halfAngleDeg * Math.PI / 360) {
      game.player.flashedUntil = Math.max(game.player.flashedUntil, game.now + 1);
    }
  };

  const showMeleeArc = (actor, direction, range, color) => {
    const halfAngle = actor.operatorId === "reaper" ? B.operators.reaper.meleeHalfAngle : B.operators.ninja.meleeHalfAngle;
    const segments = 12;
    for (let index = 0; index < segments; index++) {
      const a = direction - halfAngle + index / segments * halfAngle * 2;
      const b = direction - halfAngle + (index + 1) / segments * halfAngle * 2;
      const strip = stripMesh(color, 0.72);
      strip.userData.remoteFxOwner = actor;
      placeStrip(strip,
        { x: actor.pos.x + Math.cos(a) * range, y: actor.pos.y + Math.sin(a) * range },
        { x: actor.pos.x + Math.cos(b) * range, y: actor.pos.y + Math.sin(b) * range }, 3.8);
      window.setTimeout(() => disposeStrip(strip), 360);
    }
  };

  const syncRemoteMelee = (actor, entry, melee) => {
    if (!melee || !actor.alive) {
      if (entry.meleeAnimating) game.applyWeaponVisual(actor, actor.weapon?.id);
      entry.meleeAnimating = false;
      return;
    }
    const [direction, range, color, side, progress] = melee;
    if (!entry.meleeAnimating || progress < (entry.meleeProgress || 0)) {
      entry.meleeAnimating = true;
      showMeleeArc(actor, direction, range, color);
    }
    entry.meleeProgress = progress;
    const halfAngle = actor.operatorId === "reaper" ? B.operators.reaper.meleeHalfAngle : B.operators.ninja.meleeHalfAngle;
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    const localAngle = side === 1
      ? -halfAngle + eased * halfAngle * 2
      : halfAngle - eased * halfAngle * 2;
    const root = actor._weaponVisualRoot;
    const pieces = root?.children?.length ? root.children : actor.mesh.children;
    for (const piece of pieces.filter((part) => part.userData?.breachlineWeaponPiece || part.userData?.breachlineWeaponClone)) {
      const baseX = piece.userData.breachlineBaseX ?? piece.position.x;
      const baseY = (piece.userData.breachlineBaseY ?? piece.position.y) - 10;
      const cos = Math.cos(localAngle);
      const sin = Math.sin(localAngle);
      piece.position.x = baseX * cos - baseY * sin;
      piece.position.y = 10 + baseX * sin + baseY * cos;
      piece.rotation.z = (piece.userData.breachlineBaseRotation || 0) + localAngle;
    }
  };

  const createRemoteScythe = (actor) => {
    const source = actor._weaponVisualRoot;
    if (!source) return markerMesh(0xc59bff, 0.72, 0.9);
    const scythe = source.clone(true);
    scythe.traverse((part) => {
      if (part.geometry) part.geometry = part.geometry.clone();
      if (Array.isArray(part.material)) part.material = part.material.map((material) => material.clone());
      else if (part.material) part.material = part.material.clone();
    });
    source.visible = false;
    scythe.userData.remoteFxOwner = actor;
    game.fxGroup.add(scythe);
    return scythe;
  };

  const disposeRemoteScythe = (actor, scythe) => {
    if (!scythe) return;
    scythe.parent?.remove(scythe);
    scythe.traverse((part) => {
      part.geometry?.dispose?.();
      if (Array.isArray(part.material)) part.material.forEach((material) => material.dispose?.());
      else part.material?.dispose?.();
    });
    if (actor?._weaponVisualRoot) actor._weaponVisualRoot.visible = true;
  };

  function clearRemoteFx(playerId = null) {
    for (const [id, entry] of remoteFx) {
      if (playerId && id !== playerId) continue;
      if (entry.tongue) disposeStrip(entry.tongue);
      if (entry.melee) disposeStrip(entry.melee);
      if (entry.dashGhosts) entry.dashGhosts.forEach(disposeStrip);
      for (const strip of [
        ...(entry.barrier || []), ...(entry.railCharge || []),
        ...(entry.revealRings || []), ...(entry.trapRings || []),
        ...(entry.gunKataRing || []), ...(entry.gunKataSpin || []),
      ]) disposeStrip(strip);
      for (const marker of [entry.dash, entry.reveal, entry.landing, entry.gunKataPulse, entry.net, ...(entry.summons || []), ...(entry.traps || []), ...(entry.trapZones || [])]) {
        disposeMarker(marker);
      }
      const actor = actors.get(id);
      if (actor?._remoteGunKataActive) {
        actor._remoteGunKataActive = false;
        actor.mesh.rotation.z = actor.dir;
      }
      disposeRemoteScythe(actor, entry.scythe);
      for (const grenade of entry.grenades?.values?.() || []) {
        grenade.telegraph?.remove();
        if (grenade.trail) disposeStrip(grenade.trail);
        disposeMarker(grenade.mesh);
      }
      remoteFx.delete(id);
    }
  }

/* 낫 투척 — 회전 블레이드 + 몸체 마커 */

/* 대쉬 — 몸체 마커 + 뒤쪽 잔상 */
const syncRemoteDash = (actor, entry, fx) => {
    if (fx?.d && actor.alive) {
      const colors = [0xffd166, 0x9ef0ff, 0x9bb5ff];
      if (!entry.dash || entry.dashKind !== fx.d[0]) {
        disposeMarker(entry.dash);
        entry.dash = markerMesh(colors[fx.d[0]] || 0xffffff, 1.45, 0.24);
        entry.dashKind = fx.d[0];
      }
      entry.dash.position.set(actor.pos.x, actor.pos.y, 12);
      const back = fx.d[1] + Math.PI;
      entry.dashGhosts ||= [
        stripMesh(colors[fx.d[0]] || 0xffffff, 0.35),
        stripMesh(colors[fx.d[0]] || 0xffffff, 0.2),
      ];
      entry.dashGhosts.forEach((strip, index) => {
        const distance = 24 + index * 20;
        const ox = actor.pos.x + Math.cos(back) * distance;
        const oy = actor.pos.y + Math.sin(back) * distance;
        placeStrip(strip, { x: ox - 9, y: oy }, { x: ox + 9, y: oy }, 6);
      });
    } else if (entry.dash) {
      disposeMarker(entry.dash);
      entry.dash = null;
      if (entry.dashGhosts) {
        entry.dashGhosts.forEach(disposeStrip);
        entry.dashGhosts = null;
      }
    }
  };

  /* 시야 밖 효과는 삭제하지 않고 숨긴다 — 다시 시야에 들어오면 즉시 복원 */
  const setFxVisible = (effect, visible) => {
    if (effect) effect.visible = visible;
  };

  const isEffectVisibleAt = (actor, point) => {
    if (!actor?.alive) return false;
    if (actor.team !== "enemy") return true;
    const probe = {
      pos: game.player.pos.clone().set(point.x, point.y),
      alive: true,
      radius: 2,
      team: actor.team,
    };
    return game.isVisible(game.player, probe, B.vision.coneDegrees, B.vision.maxRange);
  };

  const setRemoteEffectVisible = (actor, effect, alwaysVisible = false) => {
    if (!effect) return;
    effect.visible = actor.alive && (alwaysVisible || isEffectVisibleAt(actor, effect.position));
  };

  const syncRemoteReveal = (actor, entry, reveal) => {
    if (!reveal) {
      disposeMarker(entry.reveal);
      entry.reveal = null;
      for (const strip of entry.revealRings || []) disposeStrip(strip);
      entry.revealRings = [];
      return;
    }
    entry.reveal ||= markerMesh(0xff3b45, 1.65, 0.22);
    entry.reveal.position.set(actor.pos.x, actor.pos.y, 11);
    const range = Math.max(100, Math.min(1200, reveal[1] || B.operators.sentinel.reveal.range));
    const segments = 32;
    const radii = [range * 0.55, range];
    entry.revealRings ||= [];
    while (entry.revealRings.length < segments * radii.length) {
      const strip = stripMesh(0xff5963, 0.42);
      strip.userData.remoteFxOwner = actor;
      entry.revealRings.push(strip);
    }
    entry.revealRings.forEach((strip, index) => {
      const band = Math.floor(index / segments);
      const segment = index % segments;
      const radius = radii[band];
      const angleA = segment / segments * Math.PI * 2;
      const angleB = (segment + 1) / segments * Math.PI * 2;
      placeStrip(strip, {
        x: actor.pos.x + Math.cos(angleA) * radius,
        y: actor.pos.y + Math.sin(angleA) * radius,
      }, {
        x: actor.pos.x + Math.cos(angleB) * radius,
        y: actor.pos.y + Math.sin(angleB) * radius,
      }, band ? 3.2 : 2.2);
    });
  };

  function syncRemoteFxVisibility() {
    for (const [id, entry] of remoteFx) {
      const actor = actors.get(id);
      if (!actor) continue;
      setRemoteEffectVisible(actor, entry.tongue);
      setRemoteEffectVisible(actor, entry.dash);
      setRemoteEffectVisible(actor, entry.scythe);
      setRemoteEffectVisible(actor, entry.reveal);
      setRemoteEffectVisible(actor, entry.gunKataPulse);
      for (const effect of [
        ...(entry.barrier || []), ...(entry.railCharge || []), ...(entry.revealRings || []),
        ...(entry.gunKataRing || []), ...(entry.gunKataSpin || []),
      ]) setRemoteEffectVisible(actor, effect);
      // Reaper summons are deliberate global information and ignore fog of war.
      for (const summon of entry.summons || []) setRemoteEffectVisible(actor, summon, true);
      // 스나이퍼 덫(반투명 깜빡이는 지뢰) — 아군·적군 모두에게 보인다(안개 무시).
      // 아군: 연한 빨강(흐릿) 깜빡임 · 적(게스트): 선명한 빨강 깜빡임.
      const trapCfgV = B.operators.sniper.trap;
      const trapAlly = actor.team === game.player.team;
      const trapColor = trapAlly ? trapCfgV.allyColor : trapCfgV.color;
      const blink = 0.06 + Math.abs(Math.sin(performance.now() / 200)) * 0.14; // 0.06~0.20 깜빡임
      for (const zone of entry.trapZones || []) {
        setRemoteEffectVisible(actor, zone, true);
        zone.material.color.setHex(trapColor);
        zone.material.transparent = true;
        zone.material.opacity = trapAlly ? blink * 0.7 : blink;
      }
      for (const body of entry.traps || []) {
        setRemoteEffectVisible(actor, body, true);
        body.material.color.setHex(trapColor);
        body.material.transparent = true;
        body.material.opacity = blink;
      }
      // 위험 구역 링 — 경계선도 함께 깜빡인다.
      for (const ring of entry.trapRings || []) {
        setRemoteEffectVisible(actor, ring, true);
        ring.material.color.setHex(trapColor);
        ring.material.opacity = (trapAlly ? 0.5 : 0.7) * (0.3 + Math.abs(Math.sin(performance.now() / 200)) * 0.7);
      }
      for (const grenade of entry.grenades?.values?.() || []) {
        const visible = isEffectVisibleAt(actor, grenade.mesh.position);
        setFxVisible(grenade.mesh, visible);
        setFxVisible(grenade.trail, visible);
        if (grenade.telegraph) grenade.telegraph.style.visibility = visible ? "" : "hidden";
      }
    }
    for (const child of game.fxGroup.children) {
      const owner = child.userData?.remoteFxOwner;
      if (owner) setRemoteEffectVisible(owner, child);
    }
    for (const projectile of game.projectiles) {
      const owner = projectile.source;
      if (owner?._remote) projectile.mesh.visible = isEffectVisibleAt(owner, projectile.pos);
    }
    for (const smoke of game.smokes) {
      const owner = smoke.owner;
      if (owner?._remote) smoke.mesh.visible = isEffectVisibleAt(owner, smoke.pos);
    }
  }

  function applyRemoteFx(playerId, fx) {
    const actor = actors.get(playerId);
    if (!actor || actor._bot) return; // 내 봇은 내 화면이 직접 그린다
    const entry = remoteFx.get(playerId) || {};
    entry.actor = actor;

    // 시야·상호작용과 무관하게 항상 동기화해야 하는 것들 (연막 시야 차단, 투척물, 유탄 착탄 지점)
    syncRemoteGrenades(actor, entry, fx?.g || []);
    syncRemoteSmokes(actor, entry, fx?.o || []);
    if (fx?.p) {
      // 유탄발사기 착탄 지점 — 폭발 반경(67) 원
      entry.landing ||= markerMesh(0xffa8f0, B.gadgets.launcher.radius / B.player.radius, 0.14);
      entry.landing.position.set(fx.p[0], fx.p[1], 16);
      entry.landing.scale.setScalar(B.gadgets.launcher.radius / B.player.radius);
      entry.landing.visible = true;
    } else if (entry.landing) {
      disposeMarker(entry.landing);
      entry.landing = null;
    }

    // 피아식별 규칙: 적은 내 시야(원형/부채꼴/연막 내부) 안에 있을 때만 효과가 보인다.
    // Keep synchronizing effects even while the caster is hidden. Visibility is
    // applied per effect position immediately before each render.

    // 개구리 혀 — 사람과 혀끝을 잇는 선
    if (fx?.t && actor.alive) {
      entry.tongue = entry.tongue || stripMesh(0xff739f, 0.95);
      placeStrip(entry.tongue, actor.pos, { x: fx.t[0], y: fx.t[1] }, 8);
    } else if (entry.tongue) {
      disposeStrip(entry.tongue);
      entry.tongue = null;
    }

    // 근접 휘두름 — 무기 휘두르기 애니메이션 + 사거리 호 (상대 수신)
    syncRemoteMelee(actor, entry, fx?.m);
    syncGunKata(actor, entry, fx?.d);

    syncRemoteDash(actor, entry, fx);
    syncBarrier(actor, entry, fx?.b);

    syncRailCharge(actor, entry, fx?.r);

    if (fx?.l && entry.railSerial !== fx.l[0]) {
      entry.railSerial = fx.l[0];
      showRemoteBurst(actor, fx.l[1], 0x55f0b0, fx.l[2]);
    }

    if (fx?.L && entry.heavyLaserSerial !== fx.L[0]) {
      entry.heavyLaserSerial = fx.L[0];
      showRemoteHeavyBeam(actor, fx.L[1], fx.L[2], fx.L[3]);
    }

    // 스나이퍼 투망 — 회전하는 파란 그물 마커
    if (fx?.N) {
      entry.net ||= markerMesh(B.operators.sniper.net.color, 0.95, 0.9);
      entry.net.userData.remoteFxOwner = actor;
      entry.net.position.set(fx.N[0], fx.N[1], 22);
      entry.net.rotation.z += 0.3;
    } else if (entry.net) {
      disposeMarker(entry.net);
      entry.net = null;
    }

    if (fx?.s) {
      entry.scythe ||= createRemoteScythe(actor);
      entry.scythe.position.set(fx.s[0], fx.s[1], 22);
      entry.scythe.rotation.z = fx.s[3];
    } else if (entry.scythe) {
      disposeRemoteScythe(actor, entry.scythe);
      entry.scythe = null;
    }

    // 스나이퍼 덫(반투명 지뢰) — 아군·적군 모두에게 보인다.
    // 위험 구역 디스크(보이는 크기 = radius) + 지뢰 본체 점. 색/투명도는 팀별로 아래 visibility 에서 준다.
    const trapCfg = B.operators.sniper.trap;
    syncPointMarkers(entry, "trapZones", fx?.T || [], trapCfg.color, trapCfg.radius / B.player.radius, 0, 1);
    syncPointMarkers(entry, "traps", fx?.T || [], trapCfg.color, 0.6, 0, 1);
    syncTrapRings(entry, fx?.T || []);

    // 소환수 — 크고 밝은 마커 + 펄스
    syncPointMarkers(entry, "summons", fx?.u || [], 0xd5dde2, 0.95, 1, 2);
    (entry.summons || []).forEach((marker, index) => {
      marker.userData.summonId = fx.u[index][0];
      marker.userData.summonHp = fx.u[index][3];
      marker.userData.summonOwnerId = playerId;
      marker.scale.setScalar(0.95 * (1 + Math.sin(performance.now() / 280 + index * 1.7) * 0.08));
    });

    applyFlashShield(actor, entry, fx?.f);

    syncRemoteReveal(actor, entry, fx?.v);

    remoteFx.set(playerId, entry);
  }

  /* 남이 쏜 총알을 내 화면에도 만든다. 피해는 서버가 정하므로 이 총알은
     맞아도 체력을 깎지 않는다(damageActor 에서 _remote 를 막아둔다). */
  function spawnRemoteShot(message) {
    if (!game || !active) return;
    const actor = actors.get(message.playerId);
    if (!actor || !actor.alive) return;
    const origin = actor.pos.clone().set(message.x, message.y);
    const direction = actor.pos.clone().set(Math.cos(message.dir), Math.sin(message.dir));
    actor.dir = message.dir;
    const specialWeapons = {
      dagger: { ...actor.weapon, id: "dagger", damage: 15, pellets: 1, range: 720, projectileSpeed: 1050, color: 0xdffcff },
      "frog-auto-bubble": { ...actor.weapon, id: "frog-auto-bubble", damage: 2, pellets: 1, range: 334, projectileSpeed: 920, color: 0x83ffad },
    };
    game.spawnProjectile(actor, origin, direction, specialWeapons[message.weaponId] || actor.weapon);
    // The auto-bubble already has its own round projectile. The generic yellow
    // rectangular muzzle flash was the stray block seen by opponents.
    if (message.weaponId === "frog-auto-bubble") return;
    // 총구섬광 — 상대 화면에서도 발사 순간이 보인다
    const flash = markerMesh(0xfff3c4, 0.5, 0.9);
    flash.position.set(message.x, message.y, 24);
    const muzzleStrip = stripMesh(0xffe9b0, 0.85);
    placeStrip(
      muzzleStrip,
      { x: message.x, y: message.y },
      { x: message.x + Math.cos(message.dir) * 22, y: message.y + Math.sin(message.dir) * 22 },
      5,
    );
    window.setTimeout(() => {
      disposeMarker(flash);
      disposeStrip(muzzleStrip);
    }, 100);
  }

  function onMessage(message) {
    if (message.type === "welcome") {
      room = message.room; playerId = message.playerId;
      resolveReady(message.room); return;
    }
    if (message.room) room = message.room;
    if (message.type === "state") {
      applyMemberState(message.player);
      applyRemoteFx(message.player.id, message.fx);
    }
    if (message.type === "barrier" && message.playerId === playerId && game?._barrier) {
      // 서버가 확정한 방벽 체력/파괴를 그대로 반영한다.
      if (message.hp <= 0 && (game._barrier.active || game._barrier.hp > 0)) {
        game.destroyBarrier?.();
        game._barrier.hp = 0;
        game.renderUi();
      } else if (message.hp > 0) {
        game._barrier.hp = message.hp;
        game._barrier.disabledUntil = 0;
        game.renderUi();
      }
    }
    if (message.type === "hit") {
      const actor = actors.get(message.targetId);
      if (actor) { actor.hp = message.hp; actor.alive = message.alive; actor.mesh.visible = message.alive; }
      if (message.slowed) game?.showWaterDrips?.(actor || (message.targetId === playerId ? game.player : null));
      // 라이브 전적(딜량·킬) 갱신 — 결과창/관전 요약이 실시간으로 맞도록.
      if (room?.members) {
        const attackerMember = room.members.find((m) => m.id === message.attackerId);
        if (attackerMember) {
          attackerMember.damage = (attackerMember.damage || 0) + (Number(message.damage) || 0);
          attackerMember.hits = (attackerMember.hits || 0) + 1;
          if (message.alive === false) attackerMember.kills = (attackerMember.kills || 0) + 1;
        }
        const targetMember = room.members.find((m) => m.id === message.targetId);
        if (targetMember) { targetMember.hp = message.hp; targetMember.alive = message.alive; }
      }
      if (message.targetId === playerId && game) {
        game.showDamageDirection?.({ x: message.sourceX, y: message.sourceY });
        game.player.hp = message.hp; game.player.alive = message.alive;
        if (message.slowed) {
          game._networkSlowUntil = performance.now() + B.operators.frog.waterSlow.duration * 1000;
          game._networkSlowMult = B.operators.frog.waterSlow.moveScale;
        }
        game.renderUi();
      }
    }
    if (message.type === "snare" && message.targetId === playerId && game) {
      // 상대의 투망/덫에 걸렸다 — 이동 둔화(또는 포박)를 로컬에 반영한다.
      game._networkSlowUntil = performance.now() + (message.ms || 1000);
      game._networkSlowMult = Number.isFinite(message.mult) ? message.mult : 0.5;
      game.renderUi?.();
    }
    if (message.type === "summon-hit" && message.ownerId === playerId) {
      game.damageSummon?.(message.summonId, message.damage);
    }
    if (message.type === "shot") spawnRemoteShot(message);
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
    remoteFx, // 디버그/테스트: playerId → 원격 효과 상태
    // 방을 아주 떠날 때(결과창 → 로비) 서버에 알려 즉시 정리하게 한다.
    leave() {
      serverEnding = true; // 나가면서 나는 접속 끊김 안내는 띄우지 않는다
      send({ type: "leave" });
    },
    get room() { return room; },
    get playerId() { return playerId; },
  };
  waitForGame();
})();
