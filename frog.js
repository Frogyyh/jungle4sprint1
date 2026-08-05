(() => {
  const installFrog = () => {
    const game = window.__breachline;
    if (!game) {
      requestAnimationFrame(installFrog);
      return;
    }

    const FROG = {
      id: "frog",
      name: "FROG BUBBLE SPRAYER",
      damage: 4,
      pellets: 4,
      rpm: 300,
      spreadDeg: 12,
      magSize: 30,
      reserve: 150,
      reload: 1.4,
      range: 900,
      projectileSpeed: 1200,
      color: 0x7eeeff,
    };
    const vec = (x = 0, y = 0) => new game.player.pos.constructor(x, y);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const isFrog = () => game.player.weapon && game.player.weapon.id === "frog";
    let tongue = null;
    let tongueReadyAt = 0;
    let canLaunchTongue = true;
    let spaceHeld = false;

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
        maxLength: 700,
        outSpeed: 3600,
        returnSpeed: 4800,
        tipPos: game.player.pos.clone().add(direction.clone().multiplyScalar(game.player.radius)),
        anchor: null,
        angularVelocity: 0,
        group,
        strip,
        tip,
      };
      game.showToast("TONGUE — WALLS ONLY");
      renderTongue();
    };

    const releaseTongue = () => {
      if (!tongue || tongue.phase === "retracting") return;
      tongue.phase = "retracting";
      tongue.anchor = null;
      tongueReadyAt = game.now + 0.08;
    };

    const swing = (dt) => {
      const radial = game.player.pos.clone().sub(tongue.anchor);
      if (radial.lengthSq() < 1) return;
      radial.setLength(tongue.length);
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
      if (game.collides(candidate, game.player.radius)) {
        tongue.angularVelocity *= -0.2;
      } else {
        game.player.pos.copy(candidate);
        game.visibilityDirty = true;
      }
      tongue.tipPos.copy(tongue.anchor);
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
          game.showToast("WALL GRABBED — A LEFT / D RIGHT");
        } else if (tongue.length >= tongue.maxLength) {
          releaseTongue();
        }
      } else if (tongue.phase === "attached") {
        swing(dt);
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
      for (const child of game.player.mesh.children.slice(2)) child.visible = !frog;
    };

    const originalStartRound = game.startRound.bind(game);
    game.startRound = function startRoundWithFrog() {
      const wantsFrog = this.selectedWeapon === "frog";
      if (wantsFrog) this.selectedWeapon = "rifle";
      disposeTongue();
      tongueReadyAt = 0;
      canLaunchTongue = true;
      spaceHeld = false;
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
      if (source !== this.player || !isFrog()) return;

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
    };

    const originalDamageActor = game.damageActor.bind(game);
    game.damageActor = function damageWithWaterSlow(source, target, amount) {
      const hpBefore = target.hp;
      originalDamageActor(source, target, amount);
      if (source === this.player && isFrog() && target.hp < hpBefore) {
        target.slowUntil = this.now + 2.5;
      }
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
      applyAppearance(true);
      document.querySelector("#weapon-name").textContent = "FROG BUBBLE SPRAYER";
      document.querySelector("#reload-hint").textContent = tongue && tongue.phase === "attached"
        ? "A: LEFT SWING · D: RIGHT SWING · RELEASE SPACE"
        : "LMB: WATER GUN · SPACE: WALL TONGUE";
      this.canvas.dataset.botSlows = this.bots
        .map((bot) => Math.max(0, bot.slowUntil - this.now).toFixed(2))
        .join(",");
      this.canvas.dataset.soapBubbles = `${this.projectiles.filter((projectile) => projectile.isSoapBubble).length}`;
    };

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
    window.addEventListener("blur", () => {
      spaceHeld = false;
      canLaunchTongue = true;
      releaseTongue();
    });
    game.canvas.dataset.frogInstalled = "true";
    game.canvas.dataset.tongueState = "idle";
  };

  installFrog();
})();
