(() => {
  const installFrog = () => {
    const game = window.__breachline;
    if (!game) {
      requestAnimationFrame(installFrog);
      return;
    }

    const FROG = {
      id: "frog",
      name: "FROG TONGUE",
      damage: 30,
      pellets: 1,
      rpm: 75,
      spreadDeg: 0,
      magSize: 1,
      reserve: 0,
      reload: 0,
      range: 650,
      projectileSpeed: 950,
      color: 0xff6b99,
    };
    const vec = (x = 0, y = 0) => new game.player.pos.constructor(x, y);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const isFrog = () => game.player.weapon && game.player.weapon.id === "frog";
    let tongue = null;
    let tongueReadyAt = 0;
    let canLaunchTongue = true;

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

    const rayActor = (origin, direction, maxDistance, actor) => {
      const dx = actor.pos.x - origin.x;
      const dy = actor.pos.y - origin.y;
      const along = dx * direction.x + dy * direction.y;
      const radius = actor.radius + 8;
      if (along < 0 || along - radius > maxDistance) return undefined;
      const sideSq = dx * dx + dy * dy - along * along;
      if (sideSq > radius * radius) return undefined;
      const halfChord = Math.sqrt(radius * radius - sideSq);
      const entry = along - halfChord;
      const hit = entry >= 0 ? entry : along + halfChord;
      return hit <= maxDistance ? hit : undefined;
    };

    const disposeTongue = () => {
      if (!tongue) return;
      game.fxGroup.remove(tongue.group);
      tongue.group.traverse((part) => {
        if (part.geometry && part.geometry.dispose) part.geometry.dispose();
        if (part.material && part.material.dispose) part.material.dispose();
      });
      tongue = null;
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
    };

    const beginTongue = () => {
      if (!isFrog() || !canLaunchTongue || tongue || game.now < tongueReadyAt || !game.player.alive) return;
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
        maxLength: FROG.range,
        outSpeed: 950,
        returnSpeed: 1200,
        tipPos: game.player.pos.clone().add(direction.clone().multiplyScalar(game.player.radius)),
        anchor: null,
        angularVelocity: 0,
        group,
        strip,
        tip,
      };
      game.player.shots++;
      game.showToast("TONGUE OUT — RELEASE TO RETRACT");
      renderTongue();
    };

    const releaseTongue = () => {
      if (!tongue || tongue.phase === "retracting") return;
      tongue.phase = "retracting";
      tongue.anchor = null;
      tongueReadyAt = game.now + 0.25;
      game.showToast("TONGUE RETURNING");
    };

    const swing = (dt, input) => {
      const radial = game.player.pos.clone().sub(tongue.anchor);
      if (radial.lengthSq() < 1) return;
      radial.setLength(tongue.length);
      const tangent = vec(-radial.y, radial.x).normalize();
      let drive = input.x * tangent.x + input.y * tangent.y;
      if (game.keys.has("ArrowRight")) drive += 1;
      if (game.keys.has("ArrowLeft")) drive -= 1;
      tongue.angularVelocity += clamp(drive, -1, 1) * 4.5 * dt;
      tongue.angularVelocity *= Math.pow(0.86, dt);
      tongue.angularVelocity = clamp(tongue.angularVelocity, -2.8, 2.8);
      const angle = tongue.angularVelocity * dt;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotated = vec(
        radial.x * cos - radial.y * sin,
        radial.x * sin + radial.y * cos,
      );
      const candidate = tongue.anchor.clone().add(rotated);
      if (game.collides(candidate, game.player.radius)) {
        tongue.angularVelocity *= -0.2;
      } else {
        game.player.pos.copy(candidate);
        game.visibilityDirty = true;
      }
      tongue.tipPos.copy(tongue.anchor);
    };

    const updateTongue = (dt, input) => {
      if (!tongue) return;
      if (!game.mouse.down && tongue.phase !== "retracting") releaseTongue();

      if (tongue.phase === "extending") {
        const origin = game.player.pos;
        const previousLength = tongue.length;
        const nextLength = Math.min(tongue.maxLength, previousLength + tongue.outSpeed * dt);
        let hitDistance = nextLength;
        let wallHit = null;
        let enemyHit = null;

        for (const wall of game.walls) {
          const distance = rayWall(origin, tongue.direction, nextLength, wall);
          if (distance !== undefined && distance >= previousLength - 10 && distance < hitDistance) {
            hitDistance = distance;
            wallHit = wall;
            enemyHit = null;
          }
        }
        for (const bot of game.bots) {
          if (!bot.alive) continue;
          const distance = rayActor(origin, tongue.direction, nextLength, bot);
          if (distance !== undefined && distance >= previousLength - 10 && distance < hitDistance) {
            hitDistance = distance;
            enemyHit = bot;
            wallHit = null;
          }
        }

        tongue.length = hitDistance;
        tongue.tipPos.copy(origin).add(tongue.direction.clone().multiplyScalar(hitDistance));
        if (enemyHit) {
          enemyHit.slowUntil = game.now + 3;
          game.player.hits++;
          game.damageActor(game.player, enemyHit, FROG.damage);
          game.player.hp = Math.min(100, game.player.hp + 50);
          game.showToast("TONGUE HIT — +50 HP / SLOWED");
          releaseTongue();
        } else if (wallHit) {
          tongue.phase = "attached";
          tongue.anchor = tongue.tipPos.clone();
          tongue.angularVelocity = 0;
          game.showToast("WALL GRABBED — WASD / ARROWS TO SWING");
        }
      } else if (tongue.phase === "attached") {
        swing(dt, input);
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
      renderTongue();
    };

    const applyAppearance = (frog) => {
      game.player.body.material.color.setHex(frog ? 0x39d36f : 0x6de6df);
      game.player.ring.material.color.setHex(frog ? 0xa4ff8b : 0xc2fff7);
      if (game.player.mesh.children[2]) game.player.mesh.children[2].visible = !frog;
    };

    const originalStartRound = game.startRound.bind(game);
    game.startRound = function startRoundWithFrog() {
      const wantsFrog = this.selectedWeapon === "frog";
      if (wantsFrog) this.selectedWeapon = "rifle";
      disposeTongue();
      canLaunchTongue = true;
      originalStartRound();
      if (wantsFrog) {
        this.selectedWeapon = "frog";
        this.player.weapon = FROG;
        this.player.ammo = 1;
        this.player.reserve = 0;
        applyAppearance(true);
        this.renderUi();
        this.showToast("FROG READY — HOLD LEFT CLICK");
      } else {
        applyAppearance(false);
      }
    };

    const originalFire = game.fire.bind(game);
    game.fire = function fireOrTongue(actor, angle) {
      if (actor === this.player && isFrog()) {
        beginTongue();
        return;
      }
      originalFire(actor, angle);
    };

    const originalUpdatePlayer = game.updatePlayer.bind(game);
    game.updatePlayer = function updateFrogPlayer(dt) {
      const input = vec(
        (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0)
          - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0),
        (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0)
          - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0),
      );
      if (input.lengthSq() > 0) input.normalize();
      if (isFrog() && tongue && tongue.phase === "attached") {
        const heldKeys = this.keys;
        this.keys = new Set();
        originalUpdatePlayer(dt);
        this.keys = heldKeys;
      } else {
        originalUpdatePlayer(dt);
      }
      if (isFrog()) updateTongue(dt, input);
    };

    const originalMoveBot = game.moveBot.bind(game);
    game.moveBot = function moveSlowedBot(bot, dt, direction) {
      const slowFactor = bot.slowUntil > this.now ? 0.45 : 1;
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
      document.querySelector("#weapon-name").textContent = "FROG TONGUE";
      document.querySelector("#ammo").textContent = "↔";
      document.querySelector("#reserve").textContent = tongue ? tongue.phase.toUpperCase() : "READY";
      document.querySelector("#reload-hint").textContent = tongue && tongue.phase === "attached"
        ? "WASD / ARROWS: SWING · RELEASE: RETURN"
        : "HOLD LEFT CLICK: EXTEND · RELEASE: RETURN";
      document.querySelector("#reload-progress").classList.remove("active");
      this.canvas.dataset.botSlows = this.bots
        .map((bot) => Math.max(0, bot.slowUntil - this.now).toFixed(2))
        .join(",");
    };

    window.addEventListener("blur", () => {
      canLaunchTongue = true;
      releaseTongue();
    });
    window.addEventListener("pointerup", (event) => {
      if (event.button === 0 && isFrog()) {
        canLaunchTongue = true;
        releaseTongue();
      }
    });
    game.canvas.dataset.frogInstalled = "true";
    game.canvas.dataset.tongueState = "idle";
  };

  installFrog();
})();
