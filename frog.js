(() => {
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

  installFrog();
})();
