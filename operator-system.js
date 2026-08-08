(() => {
  "use strict";

  /* ============================================================
   * frog.js 병합 (2026-08-08) — 원본 frog.js 의 installFrog 를
   * operator-system.js 안으로 이동해 단일 진입점으로 통합했다.
   * 패치 체인 순서를 보존하기 위해 installOperatorSystem() 에서
   * game 준비 확인 직후 installFrog() 를 먼저 호출한다.
   * ============================================================ */

  const installFrog = () => {
    const game = window.__breachline;
    if (!game) {
      requestAnimationFrame(installFrog);
      return;
    }

    // 밸런스 모듈 — 인게임 수치는 balance.js 단일 원본을 참조한다.
    const B = window.BREACHLINE_BALANCE;
    const FROG = B.operators.frog.weapon;
    // Remote frogs must use the Bubble Sprayer, regardless of the local loadout.
    game.frogWeapon = FROG;
    const vec = (x = 0, y = 0) => new game.player.pos.constructor(x, y);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const ATTACHED_VISION_RADIUS = Math.round(B.vision.maxRange * B.operators.frog.attachedVisionRatio); // 시야 최대 거리의 33% → 304
    const TONGUE_PULL_SPEED = B.operators.frog.tongue.pullSpeed;
    const MIN_TONGUE_LENGTH = B.operators.frog.tongue.minLength;
    const WALL_TONGUE_ADJUST = B.operators.frog.tongue.wallAdjust;
    const FROG_MOMENTUM_MAX = B.operators.frog.momentum.max;
    const FROG_MOMENTUM_DAMPING = B.operators.frog.momentum.damping;
    const AUTO_BUBBLE_INTERVAL = B.operators.frog.autoBubbleInterval;
    const AUTO_BUBBLE = {
      id: "frog-auto-bubble",
      name: "SWING BUBBLE",
      damage: B.operators.frog.bubble.damage,
      pellets: 1,
      rpm: 1,
      spreadDeg: 0,
      magSize: 1,
      reserve: 1,
      reload: 1,
      range: ATTACHED_VISION_RADIUS + 30,
      projectileSpeed: B.operators.frog.bubble.speed,
      color: B.operators.frog.bubble.color,
    };
    const isFrog = () => game.activeOperatorId === "frog" || game.player.weapon?.id === "frog";
    let tongue = null;
    let canLaunchTongue = true;
    let spaceHeld = false;
    let rightMouseHeld = false;
    let visionRing = null;
    let nextAutoBubbleAt = 0;
    let autoBubbleCount = 0;
    const frogMomentum = vec();

    const disposeVisionRing = () => {
      if (!visionRing) return;
      game.fxGroup.remove(visionRing);
      visionRing.traverse((part) => {
        if (part.geometry?.dispose) part.geometry.dispose();
        if (part.material?.dispose) part.material.dispose();
      });
      visionRing = null;
    };

    const ensureVisionRing = () => {
      if (visionRing?.parent === game.fxGroup) return;
      disposeVisionRing();
      visionRing = new game.fxGroup.constructor();
      const dotCount = 52;
      for (let index = 0; index < dotCount; index += 1) {
        const angle = Math.PI * 2 * index / dotCount;
        const dot = game.player.body.clone();
        dot.geometry = game.player.body.geometry.clone();
        dot.material = game.player.body.material.clone();
        dot.material.color.setHex(0x55ef82);
        dot.material.transparent = true;
        dot.material.opacity = 0.72;
        dot.material.depthWrite = false;
        dot.scale.setScalar(0.14);
        dot.position.set(
          Math.cos(angle) * ATTACHED_VISION_RADIUS,
          Math.sin(angle) * ATTACHED_VISION_RADIUS,
          25,
        );
        visionRing.add(dot);
      }
      visionRing.visible = false;
      game.fxGroup.add(visionRing);
    };

    const updateVisionRing = (dt) => {
      ensureVisionRing();
      const attached = isFrog() && tongue?.phase === "attached";
      visionRing.visible = attached;
      if (!attached) return;
      visionRing.position.set(game.player.pos.x, game.player.pos.y, 0);
      visionRing.rotation.z += dt * 0.14;
      const pulse = 1 + Math.sin(game.now * 4.5) * 0.012;
      visionRing.scale.set(pulse, pulse, 1);
    };

    const rayWall = (origin, direction, maxDistance, wall) => {
      const minX = wall.x - wall.w / 2;
      const maxX = wall.x + wall.w / 2;
      const minY = wall.y - wall.h / 2;
      const maxY = wall.y + wall.h / 2;
      let near = 0;
      let far = maxDistance;
      if (Math.abs(direction.x) < 1e-8) {
        if (origin.x < minX || origin.x > maxX) return undefined;
      } else {
        const a = (minX - origin.x) / direction.x;
        const b = (maxX - origin.x) / direction.x;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
      if (Math.abs(direction.y) < 1e-8) {
        if (origin.y < minY || origin.y > maxY) return undefined;
      } else {
        const a = (minY - origin.y) / direction.y;
        const b = (maxY - origin.y) / direction.y;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
      return far >= near && near <= maxDistance && far >= 0 ? Math.max(0, near) : undefined;
    };

    const disposeTongue = () => {
      if (!tongue) return;
      game.fxGroup.remove(tongue.group);
      tongue.group.traverse((part) => {
        if (part.geometry && part.geometry.dispose) part.geometry.dispose();
        if (part.material && part.material.dispose) part.material.dispose();
      });
      tongue = null;
      game._tongueTip = null;
      if (visionRing) visionRing.visible = false;
      game.canvas.dataset.tongueState = "idle";
      game.canvas.dataset.tongueLength = "0";
    };

    const renderTongue = () => {
      if (!tongue) return;
      const start = game.player.pos;
      const end = tongue.tipPos;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      tongue.strip.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, 22);
      tongue.strip.rotation.z = Math.atan2(dy, dx);
      tongue.strip.scale.set(Math.max(1, length) / 2600, 8 / 1800, 1);
      tongue.tip.position.set(end.x, end.y, 23);
      game.canvas.dataset.tongueState = tongue.phase;
      game.canvas.dataset.tongueLength = `${Math.round(length)}`;
      // 멀티플레이 중계용 — 다른 화면에도 같은 혀를 그린다.
      game._tongueTip = { x: end.x, y: end.y };
    };

    const beginTongue = () => {
      if (!isFrog() || !canLaunchTongue || tongue || !game.player.alive) return;
      canLaunchTongue = false;
      const direction = game.mouse.world.clone().sub(game.player.pos);
      if (direction.lengthSq() < 1) {
        direction.set(Math.cos(game.player.dir), Math.sin(game.player.dir));
      }
      direction.normalize();

      const group = new game.fxGroup.constructor();
      const strip = game.floor.clone();
      strip.geometry = game.floor.geometry.clone();
      strip.material = game.floor.material.clone();
      strip.material.color.setHex(0xff739f);
      strip.material.transparent = true;
      strip.material.opacity = 0.95;
      const tip = game.player.body.clone();
      tip.geometry = game.player.body.geometry.clone();
      tip.material = game.player.body.material.clone();
      tip.material.color.setHex(0xff9fba);
      tip.scale.setScalar(0.48);
      group.add(strip, tip);
      game.fxGroup.add(group);

      tongue = {
        phase: "extending",
        direction,
        length: game.player.radius,
        maxLength: 700,
        outSpeed: 3600,
        returnSpeed: 4800,
        tipPos: game.player.pos.clone().add(direction.clone().multiplyScalar(game.player.radius)),
        anchor: null,
        angularVelocity: 0,
        releaseVelocity: vec(),
        group,
        strip,
        tip,
      };
      game.showToast("TONGUE — WALLS ONLY");
      renderTongue();
    };

    const releaseTongue = () => {
      if (!tongue || tongue.phase === "retracting") return;
      if (tongue.phase === "attached" && tongue.releaseVelocity.lengthSq() > 1) {
        frogMomentum.copy(tongue.releaseVelocity);
        if (frogMomentum.length() > FROG_MOMENTUM_MAX) frogMomentum.setLength(FROG_MOMENTUM_MAX);
      }
      tongue.phase = "retracting";
      tongue.anchor = null;
      rightMouseHeld = false;
      game.visibilityDirty = true;
    };

    const swing = (dt) => {
      const radial = game.player.pos.clone().sub(tongue.anchor);
      if (radial.lengthSq() < 1) return;
      const previousPosition = game.player.pos.clone();
      const targetLength = rightMouseHeld
        ? Math.max(MIN_TONGUE_LENGTH, tongue.length - TONGUE_PULL_SPEED * dt)
        : tongue.length;
      radial.setLength(targetLength);
      const drive = (game.keys.has("KeyD") ? 1 : 0) - (game.keys.has("KeyA") ? 1 : 0);
      tongue.angularVelocity += drive * 11 * dt;
      tongue.angularVelocity *= Math.pow(drive === 0 ? 0.22 : 0.82, dt);
      tongue.angularVelocity = clamp(tongue.angularVelocity, -4.4, 4.4);
      const angle = tongue.angularVelocity * dt;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotated = vec(
        radial.x * cos - radial.y * sin,
        radial.x * sin + radial.y * cos,
      );
      const candidate = tongue.anchor.clone().add(rotated);
      let resolved = game.collides(candidate, game.player.radius) ? null : candidate;
      let resolvedLength = targetLength;

      if (!resolved) {
        const radialDirection = rotated.clone().normalize();
        for (let adjustment = 8; adjustment <= WALL_TONGUE_ADJUST && !resolved; adjustment += 8) {
          for (const sign of [-1, 1]) {
            const adjustedLength = clamp(targetLength + adjustment * sign, MIN_TONGUE_LENGTH, tongue.maxLength);
            const adjusted = tongue.anchor.clone().add(radialDirection.clone().multiplyScalar(adjustedLength));
            if (game.collides(adjusted, game.player.radius)) continue;
            resolved = adjusted;
            resolvedLength = adjustedLength;
            break;
          }
        }
      }

      if (!resolved) {
        const slideX = previousPosition.clone().set(candidate.x, previousPosition.y);
        const slideY = previousPosition.clone().set(previousPosition.x, candidate.y);
        const options = [slideX, slideY]
          .filter((point) => !game.collides(point, game.player.radius))
          .sort((a, b) => b.distanceToSquared(previousPosition) - a.distanceToSquared(previousPosition));
        if (options.length) {
          resolved = options[0];
          resolvedLength = resolved.distanceTo(tongue.anchor);
        }
      }

      if (resolved) {
        game.player.pos.copy(resolved);
        tongue.length = resolvedLength;
        tongue.releaseVelocity.copy(resolved).sub(previousPosition).multiplyScalar(1 / Math.max(dt, 1 / 240));
        game.visibilityDirty = true;
      } else {
        tongue.angularVelocity *= 0.35;
        tongue.releaseVelocity.multiplyScalar(0.45);
      }
      tongue.tipPos.copy(tongue.anchor);
    };

    const fireSwingBubble = () => {
      if (Math.abs(tongue.angularVelocity) < 0.3 || game.now < nextAutoBubbleAt) return;
      const target = game.bots
        .filter((bot) => (
          bot.alive
          && bot.pos.distanceTo(game.player.pos) <= ATTACHED_VISION_RADIUS
          && !game.smokeBlocks(game.player.pos, bot.pos)
          && !game.rayBlocked(game.player.pos, bot.pos)
        ))
        .sort((a, b) => a.pos.distanceToSquared(game.player.pos) - b.pos.distanceToSquared(game.player.pos))[0];
      if (!target) return;

      const direction = target.pos.clone().sub(game.player.pos).normalize();
      const position = game.player.pos.clone().add(
        direction.clone().multiplyScalar(game.player.radius + 9),
      );
      game.spawnProjectile(game.player, position, direction, AUTO_BUBBLE);
      const projectile = game.projectiles[game.projectiles.length - 1];
      if (projectile) {
        projectile.isAutoBubble = true;
        projectile.mesh.scale.multiplyScalar(0.72);
        projectile.mesh.material.color.setHex(0x83ffad);
      }
      game.player.shots++;
      nextAutoBubbleAt = game.now + AUTO_BUBBLE_INTERVAL;
      autoBubbleCount++;
    };

    const updateTongue = (dt) => {
      if (!tongue) return;
      if (!spaceHeld && tongue.phase !== "retracting") releaseTongue();

      if (tongue.phase === "extending") {
        const origin = game.player.pos;
        const previousLength = tongue.length;
        const nextLength = Math.min(tongue.maxLength, previousLength + tongue.outSpeed * dt);
        let hitDistance = nextLength;
        let wallHit = null;

        for (const wall of game.walls) {
          const distance = rayWall(origin, tongue.direction, nextLength, wall);
          if (distance !== undefined && distance >= previousLength - 10 && distance < hitDistance) {
            hitDistance = distance;
            wallHit = wall;
          }
        }

        tongue.length = hitDistance;
        tongue.tipPos.copy(origin).add(tongue.direction.clone().multiplyScalar(hitDistance));
        if (wallHit) {
          tongue.phase = "attached";
          tongue.anchor = tongue.tipPos.clone();
          tongue.angularVelocity = 0;
          game.visibilityDirty = true;
          game.showToast("WALL GRABBED — A/D SWING · RMB PULL");
        } else if (tongue.length >= tongue.maxLength) {
          releaseTongue();
        }
      } else if (tongue.phase === "attached") {
        swing(dt);
        fireSwingBubble();
      } else if (tongue.phase === "retracting") {
        const toPlayer = game.player.pos.clone().sub(tongue.tipPos);
        const distance = toPlayer.length();
        const travel = tongue.returnSpeed * dt;
        if (distance <= travel + game.player.radius) {
          disposeTongue();
          return;
        }
        tongue.tipPos.add(toPlayer.multiplyScalar(travel / distance));
      }
      updateVisionRing(dt);
      renderTongue();
    };

    const applyAppearance = (frog) => {
      game.player.body.material.color.setHex(frog ? 0x39d36f : 0x6de6df);
      game.player.ring.material.color.setHex(frog ? 0xa4ff8b : 0xc2fff7);
      for (const child of game.player.mesh.children.slice(2)) child.visible = true;
    };

    const originalStartRound = game.startRound.bind(game);
    game.startRound = function startRoundWithFrog() {
      const wantsFrog = this.selectedWeapon === "frog";
      if (wantsFrog) this.selectedWeapon = "rifle";
      disposeTongue();
      disposeVisionRing();
      canLaunchTongue = true;
      spaceHeld = false;
      rightMouseHeld = false;
      nextAutoBubbleAt = 0;
      autoBubbleCount = 0;
      frogMomentum.set(0, 0);
      originalStartRound();
      if (wantsFrog) {
        this.selectedWeapon = "frog";
        this.player.weapon = FROG;
        this.player.ammo = FROG.magSize;
        this.player.reserve = FROG.reserve;
        applyAppearance(true);
        this.renderUi();
        this.showToast("FROG READY — LMB WATER / SPACE TONGUE");
      } else {
        applyAppearance(false);
      }
    };

    const originalSpawnProjectile = game.spawnProjectile.bind(game);
    game.spawnProjectile = function spawnSoapBubble(source, position, direction, weapon) {
      originalSpawnProjectile(source, position, direction, weapon);
      const frogProjectile = source === this.player
        ? isFrog()
        : source?.operatorId === "frog" || ["frog", "frog-auto-bubble"].includes(weapon?.id);
      if (!frogProjectile) return;

      const projectile = this.projectiles[this.projectiles.length - 1];
      if (!projectile) return;
      const oldGeometry = projectile.mesh.geometry;
      projectile.mesh.geometry = this.player.body.geometry.clone();
      oldGeometry.dispose();
      const bubbleColors = [0x7eeeff, 0xa7f4ff, 0x88d8ff, 0xd1fbff];
      projectile.mesh.material.color.setHex(bubbleColors[Math.floor(Math.random() * bubbleColors.length)]);
      projectile.mesh.material.transparent = true;
      projectile.mesh.material.opacity = 0.48 + Math.random() * 0.22;
      projectile.mesh.material.depthWrite = false;
      projectile.mesh.rotation.z = 0;
      projectile.mesh.scale.setScalar(0.24 + Math.random() * 0.22);
      projectile.velocity.multiplyScalar(0.88 + Math.random() * 0.24);
      projectile.remaining *= 0.92 + Math.random() * 0.16;
      projectile.isSoapBubble = true;
    };

    const originalFire = game.fire.bind(game);
    game.fire = function fireWaterGun(actor, angle) {
      if (actor !== this.player || !isFrog()) {
        originalFire(actor, angle);
        return;
      }
      const shakeBefore = this.cameraShake || 0;
      const alertBots = this.alertBotsToGunshot;
      this.alertBotsToGunshot = () => {};
      try {
        originalFire(actor, angle);
      } finally {
        this.alertBotsToGunshot = alertBots;
      }
      this.cameraShake = Math.min(shakeBefore + 0.55, this.cameraShake || 0.55);
      document.querySelector("#muzzle-flash")?.classList.remove("active");
    };

    const originalUpdatePlayer = game.updatePlayer.bind(game);
    game.updatePlayer = function updateFrogPlayer(dt) {
      if (isFrog() && tongue && tongue.phase === "attached") {
        const heldKeys = this.keys;
        this.keys = new Set();
        originalUpdatePlayer(dt);
        this.keys = heldKeys;
      } else {
        originalUpdatePlayer(dt);
      }
      if (isFrog()) updateTongue(dt);
      if (isFrog() && tongue?.phase !== "attached" && frogMomentum.lengthSq() > 1) {
        this.moveActor(this.player, frogMomentum.clone().multiplyScalar(dt));
        const steering = this.keys.has("KeyW") || this.keys.has("KeyA")
          || this.keys.has("KeyS") || this.keys.has("KeyD");
        const damping = steering ? FROG_MOMENTUM_DAMPING * 0.35 : FROG_MOMENTUM_DAMPING;
        frogMomentum.multiplyScalar(Math.pow(damping, dt));
        if (frogMomentum.lengthSq() < 4) frogMomentum.set(0, 0);
      }
    };

    const originalIsVisible = game.isVisible.bind(game);
    game.isVisible = function isVisibleWithAttachedFrog(observer, target, fov, range) {
      if (
        isFrog()
        && tongue?.phase === "attached"
        && observer === this.player
        && target.alive
        && target.pos.distanceTo(this.player.pos) <= ATTACHED_VISION_RADIUS
        && !this.smokeBlocks(this.player.pos, target.pos)
        && !this.rayBlocked(this.player.pos, target.pos)
      ) {
        return true;
      }
      return originalIsVisible(observer, target, fov, range);
    };

    const originalUpdateVisibility = game.updateVisibility.bind(game);
    game.updateVisibility = function updateAttachedFrogVisibility() {
      originalUpdateVisibility();
      if (!isFrog() || tongue?.phase !== "attached" || !this.visibilityMesh?.geometry) return;
      if (this.visibilityMesh.geometry.userData?.frogAttachedVision) return;

      const oldGeometry = this.visibilityMesh.geometry;
      const oldPositions = oldGeometry.getAttribute("position");
      if (!oldPositions) return;

      const positions = Array.from(oldPositions.array);
      const segments = 64;
      const points = [];
      for (let index = 0; index <= segments; index += 1) {
        const angle = Math.PI * 2 * index / segments;
        points.push(this.traceVision(
          this.player.pos,
          vec(Math.cos(angle), Math.sin(angle)),
          ATTACHED_VISION_RADIUS,
        ));
      }
      for (let index = 0; index < segments; index += 1) {
        positions.push(
          this.player.pos.x, this.player.pos.y, 12,
          points[index].x, points[index].y, 12,
          points[index + 1].x, points[index + 1].y, 12,
        );
      }

      const geometry = new oldGeometry.constructor();
      geometry.setAttribute("position", new oldPositions.constructor(positions, 3));
      geometry.userData.frogAttachedVision = true;
      this.visibilityMesh.geometry = geometry;
      oldGeometry.dispose();
    };

    const originalDamageActor = game.damageActor.bind(game);
    game.damageActor = function damageWithWaterSlow(source, target, amount) {
      const hpBefore = target.hp;
      originalDamageActor(source, target, amount);
      if (source === this.player && isFrog() && target.hp < hpBefore) {
        target.slowUntil = this.now + 1;
      }
    };

    const originalMoveBot = game.moveBot.bind(game);
    game.moveBot = function moveSlowedBot(bot, dt, direction) {
      const slowFactor = bot.slowUntil > this.now ? 0.7 : 1;
      originalMoveBot(bot, dt * slowFactor, direction);
    };

    const originalUpdateBots = game.updateBots.bind(game);
    game.updateBots = function updateSlowVisuals(dt) {
      originalUpdateBots(dt);
      for (const bot of this.bots) {
        bot.ring.material.color.setHex(bot.slowUntil > this.now ? 0x8ab4ff : 0xffb0ac);
      }
    };

    const originalRenderUi = game.renderUi.bind(game);
    game.renderUi = function renderFrogUi() {
      originalRenderUi();
      this.canvas.dataset.playerKind = isFrog() ? "frog" : "soldier";
      if (!isFrog()) return;
      applyAppearance(true);
      document.querySelector("#weapon-name").textContent = "FROG BUBBLE SPRAYER";
      document.querySelector("#reload-hint").textContent = tongue && tongue.phase === "attached"
        ? "A/D: SWING · RMB: PULL · RELEASE SPACE"
        : "LMB: WATER GUN · SPACE: WALL TONGUE";
      this.canvas.dataset.botSlows = this.bots
        .map((bot) => Math.max(0, bot.slowUntil - this.now).toFixed(2))
        .join(",");
      this.canvas.dataset.soapBubbles = `${this.projectiles.filter((projectile) => projectile.isSoapBubble).length}`;
      this.canvas.dataset.tongueCooldown = "0.00";
      this.canvas.dataset.tonguePulling = rightMouseHeld ? "true" : "false";
      this.canvas.dataset.frogMomentum = frogMomentum.length().toFixed(1);
      this.canvas.dataset.frogVisionRing = tongue?.phase === "attached" ? "visible" : "hidden";
      this.canvas.dataset.autoBubbles = `${autoBubbleCount}`;
    };

    game.getTongueCooldown = () => 0;

    window.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || event.repeat || game.phase !== "playing" || !isFrog()) return;
      event.preventDefault();
      spaceHeld = true;
      beginTongue();
    });
    window.addEventListener("keyup", (event) => {
      if (event.code !== "Space" || !isFrog()) return;
      event.preventDefault();
      spaceHeld = false;
      canLaunchTongue = true;
      releaseTongue();
    });
    game.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 2 || game.phase !== "playing" || !isFrog()) return;
      if (!tongue || tongue.phase !== "attached") return;
      event.preventDefault();
      rightMouseHeld = true;
    });
    window.addEventListener("pointerup", (event) => {
      if (event.button === 2) rightMouseHeld = false;
    });
    window.addEventListener("blur", () => {
      spaceHeld = false;
      canLaunchTongue = true;
      rightMouseHeld = false;
      releaseTongue();
    });
    game.canvas.dataset.frogInstalled = "true";
    game.canvas.dataset.tongueState = "idle";
    game.canvas.dataset.frogVisionRing = "hidden";
    game.canvas.dataset.autoBubbles = "0";
  };

  const installOperatorSystem = () => {
    const game = window.__breachline;
    const operators = window.BREACHLINE_OPERATORS;
    if (!game || !operators?.length || !game.applyWeaponVisual) {
      requestAnimationFrame(installOperatorSystem);
      return;
    }
    if (game.__operatorSystemInstalled) return;
    game.__operatorSystemInstalled = true;

    // frog 패치를 먼저 적용한다 — operator 패치가 그 위에 감싸
    // 로드 순서(frog → operator)와 동일한 체인이 유지된다.
    installFrog();

    // 밸런스 모듈 — 모든 인게임 수치는 balance.js 단일 원본을 참조한다.
    const B = window.BREACHLINE_BALANCE;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const colorHex = (value) => Number.parseInt(value.slice(1), 16);
    const vector = (x = 0, y = 0) => new game.player.pos.constructor(x, y);
    const directionTo = (from, to) => to.clone().sub(from).normalize();
    const operator = () => window.findBreachlineOperator(game.activeOperatorId || game.selectedOperatorId);
    const isOperator = (id) => game.activeOperatorId === id;
    const SPECIAL_COOLDOWN = B.skills.cooldown;
    const GUN_KATA_RADIUS = B.operators.gunslinger.gunKata.radius; // 원형 공격 범위
    const GUN_KATA_DAMAGE = B.operators.gunslinger.gunKata.damage;
    const SHIELD_VIEW_DEGREES = B.vision.shieldViewDegrees;

    // 아이언 방벽 (라인하르트식): 우클릭 홀드로 전방 60도 부채꼴 방벽 전개
    const BARRIER_MAX_HP = B.operators.bulwark.barrier.maxHp;
    const BARRIER_REGEN_DELAY = B.operators.bulwark.barrier.regenDelay; // 해제 후 1초 뒤부터 재생
    const BARRIER_REGEN_RATE = B.operators.bulwark.barrier.regenRate; // 초당 재생량
    const BARRIER_BREAK_COOLDOWN = B.operators.bulwark.barrier.breakCooldown; // 파괴 시 재사용 불가 시간
    const BARRIER_HALF_ANGLE = B.operators.bulwark.barrier.halfAngleDeg * Math.PI / 360; // 전방 60도 (좌우 30도)
    const BARRIER_INNER = B.operators.bulwark.barrier.inner; // 방벽은 캐릭터로부터 약 75 거리에 전개
    const BARRIER_OUTER = B.operators.bulwark.barrier.outer;

    // 무기표도 밸런스 모듈에서 그대로 끌어온다 (각 병과의 weapon 정의).
    const WEAPONS = Object.freeze(
      Object.fromEntries(
        Object.entries(B.operators)
          .filter(([, definition]) => Boolean(definition.weapon))
          .map(([id, definition]) => [id, definition.weapon]),
      ),
    );

    /* 병과별 무기표를 밖에서도 쓸 수 있게 걸어둔다.
       멀티플레이(multiplayer-client.js)에서 상대 캐릭터에게 같은 무기를 물린다. */
    game.operatorWeapons = WEAPONS;

    const ui = {
      grid: document.querySelector("#operator-loadout-grid"),
      briefing: document.querySelector("#loadout .briefing"),
      operator: document.querySelector("#operator-status"),
      ability: document.querySelector("#ability-status"),
      weapon: document.querySelector("#weapon-name"),
      ammo: document.querySelector("#ammo"),
      reserve: document.querySelector("#reserve"),
      frag: document.querySelector("#frag-gadget"),
      flash: document.querySelector("#flash-gadget"),
      smoke: document.querySelector("#smoke-gadget"),
      fragCount: document.querySelector("#frag-count"),
      flashCount: document.querySelector("#flash-count"),
      smokeCount: document.querySelector("#smoke-count"),
      charge: document.querySelector("#grenade-charge"),
      chargeName: document.querySelector("#grenade-charge-name"),
      chargeBar: document.querySelector("#grenade-charge-bar"),
      chargeRange: document.querySelector("#grenade-charge-range"),
      allyCount: document.querySelector("#team-ally-count"),
      enemyCount: document.querySelector("#team-enemy-count"),
      slot1: document.querySelector("#skill-slot-1"),
      slot2: document.querySelector("#skill-slot-2"),
      skillName1: document.querySelector("#skill-name-1"),
      skillName2: document.querySelector("#skill-name-2"),
    };

    /* 스킬 슬롯 쿨타임 총 길이(초). 회색 오버레이 비율 계산에 쓴다. balance.js 를 단일 원본으로 읽는다.
       스킬 로직은 팀원이 직업별로 채우므로, 값이 바뀌면 balance.js 만 맞추면 여기도 따라간다. */
    const SLOT_COOLDOWN_TOTALS = {
      gunslinger: { secondary: B.operators.gunslinger.spray.cooldown, ability: B.operators.gunslinger.gunKata.cooldown },
      bulwark: { secondary: 0, ability: SPECIAL_COOLDOWN },
      sentinel: { secondary: B.operators.sentinel.heavyLaser.cooldown, ability: B.operators.sentinel.reveal.cooldown },
      soldier: { secondary: B.operators.soldier.flashCooldown, ability: B.operators.soldier.enhance.cooldown },
      frog: { secondary: 0, ability: 0 },
      reaper: { secondary: 0, ability: SPECIAL_COOLDOWN },
      hunter: { secondary: B.operators.hunter.bloodScent.cooldown, ability: B.operators.hunter.dash.cooldown },
      ninja: { secondary: 1, ability: SPECIAL_COOLDOWN },
      sniper: { secondary: B.operators.sniper.net.cooldown, ability: 0 },
      demolitionist: { secondary: B.operators.demolitionist.fragCooldown, ability: B.operators.demolitionist.barrage.cooldown },
    };

    /* 한 슬롯을 갱신한다: 쿨타임 회색 오버레이 높이, 남은 초, 준비/비활성 상태, 개수 배지. */
    const renderSkillSlot = (slotEl, { label, remaining, total, count }) => {
      if (!slotEl) return;
      const fill = slotEl.querySelector(".skill-cd-fill");
      const text = slotEl.querySelector(".skill-cd-text");
      const badge = slotEl.querySelector(".skill-count");
      const empty = !label || label === "-";
      slotEl.classList.toggle("empty", empty);
      const onCooldown = remaining > 0.05;
      const ratio = total > 0 ? clamp(remaining / total, 0, 1) : 0;
      if (fill) fill.style.height = `${ratio * 100}%`;
      if (text) text.textContent = onCooldown ? remaining.toFixed(1) : "";
      slotEl.classList.toggle("ready", !empty && !onCooldown);
      if (badge) {
        if (count === Infinity) { badge.textContent = "∞"; badge.classList.remove("hidden"); }
        else if (count > 0) { badge.textContent = String(count); badge.classList.remove("hidden"); }
        else badge.classList.add("hidden");
      }
    };

    const renderOperatorCards = () => {
      ui.grid.innerHTML = operators.map((item) => `
        <button class="operator-card${item.id === game.selectedOperatorId ? " selected" : ""}"
          type="button" data-operator="${item.id}" style="--operator:${item.color}">
          <span class="operator-symbol">${item.symbol}</span>
          <span class="operator-korean">${item.koreanName}</span>
          <span class="card-title">${item.name}</span>
          <span class="operator-role">${item.role}</span>
          <span class="card-copy">${item.weapon}<br>${item.traits[0]}</span>
        </button>`).join("");
    };

    const selectOperator = (id) => {
      const selected = window.findBreachlineOperator(id);
      game.selectedOperatorId = selected.id;
      game.selectedWeapon = selected.baseWeapon;
      for (const card of ui.grid.querySelectorAll("[data-operator]")) {
        card.classList.toggle("selected", card.dataset.operator === selected.id);
      }
      ui.briefing.textContent = `${selected.symbol} ${selected.koreanName} // ${selected.desc}`;
      document.body.dataset.selectedOperator = selected.id;
    };

    game.selectedOperatorId = window.resolveBreachlineOperatorId(
      new URLSearchParams(location.search).get("character") || "soldier",
    );
    renderOperatorCards();
    selectOperator(game.selectedOperatorId);
    ui.grid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-operator]");
      if (card) selectOperator(card.dataset.operator);
    });

    game._operatorCooldowns = Object.create(null);
    game._summons = [];
    game._traps = []; // 스나이퍼 덫 (아군·적군 모두에게 보임)
    game._trapPlacing = false; // 스나이퍼 덫 설치 모드
    game._trapPreview = null; // 설치 범위 미리보기 메시
    game._net = null; // 스나이퍼 투망 (직접 관리 오브젝트)
    game._barrage = null; // 폭탄마 직선 폭격
    game._summonSerial = 0;
    game._railChargeStartedAt = null;
    game._railNeedsRelease = false;
    game._gunHand = 1;
    game._operatorFx = [];
    game._meleeSwing = null;
    game._summonNavCache = null;

    const cooldownRemaining = (key) => Math.max(0, (game._operatorCooldowns[key] || 0) - game.now);
    const beginCooldown = (key, duration) => { game._operatorCooldowns[key] = game.now + duration; };
    const abilityReady = (key) => cooldownRemaining(key) <= 0;

    const applyAppearance = (selected) => {
      const hex = colorHex(selected.color);
      game.player._breachlineColorPulseSerial = (game.player._breachlineColorPulseSerial || 0) + 1;
      game.player.body.material.color.setHex(hex);
      game.player.ring.material.color.setHex(hex);
      game.applyWeaponVisual(game.player, selected.weaponId);
    };

    const updateGadgetVisibility = () => {
      // 우클릭 투척물: 군인=섬광탄, 폭탄마=수류탄. 스나이퍼 연막탄은 제거됨.
      ui.flash.classList.toggle("hidden", !isOperator("soldier"));
      ui.smoke.classList.add("hidden");
      ui.frag.classList.toggle("hidden", !isOperator("demolitionist"));
    };

    const applyOperator = (selected) => {
      game.activeOperatorId = selected.id;
      game.player.operatorId = selected.id;
      game.player.maxHp = B.operators[selected.id]?.hp || B.player.hp;
      game.player.hp = game.player.maxHp;
      game.player.lastDamageAt = -Infinity;
      game._operatorCooldowns = Object.create(null);
      game._railChargeStartedAt = null;
      game._railNeedsRelease = false;
      game._operatorDash = null;
      game._meleeSwing = null;
      game._revealUntil = 0;
      game._gunHand = 1;
      game.player.radius = 20; // 피격판정 통일 (시각 스프라이트 대비 원활한 판정)
      game._scytheThrow = null;
      // 새 스킬 상태 초기화
      game._spray = null;                 // 존 익 부채꼴 난사
      game._soldierBuffUntil = 0;         // 군인 신체강화
      game._bloodScentUntil = 0;          // 사냥꾼 피냄새 감지
      game._heavyChargeStartedAt = null;  // RB-08 헤비 레이저 충전
      game._heavyLaserHeld = false;
      game._heavyNeedsRelease = false;
      game._heavyLaserShots = 0;
      game._barrage = null;             // 폭탄마 직선 폭격
      game._trapPlacing = false;        // 스나이퍼 덫 설치 모드
      game.player.trapCount = selected.id === "sniper" ? B.operators.sniper.trap.count : 0;
      const scytheSource = game.player._weaponVisualRoot;
      if (scytheSource) scytheSource.visible = true;
      clearSummons();
      clearOperatorFx();
      clearTraps();
      clearNet();
      resetBarrier();

      if (selected.id !== "frog") {
        const weapon = WEAPONS[selected.id] || WEAPONS.soldier;
        game.player.weapon = weapon;
        game.player.ammo = weapon.magSize;
        game.player.reserve = weapon.reserve;
      }
      // 폭탄마 수류탄·군인 섬광탄은 개수 무제한(∞), 스나이퍼 연막탄은 제거됨.
      game.player.fragGrenades = selected.id === "demolitionist" ? Infinity : 0;
      game.player.flashGrenades = selected.id === "soldier" ? Infinity : 0;
      game.player.smokeGrenades = 0;
      game.viewScale = selected.id === "sniper" ? 1.5 : 1;
      game.updateCameraFrustum();
      applyAppearance(selected);
      updateGadgetVisibility();
      game.clearGadget?.();
      document.body.dataset.activeOperator = selected.id;
      game.canvas.dataset.operatorId = selected.id;
      game.canvas.dataset.operatorRoster = operators.map((item) => item.id).join(",");
      game.renderUi();
      game.showToast(`${selected.name} // ${selected.koreanName} READY`);
    };

    const originalStartRound = game.startRound.bind(game);
    game.startRound = function startOperatorRound() {
      const selected = window.findBreachlineOperator(this.selectedOperatorId);
      this.selectedWeapon = selected.baseWeapon;
      originalStartRound();
      applyOperator(selected);
    };

    game.canUseGadget = (type) => (
      (isOperator("soldier") && type === "flash")
      || (isOperator("demolitionist") && type === "frag")
    );
    game.getGadgetCount = (type) => ({
      frag: game.player.fragGrenades || 0,
      flash: game.player.flashGrenades || 0,
      smoke: game.player.smokeGrenades || 0,
    }[type] || 0);

    const createEffectMesh = (color, scale = 0.45) => {
      const mesh = game.player.body.clone(false);
      mesh.geometry = game.player.body.geometry.clone();
      mesh.material = game.player.body.material.clone();
      mesh.material.color.setHex(color);
      mesh.material.transparent = true;
      mesh.material.opacity = 0.95;
      mesh.scale.setScalar(scale);
      return mesh;
    };

    const eachMaterial = (mesh, callback) => {
      mesh.traverse((part) => {
        if (Array.isArray(part.material)) part.material.forEach(callback);
        else if (part.material) callback(part.material);
      });
    };

    const disposeFxMesh = (mesh, sharedGeometry = false) => {
      mesh.parent?.remove(mesh);
      mesh.traverse((part) => {
        if (!sharedGeometry) part.geometry?.dispose?.();
        if (Array.isArray(part.material)) part.material.forEach((material) => material.dispose?.());
        else part.material?.dispose?.();
      });
    };

    const clearOperatorFx = () => {
      for (const effect of game._operatorFx) disposeFxMesh(effect.mesh, effect.sharedGeometry);
      game._operatorFx.length = 0;
      game._meleeSwing = null;
      game._railFxNextAt = 0;
    };

    const setStripTransform = (mesh, from, to, width) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.max(0.01, Math.hypot(dx, dy));
      const parameters = game.floor.geometry?.parameters || {};
      const baseWidth = parameters.width || 2600;
      const baseHeight = parameters.height || 1800;
      mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, 23);
      mesh.rotation.z = Math.atan2(dy, dx);
      mesh.scale.set(length / baseWidth, width / baseHeight, 1);
    };

    const createWorldStrip = (from, to, width, color, options = {}) => {
      const strip = game.floor.clone(false);
      strip.geometry = game.floor.geometry.clone();
      strip.material = game.floor.material.clone();
      strip.material.color.setHex(color);
      strip.material.transparent = true;
      strip.material.depthWrite = false;
      strip.material.opacity = options.opacity ?? 0.85;
      setStripTransform(strip, from, to, width);
      game.fxGroup.add(strip);
      const effect = {
        mesh: strip,
        startAt: game.now,
        endAt: game.now + (options.duration ?? 0.24),
        baseOpacity: options.opacity ?? 0.85,
        width,
        sharedGeometry: false,
        follow: options.follow,
        update: options.update,
      };
      game._operatorFx.push(effect);
      return effect;
    };

    const createRangeRing = (actor, radius, color, duration, opacity = 0.58) => {
      const segments = 24;
      for (let index = 0; index < segments; index++) {
        const angleA = index / segments * Math.PI * 2;
        const angleB = (index + 1) / segments * Math.PI * 2;
        const offsetA = vector(Math.cos(angleA), Math.sin(angleA)).multiplyScalar(radius);
        const offsetB = vector(Math.cos(angleB), Math.sin(angleB)).multiplyScalar(radius);
        createWorldStrip(
          actor.pos.clone().add(offsetA),
          actor.pos.clone().add(offsetB),
          2.8,
          color,
          {
            duration,
            opacity,
            follow: () => [actor.pos.clone().add(offsetA), actor.pos.clone().add(offsetB)],
          },
        );
      }
    };

    const createRangeSector = (actor, direction, range, halfAngle, color) => {
      const segments = 18;
      for (let index = 0; index < segments; index++) {
        const angleA = direction - halfAngle + index / segments * halfAngle * 2;
        const angleB = direction - halfAngle + (index + 1) / segments * halfAngle * 2;
        const offsetA = vector(Math.cos(angleA), Math.sin(angleA)).multiplyScalar(range);
        const offsetB = vector(Math.cos(angleB), Math.sin(angleB)).multiplyScalar(range);
        createWorldStrip(
          actor.pos.clone().add(offsetA),
          actor.pos.clone().add(offsetB),
          3.8,
          color,
          {
            duration: 0.36,
            opacity: 0.72,
            follow: () => [actor.pos.clone().add(offsetA), actor.pos.clone().add(offsetB)],
          },
        );
      }
      for (const angle of [direction - halfAngle, direction + halfAngle]) {
        const offset = vector(Math.cos(angle), Math.sin(angle)).multiplyScalar(range);
        createWorldStrip(actor.pos, actor.pos.clone().add(offset), 2.4, color, {
          duration: 0.36,
          opacity: 0.45,
          follow: () => [actor.pos.clone(), actor.pos.clone().add(offset)],
        });
        const corner = actor.pos.clone().add(offset);
        const inward = vector(Math.cos(angle), Math.sin(angle)).multiplyScalar(-22);
        const tangent = vector(-Math.sin(angle), Math.cos(angle)).multiplyScalar(angle < direction ? -12 : 12);
        createWorldStrip(corner.clone().add(inward), corner.clone().add(tangent), 5.2, color, {
          duration: 0.28,
          opacity: 0.86,
          follow: () => [
            actor.pos.clone().add(offset).add(inward),
            actor.pos.clone().add(offset).add(tangent),
          ],
        });
      }
    };

    const createPulseDisc = (actor, radius, color, duration, opacity = 0.12) => {
      const mesh = createEffectMesh(color, radius / Math.max(1, game.player.radius));
      mesh.position.set(actor.pos.x, actor.pos.y, 15);
      mesh.material.opacity = opacity;
      mesh.material.depthWrite = false;
      game.fxGroup.add(mesh);
      game._operatorFx.push({
        mesh,
        startAt: game.now,
        endAt: game.now + duration,
        baseOpacity: opacity,
        sharedGeometry: false,
        update: (progress) => {
          mesh.position.set(actor.pos.x, actor.pos.y, 15);
          mesh.scale.setScalar(radius / Math.max(1, game.player.radius) * (0.92 + progress * 0.12));
        },
      });
    };

    const spawnAfterimage = (actor, color) => {
      const ghost = actor.mesh.clone(true);
      ghost.position.copy(actor.mesh.position);
      ghost.rotation.copy(actor.mesh.rotation);
      ghost.scale.copy(actor.mesh.scale);
      ghost.traverse((part) => {
        if (!part.material) return;
        if (Array.isArray(part.material)) {
          part.material = part.material.map((material) => material.clone());
        } else {
          part.material = part.material.clone();
        }
      });
      eachMaterial(ghost, (material) => {
        material.color?.setHex(color);
        material.transparent = true;
        material.depthWrite = false;
        material.opacity = 0.48;
      });
      game.fxGroup.add(ghost);
      game._operatorFx.push({
        mesh: ghost,
        startAt: game.now,
        endAt: game.now + 0.28,
        baseOpacity: 0.48,
        sharedGeometry: true,
        update: (progress) => eachMaterial(ghost, (material) => { material.opacity = 0.48 * (1 - progress); }),
      });
    };

    const getWeaponPieces = () => {
      const root = game.player._weaponVisualRoot;
      const source = root?.children?.length ? root.children : game.player.mesh.children;
      return source.filter((part) => (
        part === game.player._weaponVisualBase || part.userData?.breachlineWeaponClone
      ));
    };

    const MELEE_SWING_DURATION = B.melee.swingDuration;
    const MELEE_ATTACK_DELAY = B.melee.attackDelay; // 스윙 종료 직후 즉시 재공격 가능하도록 축소

    const beginMeleeAnimation = (range, halfAngle, color) => {
      // 사용할 때마다 휘두르는 방향을 번갈아 바꾼다 (우→좌 ↔ 좌→우)
      game._meleeSwingSide = !game._meleeSwingSide;
      game._meleeSwing = {
        startedAt: game.now,
        until: game.now + MELEE_SWING_DURATION,
        direction: game.player.dir,
        range,
        halfAngle,
        color,
        side: game._meleeSwingSide ? 1 : -1,
        lastTrailAt: -Infinity,
        lastTip: null,
      };
      for (const piece of getWeaponPieces()) {
        piece.userData = {
          ...piece.userData,
          breachlineBaseX: piece.position.x,
          breachlineBaseY: piece.position.y,
          breachlineBaseRotation: piece.rotation.z,
        };
      }
      createRangeSector(game.player, game.player.dir, range, halfAngle, color);
    };

    const updateMeleeAnimation = () => {
      const swing = game._meleeSwing;
      if (!swing) return;
      if (game.now >= swing.until || !game.player.alive) {
        game._meleeSwing = null;
        game.applyWeaponVisual(game.player, operator().weaponId);
        return;
      }
      const progress = clamp((game.now - swing.startedAt) / Math.max(0.01, swing.until - swing.startedAt), 0, 1);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const localAngle = swing.side === 1
        ? -swing.halfAngle + eased * swing.halfAngle * 2
        : swing.halfAngle - eased * swing.halfAngle * 2;
      for (const piece of getWeaponPieces()) {
        const baseX = piece.userData.breachlineBaseX ?? piece.position.x;
        const baseY = (piece.userData.breachlineBaseY ?? piece.position.y) - 10;
        const cos = Math.cos(localAngle);
        const sin = Math.sin(localAngle);
        piece.position.x = baseX * cos - baseY * sin;
        piece.position.y = 10 + baseX * sin + baseY * cos;
        piece.rotation.z = (piece.userData.breachlineBaseRotation || 0) + localAngle;
      }
      if (game.now >= swing.lastTrailAt + 0.025) {
        const trailAngle = swing.direction + localAngle;
        // 트레일 끝점은 실제 판정 사거리(swing.range)와 1:1로 일치시킨다.
        const tip = game.player.pos.clone().add(vector(Math.cos(trailAngle), Math.sin(trailAngle)).multiplyScalar(swing.range));
        if (swing.lastTip) createWorldStrip(swing.lastTip, tip, 7, swing.color, { duration: 0.2, opacity: 0.82 });
        swing.lastTip = tip;
        swing.lastTrailAt = game.now;
      }
      game.canvas.dataset.meleeSwingProgress = progress.toFixed(2);
    };

    const updateOperatorFx = () => {
      while (game._operatorFx.length > 220) {
        const expired = game._operatorFx.shift();
        if (expired) disposeFxMesh(expired.mesh, expired.sharedGeometry);
      }
      for (let index = game._operatorFx.length - 1; index >= 0; index--) {
        const effect = game._operatorFx[index];
        if (game.now >= effect.endAt) {
          disposeFxMesh(effect.mesh, effect.sharedGeometry);
          game._operatorFx.splice(index, 1);
          continue;
        }
        const progress = clamp((game.now - effect.startAt) / Math.max(0.001, effect.endAt - effect.startAt), 0, 1);
        if (effect.follow) {
          const [from, to] = effect.follow();
          setStripTransform(effect.mesh, from, to, effect.width || 2.8);
        }
        if (effect.mesh.material && !effect.update) effect.mesh.material.opacity = effect.baseOpacity * (1 - progress);
        effect.update?.(progress);
      }
      game.canvas.dataset.operatorFx = String(game._operatorFx.length);
    };

    const updateRailChargeFx = () => {
      if (!isOperator("sentinel") || game._railChargeStartedAt === null || game._railNeedsRelease) return;
      if (!game.player.alive || game.phase !== "playing") {
        game._railChargeStartedAt = null;
        game._railNeedsRelease = false;
        return;
      }
      const charge = clamp((game.now - game._railChargeStartedAt) / 1, 0, 1);
      if (game.now < (game._railFxNextAt || 0)) return;
      game._railFxNextAt = game.now + 0.065;
      const direction = vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
      const perpendicular = vector(-direction.y, direction.x);
      const muzzle = game.player.pos.clone().add(direction.clone().multiplyScalar(42));
      const spread = 54 * (1 - charge) + 14;
      for (const side of [-1, -0.45, 0.45, 1]) {
        const source = game.player.pos.clone()
          .add(direction.clone().multiplyScalar(4 + Math.abs(side) * 8))
          .add(perpendicular.clone().multiplyScalar(spread * side));
        createWorldStrip(source, muzzle, 1.8 + charge * 1.4, side > 0 ? 0x55f0b0 : 0x9ef0ff, {
          duration: 0.14,
          opacity: 0.35 + charge * 0.5,
        });
      }
      game.player.ring.material.color.setHex(charge > 0.88 ? 0xffffff : 0x55f0b0);
      game.canvas.dataset.railChargeFx = charge.toFixed(2);
    };

    const createSpecialGrenade = (type, actor, target) => {
      const countField = type === "frag" ? "fragGrenades" : null;
      if (countField && actor[countField] <= 0) {
        if (actor.team === "player") game.showToast(`${type.toUpperCase()} EMPTY`);
        return null;
      }
      if (countField) actor[countField]--;
      const aim = target || actor.pos.clone().add(vector(Math.cos(actor.dir), Math.sin(actor.dir)).multiplyScalar(300));
      const direction = directionTo(actor.pos, aim);
      const power = 1;
      const pos = actor.pos.clone().add(direction.clone().multiplyScalar(32));
      const color = type === "frag" ? 0xff6b67 : 0xffa8f0;
      const mesh = createEffectMesh(color, type === "frag" ? 0.38 : 0.32);
      mesh.position.set(pos.x, pos.y, 18);
      game.fxGroup.add(mesh);
      const grenade = {
        id: Date.now() + Math.random(), type, owner: actor, pos,
        vel: direction.multiplyScalar((type === "launcher" ? 620 : 500) * power),
        fuse: type === "frag" ? 2 : 1.5,
        initialFuse: type === "frag" ? 2 : 1.5,
        mesh,
      };
      grenade.predictedLanding = game.predictGrenadeLanding?.(actor, type, power, aim) || pos.clone();
      game.styleGrenadeMesh?.(grenade);
      game.grenades.push(grenade);
      game._pendingThrowPower = 1;
      game.canvas.dataset.grenadeMotion = "projectile-synced";
      return grenade;
    };
    game.createSpecialGrenade = createSpecialGrenade;

    const damageInRadius = (source, point, radius, damage) => {
      let hits = 0;
      for (const target of [game.player, ...game.bots]) {
        if (!target.alive || target.team === source.team || target.pos.distanceTo(point) > radius) continue;
        game.damageActor(source, target, damage);
        hits++;
      }
      return hits;
    };

    const createBurstParticle = (point, color, velocity, scale, duration, opacity = 0.9) => {
      const mesh = createEffectMesh(color, scale);
      mesh.position.set(point.x, point.y, 18);
      mesh.material.opacity = opacity;
      mesh.material.depthWrite = false;
      game.fxGroup.add(mesh);
      game._operatorFx.push({
        mesh,
        startAt: game.now,
        endAt: game.now + duration,
        baseOpacity: opacity,
        sharedGeometry: false,
        update: (progress) => {
          mesh.position.set(
            point.x + velocity.x * progress,
            point.y + velocity.y * progress,
            18 + progress * 3,
          );
          mesh.scale.setScalar(scale * (1 - progress * 0.62));
          mesh.material.opacity = opacity * (1 - progress);
        },
      });
    };

    const showFragBurst = (grenade, radius) => {
      game.canvas.dataset.lastDetonationFx = "frag-shrapnel";
      for (let index = 0; index < 18; index++) {
        const angle = index / 18 * Math.PI * 2 + Math.sin(index * 4.17) * 0.13;
        const direction = vector(Math.cos(angle), Math.sin(angle));
        const start = grenade.pos.clone().add(direction.clone().multiplyScalar(8 + index % 4));
        const end = grenade.pos.clone().add(direction.clone().multiplyScalar(radius * (0.5 + (index % 5) * 0.1)));
        createWorldStrip(start, end, index % 3 === 0 ? 5.5 : 2.8, index % 2 ? 0xffb36b : 0xff625f, {
          duration: 0.24 + index % 4 * 0.025,
          opacity: 0.92,
        });
        if (index % 3 === 0) {
          createBurstParticle(grenade.pos, 0xffd2a1, direction.multiplyScalar(radius * 0.72), 0.18, 0.34, 0.86);
        }
      }
      createBurstParticle(grenade.pos, 0xffffff, vector(), 0.62, 0.18, 0.95);
    };

    const showLauncherBurst = (grenade, radius) => {
      game.canvas.dataset.lastDetonationFx = "launcher-plasma-fan";
      const travelAngle = grenade.vel?.lengthSq?.() > 0.01 ? Math.atan2(grenade.vel.y, grenade.vel.x) : 0;
      for (let index = 0; index < 13; index++) {
        const spread = (index - 6) / 6 * Math.PI * 0.72;
        const angle = travelAngle + Math.PI + spread + Math.sin(index * 2.7) * 0.09;
        const direction = vector(Math.cos(angle), Math.sin(angle));
        const start = grenade.pos.clone().add(direction.clone().multiplyScalar(5));
        const end = grenade.pos.clone().add(direction.clone().multiplyScalar(radius * (0.45 + (index % 4) * 0.15)));
        createWorldStrip(start, end, 3.4 + index % 2 * 2.2, index % 2 ? 0xffa8f0 : 0xb86cff, {
          duration: 0.3,
          opacity: 0.88,
        });
        if (index % 2 === 0) {
          createBurstParticle(grenade.pos, 0xf2c4ff, direction.multiplyScalar(radius * 0.58), 0.16, 0.38, 0.74);
        }
      }
      createBurstParticle(grenade.pos, 0xffffff, vector(), 0.48, 0.2, 0.9);
    };

    const showFlashBurst = (grenade) => {
      game.canvas.dataset.lastDetonationFx = "flash-starburst";
      for (let index = 0; index < 20; index++) {
        const angle = index / 20 * Math.PI * 2;
        const direction = vector(Math.cos(angle), Math.sin(angle));
        const length = index % 2 ? 104 : 178;
        createWorldStrip(
          grenade.pos.clone().add(direction.clone().multiplyScalar(5)),
          grenade.pos.clone().add(direction.multiplyScalar(length)),
          index % 2 ? 2.2 : 4.8,
          index % 3 ? 0xffe67d : 0xffffff,
          { duration: 0.22, opacity: 0.96 },
        );
      }
      createBurstParticle(grenade.pos, 0xffffff, vector(), 0.78, 0.16, 1);
    };

    const styleSmokeCloud = (smoke) => {
      if (!smoke?.mesh || smoke.mesh.userData?.breachlineSmokeCluster) return;
      game.canvas.dataset.lastDetonationFx = "smoke-cluster";
      game.canvas.dataset.smokePuffCount = "22";
      smoke.mesh.userData = { ...smoke.mesh.userData, breachlineSmokeCluster: true };
      smoke.mesh.material.transparent = true;
      smoke.mesh.material.opacity = 0.06;
      smoke.mesh.material.depthWrite = false;
      // 3계층 퍼프: 중앙 코어(밝음) → 중간층 → 외곽 림(가장자리 강조)
      const layers = [
        { count: 4, distance: (i) => smoke.radius * (0.08 + i * 0.05), scale: (i) => 0.34 - i * 0.02, color: 0x7d97a1, opacity: 0.42 },
        { count: 8, distance: (i) => smoke.radius * (0.34 + i * 0.06), scale: (i) => 0.3 - i * 0.015, color: 0x5a7480, opacity: 0.34 },
        { count: 10, distance: (i) => smoke.radius * (0.62 + i * 0.035), scale: (i) => 0.26 - i * 0.01, color: 0x8ba3ab, opacity: 0.4 },
      ];
      let puffIndex = 0;
      layers.forEach((layer, layerIndex) => {
        for (let index = 0; index < layer.count; index++) {
          const angle = index / layer.count * Math.PI * 2 + layerIndex * 0.35 + (index % 3) * 0.22;
          const puff = smoke.mesh.clone(false);
          puff.material = smoke.mesh.material.clone();
          puff.material.color.setHex(layer.color);
          puff.material.opacity = layer.opacity * (0.85 + (index % 3) * 0.1);
          puff.position.set(
            Math.cos(angle) * layer.distance(index),
            Math.sin(angle) * layer.distance(index),
            0.15 + puffIndex * 0.0015,
          );
          puff.scale.setScalar(layer.scale(index));
          puff.userData = {
            breachlineSmokePuff: true,
            breachlineSmokeLayer: layerIndex, // 0=코어 1=중간 2=림
            breachlineSmokeSeed: puffIndex * 1.37,
          };
          smoke.mesh.add(puff);
          puffIndex += 1;
        }
      });
    };

    const originalExplode = game.explode.bind(game);
    game.explode = function explodeOperatorGrenade(grenade) {
      if (grenade.type === "frag" || grenade.type === "launcher") {
        const radius = grenade.type === "frag" ? B.gadgets.frag.radius : B.gadgets.launcher.radius;
        const damage = grenade.type === "frag" ? B.gadgets.frag.damage : B.gadgets.launcher.damage;
        const hits = damageInRadius(grenade.owner, grenade.pos, radius, damage);
        if (grenade.type === "frag") showFragBurst(grenade, radius);
        else showLauncherBurst(grenade, radius);
        if (grenade.owner === this.player) this.showToast(`${grenade.type.toUpperCase()} IMPACT · ${hits} HIT`);
        disposeFxMesh(grenade.mesh);
        return;
      }
      const smokeCount = this.smokes.length;
      originalExplode(grenade);
      if (grenade.ninjaSmoke && this.smokes.length > smokeCount) {
        const smoke = this.smokes[this.smokes.length - 1];
        smoke.ninjaSmoke = true;
        smoke.owner = grenade.owner;
        smoke.radius = NINJA_SMOKE_RADIUS;
        smoke.endAt = this.now + NINJA_SMOKE_DURATION;
        smoke.mesh.scale.setScalar(NINJA_SMOKE_RADIUS / 150);
      }
      if (grenade.type === "flash") showFlashBurst(grenade);
      if (grenade.type === "smoke" && this.smokes.length > smokeCount) {
        styleSmokeCloud(this.smokes[this.smokes.length - 1]);
      }
      disposeFxMesh(grenade.mesh);
    };

    const originalUpdateSmokes = game.updateSmokes.bind(game);
    game.updateSmokes = function updateClusteredSmokes() {
      for (const smoke of this.smokes) {
        if (smoke.endAt > this.now || !smoke.mesh?.userData?.breachlineSmokeCluster) continue;
        for (const child of smoke.mesh.children) {
          if (child.userData?.breachlineSmokePuff && child.material !== smoke.mesh.material) {
            child.material?.dispose?.();
          }
        }
      }
      originalUpdateSmokes();
    };

    const meleeAttack = (damage, range, halfAngle) => {
      if (game.now < game.player.nextShotAt || !game.player.alive) return;
      // 낫을 던진 상태에서는 근접 공격 불가
      if (game._scytheThrow) {
        game.showToast("SCYTHE FLYING // RETURNING");
        return;
      }
      // 스윙 종료(0.34s) 직후 즉시 재공격 가능하도록 딜레이를 축소한다.
      game.player.nextShotAt = game.now + MELEE_ATTACK_DELAY;
      game.player.shots++;
      beginMeleeAnimation(range, halfAngle, isOperator("reaper") ? 0xc59bff : 0xff5f6d);
      let hits = 0;
      for (const target of game.bots) {
        if (!target.alive) continue;
        const delta = target.pos.clone().sub(game.player.pos);
        if (delta.length() > range) continue;
        if (Math.abs(angleDelta(Math.atan2(delta.y, delta.x), game.player.dir)) > halfAngle) continue;
        if (game.rayBlocked(game.player.pos, target.pos)) continue;
        game.player.hits++;
        game.damageActor(game.player, target, damage);
        hits++;
      }
      game.cameraShake = Math.max(game.cameraShake, hits ? 5 : 2);
      game.showToast(hits ? `MELEE HIT ×${hits}` : "MELEE SWING");
    };

    // 레일건 사거리 = 현재 카메라 화면(1.25x/1.5x 확대 포함)의 대각선 거리.
    // 식별 가능한 최대 범위까지 벽을 관통하는 히트스캔을 허용한다.
    const railgunRange = () => {
      const halfWidth = (game.camera.right - game.camera.left) / 2;
      const halfHeight = (game.camera.top - game.camera.bottom) / 2;
      return Math.hypot(halfWidth, halfHeight);
    };

    const fireRailgun = () => {
      if (game._railNeedsRelease || game.player.reloadUntil > game.now || game.now < game.player.nextShotAt) return;
      if (game.player.ammo <= 0) {
        game.reload(game.player);
        return;
      }
      if (game._railChargeStartedAt === null) {
        game._railChargeStartedAt = game.now;
        game._railFxNextAt = game.now;
        createRangeRing(game.player, 46, 0x55f0b0, 1, 0.38);
        game.showToast("RAILGUN CHARGING");
        return;
      }
      if (game.now - game._railChargeStartedAt < B.operators.sentinel.railgun.chargeTime) return;

      const range = railgunRange();
      game.player.ammo--;
      game.player.shots++;
      game.player.nextShotAt = game.now + 0.35;
      game._railChargeStartedAt = null;
      game._railNeedsRelease = true;
      const direction = vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
      let nearest = null;
      let nearestAlong = Infinity;
      for (const target of game.bots) {
        if (!target.alive) continue;
        const relative = target.pos.clone().sub(game.player.pos);
        const along = relative.x * direction.x + relative.y * direction.y;
        if (along < 0 || along > range) continue;
        const perpendicular = Math.abs(relative.x * direction.y - relative.y * direction.x);
        if (perpendicular <= target.radius && along < nearestAlong) {
          nearest = target;
          nearestAlong = along;
        }
      }
      if (nearest) {
        game.player.hits++;
        game.damageActor(game.player, nearest, 40);
      }
      const beamStart = game.player.pos.clone().add(direction.clone().multiplyScalar(game.player.radius + 10));
      const beamEnd = game.player.pos.clone().add(direction.clone().multiplyScalar(range));
      createWorldStrip(beamStart, beamEnd, 13, 0x55f0b0, { duration: 0.22, opacity: 0.5 });
      createWorldStrip(beamStart, beamEnd, 4, 0xf3ffff, { duration: 0.16, opacity: 1 });
      createRangeRing(game.player, 62, 0x9ef0ff, 0.22, 0.75);
      game.cameraShake = Math.max(game.cameraShake, 8);
      game.canvas.dataset.lastRailBeam = `${Math.round(beamStart.x)}:${Math.round(beamStart.y)}>${Math.round(beamEnd.x)}:${Math.round(beamEnd.y)}`;
      game.canvas.dataset.railgunRange = String(Math.round(range));
      game.showToast(nearest ? "RAIL HIT // WALLPIERCE" : "RAIL FIRED");
    };

    const fireLauncher = () => {
      if (game.player.reloadUntil > game.now || game.now < game.player.nextShotAt) return;
      if (game.player.ammo <= 0) {
        game.reload(game.player);
        return;
      }
      // 유탄: 사거리 내 마우스 지정 지점을 착탄점으로 사용한다.
      // 범위 밖을 조준하면 최대 사거리 지점으로 클램프된다.
      const launcherRange = game.player.weapon.range || 780;
      const origin = game.player.pos;
      const aim = game.mouse.world.clone().sub(origin);
      if (aim.lengthSq() < 1) aim.set(Math.cos(game.player.dir), Math.sin(game.player.dir));
      const targetPos = origin.clone().add(
        aim.clone().normalize().multiplyScalar(Math.min(aim.length(), launcherRange)),
      );

      game.player.ammo--;
      game.player.shots++;
      game.player.nextShotAt = game.now + 60 / game.player.weapon.rpm;

      const direction = targetPos.clone().sub(origin).normalize();
      const pos = origin.clone().add(direction.clone().multiplyScalar(32));
      // 비행 식별을 위해 유탄을 크게 만들고 밝은 코어를 얹는다.
      const mesh = createEffectMesh(0xffa8f0, 0.5);
      mesh.position.set(pos.x, pos.y, 18);
      const core = game.player.body.clone(false);
      core.geometry = game.player.body.geometry.clone();
      core.material = game.player.body.material.clone();
      core.material.color.setHex(0xfff0ff);
      core.material.transparent = true;
      core.material.opacity = 0.95;
      core.material.depthWrite = false;
      core.scale.setScalar(0.16);
      core.position.z = 1;
      mesh.add(core);
      game.fxGroup.add(mesh);
      game.grenades.push({
        id: Date.now() + Math.random(),
        type: "launcher",
        owner: game.player,
        pos,
        targetPos,
        speed: B.gadgets.launcher.speed,
        directFire: true, // 투척 물리/신관 없이 직선 비행 → 착탄 즉시 폭발
        mesh,
        prevPos: pos.clone(),
        trailAt: 0,
      });
      game.canvas.dataset.lastLauncherShot = `${Math.round(targetPos.x)}:${Math.round(targetPos.y)}`;
    };

    const originalUpdateGrenades = game.updateGrenades.bind(game);
    game.updateGrenades = function updateDirectFireGrenades(dt) {
      // 직사 유탄은 코어의 투척 물리/신관에서 분리해 직접 처리한다.
      // 코어 실행 전에 꺼냈다가 실행 후 되돌려, 코어가 유탄을 건드리지 않게 한다.
      const direct = [];
      for (let index = this.grenades.length - 1; index >= 0; index--) {
        if (!this.grenades[index].directFire) continue;
        direct.push(this.grenades.splice(index, 1)[0]);
      }
      for (let index = direct.length - 1; index >= 0; index--) {
        const grenade = direct[index];
        const toTarget = grenade.targetPos.clone().sub(grenade.pos);
        const step = grenade.speed * dt;
        const detonate = (at) => {
          grenade.pos.copy(at);
          grenade.mesh.position.set(at.x, at.y, 16);
          this.explode(grenade);
          direct.splice(index, 1);
        };
        if (toTarget.lengthSq() <= step * step) {
          detonate(grenade.targetPos);
          continue;
        }
        const move = toTarget.normalize().multiplyScalar(step);
        const nextX = grenade.pos.clone().add(vector(move.x, 0));
        const nextY = grenade.pos.clone().add(vector(0, move.y));
        if (this.collides(nextX, 9)) {
          detonate(grenade.pos.clone().add(vector(move.x * 0.5, 0)));
          continue;
        }
        grenade.pos.x = nextX.x;
        if (this.collides(nextY, 9)) {
          detonate(grenade.pos.clone().add(vector(0, move.y * 0.5)));
          continue;
        }
        grenade.pos.y = nextY.y;
        grenade.mesh.position.set(grenade.pos.x, grenade.pos.y, 16);
        // 비행 트레일 (잔상)
        if (this.now >= (grenade.trailAt || 0)) {
          grenade.trailAt = this.now + 0.03;
          createWorldStrip(grenade.prevPos, grenade.pos.clone(), 2.4, 0xffa8f0, {
            duration: 0.16,
            opacity: 0.8,
          });
          grenade.prevPos.copy(grenade.pos);
        }
      }
      originalUpdateGrenades(dt);
      for (const grenade of direct) this.grenades.push(grenade);
    };

    const originalFire = game.fire.bind(game);
    game.fire = function fireByOperator(actor, aim) {
      if (actor !== this.player) {
        originalFire(actor, aim);
        return;
      }
      if (this._selectedGadget) return;
      // Iron keeps the shield deployed while firing the pistol.
      if (isOperator("bulwark")) {
        originalFire(actor, aim);
        return;
      }
      if (isOperator("reaper")) return meleeAttack(WEAPONS.reaper.damage, WEAPONS.reaper.range, B.operators.reaper.meleeHalfAngle);
      if (isOperator("ninja")) return meleeAttack(WEAPONS.ninja.damage, WEAPONS.ninja.range, B.operators.ninja.meleeHalfAngle);
      if (isOperator("sentinel")) return fireRailgun();
      if (isOperator("demolitionist")) return fireLauncher();
      const shotsBefore = actor.shots;
      const scheduledBefore = actor.nextShotAt;
      originalFire(actor, aim);
      if (isOperator("gunslinger") && actor.shots > shotsBefore) {
        const interval = 60 / WEAPONS.gunslinger.rpm;
        const continuousSchedule = scheduledBefore > 0 && this.now - scheduledBefore <= interval * 1.5;
        actor.nextShotAt = continuousSchedule ? scheduledBefore + interval : this.now + interval;
      }
    };

    const originalSpawnProjectile = game.spawnProjectile.bind(game);
    game.spawnProjectile = function spawnOperatorProjectile(source, position, direction, weapon) {
      let muzzle = position;
      const gunslinger = source === this.player ? isOperator("gunslinger") : source?.operatorId === "gunslinger";
      if (gunslinger) {
        source._gunHand = source._gunHand || 1;
        const perpendicular = vector(-direction.y, direction.x).multiplyScalar(7 * source._gunHand);
        muzzle = position.clone().add(perpendicular);
        source._gunHand *= -1;
      } else if (weapon && (weapon.pellets || 1) > 1) {
        // 다발 펠릿(샷건 등): 발사원에 가깝게 생성해 근거리에서도 전탄이 적중한다.
        muzzle = position.clone().sub(direction.clone().multiplyScalar(6));
      }
      originalSpawnProjectile(source, muzzle, direction, weapon);
      const projectile = this.projectiles[this.projectiles.length - 1];
      if ((source === this.player ? isOperator("sniper") : source?.operatorId === "sniper") && projectile) {
        projectile.mesh.scale.set(1.5, 1.35, 1);
      }
    };

    const getWasmDir = () => {
      const x = (game.keys.has("KeyD") ? 1 : 0) - (game.keys.has("KeyA") ? 1 : 0);
      const y = (game.keys.has("KeyW") ? 1 : 0) - (game.keys.has("KeyS") ? 1 : 0);
      if (x === 0 && y === 0) return null;
      return vector(x, y).normalize();
    };

    const startDash = (kind) => {
      const key = `${kind}-dash`;
      if (!abilityReady(key)) {
        game.showToast(`DASH ${cooldownRemaining(key).toFixed(1)}s`);
        return;
      }
      // 돌진 방향: 현재 누르고 있는 WASD 방향. 입력이 없으면 마지막 이동 방향,
      // 그것도 없으면 조준(마우스) 방향을 사용한다.
      const target = getWasmDir()
        || (game._lastMoveDir ? game._lastMoveDir.clone() : null)
        || game.mouse.world.clone().sub(game.player.pos);
      if (target.lengthSq() < 1) target.set(Math.cos(game.player.dir), Math.sin(game.player.dir));
      target.normalize();
      // 헌터 구르기: 쿨다운 3초 + 즉시 재장전
      const dashCooldown = kind === "hunter" ? B.operators.hunter.dash.cooldown : SPECIAL_COOLDOWN;
      beginCooldown(key, dashCooldown);
      if (kind === "hunter") {
        game.player.reloadStartedAt = 0;
        game.player.reloadUntil = 0;
        game.player.ammo = game.player.weapon.magSize;
      }
      game._operatorDash = {
        kind, direction: target, startedAt: game.now, until: game.now + (kind === "gunslinger" ? B.operators.gunslinger.dash.duration : B.operators.hunter.dash.duration),
        speed: kind === "gunslinger" ? B.operators.gunslinger.dash.speed : B.operators.hunter.dash.speed, hit: new Set(), invulnerable: kind === "hunter" ? B.operators.hunter.dash.invulnerable : false,
        nextFxAt: game.now,
      };
      if (kind === "gunslinger") {
        createRangeRing(game.player, GUN_KATA_RADIUS, 0xffd166, 0.5, 0.72);
        createPulseDisc(game.player, GUN_KATA_RADIUS, 0xffd166, 0.5, 0.11);
      } else {
        createRangeRing(game.player, game.player.radius + 9, 0x9ef0ff, 0.34, 0.76);
      }
      game.showToast(kind === "gunslinger" ? "GUN KATA" : "HUNTER DASH // INVULNERABLE");
    };

    const fireDaggers = () => {
      if (!abilityReady("daggers")) {
        game.showToast(`DAGGERS ${cooldownRemaining("daggers").toFixed(1)}s`);
        return;
      }
      beginCooldown("daggers", 1); // 수리검 딜레이 1초
      const weapon = { id: "dagger", name: "DAGGER", damage: 15, pellets: 1, rpm: 1, spreadDeg: 0, magSize: 1, reserve: 1, reload: 1, range: 720, projectileSpeed: 1050, color: 0xdffcff };
      for (const offset of [-0.08, 0, 0.08]) {
        const angle = game.player.dir + offset;
        const dir = vector(Math.cos(angle), Math.sin(angle));
        const pos = game.player.pos.clone().add(dir.clone().multiplyScalar(game.player.radius + 9));
        game.spawnProjectile(game.player, pos, dir, weapon);
      }
      game.player.shots += 3;
      game.showToast("TRIPLE DAGGERS");
    };

    const SCYTHE_THROW_RANGE = B.operators.reaper.scytheThrow.range;
    const SCYTHE_OUT_SPEED = B.operators.reaper.scytheThrow.outSpeed;
    const SCYTHE_RETURN_SPEED = B.operators.reaper.scytheThrow.returnSpeed;
    const SCYTHE_HIT_BUFFER = B.operators.reaper.scytheThrow.hitBuffer;
    const SCYTHE_FX_DOTS = B.operators.reaper.scytheThrow.fxDots;
    const SCYTHE_FX_RING = B.operators.reaper.scytheThrow.fxRing;

    const createScytheFx = (startPos) => {
      const group = new game.fxGroup.constructor();
      const makeDot = (color, opacity, scale) => {
        const dot = game.player.body.clone(false);
        dot.geometry = game.player.body.geometry.clone();
        dot.material = game.player.body.material.clone();
        dot.material.color.setHex(color);
        dot.material.transparent = true;
        dot.material.opacity = opacity;
        dot.material.depthWrite = false;
        dot.scale.setScalar(scale);
        group.add(dot);
        return dot;
      };
      const pathDots = [];
      for (let index = 0; index < SCYTHE_FX_DOTS; index++) {
        pathDots.push(makeDot(0xc59bff, 0.65, 0.12));
      }
      const ringDots = [];
      for (let index = 0; index < SCYTHE_FX_RING; index++) {
        ringDots.push(makeDot(0xffd166, 0.85, 0.14));
      }
      group.position.set(startPos.x, startPos.y, 0);
      game.fxGroup.add(group);
      return { group, pathDots, ringDots };
    };

    const updateScytheFx = (thrown) => {
      if (!thrown.fx) return;
      const fx = thrown.fx;
      fx.group.position.set(thrown.pos.x, thrown.pos.y, 0);
      // 피격 반경 링 (낫 주변)
      fx.ringDots.forEach((dot, index) => {
        const angle = index / SCYTHE_FX_RING * Math.PI * 2 + thrown.rot * 0.5;
        dot.position.set(Math.cos(angle) * (SCYTHE_HIT_BUFFER + 12), Math.sin(angle) * (SCYTHE_HIT_BUFFER + 12), 26);
      });
      // 궤적: 비행 방향으로 도트 8개 (회수 시에는 플레이어 방향)
      let target;
      if (thrown.out) {
        target = thrown.pos.clone().add(thrown.dir.clone().multiplyScalar(SCYTHE_THROW_RANGE - thrown.traveled));
      } else {
        target = game.player.pos;
      }
      fx.pathDots.forEach((dot, index) => {
        const t = (index + 1) / SCYTHE_FX_DOTS;
        const px = thrown.pos.x + (target.x - thrown.pos.x) * t;
        const py = thrown.pos.y + (target.y - thrown.pos.y) * t;
        dot.position.set(px, py, 25);
        dot.material.opacity = 0.65 * (1 - t * 0.6);
      });
    };

    // 사신 우클릭: 낫을 부메랑처럼 던진다 (벽 관통). 회수 전까지 근접 공격 불가.
    const useScytheThrow = () => {
      if (game._scytheThrow) {
        game.showToast("SCYTHE FLYING // RETURNING");
        return;
      }
      if (!game.player.alive || game.phase !== "playing") return;
      game._meleeSwing = null;
      const direction = vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
      const source = game.player._weaponVisualRoot;
      let mesh = null;
      if (source) {
        mesh = source.clone(true);
        mesh.traverse((part) => {
          if (part.geometry) part.geometry = part.geometry.clone();
          if (part.material && !Array.isArray(part.material)) part.material = part.material.clone();
        });
        mesh.position.set(game.player.pos.x, game.player.pos.y, 14);
        game.fxGroup.add(mesh);
        source.visible = false; // 손에 든 낫은 던졌다
      }
      game._scytheThrow = {
        pos: game.player.pos.clone(),
        dir: direction,
        out: true,
        traveled: 0,
        hit: new Set(),
        mesh,
        rot: 0,
        fx: createScytheFx(game.player.pos),
      };
      game.canvas.dataset.scytheThrown = "true";
      game.showToast("SCYTHE THROWN");
    };

    const reacquireScythe = () => {
      const thrown = game._scytheThrow;
      if (!thrown) return;
      if (thrown.mesh) {
        game.fxGroup.remove(thrown.mesh);
        thrown.mesh.traverse((part) => {
          part.geometry?.dispose?.();
          part.material?.dispose?.();
        });
      }
      if (thrown.fx) {
        game.fxGroup.remove(thrown.fx.group);
        thrown.fx.group.traverse((part) => {
          part.geometry?.dispose?.();
          part.material?.dispose?.();
        });
      }
      const source = game.player._weaponVisualRoot;
      if (source) source.visible = true;
      game._scytheThrow = null;
      game.canvas.dataset.scytheThrown = "false";
    };

    const updateScytheThrow = (dt) => {
      const thrown = game._scytheThrow;
      if (!thrown) return;
      if (!game.player.alive) {
        reacquireScythe();
        return;
      }
      const speed = thrown.out ? SCYTHE_OUT_SPEED : SCYTHE_RETURN_SPEED;
      if (thrown.out) {
        // 벽에 막히면 관통하지 않고 그 자리에서 회수로 전환한다.
        const nextPos = vector(thrown.pos.x + thrown.dir.x * speed * dt, thrown.pos.y + thrown.dir.y * speed * dt);
        if (game.collides(nextPos, 10)) {
          thrown.out = false;
          game.showToast("SCYTHE BLOCKED // RETURN");
        } else {
          thrown.traveled += speed * dt;
          thrown.pos.copy(nextPos);
          if (thrown.traveled >= SCYTHE_THROW_RANGE) {
            thrown.out = false;
            game.showToast("SCYTHE RETURN");
          }
        }
      } else {
        const toPlayer = game.player.pos.clone().sub(thrown.pos);
        const distance = toPlayer.length();
        if (distance < 28) {
          reacquireScythe();
          return;
        }
        const back = toPlayer.normalize();
        thrown.pos.x += back.x * speed * dt;
        thrown.pos.y += back.y * speed * dt;
      }
      thrown.rot += dt * 14;
      if (thrown.mesh) {
        thrown.mesh.position.set(thrown.pos.x, thrown.pos.y, 14);
        thrown.mesh.rotation.z = thrown.rot;
      }
      updateScytheFx(thrown);
      // 접촉 피해 (대상당 1회) — 아군(team "player")은 제외
      for (const bot of game.bots) {
        if (!bot.alive || bot.team === "player" || thrown.hit.has(bot)) continue;
        if (bot.pos.distanceTo(thrown.pos) > SCYTHE_HIT_BUFFER + bot.radius) continue;
        if (game.rayBlocked(thrown.pos, bot.pos)) continue; // 벽 너머 타격 금지
        thrown.hit.add(bot);
        game.player.hits++;
        game.damageActor(game.player, bot, WEAPONS.reaper.damage);
        createWorldStrip(thrown.pos.clone(), bot.pos.clone(), 4, 0xc59bff, { duration: 0.18, opacity: 0.85 });
      }
    };

    /* 소환수·원격 액터를 포함한 봇의 이동을 둔화/포박한다.
       factor<=0.15 이면 포박(rootUntil), 그 외에는 둔화(netSlowUntil). */
    game.applyControlEffect = (target, factor, seconds) => {
      if (!target || target === game.player) return;
      if (factor <= 0.15) target.rootUntil = Math.max(target.rootUntil || 0, game.now + seconds);
      else target.netSlowUntil = Math.max(target.netSlowUntil || 0, game.now + seconds);
      // 멀티플레이: 상대가 사람이면 서버에 둔화/포박을 알린다(있을 때만).
      game._onControlEffect?.(target, factor, seconds);
    };
    const originalMoveBotForControl = game.moveBot.bind(game);
    game.moveBot = function moveBotWithControl(bot, dt, direction) {
      let factor = 1;
      if ((bot.rootUntil || 0) > game.now) factor = 0;                       // 덫 포박
      else if ((bot.netSlowUntil || 0) > game.now) factor = B.operators.sniper.net.slowMult; // 투망 둔화
      originalMoveBotForControl(bot, dt * factor, direction);
    };

    // ---- 존 익: 부채꼴 난사 (우클릭) ----
    const SPRAY = B.operators.gunslinger.spray;
    const fireSpray = () => {
      if (!abilityReady("spray")) { game.showToast(`SPRAY ${cooldownRemaining("spray").toFixed(1)}s`); return; }
      beginCooldown("spray", SPRAY.cooldown);
      game._spray = { until: game.now + SPRAY.duration, nextAt: game.now, fired: 0, dir: game.player.dir };
      createRangeSector(game.player, game.player.dir, WEAPONS.gunslinger.range * 0.5, SPRAY.halfAngleDeg * Math.PI / 360, 0xffd166);
      game.showToast("SPRAY");
    };
    const updateSpray = () => {
      const spray = game._spray;
      if (!spray) return;
      if (!game.player.alive || game.phase !== "playing" || game.now >= spray.until) { game._spray = null; return; }
      const half = SPRAY.halfAngleDeg * Math.PI / 360;
      const interval = SPRAY.duration / SPRAY.shots;
      const weapon = { ...WEAPONS.gunslinger, id: "dual_pistols", damage: SPRAY.damage, spreadDeg: 0, projectileSpeed: SPRAY.projectileSpeed };
      while (spray.fired < SPRAY.shots && game.now >= spray.nextAt) {
        const sweep = (spray.fired / Math.max(1, SPRAY.shots - 1)) * 2 - 1; // -1..1 로 부채꼴을 훑는다
        const jitter = game.rng?.range ? game.rng.range(-0.06, 0.06) : (Math.random() - 0.5) * 0.12;
        const angle = spray.dir + sweep * half + jitter;
        const dir = vector(Math.cos(angle), Math.sin(angle));
        const pos = game.player.pos.clone().add(dir.clone().multiplyScalar(game.player.radius + 9));
        game.spawnProjectile(game.player, pos, dir, weapon);
        game.player.shots++;
        spray.fired++;
        spray.nextAt += interval;
      }
    };

    // ---- RB-08: 헤비 레이저 (우클릭 홀드로 3초 충전 → 넓은 보라색 관통 레이저) ----
    const HEAVY = B.operators.sentinel.heavyLaser;
    const startHeavyCharge = () => {
      if (!abilityReady("heavy-laser")) { game.showToast(`HEAVY LASER ${cooldownRemaining("heavy-laser").toFixed(1)}s`); return; }
      game._heavyLaserHeld = true;
      game._heavyNeedsRelease = false;
    };
    const releaseHeavyLaser = () => {
      game._heavyLaserHeld = false;
      game._heavyChargeStartedAt = null;
      game._heavyNeedsRelease = false;
      if (isOperator("sentinel")) game.player.ring.material.color.setHex(0x55f0b0);
    };
    const fireHeavyLaser = () => {
      const range = railgunRange();
      game._heavyChargeStartedAt = null;
      game._heavyNeedsRelease = true;
      beginCooldown("heavy-laser", HEAVY.cooldown);
      const direction = vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
      let hits = 0;
      for (const target of game.bots) {
        if (!target.alive || target.team === game.player.team) continue;
        const relative = target.pos.clone().sub(game.player.pos);
        const along = relative.x * direction.x + relative.y * direction.y;
        if (along < 0 || along > range) continue;
        const perpendicular = Math.abs(relative.x * direction.y - relative.y * direction.x);
        if (perpendicular <= HEAVY.halfWidth + target.radius) {
          game.player.hits++;
          game.damageActor(game.player, target, HEAVY.damage);
          hits++;
        }
      }
      const beamStart = game.player.pos.clone().add(direction.clone().multiplyScalar(game.player.radius + 10));
      const beamEnd = game.player.pos.clone().add(direction.clone().multiplyScalar(range));
      createWorldStrip(beamStart, beamEnd, HEAVY.halfWidth * 2, HEAVY.color, { duration: 0.3, opacity: 0.42 });
      createWorldStrip(beamStart, beamEnd, HEAVY.halfWidth, 0xe6c6ff, { duration: 0.22, opacity: 0.65 });
      createWorldStrip(beamStart, beamEnd, 6, 0xffffff, { duration: 0.18, opacity: 1 });
      game.cameraShake = Math.max(game.cameraShake, 10);
      game._heavyLaserShots = (game._heavyLaserShots || 0) + 1;
      game.player.shots++;
      game.canvas.dataset.lastHeavyLaser = `${Math.round(beamEnd.x)}:${Math.round(beamEnd.y)}`;
      game.showToast(hits ? `HEAVY LASER // ${hits} HIT` : "HEAVY LASER");
    };
    const updateHeavyLaser = () => {
      if (!isOperator("sentinel") || !game._heavyLaserHeld || game._heavyNeedsRelease) return;
      if (!game.player.alive || game.phase !== "playing") { game._heavyChargeStartedAt = null; return; }
      if (!abilityReady("heavy-laser")) return;
      if (game._heavyChargeStartedAt === null) {
        game._heavyChargeStartedAt = game.now;
        game._heavyFxNextAt = game.now;
        createRangeRing(game.player, 52, HEAVY.color, HEAVY.chargeTime, 0.35);
        game.showToast("HEAVY LASER CHARGING");
      }
      const charge = clamp((game.now - game._heavyChargeStartedAt) / HEAVY.chargeTime, 0, 1);
      if (game.now >= (game._heavyFxNextAt || 0)) {
        game._heavyFxNextAt = game.now + 0.07;
        const direction = vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
        const perpendicular = vector(-direction.y, direction.x);
        const muzzle = game.player.pos.clone().add(direction.clone().multiplyScalar(46));
        const spread = (HEAVY.halfWidth + 30) * (1 - charge) + 12;
        for (const side of [-1, -0.4, 0.4, 1]) {
          const source = game.player.pos.clone()
            .add(direction.clone().multiplyScalar(4 + Math.abs(side) * 8))
            .add(perpendicular.clone().multiplyScalar(spread * side));
          createWorldStrip(source, muzzle, 2 + charge * 2, HEAVY.color, { duration: 0.16, opacity: 0.3 + charge * 0.55 });
        }
        game.player.ring.material.color.setHex(charge > 0.9 ? 0xffffff : HEAVY.color);
      }
      if (game.now - game._heavyChargeStartedAt >= HEAVY.chargeTime) fireHeavyLaser();
    };

    // ---- 군인: 섬광탄 직투척(우클릭·무제한·쿨다운 5초) + 신체강화(SPACE) ----
    const throwFlashDirect = () => {
      if (!abilityReady("flash")) { game.showToast(`FLASH ${cooldownRemaining("flash").toFixed(1)}s`); return; }
      beginCooldown("flash", B.operators.soldier.flashCooldown);
      game.throwGrenade("flash", game.player, game.mouse.world.clone());
    };
    const useEnhance = () => {
      if (!abilityReady("enhance")) { game.showToast(`ENHANCE ${cooldownRemaining("enhance").toFixed(1)}s`); return; }
      const enhance = B.operators.soldier.enhance;
      beginCooldown("enhance", enhance.cooldown);
      game._soldierBuffUntil = game.now + enhance.duration;
      const base = WEAPONS.soldier;
      game.player.weapon = { ...base, damage: Math.round(base.damage * enhance.damageMult) };
      createRangeRing(game.player, game.player.radius + 14, 0x6de6df, 0.5, 0.7);
      createPulseDisc(game.player, 70, 0x6de6df, 0.5, 0.12);
      game.showToast(`BODY ENHANCE // ${enhance.duration.toFixed(0)}s`);
    };
    const updateSoldierBuff = () => {
      if (!game._soldierBuffUntil || game.now < game._soldierBuffUntil) return;
      game._soldierBuffUntil = 0;
      if (isOperator("soldier")) game.player.weapon = WEAPONS.soldier;
    };

    // ---- 사냥꾼: 피냄새 감지 (우클릭·나만 보임) ----
    const BLOOD_SCENT = B.operators.hunter.bloodScent;
    const useBloodScent = () => {
      if (!abilityReady("blood-scent")) { game.showToast(`BLOOD SCENT ${cooldownRemaining("blood-scent").toFixed(1)}s`); return; }
      beginCooldown("blood-scent", BLOOD_SCENT.cooldown);
      game._bloodScentUntil = game.now + BLOOD_SCENT.duration;
      game.visibilityDirty = true;
      createRangeRing(game.player, BLOOD_SCENT.range, 0xff6b3d, BLOOD_SCENT.duration, 0.4);
      createRangeRing(game.player, BLOOD_SCENT.range * 0.5, 0xffb08a, BLOOD_SCENT.duration, 0.26);
      game.showToast(`BLOOD SCENT // ${BLOOD_SCENT.duration.toFixed(0)}s`);
    };

    // ---- 스나이퍼: 투망(우클릭) + 덫(SPACE) ----
    // 투망은 코어 투사체가 아니라 직접 관리하는 오브젝트다(확실히 보이고, 벽에 막히며,
    // 첫 적중 대상만 둔화). 멀티플레이는 fx.N 채널로 상대 화면에 그린다.
    const NET = B.operators.sniper.net;
    const NET_VISUAL_RADIUS = 26;
    const applyNetKnockback = (aimDir) => {
      const back = aimDir.clone().multiplyScalar(-1).normalize();
      const step = 8;
      for (let moved = 0; moved < NET.knockback; moved += step) {
        const candidate = game.player.pos.clone().add(back.clone().multiplyScalar(step));
        if (game.collides(candidate, game.player.radius)) break;
        game.player.pos.copy(candidate);
      }
      game.player.syncMesh();
    };
    const disposeNet = () => {
      const net = game._net;
      if (!net) return;
      for (const mesh of net.meshes) {
        mesh.parent?.remove(mesh);
        mesh.geometry?.dispose?.();
        mesh.material?.dispose?.();
      }
      game._net = null;
      game.canvas.dataset.netActive = "false";
    };
    const fireNet = () => {
      if (game._net) { game.showToast("NET IN FLIGHT"); return; }
      if (!abilityReady("net")) { game.showToast(`NET ${cooldownRemaining("net").toFixed(1)}s`); return; }
      beginCooldown("net", NET.cooldown);
      const direction = vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
      const pos = game.player.pos.clone().add(direction.clone().multiplyScalar(game.player.radius + 12));
      const meshes = [];
      const core = createEffectMesh(NET.color, NET_VISUAL_RADIUS / Math.max(1, game.player.radius));
      core.material.opacity = 0.9;
      core.material.depthWrite = false;
      core.position.set(pos.x, pos.y, 22);
      game.fxGroup.add(core);
      meshes.push(core);
      for (let index = 0; index < 8; index++) {
        const dot = createEffectMesh(0xffffff, 0.17);
        dot.material.opacity = 0.95;
        dot.material.depthWrite = false;
        dot.position.set(pos.x, pos.y, 23);
        game.fxGroup.add(dot);
        meshes.push(dot);
      }
      game._net = { pos, dir: direction, traveled: 0, prev: pos.clone(), meshes, rot: 0 };
      game.player.shots++;
      applyNetKnockback(direction);
      game.canvas.dataset.netActive = "true";
      game.showToast("NET FIRED");
    };
    const updateNet = (dt) => {
      const net = game._net;
      if (!net) return;
      if (!game.player.alive || game.phase !== "playing") { disposeNet(); return; }
      const speed = NET.speed;
      const nextPos = vector(net.pos.x + net.dir.x * speed * dt, net.pos.y + net.dir.y * speed * dt);
      if (game.collides(nextPos, 8)) { // 벽에 막히면 관통하지 않고 소멸
        createPulseDisc({ pos: net.pos.clone() }, NET_VISUAL_RADIUS, NET.color, 0.3, 0.2);
        disposeNet();
        return;
      }
      net.prev.copy(net.pos);
      net.pos.copy(nextPos);
      net.traveled += speed * dt;
      net.rot += dt * 10;
      net.meshes[0].position.set(net.pos.x, net.pos.y, 22);
      for (let index = 1; index < net.meshes.length; index++) {
        const angle = net.rot + (index - 1) / 8 * Math.PI * 2;
        net.meshes[index].position.set(net.pos.x + Math.cos(angle) * NET_VISUAL_RADIUS, net.pos.y + Math.sin(angle) * NET_VISUAL_RADIUS, 23);
      }
      createWorldStrip(net.prev.clone(), net.pos.clone(), 6, NET.color, { duration: 0.14, opacity: 0.5 });
      for (const bot of game.bots) {
        if (!bot.alive || bot.team === game.player.team) continue;
        if (bot.pos.distanceTo(net.pos) > NET_VISUAL_RADIUS + bot.radius) continue;
        if (game.rayBlocked(net.pos, bot.pos)) continue;
        game.applyControlEffect(bot, NET.slowMult, NET.slowDuration);
        createPulseDisc(bot, 42, NET.color, 0.5, 0.22);
        createRangeRing(bot, 34, NET.color, 0.6, 0.72);
        game.showToast("NET HIT // SLOW");
        disposeNet();
        return;
      }
      if (net.traveled >= NET.range) disposeNet();
    };

    const TRAP = B.operators.sniper.trap;
    // 반투명 빨간 지뢰. 소유자 화면에서는 연한 빨강(allyColor)으로 본다.
    // 본체·스파이크는 반투명(알파 0.10~0.20), 위험 구역 링(radius)은 얇은 선으로 표시한다.
    const addTrapMesh = (meshes, pos, scale, opacity, z, color = TRAP.allyColor) => {
      const mesh = createEffectMesh(color, scale);
      mesh.material.opacity = opacity;
      mesh.material.depthWrite = false;
      mesh.userData.baseOpacity = opacity;
      mesh.position.set(pos.x, pos.y, z);
      game.fxGroup.add(mesh);
      meshes.push(mesh);
      return mesh;
    };
    const makeTrapVisual = (pos) => {
      // 상대(원격) 화면 덫과 완전히 동일한 모양: 본체 점(0.6) + 링. 색만 아군색(파랑).
      const meshes = [];
      addTrapMesh(meshes, pos, 0.6, 0.4, 23);
      return meshes;
    };
    // 위험 구역 링 — 지속 스트립으로 만든다(원격과 동일). 매 프레임 새로 그리면
    // 각 조각이 페이드아웃돼 본체와 따로 깜빡이므로, 고정 스트립의 투명도만 갱신한다.
    const TRAP_RING_SEGMENTS = 20;
    const makeTrapRing = (pos) => {
      const strips = [];
      for (let index = 0; index < TRAP_RING_SEGMENTS; index++) {
        const strip = game.floor.clone(false);
        strip.geometry = game.floor.geometry.clone();
        strip.material = game.floor.material.clone();
        strip.material.color.setHex(TRAP.allyColor);
        strip.material.transparent = true;
        strip.material.depthWrite = false;
        const angleA = index / TRAP_RING_SEGMENTS * Math.PI * 2;
        const angleB = (index + 1) / TRAP_RING_SEGMENTS * Math.PI * 2;
        setStripTransform(
          strip,
          vector(pos.x + Math.cos(angleA) * TRAP.radius, pos.y + Math.sin(angleA) * TRAP.radius),
          vector(pos.x + Math.cos(angleB) * TRAP.radius, pos.y + Math.sin(angleB) * TRAP.radius),
          3,
        );
        game.fxGroup.add(strip);
        strips.push(strip);
      }
      return strips;
    };
    const disposeTrap = (trap) => {
      for (const mesh of [...(trap.meshes || []), ...(trap.ringStrips || [])]) {
        mesh.parent?.remove(mesh);
        mesh.geometry?.dispose?.();
        mesh.material?.dispose?.();
      }
    };
    // 트랩/미리보기의 발동 범위 링 — createWorldStrip 로 그려 확실히 보이게 한다.
    const drawTrapRing = (center, radius, color, width, opacity, duration, segments = 24) => {
      for (let index = 0; index < segments; index++) {
        const angleA = index / segments * Math.PI * 2;
        const angleB = (index + 1) / segments * Math.PI * 2;
        createWorldStrip(
          vector(center.x + Math.cos(angleA) * radius, center.y + Math.sin(angleA) * radius),
          vector(center.x + Math.cos(angleB) * radius, center.y + Math.sin(angleB) * radius),
          width, color, { duration, opacity },
        );
      }
    };
    // SPACE: 설치 모드 진입/취소 (토글). 진입하면 발밑에 설치 가능 범위가 뜬다.
    const beginTrapPlacement = () => {
      if ((game.player.trapCount || 0) <= 0) { game.showToast("NO TRAPS LEFT"); return; }
      game._trapPlacing = !game._trapPlacing;
      game.showToast(game._trapPlacing ? "TRAP // 범위 내 우클릭으로 설치" : "TRAP CANCEL");
    };
    // 설치 모드에서 우클릭: 범위 안(placeRange)에 덫을 놓는다. 범위 밖이면 경계로 당겨 놓는다.
    const placeTrapAtMouse = () => {
      if ((game.player.trapCount || 0) <= 0) { game._trapPlacing = false; game.showToast("NO TRAPS LEFT"); return; }
      const toTarget = game.mouse.world.clone().sub(game.player.pos);
      const distance = toTarget.length();
      const pos = distance <= TRAP.placeRange
        ? game.mouse.world.clone()
        : game.player.pos.clone().add(toTarget.normalize().multiplyScalar(TRAP.placeRange));
      if (game.collides(pos, 10)) { game.showToast("TRAP // 벽 위엔 설치 불가"); return; }
      game.player.trapCount--;
      game._traps.push({ pos, meshes: makeTrapVisual(pos), ringStrips: makeTrapRing(pos), armedAt: game.now + TRAP.armDelay });
      game._trapPlacing = false;
      // 설치 확인 플래시(내 덫 = 아군색·파랑)
      drawTrapRing(pos, TRAP.radius, TRAP.allyColor, 5, 0.9, 0.5, 28);
      createPulseDisc({ pos: pos.clone() }, 40, TRAP.allyColor, 0.4, 0.3);
      game.showToast(`TRAP SET // ${game.player.trapCount} LEFT`);
    };
    // 설치 모드 미리보기: 빨간 설치 가능 범위 링 + 조준 마커 (createWorldStrip 로 매 프레임 그린다).
    const updateTrapPlacement = () => {
      if (!isOperator("sniper") || !game._trapPlacing || !game.player.alive || game.phase !== "playing") return;
      const origin = game.player.pos;
      // 설치 가능 범위(아군색·파란 원)
      drawTrapRing(origin, TRAP.placeRange, TRAP.allyColor, 4, 0.7, 0.05, 24);
      // 조준 마커 — 범위 밖이면 경계로 당긴다. 벽 위면 회색(설치 불가).
      const toTarget = game.mouse.world.clone().sub(origin);
      const distance = toTarget.length();
      const pos = distance <= TRAP.placeRange
        ? game.mouse.world.clone()
        : origin.clone().add(toTarget.normalize().multiplyScalar(TRAP.placeRange));
      const markerColor = game.collides(pos, 10) ? 0x888888 : TRAP.allyColor;
      drawTrapRing(pos, 13, markerColor, 3, 0.95, 0.05, 10);
      createWorldStrip(vector(pos.x - 9, pos.y), vector(pos.x + 9, pos.y), 3, markerColor, { duration: 0.05, opacity: 0.95 });
      createWorldStrip(vector(pos.x, pos.y - 9), vector(pos.x, pos.y + 9), 3, markerColor, { duration: 0.05, opacity: 0.95 });
    };
    // 내 덫도 시야 안(안개 준수)에 있을 때만 그린다. 발동 판정은 시야와 무관하게 계속한다.
    const trapInSight = (pos) => {
      if (!game.player.alive) return false;
      const probe = { pos: game.player.pos.clone(), alive: true, radius: 4, team: "enemy" };
      probe.pos.set(pos.x, pos.y);
      return game.isVisible(game.player, probe, B.vision.coneDegrees, B.vision.maxRange);
    };
    const updateTraps = () => {
      if (!game._traps.length) return;
      for (let index = game._traps.length - 1; index >= 0; index--) {
        const trap = game._traps[index];
        // 본체 점 + 지속 링을 하나의 깜빡임 값으로 함께 조절한다(따로 깜빡이지 않게).
        // 속도/위상도 원격(적 덫)과 동일하게 맞춘다.
        const blink01 = Math.abs(Math.sin(performance.now() / 250)); // 0..1
        const visible = trapInSight(trap.pos);
        for (const mesh of trap.meshes) { mesh.visible = visible; mesh.material.opacity = 0.5 + blink01 * 0.25; }
        for (const strip of trap.ringStrips || []) { strip.visible = visible; strip.material.opacity = 0.4 + blink01 * 0.4; }
        if (game.now < trap.armedAt) continue;
        for (const bot of game.bots) {
          if (!bot.alive || bot.team === game.player.team) continue;
          // 실제 발동은 보이는 범위(radius)보다 약간 넓은 triggerRadius — 살짝만 걸쳐도 작동.
          if (bot.pos.distanceTo(trap.pos) > TRAP.triggerRadius + bot.radius) continue;
          game.applyControlEffect(bot, 0.05, TRAP.rootDuration); // 1초 포박
          game.damageActor(game.player, bot, TRAP.damage);        // 약한 피해
          for (let burst = 0; burst < 12; burst++) {
            const angle = burst / 12 * Math.PI * 2;
            const dir = vector(Math.cos(angle), Math.sin(angle));
            createWorldStrip(trap.pos.clone(), trap.pos.clone().add(dir.multiplyScalar(44)), 3.5, TRAP.color, { duration: 0.26, opacity: 0.9 });
          }
          createPulseDisc(bot, 44, TRAP.color, 0.5, 0.24);
          disposeTrap(trap);
          game._traps.splice(index, 1);
          game.showToast("TRAP TRIGGERED // ROOT");
          break;
        }
      }
    };

    // ---- 폭탄마: 수류탄 직투척(우클릭) + 직선 폭격(SPACE) ----
    const throwFragDirect = () => {
      if (!abilityReady("frag")) { game.showToast(`FRAG ${cooldownRemaining("frag").toFixed(1)}s`); return; }
      beginCooldown("frag", B.operators.demolitionist.fragCooldown);
      game.throwGrenade("frag", game.player, game.mouse.world.clone());
    };

    const BARRAGE = B.operators.demolitionist.barrage;
    const explosionBurstAt = (point, radius, color = 0xffa8f0) => {
      createPulseDisc({ pos: point.clone() }, radius, color, 0.35, 0.18);
      for (let index = 0; index < 14; index++) {
        const angle = index / 14 * Math.PI * 2;
        const dir = vector(Math.cos(angle), Math.sin(angle));
        createWorldStrip(
          point.clone().add(dir.clone().multiplyScalar(8)),
          point.clone().add(dir.multiplyScalar(radius)),
          index % 2 ? 4 : 6,
          index % 2 ? 0xffd2a1 : color,
          { duration: 0.28, opacity: 0.9 },
        );
      }
      createBurstParticle(point.clone(), 0xffffff, vector(), 0.5, 0.18, 0.95);
    };
    const fireBarrage = () => {
      if (game._barrage) return;
      if (!abilityReady("barrage")) { game.showToast(`BARRAGE ${cooldownRemaining("barrage").toFixed(1)}s`); return; }
      beginCooldown("barrage", BARRAGE.cooldown);
      const direction = vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
      game._barrage = { origin: game.player.pos.clone(), dir: direction, nextAt: game.now, fired: 0 };
      game.showToast("LINE BARRAGE");
    };
    const updateBarrage = () => {
      const barrage = game._barrage;
      if (!barrage) return;
      if (game.now < barrage.nextAt) return;
      if (barrage.fired >= BARRAGE.steps || !game.player.alive || game.phase !== "playing") { game._barrage = null; return; }
      const point = barrage.origin.clone().add(barrage.dir.clone().multiplyScalar(BARRAGE.spacing * (barrage.fired + 1)));
      damageInRadius(game.player, point, BARRAGE.radius, BARRAGE.damage);
      explosionBurstAt(point, BARRAGE.radius);
      game.cameraShake = Math.max(game.cameraShake, 4);
      barrage.fired += 1;
      barrage.nextAt = game.now + BARRAGE.interval;
    };

    const useSecondary = () => {
      if (isOperator("gunslinger")) fireSpray();
      else if (isOperator("ninja")) fireDaggers();
      else if (isOperator("bulwark")) deployBarrier();
      else if (isOperator("reaper")) useScytheThrow();
      else if (isOperator("sentinel")) startHeavyCharge();
      else if (isOperator("soldier")) throwFlashDirect();
      else if (isOperator("hunter")) useBloodScent();
      else if (isOperator("sniper")) { if (game._trapPlacing) placeTrapAtMouse(); else fireNet(); }
      else if (isOperator("demolitionist")) throwFragDirect();
      else game.showToast("NO SECONDARY ATTACK");
    };

    const NAV_CELL = B.operators.reaper.summon.navCell;
    const NAV_RADIUS = B.operators.reaper.summon.navRadius;
    const navSignature = () => `${game._activeLayout || "layout"}|${game.walls
      .map((wall) => `${wall.id}:${wall.x},${wall.y},${wall.w},${wall.h}`)
      .join("|")}`;

    const buildSummonNavGrid = () => {
      const signature = navSignature();
      if (game._summonNavCache?.signature === signature) return game._summonNavCache;
      const parameters = game.floor.geometry?.parameters || {};
      const width = parameters.width || 2600;
      const height = parameters.height || 1800;
      const columns = Math.max(1, Math.floor(width / NAV_CELL));
      const rows = Math.max(1, Math.floor(height / NAV_CELL));
      const minX = -width / 2 + NAV_CELL / 2;
      const minY = -height / 2 + NAV_CELL / 2;
      const blocked = new Uint8Array(columns * rows);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const point = vector(minX + column * NAV_CELL, minY + row * NAV_CELL);
          blocked[row * columns + column] = game.collides(point, NAV_RADIUS) ? 1 : 0;
        }
      }
      game._summonNavCache = { signature, width, height, columns, rows, minX, minY, blocked };
      game.canvas.dataset.summonNavGrid = `${columns}x${rows}`;
      return game._summonNavCache;
    };

    const navPoint = (grid, index) => {
      const column = index % grid.columns;
      const row = Math.floor(index / grid.columns);
      return vector(grid.minX + column * NAV_CELL, grid.minY + row * NAV_CELL);
    };

    const nearestOpenCell = (grid, point) => {
      const baseColumn = clamp(Math.round((point.x - grid.minX) / NAV_CELL), 0, grid.columns - 1);
      const baseRow = clamp(Math.round((point.y - grid.minY) / NAV_CELL), 0, grid.rows - 1);
      let best = -1;
      let bestDistance = Infinity;
      for (let radius = 0; radius <= 5; radius++) {
        for (let row = baseRow - radius; row <= baseRow + radius; row++) {
          for (let column = baseColumn - radius; column <= baseColumn + radius; column++) {
            if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue;
            if (radius > 0 && Math.abs(column - baseColumn) < radius && Math.abs(row - baseRow) < radius) continue;
            const index = row * grid.columns + column;
            if (grid.blocked[index]) continue;
            const distance = navPoint(grid, index).distanceToSquared(point);
            if (distance < bestDistance) {
              best = index;
              bestDistance = distance;
            }
          }
        }
        if (best >= 0) break;
      }
      return best;
    };

    const segmentClearForSummon = (from, to, radius = 13) => {
      if (game.rayBlocked(from, to)) return false;
      const distance = from.distanceTo(to);
      const steps = Math.max(1, Math.ceil(distance / 11));
      for (let step = 1; step < steps; step++) {
        const point = from.clone().lerp(to, step / steps);
        if (game.collides(point, radius)) return false;
      }
      return !game.collides(to, radius);
    };

    const smoothSummonPath = (start, points) => {
      const smoothed = [];
      let anchor = start;
      let index = 0;
      while (index < points.length) {
        let furthest = index;
        for (let candidate = points.length - 1; candidate >= index; candidate--) {
          if (!segmentClearForSummon(anchor, points[candidate])) continue;
          furthest = candidate;
          break;
        }
        smoothed.push(points[furthest]);
        anchor = points[furthest];
        index = furthest + 1;
      }
      return smoothed;
    };

    const findSummonPath = (start, goal) => {
      if (segmentClearForSummon(start, goal)) return [goal.clone()];
      const grid = buildSummonNavGrid();
      const startIndex = nearestOpenCell(grid, start);
      const goalIndex = nearestOpenCell(grid, goal);
      if (startIndex < 0 || goalIndex < 0) return [];
      const total = grid.columns * grid.rows;
      const score = new Float64Array(total);
      score.fill(Infinity);
      const parent = new Int32Array(total);
      parent.fill(-1);
      const closed = new Uint8Array(total);
      const open = [];
      const goalColumn = goalIndex % grid.columns;
      const goalRow = Math.floor(goalIndex / grid.columns);
      const heuristic = (index) => {
        const column = index % grid.columns;
        const row = Math.floor(index / grid.columns);
        const dx = Math.abs(column - goalColumn);
        const dy = Math.abs(row - goalRow);
        return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
      };
      const pushOpen = (index, priority) => {
        const entry = { index, priority };
        open.push(entry);
        let child = open.length - 1;
        while (child > 0) {
          const parentIndex = Math.floor((child - 1) / 2);
          if (open[parentIndex].priority <= priority) break;
          open[child] = open[parentIndex];
          child = parentIndex;
        }
        open[child] = entry;
      };
      const popOpen = () => {
        const root = open[0];
        const tail = open.pop();
        if (open.length && tail) {
          let parentIndex = 0;
          while (true) {
            const left = parentIndex * 2 + 1;
            if (left >= open.length) break;
            const right = left + 1;
            const child = right < open.length && open[right].priority < open[left].priority ? right : left;
            if (open[child].priority >= tail.priority) break;
            open[parentIndex] = open[child];
            parentIndex = child;
          }
          open[parentIndex] = tail;
        }
        return root.index;
      };
      score[startIndex] = 0;
      pushOpen(startIndex, heuristic(startIndex));
      const directions = [
        [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
        [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
      ];

      while (open.length) {
        const current = popOpen();
        if (closed[current]) continue;
        if (current === goalIndex) break;
        closed[current] = 1;
        const column = current % grid.columns;
        const row = Math.floor(current / grid.columns);
        for (const [offsetX, offsetY, moveCost] of directions) {
          const nextColumn = column + offsetX;
          const nextRow = row + offsetY;
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= grid.columns || nextRow >= grid.rows) continue;
          const next = nextRow * grid.columns + nextColumn;
          if (closed[next] || grid.blocked[next]) continue;
          if (offsetX && offsetY) {
            if (grid.blocked[row * grid.columns + nextColumn] || grid.blocked[nextRow * grid.columns + column]) continue;
          }
          const tentative = score[current] + moveCost;
          if (tentative >= score[next]) continue;
          score[next] = tentative;
          parent[next] = current;
          pushOpen(next, tentative + heuristic(next));
        }
      }
      if (goalIndex !== startIndex && parent[goalIndex] < 0) return [];
      const raw = [];
      for (let current = goalIndex; current >= 0 && current !== startIndex; current = parent[current]) {
        raw.push(navPoint(grid, current));
        if (parent[current] < 0) break;
      }
      raw.reverse();
      if (!raw.length || segmentClearForSummon(raw[raw.length - 1], goal)) raw.push(goal.clone());
      return smoothSummonPath(start, raw);
    };

    const findFreeSummonSpawn = (preferred) => {
      if (!game.collides(preferred, 12)) return preferred;
      for (const radius of [36, 52, 68, 84]) {
        for (let index = 0; index < 16; index++) {
          const angle = index / 16 * Math.PI * 2;
          const candidate = game.player.pos.clone().add(vector(Math.cos(angle), Math.sin(angle)).multiplyScalar(radius));
          if (!game.collides(candidate, 12)) return candidate;
        }
      }
      return game.player.pos.clone();
    };

    const summonUndead = () => {
      if (!abilityReady("undead")) {
        game.showToast(`UNDEAD ${cooldownRemaining("undead").toFixed(1)}s`);
        return;
      }
      if (game.player.hp <= B.operators.reaper.summon.minHp) {
        game.showToast("HP 25 이하에서는 소환 불가");
        return;
      }
      game.player.hp -= B.operators.reaper.summon.costHp;
      game.player.lastDamageAt = game.now;
      beginCooldown("undead", SPECIAL_COOLDOWN);
      // 해골이 들고 있는 미니 낫: 사신 본체의 낫 텍스처를 복제해 축소한다.
      const scytheSource = game.player._weaponVisualRoot;
      for (const offset of [-0.55, 0, 0.55]) {
        const preferred = game.player.pos.clone().add(vector(Math.cos(game.player.dir + offset), Math.sin(game.player.dir + offset)).multiplyScalar(B.operators.reaper.summon.spawnDistance));
        const pos = findFreeSummonSpawn(preferred);
        const mesh = game.player.mesh.clone(true);
        mesh.scale.setScalar(B.operators.reaper.summon.scale);
        mesh.traverse((part) => {
          if (part.material) {
            part.material = part.material.clone();
            part.material.color?.setHex(0xc7d0d5);
          }
        });
        if (scytheSource) {
          const scythe = scytheSource.clone(true);
          // 사신 본체 무기가 재구성될 때 공유 자원이 해제되지 않도록
          // 지오메트리/머티리얼을 복제해 독립시킨다.
          scythe.traverse((part) => {
            if (part.geometry) part.geometry = part.geometry.clone();
            if (part.material && !Array.isArray(part.material)) part.material = part.material.clone();
          });
          scythe.position.z = 12;
          scythe.scale.setScalar(B.operators.reaper.summon.scytheScale);
          mesh.add(scythe);
        }
        mesh.position.set(pos.x, pos.y, 10);
        game.entityGroup.add(mesh);
        game._summons.push({
          id: ++game._summonSerial,
          pos,
          mesh,
          hp: 1,
          nextDamageAt: 0,
          expireAt: game.now + B.operators.reaper.summon.expire,
          swingAt: 0,
          swingDir: 0,
          swingTrailAt: 0,
          nav: {
            path: [],
            index: 0,
            targetId: null,
            targetPos: null,
            nextRepathAt: 0,
            anchor: pos.clone(),
            anchorAt: game.now,
          },
        });
      }
      game.showToast("UNDEAD ×3 SUMMONED");
    };

    function clearSummons() {
      while (game._summons.length) removeSummon(game._summons.length - 1);
    }

    function clearTraps() {
      for (const trap of game._traps || []) {
        for (const mesh of [...(trap.meshes || []), ...(trap.ringStrips || [])]) {
          mesh.parent?.remove(mesh);
          mesh.geometry?.dispose?.();
          mesh.material?.dispose?.();
        }
      }
      if (game._traps) game._traps.length = 0;
      const preview = game._trapPreview;
      if (preview) {
        for (const mesh of [preview.area, preview.marker]) {
          mesh.parent?.remove(mesh);
          mesh.geometry?.dispose?.();
          mesh.material?.dispose?.();
        }
        game._trapPreview = null;
      }
    }

    function clearNet() {
      const net = game._net;
      if (!net) return;
      for (const mesh of net.meshes || []) {
        mesh.parent?.remove(mesh);
        mesh.geometry?.dispose?.();
        mesh.material?.dispose?.();
      }
      game._net = null;
    }

    function removeSummon(index) {
      const summon = game._summons[index];
      if (!summon) return;
      game.entityGroup.remove(summon.mesh);
      summon.mesh.traverse((part) => {
        if (Array.isArray(part.material)) part.material.forEach((material) => material.dispose?.());
        else part.material?.dispose?.();
      });
      game._summons.splice(index, 1);
    }

    const damageSummon = (summonId) => {
      const index = game._summons.findIndex((summon) => summon.id === summonId);
      if (index < 0) return false;
      const summon = game._summons[index];
      summon.hp = 0; // Any valid hit destroys a summoned undead.
      for (let burst = 0; burst < 6; burst++) {
        const angle = burst / 6 * Math.PI * 2;
        const dir = vector(Math.cos(angle), Math.sin(angle));
        createWorldStrip(
          summon.pos.clone(),
          summon.pos.clone().add(dir.multiplyScalar(18)),
          3,
          0x8d7bff,
          { duration: 0.2, opacity: 0.8 },
        );
      }
      removeSummon(index);
      return true;
    };
    game.damageSummon = damageSummon;

    const REVEAL_DURATION = B.operators.sentinel.reveal.duration;
    const REVEAL_RANGE = B.operators.sentinel.reveal.range;
    const REVEAL_COOLDOWN = B.operators.sentinel.reveal.cooldown;

    const useReveal = () => {
      if (!abilityReady("reveal")) {
        game.showToast(`SCAN ${cooldownRemaining("reveal").toFixed(1)}s`);
        return;
      }
      beginCooldown("reveal", REVEAL_COOLDOWN);
      game._revealUntil = game.now + REVEAL_DURATION;
      game._revealRange = REVEAL_RANGE;
      game.visibilityDirty = true;
      createRangeRing(game.player, REVEAL_RANGE, 0xff5963, REVEAL_DURATION, 0.5);
      createRangeRing(game.player, REVEAL_RANGE * 0.55, 0xff8b91, REVEAL_DURATION, 0.32);
      game.showToast(`THERMAL VISION // ${REVEAL_DURATION.toFixed(0)}s`);
    };

    const NINJA_DASH_SPEED = B.operators.ninja.dash.speed;
    const NINJA_DASH_DURATION = B.operators.ninja.dash.duration;
    const NINJA_SMOKE_RADIUS = B.operators.ninja.smoke.radius;
    const NINJA_SMOKE_DURATION = B.operators.ninja.smoke.duration;

    /** 지정 지점에 닌자 강화 연막(반경 225 · 5초)을 즉시 생성한다. */
    const spawnNinjaSmokeAt = (point) => {
      const mesh = createEffectMesh(0x9bb5ff, 0.3);
      mesh.position.set(point.x, point.y, 18);
      game.fxGroup.add(mesh);
      game.explode({
        type: "smoke",
        pos: point.clone(),
        owner: game.player,
        ninjaSmoke: true,
        mesh,
      });
    };

    const useNinjaDash = () => {
      if (!abilityReady("ninja-smoke")) {
        game.showToast(`NINJA DASH ${cooldownRemaining("ninja-smoke").toFixed(1)}s`);
        return;
      }
      beginCooldown("ninja-smoke", SPECIAL_COOLDOWN);
      // 대쉬 방향: 현재 누르는 WASD 방향, 입력 없으면 마지막 이동/조준 방향.
      const direction = getWasmDir()
        || (game._lastMoveDir ? game._lastMoveDir.clone() : null)
        || vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
      direction.normalize();
      game._operatorDash = {
        kind: "ninja",
        direction,
        startedAt: game.now,
        until: game.now + NINJA_DASH_DURATION,
        speed: NINJA_DASH_SPEED,
        hit: new Set(),
        invulnerable: false,
        nextFxAt: game.now,
        smokeSpawned: false,
      };
      createRangeRing(game.player, game.player.radius + 9, 0x9bb5ff, 0.3, 0.5);
      createPulseDisc(game.player, NINJA_SMOKE_RADIUS, 0x9bb5ff, 0.5, 0.08);
      game.canvas.dataset.ninjaDash = String(Math.round(game.now * 100) / 100);
      game.showToast("NINJA DASH");
    };

    const FLASH_SHIELD_RANGE = B.operators.bulwark.flashShield.range;
    const FLASH_SHIELD_HALF_ANGLE = B.operators.bulwark.flashShield.halfAngleDeg * Math.PI / 360; // 좌우 60도 (총 120도)
    const FLASH_SHIELD_DURATION = B.operators.bulwark.flashShield.duration; // 섬광탄과 동일한 1초 시야 차단

    const useFlashShield = () => {
      if (!abilityReady("flash-shield")) {
        game.showToast(`FLASH SHIELD ${cooldownRemaining("flash-shield").toFixed(1)}s`);
        return;
      }
      beginCooldown("flash-shield", SPECIAL_COOLDOWN);
      // 섬광방패는 아이언이 바라보고 있는(조준) 방향으로 전개한다.
      const direction = vector(Math.cos(game.player.dir), Math.sin(game.player.dir));
      direction.normalize();

      let hits = 0;
      for (const target of game.bots) {
        if (!target.alive) continue;
        const relative = target.pos.clone().sub(game.player.pos);
        const distance = relative.length();
        if (distance > FLASH_SHIELD_RANGE) continue;
        if (Math.abs(angleDelta(Math.atan2(relative.y, relative.x), Math.atan2(direction.y, direction.x))) > FLASH_SHIELD_HALF_ANGLE) continue;
        target.flashedUntil = Math.max(target.flashedUntil, game.now + FLASH_SHIELD_DURATION);
        target.hadVisual = false;
        hits++;
      }
      game.visibilityDirty = true;
      game.cameraShake = Math.max(game.cameraShake, 3);

      // 시각 이펙트: 부채꼴 범위에만 빛이 발생한다 (방사형 버스트 없음)
      createRangeSector(game.player, Math.atan2(direction.y, direction.x), FLASH_SHIELD_RANGE, FLASH_SHIELD_HALF_ANGLE, 0xffe67d);
      createRangeSector(game.player, Math.atan2(direction.y, direction.x), FLASH_SHIELD_RANGE * 0.55, FLASH_SHIELD_HALF_ANGLE * 0.8, 0xffffff);
      game.canvas.dataset.lastFlashShield = `${Math.round(game.now * 100) / 100}:hits=${hits}`;
      game.showToast(hits ? `FLASH SHIELD ×${hits}` : "FLASH SHIELD");
    };

    const useAbility = () => {
      if (isOperator("sentinel")) useReveal();
      else if (isOperator("bulwark")) useFlashShield();
      else if (isOperator("reaper")) summonUndead();
      else if (isOperator("hunter")) startDash("hunter");
      else if (isOperator("ninja")) useNinjaDash();
      else if (isOperator("gunslinger")) startDash("gunslinger");
      else if (isOperator("soldier")) useEnhance();
      else if (isOperator("sniper")) beginTrapPlacement();
      else if (isOperator("demolitionist")) fireBarrage();
      else if (!isOperator("frog")) game.showToast("NO ACTIVE ABILITY");
    };

    game.canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 0 && game.phase === "playing" && isOperator("bulwark") && game._barrier?.active) {
        event.preventDefault();
        event.stopImmediatePropagation();
        game.mouse.x = event.clientX;
        game.mouse.y = event.clientY;
        game.mouse.down = true;
        game.updateMouseWorld();
        game.fire(game.player, game.player.dir);
        return;
      }
      if (event.button !== 2 || game.phase !== "playing") return;
      if (isOperator("frog")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      game.mouse.x = event.clientX;
      game.mouse.y = event.clientY;
      game.updateMouseWorld();
      useSecondary();
    }, true);
    game.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    // 전투 중에는 우클릭이 항상 스킬이다. 캔버스 위의 오버레이(크로스헤어/HUD)로
    // 우클릭이 새어 브라우저 컨텍스트 메뉴("이미지 저장" 등)가 뜨는 걸 전역으로 막는다.
    document.addEventListener("contextmenu", (event) => {
      if (game.phase === "playing") event.preventDefault();
    }, true);
    window.addEventListener("pointerup", (event) => {
      if (event.button === 0) {
        game._railChargeStartedAt = null;
        game._railNeedsRelease = false;
        if (isOperator("sentinel")) game.player.ring.material.color.setHex(0x55f0b0);
      }
      if (event.button === 2) { releaseBarrier(); releaseHeavyLaser(); }
    });
    window.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || event.repeat || game.phase !== "playing" || isOperator("frog")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      useAbility();
    }, true);

    const originalDamageActor = game.damageActor.bind(game);
    game.damageActor = function damageWithOperatorRules(source, target, amount) {
      if (!target?.alive || source?.team === target.team) return;
      if (target === this.player && this._operatorDash?.invulnerable) return;
      // 아이언 방벽: 전방 공격(투사체·히트스캔)을 방벽 체력으로 흡수한다.
      if (target === this.player && isOperator("bulwark") && source?.pos && barrierBlocks(source.pos, target.pos)) {
        absorbBarrierDamage(amount);
        this.canvas.dataset.lastBarrierBlock = `${Math.round(this.now * 100) / 100}:${amount}`;
        return;
      }
      const before = target.hp;
      originalDamageActor(source, target, amount);
      if (target.hp < before) target.lastDamageAt = this.now;
    };

    const originalMoveActor = game.moveActor.bind(game);
    game.moveActor = function moveWithOperatorSpeed(actor, delta) {
      let movement = delta;
      if (actor === this.player && !this._operatorForcedMove) {
        if (isOperator("sniper")) movement = delta.clone().multiplyScalar(0.75);
        else if (isOperator("ninja") && this.isInsideSmoke(this.player.pos)) movement = delta.clone().multiplyScalar(1.5);
        else if (isOperator("bulwark") && this._barrier?.active) movement = delta.clone().multiplyScalar(0.5);
        else if (isOperator("soldier") && this._soldierBuffUntil > this.now) movement = delta.clone().multiplyScalar(B.operators.soldier.enhance.speedMult);
      }
      originalMoveActor(actor, movement);
    };

    const originalUpdatePlayer = game.updatePlayer.bind(game);
    game.updatePlayer = function updateOperatorPlayer(dt) {
      // 마지막 이동 방향 추적 (돌진 방향 fallback 용)
      const lastMove = getWasmDir();
      if (lastMove) this._lastMoveDir = lastMove.clone();
      const dash = this._operatorDash;
      if (!dash) {
        originalUpdatePlayer(dt);
        return;
      }
      if (!this.player.alive) {
        this._operatorDash = null;
        applyAppearance(operator());
        return;
      }
      const keys = this.keys;
      const mouseDown = this.mouse.down;
      this.keys = new Set();
      this.mouse.down = false;
      originalUpdatePlayer(dt);
      this.keys = keys;
      this.mouse.down = mouseDown;
      this._operatorForcedMove = true;
      this.moveActor(this.player, dash.direction.clone().multiplyScalar(dash.speed * dt));
      this._operatorForcedMove = false;
      this.player.syncMesh();
      if (dash.kind === "gunslinger") {
        for (const target of this.bots) {
          if (!target.alive || dash.hit.has(target) || target.pos.distanceTo(this.player.pos) > GUN_KATA_RADIUS) continue;
          dash.hit.add(target);
          this.damageActor(this.player, target, GUN_KATA_DAMAGE);
        }
        const progress = clamp((this.now - dash.startedAt) / Math.max(0.01, dash.until - dash.startedAt), 0, 1);
        this.player.mesh.rotation.z += progress * Math.PI * 8;
        for (const [index, piece] of getWeaponPieces().entries()) {
          const side = piece.userData.breachlineGunSide || Math.sign(piece.position.x) || (index % 2 ? 1 : -1);
          piece.userData.breachlineGunSide = side;
          piece.position.x = side * 17;
          piece.position.y = index < 2 ? 5 : -2;
          // asset-visuals 의 건카타 자세와 동일: 왼손 0°, 오른손 180° (양 방향)
          piece.rotation.z = side < 0 ? 0 : Math.PI;
        }
        if (this.now >= dash.nextFxAt) {
          dash.nextFxAt = this.now + 0.045;
          const spin = this.player.dir + progress * Math.PI * 8;
          for (const side of [-1, 1]) {
            const angle = spin + side * Math.PI / 2;
            const start = this.player.pos.clone().add(vector(Math.cos(angle), Math.sin(angle)).multiplyScalar(13));
            const end = this.player.pos.clone().add(vector(Math.cos(angle), Math.sin(angle)).multiplyScalar(64));
            createWorldStrip(start, end, 3.5, 0xffd166, { duration: 0.13, opacity: 0.85 });
          }
          this.cameraShake = Math.max(this.cameraShake, 2.2);
        }
      } else if (dash.kind === "hunter") {
        const pulse = 0.5 + Math.sin((this.now - dash.startedAt) * 55) * 0.5;
        this.player.ring.material.color.setHex(pulse > 0.45 ? 0xf4ffff : 0x64cfff);
        this.player.body.material.color.setHex(pulse > 0.45 ? 0xeaffff : 0x77bfff);
        if (this.now >= dash.nextFxAt) {
          dash.nextFxAt = this.now + 0.05;
          spawnAfterimage(this.player, pulse > 0.45 ? 0x9ef0ff : 0xffab63);
        }
      } else if (dash.kind === "ninja") {
        // 대쉬 종료 시점에 현재 위치에 강화 연막을 생성한다.
        if (this.now >= dash.until && !dash.smokeSpawned) {
          dash.smokeSpawned = true;
          spawnNinjaSmokeAt(this.player.pos.clone());
          createPulseDisc(this.player, NINJA_SMOKE_RADIUS, 0x9bb5ff, 0.5, 0.08);
          this.canvas.dataset.ninjaSmokeAt = `${Math.round(this.player.pos.x)}:${Math.round(this.player.pos.y)}`;
        }
        if (this.now >= dash.nextFxAt) {
          dash.nextFxAt = this.now + 0.05;
          spawnAfterimage(this.player, 0x9bb5ff);
        }
      }
      if (this.now >= dash.until) {
        this._operatorDash = null;
        applyAppearance(operator());
        this.canvas.dataset.lastDashDirection = `${dash.direction.x.toFixed(3)}:${dash.direction.y.toFixed(3)}`;
      }
    };

    const originalVisible = game.isVisible.bind(game);
    game.isVisible = function operatorVisibility(observer, target, coneDegrees, distance) {
      // Ninja smoke is opaque from the inside, including for its owner.
      const ninjaSmokeAt = (point) => this.smokes.find((smoke) => smoke.ninjaSmoke
        && smoke.endAt > this.now && point.distanceTo(smoke.pos) < smoke.radius);
      const observerNinjaSmoke = ninjaSmokeAt(observer.pos);
      if (observerNinjaSmoke && ninjaSmokeAt(target.pos) !== observerNinjaSmoke) return false;
      // 닌자 패시브: 연막 안에 있는 모든 적은 절대 시야로 식별된다 (벽/연막 무시).
      if (observer === this.player && isOperator("ninja") && target !== observer && target.alive) {
        if (this.isInsideSmoke(target.pos) && target.pos.distanceTo(observer.pos) <= distance) {
          return true;
        }
      }
      if (observer === this.player && isOperator("sentinel") && this._revealUntil > this.now) {
        const delta = target.pos.clone().sub(observer.pos);
        // 투시 스캔: 벽과 연막 모두 투시한다.
        return target.alive && delta.length() <= distance
          && Math.abs(angleDelta(Math.atan2(delta.y, delta.x), observer.dir)) <= coneDegrees * Math.PI / 360;
      }
      // 사냥꾼 피냄새: 일정 거리 내의 적을 벽 너머로 감지한다(360도, 나만 보임).
      if (observer === this.player && isOperator("hunter") && this._bloodScentUntil > this.now
        && target !== observer && target.alive
        && target.pos.distanceTo(observer.pos) <= B.operators.hunter.bloodScent.range) {
        return true;
      }
      const adjustedDistance = observer === this.player && isOperator("sniper") ? distance * 1.5 : distance;
      const adjustedCone = observer === this.player && isOperator("bulwark")
        ? SHIELD_VIEW_DEGREES
        : coneDegrees;
      return originalVisible(observer, target, adjustedCone, adjustedDistance);
    };

    const originalTraceVision = game.traceVision.bind(game);
    game.traceVision = function operatorTraceVision(origin, direction, distance) {
      let adjustedDirection = direction;
      if (isOperator("bulwark") && origin.distanceToSquared(this.player.pos) < 1) {
        const angle = Math.atan2(direction.y, direction.x);
        const halfView = SHIELD_VIEW_DEGREES * Math.PI / 360;
        const clampedAngle = this.player.dir + clamp(angleDelta(angle, this.player.dir), -halfView, halfView);
        adjustedDirection = vector(Math.cos(clampedAngle), Math.sin(clampedAngle));
      }
      // RB-08 투시 스캔 중에는 시야 부채꼴이 벽·연막에 잘리지 않는다.
      if (isOperator("sentinel") && this._revealUntil > this.now && origin.distanceToSquared(this.player.pos) < 1) {
        return origin.clone().add(adjustedDirection.clone().multiplyScalar(distance));
      }
      return originalTraceVision(origin, adjustedDirection, isOperator("sniper") ? distance * 1.5 : distance);
    };

    const originalOperatorVisibility = game.updateVisibility.bind(game);
    game.updateVisibility = function updateIronWideVision() {
      if (isOperator("bulwark")) this.visibilityDirty = true;
      originalOperatorVisibility();
      if (!isOperator("bulwark") || !this.visibilityMesh?.geometry || !this.visibilityBorder?.geometry) return;

      const halfView = SHIELD_VIEW_DEGREES * Math.PI / 360;
      const segments = 96;
      const points = [];
      for (let index = 0; index <= segments; index++) {
        const angle = this.player.dir - halfView + index / segments * halfView * 2;
        points.push(this.traceVision(
          this.player.pos,
          vector(Math.cos(angle), Math.sin(angle)),
          B.vision.maxRange,
        ));
      }

      const positions = [];
      for (let index = 0; index < points.length - 1; index++) {
        positions.push(
          this.player.pos.x, this.player.pos.y, 12,
          points[index].x, points[index].y, 12,
          points[index + 1].x, points[index + 1].y, 12,
        );
      }
      const oldGeometry = this.visibilityMesh.geometry;
      const oldPosition = oldGeometry.getAttribute("position");
      const geometry = new oldGeometry.constructor();
      geometry.setAttribute("position", new oldPosition.constructor(positions, 3));
      geometry.userData.ironViewDegrees = SHIELD_VIEW_DEGREES;
      this.visibilityMesh.geometry = geometry;
      oldGeometry.dispose();

      const Vector3 = this.camera.position.constructor;
      const borderPoints = [
        new Vector3(this.player.pos.x, this.player.pos.y, 13),
        ...points.map((point) => new Vector3(point.x, point.y, 13)),
        new Vector3(this.player.pos.x, this.player.pos.y, 13),
      ];
      const oldBorder = this.visibilityBorder.geometry;
      const borderGeometry = new oldBorder.constructor().setFromPoints(borderPoints);
      this.visibilityBorder.geometry = borderGeometry;
      oldBorder.dispose();
    };

    const updateSummons = (dt) => {
      for (let index = game._summons.length - 1; index >= 0; index--) {
        const summon = game._summons[index];
        let target = null;
        let nearestDistance = Infinity;
        for (const bot of game.bots) {
          if (!bot.alive || bot.team === "player") continue; // 아군은 소환수 목표 제외
          const distance = bot.pos.distanceToSquared(summon.pos);
          if (distance >= nearestDistance) continue;
          nearestDistance = distance;
          target = bot;
        }
        if (!target || game.now >= summon.expireAt) {
          removeSummon(index);
          continue;
        }
        const delta = target.pos.clone().sub(summon.pos);
        const distance = delta.length();
        if (distance <= B.operators.reaper.summon.attackRange && !game.rayBlocked(summon.pos, target.pos)) {
          if (game.now >= summon.nextDamageAt) {
            game.damageActor(game.player, target, B.operators.reaper.summon.attackDamage);
            summon.nextDamageAt = game.now + B.operators.reaper.summon.attackInterval;
            // 사신과 동일한 근접 연출: 휘두르기 + 부채꼴 + 트레일
            summon.swingAt = game.now;
            summon.swingDir = Math.atan2(delta.y, delta.x);
            summon.swingTrailAt = 0;
            createRangeSector({ pos: summon.pos }, summon.swingDir, B.operators.reaper.summon.attackRange, 0.9, 0xc59bff);
          }
        } else {
          const nav = summon.nav;
          const targetMoved = !nav.targetPos || nav.targetPos.distanceToSquared(target.pos) > 52 * 52;
          // 재경로는 쿨다운(0.38s) 안에 한 번만 수행한다. (이전: 매 프레임 A* → 프리징)
          if (game.now >= nav.nextRepathAt && (nav.targetId !== target.id || targetMoved || nav.index >= nav.path.length)) {
            nav.path = findSummonPath(summon.pos, target.pos);
            nav.index = 0;
            nav.targetId = target.id;
            nav.targetPos = target.pos.clone();
            nav.nextRepathAt = game.now + 0.38;
          }
          while (nav.index < nav.path.length && summon.pos.distanceTo(nav.path[nav.index]) < 22) nav.index++;
          let desired;
          if (nav.index < nav.path.length) desired = nav.path[nav.index].clone().sub(summon.pos);
          else desired = delta.clone();

          if (desired.lengthSq() < 0.01 || (!nav.path.length && !segmentClearForSummon(summon.pos, target.pos))) {
            let bestDirection = null;
            let bestScore = summon.pos.distanceToSquared(target.pos);
            for (let directionIndex = 0; directionIndex < 16; directionIndex++) {
              const angle = directionIndex / 16 * Math.PI * 2;
              const direction = vector(Math.cos(angle), Math.sin(angle));
              const candidate = summon.pos.clone().add(direction.clone().multiplyScalar(28));
              if (game.collides(candidate, 12)) continue;
              const score = candidate.distanceToSquared(target.pos);
              if (score >= bestScore) continue;
              bestScore = score;
              bestDirection = direction;
            }
            desired = bestDirection || delta.clone();
          }

          for (const other of game._summons) {
            if (other === summon) continue;
            const separation = summon.pos.clone().sub(other.pos);
            const separationDistance = separation.length();
            if (separationDistance > 0 && separationDistance < 34) {
              desired.add(separation.normalize().multiplyScalar((34 - separationDistance) * 1.8));
            }
          }

          if (desired.lengthSq() > 0.01) {
            desired.normalize().multiplyScalar(B.operators.reaper.summon.moveSpeed * dt); // 소환수 이동속도 2배
            const previous = summon.pos.clone();
            const candidateX = summon.pos.clone().add(vector(desired.x, 0));
            if (!game.collides(candidateX, 12)) summon.pos.x = candidateX.x;
            const candidateY = summon.pos.clone().add(vector(0, desired.y));
            if (!game.collides(candidateY, 12)) summon.pos.y = candidateY.y;
            // 벽에 갇힘 감지 시 즉시 재경로 대신 0.25초 스로틀 (프리징 방지)
            if (summon.pos.distanceToSquared(previous) < 0.05) {
              nav.nextRepathAt = Math.max(nav.nextRepathAt, game.now + 0.25);
            }
          }

          if (game.now - nav.anchorAt >= 0.42) {
            if (summon.pos.distanceToSquared(nav.anchor) < 4 * 4) {
              nav.nextRepathAt = Math.max(nav.nextRepathAt, game.now + 0.25);
            }
            nav.anchor.copy(summon.pos);
            nav.anchorAt = game.now;
          }
        }
        summon.mesh.position.set(summon.pos.x, summon.pos.y, 10);
        // 휘두르기 중에는 낫이 부채꼴을 그리며 스윙한다.
        let facingAngle = Math.atan2(delta.y, delta.x);
        if (summon.swingAt && game.now - summon.swingAt < 0.32) {
          const progress = (game.now - summon.swingAt) / 0.32;
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          facingAngle += -0.7 + eased * 1.4;
          if (game.now >= summon.swingTrailAt) {
            summon.swingTrailAt = game.now + 0.03;
            const tip = summon.pos.clone().add(
              vector(Math.cos(summon.swingDir), Math.sin(summon.swingDir)).multiplyScalar(38),
            );
            createWorldStrip(summon.pos.clone(), tip, 5, 0xc59bff, { duration: 0.18, opacity: 0.72 });
          }
        } else {
          summon.swingAt = 0;
        }
        summon.mesh.rotation.z = facingAngle;
      }
      game.canvas.dataset.undeadCount = String(game._summons.length);
      game.canvas.dataset.undeadPathNodes = game._summons.map((summon) => Math.max(0, summon.nav.path.length - summon.nav.index)).join(",");
    };

    // 적 AI가 해골 소환수를 위협으로 인식해 사격하게 한다.
    const SUMMON_COMBAT_RANGE = B.ai.summonCombatRange;
    const nearestSummonThreat = (bot) => {
      let best = null;
      let bestDistance = Infinity;
      for (const summon of game._summons) {
        const distance = summon.pos.distanceTo(bot.pos);
        if (distance >= bestDistance || distance > SUMMON_COMBAT_RANGE) continue;
        if (game.rayBlocked(bot.pos, summon.pos)) continue;
        bestDistance = distance;
        best = summon;
      }
      return best;
    };

    const botFightSummon = (bot, summon, dt) => {
      const relative = summon.pos.clone().sub(bot.pos);
      const distance = relative.length() || 1;
      bot.dir = Math.atan2(relative.y, relative.x);
      let movement;
      if (distance > 300) movement = relative.clone().normalize();
      else movement = vector(-relative.y, relative.x).normalize().multiplyScalar(bot.strafe);
      game.moveBot(bot, dt, movement);
      if (game.now >= (bot.reactionAt || 0)) {
        game.fire(bot, bot.dir + game.rng.angle((6 * Math.PI) / 180));
        bot.reactionAt = game.now + game.rng.range(0.6, 1.0);
      }
    };

    const originalUpdateBots = game.updateBots.bind(game);
    game.updateBots = function updateBotsMultiplayerSafe(dt) {
      // 멀티플레이 대비: 원격 플레이어 액터(_remote)는 AI 제어에서 제외한다.
      const remote = [];
      for (let index = this.bots.length - 1; index >= 0; index--) {
        if (!this.bots[index]._remote) continue;
        remote.push(this.bots.splice(index, 1)[0]);
      }
      if (game._summons.length) {
        const engaged = [];
        for (const bot of this.bots) {
          // 원격 플레이어 액터(_remote)는 서버 동기화 대상 — 로컬 교전 AI 제외
          if (!bot.alive || bot._remote || bot.team === "player" || bot.flashedUntil > this.now) continue;
          const summon = nearestSummonThreat(bot);
          if (!summon) continue;
          engaged.push(bot);
          botFightSummon(bot, summon, dt);
        }
        if (engaged.length) {
          // 교전 중인 봇을 잠시 제외하고 나머지 AI를 돌린다.
          const held = [];
          for (const bot of engaged) {
            const index = this.bots.indexOf(bot);
            if (index >= 0) {
              held.push([bot, index]);
              this.bots.splice(index, 1);
            }
          }
          originalUpdateBots(dt);
          for (const [bot, index] of held) {
            this.bots.splice(Math.min(index, this.bots.length), 0, bot);
            // 슬로우 링 색상(개구리) 보정
            if (bot.ring?.material) {
              bot.ring.material.color.setHex(bot.slowUntil > this.now ? 0x8ab4ff : 0xffb0ac);
            }
          }
          for (const bot of remote) this.bots.push(bot);
          return;
        }
      }
      originalUpdateBots(dt);
      for (const bot of remote) this.bots.push(bot);
    };

    // 세그먼트-원 충돌 판정. 코어 _p 는 투사체가 히트박스 내부에서 생성되면(근거리
    // 점사) 놓치는 결함이 있어, 보정 패스에서 이 함수로 재검사한다.
    const SUMMON_HIT_RADIUS = B.operators.reaper.summon.hitRadius;
    const segmentCircleHit = (start, end, center, radius) => {
      const sx = end.x - start.x;
      const sy = end.y - start.y;
      const lengthSq = sx * sx + sy * sy;
      let t = 0;
      if (lengthSq > 1e-9) {
        t = ((center.x - start.x) * sx + (center.y - start.y) * sy) / lengthSq;
        t = clamp(t, 0, 1);
      }
      const px = start.x + sx * t;
      const py = start.y + sy * t;
      const dx = center.x - px;
      const dy = center.y - py;
      return dx * dx + dy * dy <= radius * radius;
    };

    // 히트박스 판정 평준화: 모든 투사체(권총/샷건 펠릿 포함)에 동일한 완화 판정을
    // 적용해, 시각(탄환 폭)과 히트박스가 어긋나 보이는 경우를 제거한다.
    // 반경 +5 버퍼 + 코어가 놓치는 "근거리 내부 생성" 케이스 보정.
    const PROJECTILE_HIT_BUFFER = B.projectiles.hitBuffer;
    const originalUpdateProjectiles = game.updateProjectiles.bind(game);
    game.updateProjectiles = function updateProjectilesWithFairHits(dt) {
      for (const projectile of this.projectiles) {
        projectile._prevPos = projectile.pos.clone();
      }
      originalUpdateProjectiles(dt);

      // 캐릭터 대상 보정 (모든 팀의 투사체에 동일 적용)
      for (let index = this.projectiles.length - 1; index >= 0; index--) {
        const projectile = this.projectiles[index];
        if (!projectile?._prevPos) continue;
        // 방벽 흡수는 서버가 확정한다(멀티플레이) — 여기서는 하지 않는다.
        for (const target of [this.player, ...this.bots]) {
          if (target === projectile.source || !target.alive) continue;
          if (!segmentCircleHit(projectile._prevPos, projectile.pos, target.pos, target.radius + PROJECTILE_HIT_BUFFER)) continue;
          projectile.source.hits++;
          this.damageActor(projectile.source, target, projectile.damage);
          this.removeProjectile(index);
          break;
        }
      }

      // 소환수도 총알에 맞아 죽는다. (적 팀 투사체만)
      if (!game._summons.length) return;
      for (let index = this.projectiles.length - 1; index >= 0; index--) {
        const projectile = this.projectiles[index];
        if (!projectile || projectile.source?.team !== "enemy") continue;
        for (let summonIndex = game._summons.length - 1; summonIndex >= 0; summonIndex--) {
          const summon = game._summons[summonIndex];
          if (!segmentCircleHit(projectile._prevPos, projectile.pos, summon.pos, SUMMON_HIT_RADIUS + PROJECTILE_HIT_BUFFER)) continue;
          this.removeProjectile(index);
          damageSummon(summon.id, projectile.damage);
          break;
        }
      }
    };

    // 섬광 피격 시 캐릭터 주변에 남은 지속시간을 보여주는 점멸 링
    // (다른 플레이어가 "섬광에 맞았다 + 얼마나 남았는지"를 식별할 수 있다)
    const FLASH_HALO_DOTS = 12;
    const FLASH_HALO_RADIUS = 27;
    const FLASH_HALO_DURATION = 1; // 섬광탄 지속 시간(초) 기준
    const flashHalos = new Map(); // actor -> { group, dots }

    const ensureFlashHalo = (actor) => {
      let halo = flashHalos.get(actor);
      if (halo) return halo;
      const group = new game.fxGroup.constructor();
      const dots = [];
      for (let index = 0; index < FLASH_HALO_DOTS; index++) {
        const dot = game.player.body.clone(false);
        dot.geometry = game.player.body.geometry.clone();
        dot.material = game.player.body.material.clone();
        dot.material.color.setHex(0xffe066);
        dot.material.transparent = true;
        dot.material.opacity = 0.95;
        dot.material.depthWrite = false;
        dot.scale.setScalar(0.16);
        dots.push(dot);
        group.add(dot);
      }
      game.fxGroup.add(group);
      halo = { group, dots };
      flashHalos.set(actor, halo);
      return halo;
    };

    // ---- 아이언 방벽 (벡터 도형) ----
    // 상태: game._barrier = { active, hp, regenAt, disabledUntil, mesh }
    const barrierVisual = { group: null, fan: [], arc: [], edges: [] };

    const ensureBarrierVisual = () => {
      if (barrierVisual.group) return;
      const group = new game.fxGroup.constructor();
      const makeStrip = (color, opacity, width) => {
        const strip = game.floor.clone(false);
        strip.geometry = game.floor.geometry.clone();
        strip.material = game.floor.material.clone();
        strip.material.color.setHex(color);
        strip.material.transparent = true;
        strip.material.opacity = opacity;
        strip.material.depthWrite = false;
        strip.userData.barrierWidth = width;
        group.add(strip);
        return strip;
      };
      const fan = [];
      const fanCount = 12;
      for (let index = 0; index < fanCount; index++) {
        fan.push(makeStrip(0x4a9dff, 0.14, 9));
      }
      const arc = [];
      const arcCount = 10;
      for (let index = 0; index < arcCount; index++) {
        arc.push(makeStrip(0x9bd0ff, 0.85, 3));
      }
      const edges = [makeStrip(0x9bd0ff, 0.9, 3.4), makeStrip(0x9bd0ff, 0.9, 3.4)];
      group.visible = false;
      game.fxGroup.add(group);
      barrierVisual.group = group;
      barrierVisual.fan = fan;
      barrierVisual.arc = arc;
      barrierVisual.edges = edges;
    };

    const setBarrierStrip = (strip, from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.max(0.01, Math.hypot(dx, dy));
      const params = game.floor.geometry?.parameters || { width: 2600, height: 1800 };
      strip.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, 24);
      strip.rotation.z = Math.atan2(dy, dx);
      strip.scale.set(length / params.width, (strip.userData.barrierWidth || 3) / params.height, 1);
    };

    const syncBarrierVisual = () => {
      ensureBarrierVisual();
      const barrier = game._barrier;
      const visible = Boolean(barrier && barrier.active && game.phase === "playing" && game.player.alive);
      barrierVisual.group.visible = visible;
      if (!visible) return;
      const origin = game.player.pos;
      const dir = game.player.dir;
      const hpFrac = clamp(barrier.hp / BARRIER_MAX_HP, 0, 1);
      // 피해 비례: 방벽이 약해지면 호가 붉게 물든다
      for (const strip of [...barrierVisual.fan, ...barrierVisual.arc, ...barrierVisual.edges]) {
        strip.material.color.setHex(hpFrac > 0.35 ? 0x9bd0ff : 0xff8a7a);
      }
      const fanCount = barrierVisual.fan.length;
      barrierVisual.fan.forEach((strip, index) => {
        const angleA = dir - BARRIER_HALF_ANGLE + index / fanCount * BARRIER_HALF_ANGLE * 2;
        const angleB = dir - BARRIER_HALF_ANGLE + (index + 1) / fanCount * BARRIER_HALF_ANGLE * 2;
        setBarrierStrip(
          strip,
          origin.clone().add(vector(Math.cos(angleA), Math.sin(angleA)).multiplyScalar(BARRIER_INNER)),
          origin.clone().add(vector(Math.cos(angleB), Math.sin(angleB)).multiplyScalar(BARRIER_OUTER)),
        );
      });
      const arcCount = barrierVisual.arc.length;
      barrierVisual.arc.forEach((strip, index) => {
        const angleA = dir - BARRIER_HALF_ANGLE + index / arcCount * BARRIER_HALF_ANGLE * 2;
        const angleB = dir - BARRIER_HALF_ANGLE + (index + 1) / arcCount * BARRIER_HALF_ANGLE * 2;
        const radius = BARRIER_OUTER * (0.88 + hpFrac * 0.12);
        setBarrierStrip(
          strip,
          origin.clone().add(vector(Math.cos(angleA), Math.sin(angleA)).multiplyScalar(radius)),
          origin.clone().add(vector(Math.cos(angleB), Math.sin(angleB)).multiplyScalar(radius)),
        );
      });
      barrierVisual.edges.forEach((strip, index) => {
        const angle = dir + (index === 0 ? -BARRIER_HALF_ANGLE : BARRIER_HALF_ANGLE);
        const from = origin.clone().add(vector(Math.cos(angle), Math.sin(angle)).multiplyScalar(BARRIER_INNER));
        const to = origin.clone().add(vector(Math.cos(angle), Math.sin(angle)).multiplyScalar(BARRIER_OUTER));
        setBarrierStrip(strip, from, to);
      });
    };

    const resetBarrier = () => {
      game._barrier = {
        active: false,
        hp: BARRIER_MAX_HP,
        regenAt: 0,
        disabledUntil: 0,
      };
      if (barrierVisual.group) barrierVisual.group.visible = false;
      game.canvas.dataset.barrierHp = String(BARRIER_MAX_HP);
      game.canvas.dataset.barrierState = "ready";
    };

    const deployBarrier = () => {
      if (!isOperator("bulwark")) return;
      const barrier = game._barrier;
      if (game.now < barrier.disabledUntil) {
        game.showToast(`BARRIER ${Math.ceil(barrier.disabledUntil - game.now)}s`);
        return;
      }
      if (barrier.active) return;
      barrier.active = true;
      game.canvas.dataset.barrierState = "active";
      game.showToast("BARRIER DEPLOYED");
    };

    const releaseBarrier = () => {
      const barrier = game._barrier;
      if (!barrier || !barrier.active) return;
      barrier.active = false;
      barrier.regenAt = game.now + BARRIER_REGEN_DELAY;
      game.canvas.dataset.barrierState = "regen";
    };

    const destroyBarrier = () => {
      const barrier = game._barrier;
      if (!barrier || !barrier.active) return;
      barrier.active = false;
      barrier.hp = 0;
      barrier.disabledUntil = game.now + BARRIER_BREAK_COOLDOWN;
      // 파괴 이펙트: 방사형 파편 + 섬광
      for (let index = 0; index < 18; index++) {
        const angle = index / 18 * Math.PI * 2;
        const dir = vector(Math.cos(angle), Math.sin(angle));
        createWorldStrip(
          game.player.pos.clone().add(dir.clone().multiplyScalar(BARRIER_INNER)),
          game.player.pos.clone().add(dir.multiplyScalar(BARRIER_INNER + 46)),
          index % 2 ? 4 : 8,
          index % 3 ? 0x9bd0ff : 0xffffff,
          { duration: 0.34, opacity: 0.95 },
        );
      }
      createPulseDisc(game.player, BARRIER_OUTER, 0x9bd0ff, 0.4, 0.16);
      game.cameraShake = Math.max(game.cameraShake, 7);
      game.canvas.dataset.barrierState = "broken";
      game.canvas.dataset.barrierHp = "0";
      game.showToast("BARRIER DESTROYED");
    };

    const updateBarrier = (dt) => {
      const barrier = game._barrier;
      if (!barrier) return;
      if (!barrier.active && barrier.hp < BARRIER_MAX_HP && game.now >= barrier.regenAt) {
        barrier.hp = Math.min(BARRIER_MAX_HP, barrier.hp + BARRIER_REGEN_RATE * dt);
        game.canvas.dataset.barrierHp = String(Math.ceil(barrier.hp));
      }
      syncBarrierVisual();
    };

    // 방벽이 세그먼트(from→to)를 흡수하는지 판정 (구간 샘플링)
    const barrierBlocks = (from, to) => {
      const barrier = game._barrier;
      if (!barrier || !barrier.active || barrier.hp <= 0) return false;
      const samples = 10;
      for (let index = 0; index <= samples; index++) {
        const t = index / samples;
        const px = from.x + (to.x - from.x) * t;
        const py = from.y + (to.y - from.y) * t;
        const rel = vector(px - game.player.pos.x, py - game.player.pos.y);
        const dist = rel.length();
        if (dist < BARRIER_INNER || dist > BARRIER_OUTER) continue;
        const angle = Math.atan2(rel.y, rel.x);
        if (Math.abs(angleDelta(angle, game.player.dir)) <= BARRIER_HALF_ANGLE) return true;
      }
      return false;
    };

    const absorbBarrierDamage = (amount) => {
      const barrier = game._barrier;
      if (!barrier) return;
      barrier.hp = Math.max(0, barrier.hp - amount);
      game.canvas.dataset.barrierHp = String(Math.ceil(barrier.hp));
      if (barrier.hp <= 0) destroyBarrier();
    };
    game.destroyBarrier = destroyBarrier; // 멀티플레이 서버 확정 파괴 처리용

    const syncFlashHalos = () => {
      // 시야(부채꼴/원형) 안에 들어온 적에 한해서만 링을 표시한다. (자기 자신 제외)
      for (const actor of [game.player, ...game.bots]) {
        if (actor === game.player) continue;
        if (!actor.alive || actor.flashedUntil <= game.now) continue;
        if (!game.isVisible(game.player, actor, B.vision.coneDegrees, B.vision.maxRange)) continue;
        ensureFlashHalo(actor);
      }
      for (const [actor, halo] of [...flashHalos]) {
        const active = actor.alive && actor.flashedUntil > game.now
          && actor !== game.player
          && game.isVisible(game.player, actor, B.vision.coneDegrees, B.vision.maxRange);
        if (!active) {
          game.fxGroup.remove(halo.group);
          halo.group.traverse((part) => {
            part.geometry?.dispose?.();
            part.material?.dispose?.();
          });
          flashHalos.delete(actor);
          continue;
        }
        const fraction = clamp((actor.flashedUntil - game.now) / FLASH_HALO_DURATION, 0, 1);
        const visibleCount = Math.max(1, Math.ceil(FLASH_HALO_DOTS * fraction));
        halo.group.position.set(actor.pos.x, actor.pos.y, 0);
        halo.group.rotation.z += 0.02; // 남은 시간을 읽기 쉽게 천천히 회전
        const pulse = 1 + Math.sin(game.now * 6) * 0.08;
        halo.group.scale.set(pulse, pulse, 1);
        halo.dots.forEach((dot, index) => {
          const angle = index / FLASH_HALO_DOTS * Math.PI * 2;
          dot.position.set(Math.cos(angle) * FLASH_HALO_RADIUS, Math.sin(angle) * FLASH_HALO_RADIUS, 26);
          dot.visible = index < visibleCount;
        });
      }
    };

    const originalStep = game.step.bind(game);
    game.step = function operatorStep(dt) {
      originalStep(dt);
      for (const actor of [this.player, ...this.bots]) {
        if (!actor.alive || actor.hp >= (actor.maxHp || 100) || this.now - (actor.lastDamageAt ?? -Infinity) < 5) continue;
        actor.hp = Math.min(actor.maxHp || 100, actor.hp + 5 * dt);
      }
      // RB-08 투시 스캔 활성 중 식별 링 점멸 — 주변에서 능력 상태를 알 수 있게 한다.
      if (isOperator("sentinel") && this.player.alive && this._revealUntil > this.now) {
        this.player.ring.material.color.setHex(Math.sin(this.now * 11) > 0 ? 0xff3b45 : 0xffffff);
      }
      syncFlashHalos();
      updateBarrier(dt);
      updateScytheThrow(dt);
      updateSummons(dt);
      updateSpray();
      updateHeavyLaser();
      updateSoldierBuff();
      updateTraps();
      updateTrapPlacement();
      updateNet(dt);
      updateBarrage();
      updateOperatorFx();
      updateMeleeAnimation();
      updateRailChargeFx();
    };

    const originalRenderUi = game.renderUi.bind(game);
    game.renderUi = function renderOperatorUi() {
      originalRenderUi();
      if (!this.activeOperatorId) return;
      const selected = operator();
      const maxHp = this.player.maxHp || selected.hp || B.player.hp;
      const hp = Math.max(0, Math.min(maxHp, this.player.hp));
      const hpRatio = maxHp > 0 ? hp / maxHp : 0;
      const healthText = document.querySelector("#health-text");
      const healthBar = document.querySelector("#health-bar");
      if (healthText) healthText.textContent = `${Math.ceil(hp)} / ${maxHp}`;
      if (healthBar) healthBar.style.width = `${hpRatio * 100}%`;
      ui.operator.textContent = `${selected.name} // ${selected.koreanName}`;
      ui.operator.style.color = selected.color;
      ui.weapon.textContent = this.player.weapon.name;
      if (["reaper", "ninja"].includes(selected.id)) {
        ui.ammo.textContent = "∞";
        ui.reserve.textContent = "∞";
      } else if (["frog", "bulwark"].includes(selected.id)) {
        ui.ammo.textContent = `${this.player.ammo}`;
        ui.reserve.textContent = "∞";
      } else if (this.player.reserve >= 9999) {
        // 무제한 장탄 무기는 9999 대신 현재 최대 장탄수를 표시한다. (예: 30/30)
        ui.reserve.textContent = `${this.player.weapon.magSize}`;
      }
      const badgeCount = (value) => (Number.isFinite(value) ? String(value || 0) : "∞");
      ui.fragCount.textContent = badgeCount(this.player.fragGrenades);
      ui.flashCount.textContent = badgeCount(this.player.flashGrenades);
      ui.smokeCount.textContent = badgeCount(this.player.smokeGrenades);
      updateGadgetVisibility();

      const secondary = selected.controls.secondary;
      const ability = selected.controls.ability;
      let secondaryCooldown = 0;
      let abilityCooldown = 0;
      if (selected.id === "gunslinger") {
        secondaryCooldown = cooldownRemaining("spray");
        abilityCooldown = cooldownRemaining("gunslinger-dash");
      } else if (selected.id === "reaper") abilityCooldown = cooldownRemaining("undead");
      else if (selected.id === "hunter") {
        secondaryCooldown = cooldownRemaining("blood-scent");
        abilityCooldown = cooldownRemaining("hunter-dash");
      } else if (selected.id === "ninja") {
        secondaryCooldown = cooldownRemaining("daggers");
        abilityCooldown = cooldownRemaining("ninja-smoke");
      } else if (selected.id === "sentinel") {
        secondaryCooldown = cooldownRemaining("heavy-laser");
        abilityCooldown = cooldownRemaining("reveal");
      } else if (selected.id === "bulwark") abilityCooldown = cooldownRemaining("flash-shield");
      else if (selected.id === "soldier") {
        secondaryCooldown = cooldownRemaining("flash");
        abilityCooldown = cooldownRemaining("enhance");
      }
      else if (selected.id === "sniper") secondaryCooldown = cooldownRemaining("net");
      else if (selected.id === "demolitionist") {
        secondaryCooldown = cooldownRemaining("frag");
        abilityCooldown = cooldownRemaining("barrage");
      }
      else if (selected.id === "frog") abilityCooldown = this.getTongueCooldown?.() || 0;
      const cooldown = Math.max(secondaryCooldown, abilityCooldown);
      const secondaryStatus = secondaryCooldown > 0 ? ` ${secondaryCooldown.toFixed(1)}s` : "";
      const abilityStatus = abilityCooldown > 0 ? ` ${abilityCooldown.toFixed(1)}s` : "";
      ui.ability.textContent = `RMB ${secondary}${secondaryStatus} · SPACE ${ability}${abilityStatus}`;
      ui.ability.classList.toggle("ability-cooldown", cooldown > 0);
      ui.ability.classList.toggle("ability-ready", cooldown <= 0);
      // 스킬 슬롯 아래 스킬 이름 라벨 (슬롯1=우클릭, 슬롯2=스페이스)
      if (ui.skillName1) ui.skillName1.textContent = secondary === "-" ? "" : secondary;
      if (ui.skillName2) ui.skillName2.textContent = ability === "-" ? "" : ability;

      // 상단 중앙: 좌 아군 / 우 적 남은 인원.
      // 멀티플레이에서는 아군(사람)이 game.bots 에 없어 누락되므로, 멀티 훅이 있으면
      // 서버 기준 전체 로스터로 센다(getTeamCounts). 없으면(싱글) 로컬 봇으로 센다.
      let allyAlive;
      let enemyAlive;
      const teamCounts = this.getTeamCounts?.();
      if (teamCounts) {
        allyAlive = teamCounts.ally;
        enemyAlive = teamCounts.enemy;
      } else {
        const bots = this.bots || [];
        allyAlive = this.player && this.player.alive !== false ? 1 : 0;
        enemyAlive = 0;
        for (const bot of bots) {
          if (!bot.alive) continue;
          if (bot.team === "player") allyAlive += 1;
          else enemyAlive += 1;
        }
      }
      if (ui.allyCount) ui.allyCount.textContent = String(allyAlive);
      if (ui.enemyCount) ui.enemyCount.textContent = String(enemyAlive);

      // 하단 스킬 슬롯 2칸: 슬롯1=우클릭(특수), 슬롯2=스페이스(유틸). 쿨타임 회색 드레인 + 남은 초.
      // 슬롯1 배지: 군인 섬광탄·폭탄마 수류탄은 무제한(∞). 슬롯2 배지: 스나이퍼 덫 잔여 개수.
      const totals = SLOT_COOLDOWN_TOTALS[selected.id] || { secondary: 0, ability: 0 };
      const slot1Count = (selected.id === "soldier" || selected.id === "demolitionist") ? Infinity : 0;
      const slot2Count = selected.id === "sniper" ? (this.player.trapCount || 0) : 0;
      renderSkillSlot(ui.slot1, {
        label: secondary,
        remaining: secondaryCooldown,
        total: totals.secondary,
        count: slot1Count,
      });
      renderSkillSlot(ui.slot2, {
        label: ability,
        remaining: abilityCooldown,
        total: totals.ability,
        count: slot2Count,
      });

      if (selected.id === "sentinel" && this._railChargeStartedAt !== null) {
        const charge = clamp(this.now - this._railChargeStartedAt, 0, 1);
        ui.charge.classList.add("active");
        ui.chargeName.textContent = "RAILGUN CHARGE";
        ui.chargeBar.style.width = `${charge * 100}%`;
        ui.chargeRange.textContent = `${Math.round(charge * 100)}%`;
        this.player.ring.material.color.setHex(this._revealUntil > this.now ? 0xff3b45 : 0x55f0b0);
      }
      this.canvas.dataset.operatorCooldown = cooldown.toFixed(2);
      this.canvas.dataset.secondaryCooldown = secondaryCooldown.toFixed(2);
      this.canvas.dataset.abilityCooldown = abilityCooldown.toFixed(2);
      this.canvas.dataset.specialCooldownSeconds = String(SPECIAL_COOLDOWN);
      this.canvas.dataset.shieldViewDegrees = String(SHIELD_VIEW_DEGREES);
      this.canvas.dataset.barrierHp = String(Math.ceil(this._barrier?.hp ?? 0));
      this.canvas.dataset.weaponRpm = String(this.player.weapon.rpm);
      this.canvas.dataset.weaponReloadSeconds = String(this.player.weapon.reload);
      this.canvas.dataset.ninjaSmokeRadius = "225";
      this.canvas.dataset.daggerSpreadRadians = "0.16";
      this.canvas.dataset.demolitionistCharging = "disabled";
      this.canvas.dataset.hunterInvulnerable = String(Boolean(this._operatorDash?.invulnerable));
      this.canvas.dataset.soldierGadgets = isOperator("soldier") ? "flash:2" : "none";
      this.canvas.dataset.sniperGadgets = isOperator("sniper") ? "smoke:2" : "none";
      this.canvas.dataset.demolitionistGadgets = isOperator("demolitionist") ? "frag:2" : "none";
      this.canvas.dataset.healthRegenDelay = "5";
      this.canvas.dataset.healthRegenRate = "5";

      // 아이언 방벽 상태 표시
      const barrierEl = document.getElementById("barrier-status");
      if (barrierEl) {
        if (isOperator("bulwark") && this._barrier) {
          const barrier = this._barrier;
          barrierEl.classList.remove("hidden");
          if (this.now < barrier.disabledUntil) {
            barrierEl.textContent = `BARRIER ${Math.ceil(barrier.disabledUntil - this.now)}s`;
            barrierEl.className = "barrier-status broken";
          } else {
            barrierEl.textContent = `BARRIER ${Math.ceil(barrier.hp)}/${BARRIER_MAX_HP}`;
            barrierEl.className = barrier.hp < BARRIER_MAX_HP * 0.35 ? "barrier-status damaged" : "barrier-status";
          }
        } else {
          barrierEl.classList.add("hidden");
        }
      }
    };

    game.canvas.dataset.operatorSystem = "10-class-v2";
  };

  installOperatorSystem();
})();
