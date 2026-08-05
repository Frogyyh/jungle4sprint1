(() => {
  "use strict";

  const installOperatorSystem = () => {
    const game = window.__breachline;
    const operators = window.BREACHLINE_OPERATORS;
    if (!game || !operators?.length || !game.applyWeaponVisual) {
      requestAnimationFrame(installOperatorSystem);
      return;
    }
    if (game.__operatorSystemInstalled) return;
    game.__operatorSystemInstalled = true;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const colorHex = (value) => Number.parseInt(value.slice(1), 16);
    const vector = (x = 0, y = 0) => new game.player.pos.constructor(x, y);
    const directionTo = (from, to) => to.clone().sub(from).normalize();
    const operator = () => window.findBreachlineOperator(game.activeOperatorId || game.selectedOperatorId);
    const isOperator = (id) => game.activeOperatorId === id;
    const SPECIAL_COOLDOWN = 5;
    const GUN_KATA_RADIUS = 88;
    const SHIELD_VIEW_DEGREES = 20;
    const SHIELD_BLOCK_HALF_ANGLE = Math.PI / 4;

    const WEAPONS = Object.freeze({
      gunslinger: { id: "dual_pistols", name: "DUAL PISTOLS", damage: 15, pellets: 1, rpm: 800, spreadDeg: 4, magSize: 30, reserve: 9999, reload: 2.5, range: 720, projectileSpeed: 1450, color: 0xffd166 },
      bulwark: { id: "shield_pistol", name: "SHIELD & PISTOL", damage: 10, pellets: 1, rpm: 250, spreadDeg: 5, magSize: 20, reserve: 9999, reload: 2.5, range: 540, projectileSpeed: 950, color: 0x7ea8ff },
      sentinel: { id: "railgun", name: "RAILGUN", damage: 40, pellets: 1, rpm: 45, spreadDeg: 0, magSize: 6, reserve: 9999, reload: 2.5, range: 580, projectileSpeed: 1, color: 0x55f0b0 },
      soldier: { id: "rifle", name: "ASSAULT RIFLE", damage: 20, pellets: 1, rpm: 420, spreadDeg: 4.5, magSize: 30, reserve: 9999, reload: 2.5, range: 1040, projectileSpeed: 1500, color: 0x6de6df },
      reaper: { id: "scythe", name: "GREAT SCYTHE", damage: 30, pellets: 1, rpm: 80, spreadDeg: 0, magSize: 1, reserve: 9999, reload: 2.5, range: 116, projectileSpeed: 1, color: 0xc59bff },
      hunter: { id: "shotgun", name: "DOUBLE BARREL", damage: 20, pellets: 5, rpm: 150, spreadDeg: 18, magSize: 2, reserve: 9999, reload: 2.5, range: 470, projectileSpeed: 1120, color: 0xffab63 },
      ninja: { id: "katana", name: "KATANA / DAGGERS", damage: 30, pellets: 1, rpm: 105, spreadDeg: 0, magSize: 1, reserve: 9999, reload: 2.5, range: 105, projectileSpeed: 1, color: 0xff5f6d },
      sniper: { id: "bolt_action", name: "BOLT-ACTION RIFLE", damage: 80, pellets: 1, rpm: 67, spreadDeg: 1, magSize: 1, reserve: 9999, reload: 0.9, range: 1420, projectileSpeed: 2200, color: 0x9ef0ff },
      demolitionist: { id: "grenade_launcher", name: "6-SHOT GRENADE LAUNCHER", damage: 40, pellets: 1, rpm: 90, spreadDeg: 0, magSize: 6, reserve: 9999, reload: 2.5, range: 780, projectileSpeed: 620, color: 0xffa8f0 },
    });

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
      charge: document.querySelector("#grenade-charge"),
      chargeName: document.querySelector("#grenade-charge-name"),
      chargeBar: document.querySelector("#grenade-charge-bar"),
      chargeRange: document.querySelector("#grenade-charge-range"),
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
      const soldier = isOperator("soldier");
      ui.frag.classList.add("hidden");
      ui.flash.classList.toggle("hidden", !soldier);
      ui.smoke.classList.add("hidden");
    };

    const applyOperator = (selected) => {
      game.activeOperatorId = selected.id;
      game.player.operatorId = selected.id;
      game.player.maxHp = 100;
      game.player.hp = 100;
      game.player.lastDamageAt = -Infinity;
      game._operatorCooldowns = Object.create(null);
      game._railChargeStartedAt = null;
      game._railNeedsRelease = false;
      game._operatorDash = null;
      game._meleeSwing = null;
      game._revealUntil = 0;
      game._gunHand = 1;
      clearSummons();
      clearOperatorFx();

      if (selected.id !== "frog") {
        const weapon = WEAPONS[selected.id] || WEAPONS.soldier;
        game.player.weapon = weapon;
        game.player.ammo = weapon.magSize;
        game.player.reserve = weapon.reserve;
      }
      game.player.fragGrenades = 0;
      game.player.flashGrenades = selected.id === "soldier" ? 2 : 0;
      game.player.smokeGrenades = 0;
      game.player.specialGrenades = selected.id === "demolitionist" ? 2 : 0;
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

    game.canUseGadget = (type) => isOperator("soldier") && type === "flash";
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

    const getWeaponPieces = () => game.player.mesh.children.filter((part) => (
      part === game.player._weaponVisualBase || part.userData?.breachlineWeaponClone
    ));

    const beginMeleeAnimation = (range, halfAngle, color) => {
      game._meleeSwing = {
        startedAt: game.now,
        until: game.now + 0.34,
        direction: game.player.dir,
        range,
        halfAngle,
        color,
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
      const localAngle = -swing.halfAngle + eased * swing.halfAngle * 2;
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
        const tip = game.player.pos.clone().add(vector(Math.cos(trailAngle), Math.sin(trailAngle)).multiplyScalar(swing.range * 0.86));
        if (swing.lastTip) createWorldStrip(swing.lastTip, tip, 7, swing.color, { duration: 0.2, opacity: 0.82 });
        swing.lastTip = tip;
        swing.lastTrailAt = game.now;
      }
      game.canvas.dataset.meleeSwingProgress = progress.toFixed(2);
    };

    const updateOperatorFx = () => {
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

    const showExplosion = (point, color, radius) => {
      const mesh = createEffectMesh(color, radius / 24);
      mesh.position.set(point.x, point.y, 14);
      mesh.material.opacity = 0.4;
      game.fxGroup.add(mesh);
      setTimeout(() => {
        game.fxGroup.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }, 180);
    };

    const originalExplode = game.explode.bind(game);
    game.explode = function explodeOperatorGrenade(grenade) {
      if (grenade.type === "frag" || grenade.type === "launcher") {
        const radius = grenade.type === "frag" ? 100 : 67;
        const damage = grenade.type === "frag" ? 60 : 40;
        const hits = damageInRadius(grenade.owner, grenade.pos, radius, damage);
        showExplosion(grenade.pos, grenade.type === "frag" ? 0xff6b67 : 0xffa8f0, radius);
        if (grenade.owner === this.player) this.showToast(`${grenade.type.toUpperCase()} IMPACT · ${hits} HIT`);
        disposeFxMesh(grenade.mesh);
        return;
      }
      const smokeCount = this.smokes.length;
      originalExplode(grenade);
      if (grenade.ninjaSmoke && this.smokes.length > smokeCount) {
        const smoke = this.smokes[this.smokes.length - 1];
        smoke.radius = 225;
        smoke.endAt = this.now + 5;
        smoke.mesh.scale.setScalar(1.5);
      }
      disposeFxMesh(grenade.mesh);
    };

    const meleeAttack = (damage, range, halfAngle) => {
      if (game.now < game.player.nextShotAt || !game.player.alive) return;
      game.player.nextShotAt = game.now + 60 / game.player.weapon.rpm;
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
      if (game.now - game._railChargeStartedAt < 1) return;

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
        if (along < 0 || along > 580) continue;
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
      const beamEnd = game.player.pos.clone().add(direction.clone().multiplyScalar(580));
      createWorldStrip(beamStart, beamEnd, 13, 0x55f0b0, { duration: 0.22, opacity: 0.5 });
      createWorldStrip(beamStart, beamEnd, 4, 0xf3ffff, { duration: 0.16, opacity: 1 });
      createRangeRing(game.player, 62, 0x9ef0ff, 0.22, 0.75);
      game.cameraShake = Math.max(game.cameraShake, 8);
      game.canvas.dataset.lastRailBeam = `${Math.round(beamStart.x)}:${Math.round(beamStart.y)}>${Math.round(beamEnd.x)}:${Math.round(beamEnd.y)}`;
      game.showToast(nearest ? "RAIL HIT // WALLPIERCE" : "RAIL FIRED");
    };

    const fireLauncher = () => {
      if (game.player.reloadUntil > game.now || game.now < game.player.nextShotAt) return;
      if (game.player.ammo <= 0) {
        game.reload(game.player);
        return;
      }
      game.player.ammo--;
      game.player.shots++;
      game.player.nextShotAt = game.now + 60 / game.player.weapon.rpm;
      createSpecialGrenade("launcher", game.player, game.mouse.world.clone());
    };

    const originalFire = game.fire.bind(game);
    game.fire = function fireByOperator(actor, aim) {
      if (actor !== this.player) {
        originalFire(actor, aim);
        return;
      }
      if (this._selectedGadget) return;
      if (isOperator("reaper")) return meleeAttack(30, 116, Math.PI * 0.31);
      if (isOperator("ninja")) return meleeAttack(30, 105, Math.PI * 0.29);
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
      if (source === this.player && isOperator("gunslinger")) {
        const perpendicular = vector(-direction.y, direction.x).multiplyScalar(7 * this._gunHand);
        muzzle = position.clone().add(perpendicular);
        this._gunHand *= -1;
      }
      originalSpawnProjectile(source, muzzle, direction, weapon);
      const projectile = this.projectiles[this.projectiles.length - 1];
      if (source === this.player && isOperator("sniper") && projectile) {
        projectile.mesh.scale.set(1.5, 1.35, 1);
      }
    };

    const startDash = (kind) => {
      const key = `${kind}-dash`;
      if (!abilityReady(key)) {
        game.showToast(`DASH ${cooldownRemaining(key).toFixed(1)}s`);
        return;
      }
      const target = game.mouse.world.clone().sub(game.player.pos);
      if (target.lengthSq() < 1) target.set(Math.cos(game.player.dir), Math.sin(game.player.dir));
      target.normalize();
      beginCooldown(key, SPECIAL_COOLDOWN);
      game._operatorDash = {
        kind, direction: target, startedAt: game.now, until: game.now + (kind === "gunslinger" ? 0.5 : 0.34),
        speed: kind === "gunslinger" ? 760 : 900, hit: new Set(), invulnerable: kind === "hunter",
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
      beginCooldown("daggers", SPECIAL_COOLDOWN);
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

    const throwDemoFrag = () => {
      if (game.player.specialGrenades <= 0) {
        game.showToast("FRAG EMPTY");
        return;
      }
      game.player.specialGrenades--;
      const current = game.player.fragGrenades;
      game.player.fragGrenades = 1;
      createSpecialGrenade("frag", game.player, game.mouse.world.clone());
      game.player.fragGrenades = current;
    };

    const useSecondary = () => {
      if (isOperator("gunslinger")) startDash("gunslinger");
      else if (isOperator("ninja")) fireDaggers();
      else if (isOperator("demolitionist")) throwDemoFrag();
      else game.showToast("NO SECONDARY ATTACK");
    };

    const NAV_CELL = 48;
    const NAV_RADIUS = 14;
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
      if (game.player.hp <= 25) {
        game.showToast("HP 25 이하에서는 소환 불가");
        return;
      }
      game.player.hp -= 25;
      game.player.lastDamageAt = game.now;
      beginCooldown("undead", SPECIAL_COOLDOWN);
      for (const offset of [-0.55, 0, 0.55]) {
        const preferred = game.player.pos.clone().add(vector(Math.cos(game.player.dir + offset), Math.sin(game.player.dir + offset)).multiplyScalar(44));
        const pos = findFreeSummonSpawn(preferred);
        const mesh = game.player.mesh.clone(true);
        mesh.scale.setScalar(0.62);
        mesh.traverse((part) => {
          if (part.material) {
            part.material = part.material.clone();
            part.material.color?.setHex(0xc7d0d5);
          }
        });
        mesh.position.set(pos.x, pos.y, 10);
        game.entityGroup.add(mesh);
        game._summons.push({
          pos,
          mesh,
          hp: 25,
          nextDamageAt: 0,
          expireAt: game.now + 20,
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

    const useReveal = () => {
      if (!abilityReady("reveal")) return;
      beginCooldown("reveal", SPECIAL_COOLDOWN);
      game._revealUntil = game.now + 3;
      game.visibilityDirty = true;
      game.showToast("THERMAL VISION // 3.0s");
    };

    const useNinjaSmoke = () => {
      if (!abilityReady("ninja-smoke")) return;
      beginCooldown("ninja-smoke", SPECIAL_COOLDOWN);
      const previous = game.player.smokeGrenades;
      game.player.smokeGrenades = 1;
      game.throwGrenade("smoke", game.player, game.player.pos.clone().add(vector(1, 0)));
      const grenade = game.grenades[game.grenades.length - 1];
      if (grenade) {
        grenade.ninjaSmoke = true;
        grenade.fuse = 0.03;
        grenade.initialFuse = 0.03;
        grenade.vel.set(0, 0);
      }
      game.player.smokeGrenades = previous;
      game.showToast("NINJA SMOKE // R225 · 5s");
    };

    const useAbility = () => {
      if (isOperator("sentinel")) useReveal();
      else if (isOperator("reaper")) summonUndead();
      else if (isOperator("hunter")) startDash("hunter");
      else if (isOperator("ninja")) useNinjaSmoke();
      else if (!isOperator("frog")) game.showToast("NO ACTIVE ABILITY");
    };

    game.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 2 || game.phase !== "playing") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      game.mouse.x = event.clientX;
      game.mouse.y = event.clientY;
      game.updateMouseWorld();
      useSecondary();
    }, true);
    game.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("pointerup", (event) => {
      if (event.button === 0) {
        game._railChargeStartedAt = null;
        game._railNeedsRelease = false;
        if (isOperator("sentinel")) game.player.ring.material.color.setHex(0x55f0b0);
      }
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
      if (target === this.player && isOperator("bulwark") && source?.pos) {
        const incoming = source.pos.clone().sub(target.pos);
        const incomingAngle = Math.atan2(incoming.y, incoming.x);
        if (Math.abs(angleDelta(incomingAngle, target.dir)) <= SHIELD_BLOCK_HALF_ANGLE) {
          this.showToast("SHIELD BLOCK");
          this.canvas.dataset.lastShieldBlock = this.now.toFixed(2);
          return;
        }
      }
      const before = target.hp;
      originalDamageActor(source, target, amount);
      if (target.hp < before) target.lastDamageAt = this.now;
    };

    const originalMoveActor = game.moveActor.bind(game);
    game.moveActor = function moveWithOperatorSpeed(actor, delta) {
      const movement = actor === this.player && isOperator("sniper") && !this._operatorForcedMove
        ? delta.clone().multiplyScalar(0.75)
        : delta;
      originalMoveActor(actor, movement);
    };

    const originalUpdatePlayer = game.updatePlayer.bind(game);
    game.updatePlayer = function updateOperatorPlayer(dt) {
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
          this.damageActor(this.player, target, 40);
        }
        const progress = clamp((this.now - dash.startedAt) / Math.max(0.01, dash.until - dash.startedAt), 0, 1);
        this.player.mesh.rotation.z += progress * Math.PI * 8;
        for (const [index, piece] of getWeaponPieces().entries()) {
          const side = piece.userData.breachlineGunSide || Math.sign(piece.position.x) || (index % 2 ? 1 : -1);
          piece.userData.breachlineGunSide = side;
          piece.position.x = side * 17;
          piece.position.y = index < 2 ? 5 : -2;
          piece.rotation.z = -side * Math.PI / 2;
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
      }
      if (this.now >= dash.until) {
        this._operatorDash = null;
        applyAppearance(operator());
        this.canvas.dataset.lastDashDirection = `${dash.direction.x.toFixed(3)}:${dash.direction.y.toFixed(3)}`;
      }
    };

    const originalVisible = game.isVisible.bind(game);
    game.isVisible = function operatorVisibility(observer, target, coneDegrees, distance) {
      if (observer === this.player && isOperator("sentinel") && this._revealUntil > this.now) {
        const delta = target.pos.clone().sub(observer.pos);
        return target.alive && delta.length() <= distance
          && Math.abs(angleDelta(Math.atan2(delta.y, delta.x), observer.dir)) <= coneDegrees * Math.PI / 360
          && !this.smokeBlocks(observer.pos, target.pos);
      }
      const adjustedDistance = observer === this.player && isOperator("sniper") ? distance * 1.5 : distance;
      const adjustedCone = observer === this.player && isOperator("bulwark")
        ? Math.min(coneDegrees, SHIELD_VIEW_DEGREES)
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
      return originalTraceVision(origin, adjustedDirection, isOperator("sniper") ? distance * 1.5 : distance);
    };

    const updateSummons = (dt) => {
      for (let index = game._summons.length - 1; index >= 0; index--) {
        const summon = game._summons[index];
        let target = null;
        let nearestDistance = Infinity;
        for (const bot of game.bots) {
          if (!bot.alive) continue;
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
        if (distance <= 38 && !game.rayBlocked(summon.pos, target.pos)) {
          if (game.now >= summon.nextDamageAt) {
            game.damageActor(game.player, target, 10);
            summon.nextDamageAt = game.now + 1;
          }
        } else {
          const nav = summon.nav;
          const targetMoved = !nav.targetPos || nav.targetPos.distanceToSquared(target.pos) > 52 * 52;
          if (nav.targetId !== target.id || targetMoved || game.now >= nav.nextRepathAt || nav.index >= nav.path.length) {
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
            desired.normalize().multiplyScalar(82 * dt);
            const previous = summon.pos.clone();
            const candidateX = summon.pos.clone().add(vector(desired.x, 0));
            if (!game.collides(candidateX, 12)) summon.pos.x = candidateX.x;
            const candidateY = summon.pos.clone().add(vector(0, desired.y));
            if (!game.collides(candidateY, 12)) summon.pos.y = candidateY.y;
            if (summon.pos.distanceToSquared(previous) < 0.05) nav.nextRepathAt = 0;
          }

          if (game.now - nav.anchorAt >= 0.42) {
            if (summon.pos.distanceToSquared(nav.anchor) < 4 * 4) nav.nextRepathAt = 0;
            nav.anchor.copy(summon.pos);
            nav.anchorAt = game.now;
          }
        }
        summon.mesh.position.set(summon.pos.x, summon.pos.y, 10);
        summon.mesh.rotation.z = Math.atan2(delta.y, delta.x);
      }
      game.canvas.dataset.undeadCount = String(game._summons.length);
      game.canvas.dataset.undeadPathNodes = game._summons.map((summon) => Math.max(0, summon.nav.path.length - summon.nav.index)).join(",");
    };

    const originalStep = game.step.bind(game);
    game.step = function operatorStep(dt) {
      originalStep(dt);
      for (const actor of [this.player, ...this.bots]) {
        if (!actor.alive || actor.hp >= (actor.maxHp || 100) || this.now - (actor.lastDamageAt ?? -Infinity) < 5) continue;
        actor.hp = Math.min(actor.maxHp || 100, actor.hp + 5 * dt);
      }
      updateSummons(dt);
      updateOperatorFx();
      updateMeleeAnimation();
      updateRailChargeFx();
    };

    const originalRenderUi = game.renderUi.bind(game);
    game.renderUi = function renderOperatorUi() {
      originalRenderUi();
      if (!this.activeOperatorId) return;
      const selected = operator();
      ui.operator.textContent = `${selected.name} // ${selected.koreanName}`;
      ui.operator.style.color = selected.color;
      ui.weapon.textContent = this.player.weapon.name;
      if (["reaper", "ninja"].includes(selected.id)) {
        ui.ammo.textContent = "∞";
        ui.reserve.textContent = "∞";
      }
      ui.fragCount.textContent = `${this.player.fragGrenades || 0}`;
      document.querySelector("#flash-count").textContent = `${this.player.flashGrenades || 0}`;
      document.querySelector("#smoke-count").textContent = `${this.player.smokeGrenades || 0}`;
      updateGadgetVisibility();

      const secondary = selected.controls.secondary;
      const ability = selected.controls.ability;
      let secondaryCooldown = 0;
      let abilityCooldown = 0;
      if (selected.id === "gunslinger") secondaryCooldown = cooldownRemaining("gunslinger-dash");
      else if (selected.id === "reaper") abilityCooldown = cooldownRemaining("undead");
      else if (selected.id === "hunter") abilityCooldown = cooldownRemaining("hunter-dash");
      else if (selected.id === "ninja") {
        secondaryCooldown = cooldownRemaining("daggers");
        abilityCooldown = cooldownRemaining("ninja-smoke");
      } else if (selected.id === "sentinel") abilityCooldown = cooldownRemaining("reveal");
      else if (selected.id === "frog") abilityCooldown = this.getTongueCooldown?.() || 0;
      const cooldown = Math.max(secondaryCooldown, abilityCooldown);
      const secondaryStatus = secondaryCooldown > 0 ? ` ${secondaryCooldown.toFixed(1)}s` : "";
      const abilityStatus = abilityCooldown > 0 ? ` ${abilityCooldown.toFixed(1)}s` : "";
      ui.ability.textContent = `RMB ${secondary}${secondaryStatus} · SPACE ${ability}${abilityStatus}`;
      ui.ability.classList.toggle("ability-cooldown", cooldown > 0);
      ui.ability.classList.toggle("ability-ready", cooldown <= 0);

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
      this.canvas.dataset.shieldBlockDegrees = String(Math.round(SHIELD_BLOCK_HALF_ANGLE * 360 / Math.PI));
      this.canvas.dataset.weaponRpm = String(this.player.weapon.rpm);
      this.canvas.dataset.weaponReloadSeconds = String(this.player.weapon.reload);
      this.canvas.dataset.ninjaSmokeRadius = "225";
      this.canvas.dataset.daggerSpreadRadians = "0.16";
      this.canvas.dataset.demolitionistCharging = "disabled";
      this.canvas.dataset.hunterInvulnerable = String(Boolean(this._operatorDash?.invulnerable));
      this.canvas.dataset.soldierGadgets = isOperator("soldier") ? "flash:2" : "none";
      this.canvas.dataset.specialGrenades = String(this.player.specialGrenades || 0);
      this.canvas.dataset.healthRegenDelay = "5";
      this.canvas.dataset.healthRegenRate = "5";
    };

    game.canvas.dataset.operatorSystem = "10-class-v2";
  };

  installOperatorSystem();
})();
