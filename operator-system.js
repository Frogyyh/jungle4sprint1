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
    const GUN_KATA_RADIUS = 176; // 원형 공격 범위 2배 (기존 88)
    const GUN_KATA_DAMAGE = 50;
    const SHIELD_VIEW_DEGREES = 20;

    // 아이언 방벽 (라인하르트식): 우클릭 홀드로 전방 60도 부채꼴 방벽 전개
    const BARRIER_MAX_HP = 250;
    const BARRIER_REGEN_DELAY = 1; // 해제 후 1초 뒤부터 재생
    const BARRIER_REGEN_RATE = 50; // 초당 재생량
    const BARRIER_BREAK_COOLDOWN = 10; // 파괴 시 재사용 불가 시간
    const BARRIER_HALF_ANGLE = Math.PI / 6; // 전방 60도 (좌우 30도)
    const BARRIER_INNER = 55; // 방벽은 캐릭터로부터 약 75 거리에 전개
    const BARRIER_OUTER = 100;

    const WEAPONS = Object.freeze({
      gunslinger: { id: "dual_pistols", name: "DUAL PISTOLS", damage: 15, pellets: 1, rpm: 800, spreadDeg: 4, magSize: 30, reserve: 9999, reload: 2.5, range: 720, projectileSpeed: 1450, color: 0xffd166 },
      bulwark: { id: "shield_pistol", name: "SHIELD & PISTOL", damage: 10, pellets: 1, rpm: 375, spreadDeg: 5, magSize: 20, reserve: 9999, reload: 2.5, range: 540, projectileSpeed: 950, color: 0x7ea8ff },
      sentinel: { id: "railgun", name: "RAILGUN", damage: 40, pellets: 1, rpm: 45, spreadDeg: 0, magSize: 6, reserve: 9999, reload: 2.5, range: 580, projectileSpeed: 1, color: 0x55f0b0 },
      soldier: { id: "rifle", name: "ASSAULT RIFLE", damage: 20, pellets: 1, rpm: 420, spreadDeg: 4.5, magSize: 30, reserve: 9999, reload: 2.5, range: 1040, projectileSpeed: 1500, color: 0x6de6df },
      reaper: { id: "scythe", name: "GREAT SCYTHE", damage: 40, pellets: 1, rpm: 80, spreadDeg: 0, magSize: 1, reserve: 9999, reload: 2.5, range: 128, projectileSpeed: 1, color: 0xc59bff },
      hunter: { id: "shotgun", name: "DOUBLE BARREL", damage: 24, pellets: 5, rpm: 150, spreadDeg: 18, magSize: 2, reserve: 9999, reload: 2.5, range: 470, projectileSpeed: 1120, color: 0xffab63 },
      ninja: { id: "katana", name: "KATANA / DAGGERS", damage: 40, pellets: 1, rpm: 105, spreadDeg: 0, magSize: 1, reserve: 9999, reload: 2.5, range: 118, projectileSpeed: 1, color: 0xff5f6d },
      sniper: { id: "bolt_action", name: "BOLT-ACTION RIFLE", damage: 80, pellets: 1, rpm: 67, spreadDeg: 1, magSize: 1, reserve: 9999, reload: 0.9, range: 1420, projectileSpeed: 2200, color: 0x9ef0ff },
      demolitionist: { id: "grenade_launcher", name: "6-SHOT GRENADE LAUNCHER", damage: 40, pellets: 1, rpm: 90, spreadDeg: 0, magSize: 6, reserve: 9999, reload: 2.5, range: 780, projectileSpeed: 620, color: 0xffa8f0 },
    });

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
      // 2번키 투척물: 군인=섬광탄, 스나이퍼=연막탄, 폭탄마=수류탄
      ui.flash.classList.toggle("hidden", !isOperator("soldier"));
      ui.smoke.classList.toggle("hidden", !isOperator("sniper"));
      ui.frag.classList.toggle("hidden", !isOperator("demolitionist"));
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
      game._gunKataUsedThisRound = false; // 건카타: 라운드당 1회, 처치 시 충전
      game.player.radius = 20; // 피격판정 통일 (시각 스프라이트 대비 원활한 판정)
      game._scytheThrow = null;
      const scytheSource = game.player._weaponVisualRoot;
      if (scytheSource) scytheSource.visible = true;
      clearSummons();
      clearOperatorFx();
      resetBarrier();

      if (selected.id !== "frog") {
        const weapon = WEAPONS[selected.id] || WEAPONS.soldier;
        game.player.weapon = weapon;
        game.player.ammo = weapon.magSize;
        game.player.reserve = weapon.reserve;
      }
      game.player.fragGrenades = selected.id === "demolitionist" ? 2 : 0;
      game.player.flashGrenades = selected.id === "soldier" ? 2 : 0;
      game.player.smokeGrenades = selected.id === "sniper" ? 2 : 0;
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
      || (isOperator("sniper") && type === "smoke")
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

    const MELEE_SWING_DURATION = 0.34;
    const MELEE_ATTACK_DELAY = 0.32; // 스윙 종료 직후 즉시 재공격 가능

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
        const radius = grenade.type === "frag" ? 100 : 67;
        const damage = grenade.type === "frag" ? 60 : 40;
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
      if (game.now - game._railChargeStartedAt < 1) return;

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
        speed: 620,
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
      if (isOperator("reaper")) return meleeAttack(WEAPONS.reaper.damage, WEAPONS.reaper.range, Math.PI * 0.31);
      if (isOperator("ninja")) return meleeAttack(WEAPONS.ninja.damage, WEAPONS.ninja.range, Math.PI * 0.29);
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
      // 건카타: 라운드당 1회. 적 처치 시 충전된다. (쿨다운과 무관하게 우선 차단)
      if (kind === "gunslinger" && game._gunKataUsedThisRound) {
        game.showToast("GUN KATA // 처치 시 충전");
        return;
      }
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
      const dashCooldown = kind === "hunter" ? 3 : SPECIAL_COOLDOWN;
      beginCooldown(key, dashCooldown);
      if (kind === "hunter") {
        game.player.reloadStartedAt = 0;
        game.player.reloadUntil = 0;
        game.player.ammo = game.player.weapon.magSize;
      }
      if (kind === "gunslinger") game._gunKataUsedThisRound = true;
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

    const SCYTHE_THROW_RANGE = 480;
    const SCYTHE_OUT_SPEED = 950;
    const SCYTHE_RETURN_SPEED = 1150;
    const SCYTHE_HIT_BUFFER = 26;
    const SCYTHE_FX_DOTS = 8;
    const SCYTHE_FX_RING = 8;

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
        thrown.traveled += speed * dt;
        thrown.pos.x += thrown.dir.x * speed * dt;
        thrown.pos.y += thrown.dir.y * speed * dt;
        if (thrown.traveled >= SCYTHE_THROW_RANGE) {
          thrown.out = false;
          game.showToast("SCYTHE RETURN");
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
        thrown.hit.add(bot);
        game.player.hits++;
        game.damageActor(game.player, bot, WEAPONS.reaper.damage);
        createWorldStrip(thrown.pos.clone(), bot.pos.clone(), 4, 0xc59bff, { duration: 0.18, opacity: 0.85 });
      }
    };

    const useSecondary = () => {
      if (isOperator("gunslinger")) startDash("gunslinger");
      else if (isOperator("ninja")) fireDaggers();
      else if (isOperator("bulwark")) deployBarrier();
      else if (isOperator("reaper")) useScytheThrow();
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
      // 해골이 들고 있는 미니 낫: 사신 본체의 낫 텍스처를 복제해 축소한다.
      const scytheSource = game.player._weaponVisualRoot;
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
        if (scytheSource) {
          const scythe = scytheSource.clone(true);
          // 사신 본체 무기가 재구성될 때 공유 자원이 해제되지 않도록
          // 지오메트리/머티리얼을 복제해 독립시킨다.
          scythe.traverse((part) => {
            if (part.geometry) part.geometry = part.geometry.clone();
            if (part.material && !Array.isArray(part.material)) part.material = part.material.clone();
          });
          scythe.position.z = 12;
          scythe.scale.setScalar(0.9);
          mesh.add(scythe);
        }
        mesh.position.set(pos.x, pos.y, 10);
        game.entityGroup.add(mesh);
        game._summons.push({
          pos,
          mesh,
          hp: 10, // 해골 체력 10 (기존 25)
          nextDamageAt: 0,
          expireAt: game.now + 20,
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

    const REVEAL_DURATION = 7;
    const REVEAL_COOLDOWN = 15;

    const useReveal = () => {
      if (!abilityReady("reveal")) {
        game.showToast(`SCAN ${cooldownRemaining("reveal").toFixed(1)}s`);
        return;
      }
      beginCooldown("reveal", REVEAL_COOLDOWN);
      game._revealUntil = game.now + REVEAL_DURATION;
      game.visibilityDirty = true;
      game.showToast(`THERMAL VISION // ${REVEAL_DURATION.toFixed(0)}s`);
    };

    const NINJA_DASH_SPEED = 780;
    const NINJA_DASH_DURATION = 0.33;
    const NINJA_SMOKE_RADIUS = 225;
    const NINJA_SMOKE_DURATION = 5;

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

    const FLASH_SHIELD_RANGE = 260;
    const FLASH_SHIELD_HALF_ANGLE = Math.PI / 3; // 좌우 60도 (총 120도)
    const FLASH_SHIELD_DURATION = 1; // 섬광탄과 동일한 1초 시야 차단

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
      else if (!isOperator("frog")) game.showToast("NO ACTIVE ABILITY");
    };

    game.canvas.addEventListener("pointerdown", (event) => {
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
    window.addEventListener("pointerup", (event) => {
      if (event.button === 0) {
        game._railChargeStartedAt = null;
        game._railNeedsRelease = false;
        if (isOperator("sentinel")) game.player.ring.material.color.setHex(0x55f0b0);
      }
      if (event.button === 2) releaseBarrier();
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
      // 건카타 충전: 존 익이 적을 처치하면 쿨다운과 사용횟수를 즉시 초기화한다.
      // 최대 1회 충전 — 여러 번 처치해도 1회분만 유지된다.
      if (source === this.player && isOperator("gunslinger") && !target.alive && target.hp < before) {
        this._gunKataUsedThisRound = false;
        this._operatorCooldowns["gunslinger-dash"] = 0;
        this.showToast("GUN KATA // READY");
        this.canvas.dataset.gunKataRefresh = String(Math.round(this.now * 100) / 100);
      }
    };

    const originalMoveActor = game.moveActor.bind(game);
    game.moveActor = function moveWithOperatorSpeed(actor, delta) {
      let movement = delta;
      if (actor === this.player && !this._operatorForcedMove) {
        if (isOperator("sniper")) movement = delta.clone().multiplyScalar(0.75);
        else if (isOperator("ninja") && this.isInsideSmoke(this.player.pos)) movement = delta.clone().multiplyScalar(1.5);
        else if (isOperator("bulwark") && this._barrier?.active) movement = delta.clone().multiplyScalar(0.5);
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
      // RB-08 투시 스캔 중에는 시야 부채꼴이 벽·연막에 잘리지 않는다.
      if (isOperator("sentinel") && this._revealUntil > this.now && origin.distanceToSquared(this.player.pos) < 1) {
        return origin.clone().add(adjustedDirection.clone().multiplyScalar(distance));
      }
      return originalTraceVision(origin, adjustedDirection, isOperator("sniper") ? distance * 1.5 : distance);
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
        if (distance <= 38 && !game.rayBlocked(summon.pos, target.pos)) {
          if (game.now >= summon.nextDamageAt) {
            game.damageActor(game.player, target, 10);
            summon.nextDamageAt = game.now + 1;
            // 사신과 동일한 근접 연출: 휘두르기 + 부채꼴 + 트레일
            summon.swingAt = game.now;
            summon.swingDir = Math.atan2(delta.y, delta.x);
            summon.swingTrailAt = 0;
            createRangeSector({ pos: summon.pos }, summon.swingDir, 38, 0.9, 0xc59bff);
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
            desired.normalize().multiplyScalar(164 * dt); // 소환수 이동속도 2배
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
    const SUMMON_COMBAT_RANGE = 640;
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
          if (!bot.alive || bot.team === "player" || bot.flashedUntil > this.now) continue;
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
    const SUMMON_HIT_RADIUS = 16;
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
    const PROJECTILE_HIT_BUFFER = 5;
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
        // 아이언 방벽: 적 투사체가 방벽을 지나면 흡수
        if (projectile.source?.team === "enemy" && barrierBlocks(projectile._prevPos, projectile.pos)) {
          absorbBarrierDamage(projectile.damage);
          this.removeProjectile(index);
          continue;
        }
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
          summon.hp -= projectile.damage;
          this.removeProjectile(index);
          if (summon.hp <= 0) {
            for (let burst = 0; burst < 6; burst++) {
              const angle = burst / 6 * Math.PI * 2;
              const dir = vector(Math.cos(angle), Math.sin(angle));
              createWorldStrip(
                summon.pos.clone(),
                summon.pos.clone().add(dir.clone().multiplyScalar(18)),
                3,
                0x8d7bff,
                { duration: 0.2, opacity: 0.8 },
              );
            }
            removeSummon(summonIndex);
          }
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
    game._flashHalos = flashHalos; // 디버그/테스트용 노출

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
    game._barrierVisual = barrierVisual; // 디버그/테스트용 노출
    game.absorbBarrierDamage = absorbBarrierDamage; // 디버그/테스트용 노출

    const syncFlashHalos = () => {
      // 시야(부채꼴/원형) 안에 들어온 적에 한해서만 링을 표시한다. (자기 자신 제외)
      for (const actor of [game.player, ...game.bots]) {
        if (actor === game.player) continue;
        if (!actor.alive || actor.flashedUntil <= game.now) continue;
        if (!game.isVisible(game.player, actor, 45, 920)) continue;
        ensureFlashHalo(actor);
      }
      for (const [actor, halo] of [...flashHalos]) {
        const active = actor.alive && actor.flashedUntil > game.now
          && actor !== game.player
          && game.isVisible(game.player, actor, 45, 920);
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
      } else if (this.player.reserve >= 9999) {
        // 무제한 장탄 무기는 9999 대신 현재 최대 장탄수를 표시한다. (예: 30/30)
        ui.reserve.textContent = `${this.player.weapon.magSize}`;
      }
      ui.fragCount.textContent = `${this.player.fragGrenades || 0}`;
      ui.flashCount.textContent = `${this.player.flashGrenades || 0}`;
      ui.smokeCount.textContent = `${this.player.smokeGrenades || 0}`;
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
      else if (selected.id === "bulwark") abilityCooldown = cooldownRemaining("flash-shield");
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
