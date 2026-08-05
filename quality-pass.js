(() => {
  "use strict";

  const bootQualityPass = () => {
    const game = window.__breachline;
    if (!game) {
      window.requestAnimationFrame(bootQualityPass);
      return;
    }
    if (game.__qualityPassApplied) return;
    game.__qualityPassApplied = true;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const $ = (selector) => document.querySelector(selector);
    const FLASH_RADIUS = 200;
    const FLASH_DURATION = 1.5;
    const SMOKE_DURATION = 12;
    const AI_FAIR_RANGE = 620;
    const VIEW_CONE_RADIANS = 45 * Math.PI / 180;

    const ui = {
      flashGadget: $("#flash-gadget"),
      smokeGadget: $("#smoke-gadget"),
      charge: $("#grenade-charge"),
      chargeName: $("#grenade-charge-name"),
      chargeRange: $("#grenade-charge-range"),
      chargeBar: $("#grenade-charge-bar"),
      zoom: $("#zoom-status"),
      layout: $("#map-layout"),
      flashStatus: $("#flash-status"),
      hitmarker: $("#hitmarker"),
      damage: $("#damage-overlay"),
      smoke: $("#smoke-overlay"),
      muzzle: $("#muzzle-flash"),
      status: $("#status-message"),
      ammo: $("#ammo"),
      health: $(".health-block")
    };
    ui.telegraphs = $("#throw-telegraphs");
    ui.throwPreview = $("#throw-preview");
    ui.throwVector = $("#throw-vector");
    ui.throwPreviewSweep = ui.throwPreview.querySelector(".telegraph-sweep");
    ui.throwPreviewIcon = ui.throwPreview.querySelector(".telegraph-icon");
    ui.throwPreviewTime = ui.throwPreview.querySelector(".telegraph-time");

    game.viewScale = 1;
    game.cameraShake = 0;
    game._selectedGadget = null;
    game._grenadeChargeStartedAt = 0;
    game._pendingThrowPower = 1;
    game._roundSerial = 0;
    game._flashFeedback = [];
    game._incomingUntil = 0;
    game.canvas.dataset.flashRadius = String(FLASH_RADIUS);
    game.canvas.dataset.smokeDuration = String(SMOKE_DURATION);
    game.canvas.dataset.enemyGadgetMix = "50:50";
    game.canvas.dataset.flashDurations = FLASH_DURATION.toFixed(2);

    const layouts = [
      {
        name: "CROSSROADS",
        points: {
          "center-nw": [-125, 125], "center-ne": [125, 125],
          "center-sw": [-125, -125], "center-se": [125, -125],
          "north-center-cover": [0, 500], "south-center-cover": [0, -500],
          "north-west-long": [-500, 380], "north-west-short": [-315, 290],
          "north-east-long": [500, 380], "north-east-short": [315, 290],
          "south-west-long": [-500, -380], "south-west-short": [-315, -290],
          "south-east-long": [500, -380], "south-east-short": [315, -290],
          "west-mid-upper": [-675, 135], "west-mid-lower": [-675, -135],
          "east-mid-upper": [675, 135], "east-mid-lower": [675, -135],
          "corner-nw": [-775, 525], "corner-ne": [775, 525],
          "corner-sw": [-775, -525], "corner-se": [775, -525]
        }
      },
      {
        name: "OFFSET",
        points: {
          "center-nw": [-145, 135], "center-ne": [145, 105],
          "center-sw": [-145, -105], "center-se": [145, -135],
          "north-center-cover": [80, 515], "south-center-cover": [-80, -515],
          "north-west-long": [-535, 345], "north-west-short": [-325, 435],
          "north-east-long": [535, 405], "north-east-short": [325, 285],
          "south-west-long": [-535, -405], "south-west-short": [-325, -285],
          "south-east-long": [535, -345], "south-east-short": [325, -435],
          "west-mid-upper": [-700, 160], "west-mid-lower": [-620, -145],
          "east-mid-upper": [620, 145], "east-mid-lower": [700, -160],
          "corner-nw": [-650, 550], "corner-ne": [805, 500],
          "corner-sw": [-805, -500], "corner-se": [650, -550]
        }
      },
      {
        name: "OPEN LANES",
        points: {
          "center-nw": [-165, 145], "center-ne": [165, 145],
          "center-sw": [-165, -145], "center-se": [165, -145],
          "north-center-cover": [0, 535], "south-center-cover": [0, -535],
          "north-west-long": [-445, 425], "north-west-short": [-305, 230],
          "north-east-long": [445, 425], "north-east-short": [305, 230],
          "south-west-long": [-445, -425], "south-west-short": [-305, -230],
          "south-east-long": [445, -425], "south-east-short": [305, -230],
          "west-mid-upper": [-735, 155], "west-mid-lower": [-735, -155],
          "east-mid-upper": [735, 155], "east-mid-lower": [735, -155],
          "corner-nw": [-760, 470], "corner-ne": [760, 470],
          "corner-sw": [-760, -470], "corner-se": [760, -470]
        }
      }
    ];

    const applyLayout = (index) => {
      const layout = layouts[index % layouts.length];
      for (const [id, point] of Object.entries(layout.points)) {
        const wall = game.walls.find((item) => item.id === id);
        if (!wall) continue;
        wall.x = point[0];
        wall.y = point[1];
        if (wall.mesh) {
          wall.mesh.position.x = wall.x;
          wall.mesh.position.y = wall.y;
        }
      }
      game.visibilityDirty = true;
      game._activeLayout = layout.name;
      ui.layout.textContent = `LAYOUT // ${layout.name}`;
      game.canvas.dataset.mapLayout = layout.name;
    };

    const pulseClass = (element, className) => {
      if (!element) return;
      element.classList.remove(className);
      void element.offsetWidth;
      element.classList.add(className);
    };

    const weaponVisualProfiles = {
      rifle: [
        { x: 0, y: 29, w: 5, h: 25, color: 0x6de6df },
        { x: 0, y: 18, w: 10, h: 7, color: 0x31434c },
        { x: 4, y: 25, w: 3, h: 8, r: -0.18, color: 0x9db7bd }
      ],
      shotgun: [
        { x: 0, y: 30, w: 6, h: 29, color: 0xffab63 },
        { x: 0, y: 24, w: 9, h: 8, color: 0x5b4638 },
        { x: 0, y: 16, w: 11, h: 6, color: 0x8c6547 }
      ],
      smg: [
        { x: 0, y: 25, w: 8, h: 18, color: 0xb9a4ff },
        { x: 4, y: 20, w: 4, h: 10, r: -0.22, color: 0x493f69 },
        { x: 0, y: 34, w: 3, h: 8, color: 0xd7ccff }
      ],
      dual_pistols: [
        { x: -5, y: 25, w: 4, h: 17, color: 0x6de6df },
        { x: 5, y: 25, w: 4, h: 17, color: 0x6de6df },
        { x: -5, y: 17, w: 6, h: 6, color: 0x26363d },
        { x: 5, y: 17, w: 6, h: 6, color: 0x26363d }
      ],
      shield_pistol: [
        { x: 0, y: 24, w: 20, h: 18, color: 0x738aa0 },
        { x: 6, y: 34, w: 4, h: 15, color: 0xffc36f },
        { x: 0, y: 24, w: 13, h: 11, color: 0x26363d }
      ],
      railgun: [
        { x: -3.5, y: 30, w: 2.5, h: 31, color: 0x9bb5ff },
        { x: 3.5, y: 30, w: 2.5, h: 31, color: 0x9bb5ff },
        { x: 0, y: 28, w: 4, h: 17, color: 0xf0fbff }
      ],
      frog_tongue: [
        { x: 0, y: 29, w: 3, h: 31, color: 0x78e08f },
        { x: 0, y: 43, w: 9, h: 8, color: 0xff7fd1 },
        { x: 0, y: 18, w: 8, h: 7, color: 0x41694b }
      ],
      scythe: [
        { x: 0, y: 29, w: 2.5, h: 32, color: 0x9db7bd },
        { x: 8, y: 42, w: 3, h: 20, r: -1.02, color: 0xe6f0f2 },
        { x: 0, y: 17, w: 7, h: 6, color: 0x553d62 }
      ],
      katana: [
        { x: 0, y: 31, w: 2.5, h: 35, color: 0xe9f4f6 },
        { x: 0, y: 17, w: 13, h: 2.5, color: 0xffab63 },
        { x: 0, y: 12, w: 4, h: 8, color: 0x3a4850 }
      ],
      shuriken: [
        { x: 0, y: 27, w: 3, h: 18, r: 0.78, color: 0xd5e4e7 },
        { x: 0, y: 27, w: 3, h: 18, r: -0.78, color: 0xd5e4e7 },
        { x: 0, y: 27, w: 6, h: 6, color: 0x637780 }
      ],
      bolt_action: [
        { x: 0, y: 31, w: 3.5, h: 34, color: 0xc7d8dc },
        { x: 0, y: 18, w: 10, h: 7, color: 0x6c4e36 },
        { x: 4, y: 30, w: 4, h: 11, color: 0x6de6df }
      ],
      grenade_launcher: [
        { x: 0, y: 29, w: 9, h: 26, color: 0x8f9e6a },
        { x: 0, y: 23, w: 13, h: 12, color: 0x4b5539 },
        { x: 0, y: 41, w: 7, h: 6, color: 0xc5d18f }
      ]
    };
    const weaponVisualAliases = {
      "dual-pistols": "dual_pistols", akimbo: "dual_pistols",
      "shield-pistol": "shield_pistol", shield: "shield_pistol",
      "frog-tongue": "frog_tongue", tongue: "frog_tongue",
      "bolt-action": "bolt_action", sniper: "bolt_action",
      "grenade-launcher": "grenade_launcher", launcher: "grenade_launcher"
    };

    const applyWeaponVisual = (actor, requestedId = actor.weapon?.id || "rifle") => {
      if (!actor?.mesh) return;
      const id = weaponVisualAliases[requestedId] || requestedId;
      const profile = weaponVisualProfiles[id] || weaponVisualProfiles.rifle;
      const base = actor._weaponVisualBase || actor.mesh.children[2];
      if (!base) return;
      actor._weaponVisualBase = base;

      for (const child of [...actor.mesh.children]) {
        if (!child.userData?.breachlineWeaponClone) continue;
        actor.mesh.remove(child);
        child.geometry?.dispose();
        child.material?.dispose();
      }

      profile.forEach((shape, index) => {
        const piece = index === 0 ? base : base.clone(false);
        if (index > 0) {
          piece.geometry = base.geometry.clone();
          piece.material = base.material.clone();
          piece.userData = { ...piece.userData, breachlineWeaponClone: true };
          actor.mesh.add(piece);
        }
        piece.visible = true;
        piece.position.set(shape.x, shape.y, 11 + index * 0.04);
        piece.scale.set(shape.w / 7, shape.h / 12, 1);
        piece.rotation.z = shape.r || 0;
        piece.material.color.setHex(shape.color);
      });
      actor._visualWeaponId = id;
    };

    game.applyWeaponVisual = applyWeaponVisual;
    game.weaponVisualIds = Object.keys(weaponVisualProfiles);
    game.canvas.dataset.weaponVisuals = game.weaponVisualIds.join(",");

    const styleGrenadeMesh = (grenade) => {
      const mesh = grenade.mesh;
      if (!mesh || mesh.userData?.breachlineStyled) return;
      mesh.userData = { ...mesh.userData, breachlineStyled: true };
      const flash = grenade.type === "flash";
      mesh.scale.setScalar(flash ? 1 : 1.12);
      mesh.material.color.setHex(flash ? 0xffdf70 : 0x7088a8);

      const core = mesh.clone(false);
      core.geometry = mesh.geometry.clone();
      core.material = mesh.material.clone();
      core.material.color.setHex(flash ? 0xffffff : 0xc4d0d4);
      core.position.set(0, 0, 0.8);
      core.scale.set(flash ? 0.42 : 0.5, flash ? 0.42 : 0.5, 1);
      core.userData = { breachlineGrenadeDetail: true };
      mesh.add(core);

      const band = mesh.clone(false);
      band.geometry = mesh.geometry.clone();
      band.material = mesh.material.clone();
      band.material.color.setHex(flash ? 0xff8f3d : 0x283a4c);
      band.position.set(0, 0, 0.9);
      band.scale.set(flash ? 0.17 : 0.92, flash ? 0.85 : 0.18, 1);
      band.userData = { breachlineGrenadeDetail: true };
      mesh.add(band);
    };

    const predictGrenadeLanding = (actor, type, power, target) => {
      const direction = target
        ? target.clone().sub(actor.pos)
        : actor.pos.clone().set(Math.cos(actor.dir), Math.sin(actor.dir));
      if (direction.lengthSq() < 0.001) direction.set(Math.cos(actor.dir), Math.sin(actor.dir));
      direction.normalize();

      const position = actor.pos.clone().add(direction.clone().multiplyScalar(32));
      const velocity = direction.clone().multiplyScalar(500 * clamp(power, 0.8, 2));
      let fuse = type === "flash" ? 1.05 : 0.8;
      const fixedStep = 1 / 60;
      while (fuse > 0) {
        const step = Math.min(fixedStep, fuse);
        const nextX = position.clone();
        nextX.x += velocity.x * step;
        if (game.collides(nextX, 9)) velocity.x *= -0.42;
        else position.x = nextX.x;

        const nextY = position.clone();
        nextY.y += velocity.y * step;
        if (game.collides(nextY, 9)) velocity.y *= -0.42;
        else position.y = nextY.y;

        velocity.multiplyScalar(Math.pow(0.045, step));
        fuse -= step;
      }
      return position;
    };

    game.predictGrenadeLanding = predictGrenadeLanding;

    const worldToScreen = (point) => {
      const rect = game.canvas.getBoundingClientRect();
      const camera = game.camera;
      return {
        x: rect.left + (point.x - (camera.position.x + camera.left)) / (camera.right - camera.left) * rect.width,
        y: rect.top + ((camera.position.y + camera.top) - point.y) / (camera.top - camera.bottom) * rect.height,
        unitsToPixels: rect.width / (camera.right - camera.left),
        rect
      };
    };

    const positionTelegraph = (element, point, type, radius, progress, label, enemy = false) => {
      const screen = worldToScreen(point);
      const size = Math.max(42, radius * 2 * screen.unitsToPixels);
      const offscreen = screen.x < -size || screen.x > screen.rect.width + size || screen.y < -size || screen.y > screen.rect.height + size;
      element.classList.toggle("hidden", offscreen);
      element.classList.toggle("smoke", type === "smoke");
      element.classList.toggle("enemy", enemy);
      element.style.left = `${screen.x}px`;
      element.style.top = `${screen.y}px`;
      element.style.width = `${size}px`;
      element.style.height = `${size}px`;
      element.style.setProperty("--fill-angle", `${clamp(progress, 0, 1) * 360}deg`);
      const icon = element.querySelector(".telegraph-icon");
      const timer = element.querySelector(".telegraph-time");
      if (icon) icon.textContent = type === "flash" ? "✦" : "●";
      if (timer) timer.textContent = label;
      return screen;
    };

    game._grenadeTelegraphs = new Map();
    const syncGrenadeTelegraphs = () => {
      const activeIds = new Set();
      for (const grenade of game.grenades.slice(0, 8)) {
        const key = String(grenade.id);
        activeIds.add(key);
        let element = game._grenadeTelegraphs.get(key);
        if (!element) {
          element = document.createElement("div");
          element.className = "throw-telegraph";
          element.innerHTML = '<div class="telegraph-sweep"></div><div class="telegraph-core"><span class="telegraph-icon">✦</span></div><span class="telegraph-time">0.0s</span>';
          ui.telegraphs.appendChild(element);
          game._grenadeTelegraphs.set(key, element);
        }
        const destination = grenade.predictedLanding || grenade.pos;
        const initialFuse = Math.max(0.01, grenade.initialFuse || grenade.fuse);
        const progress = 1 - grenade.fuse / initialFuse;
        positionTelegraph(
          element,
          destination,
          grenade.type,
          grenade.type === "flash" ? FLASH_RADIUS : 150,
          progress,
          `${Math.max(0, grenade.fuse).toFixed(1)}s`,
          grenade.owner.team === "enemy"
        );
      }
      for (const [key, element] of game._grenadeTelegraphs) {
        if (activeIds.has(key)) continue;
        element.remove();
        game._grenadeTelegraphs.delete(key);
      }
      game.canvas.dataset.activeGrenadeTelegraphs = String(activeIds.size);
    };

    const updateThrowPreview = () => {
      if (!game._grenadeChargeStartedAt || !game._selectedGadget || game.phase !== "playing") {
        ui.throwPreview.classList.add("hidden");
        ui.throwVector.classList.remove("active");
        return;
      }
      const charge = clamp((performance.now() - game._grenadeChargeStartedAt) / 1000, 0, 1);
      const power = 1 + charge;
      const type = game._selectedGadget;
      const destination = predictGrenadeLanding(game.player, type, power, game.mouse.world);
      const destinationScreen = worldToScreen(destination);
      ui.throwPreview.classList.remove("hidden");
      ui.throwPreview.classList.add("landing-only");
      ui.throwPreview.classList.toggle("smoke", type === "smoke");
      ui.throwPreview.style.left = `${destinationScreen.x}px`;
      ui.throwPreview.style.top = `${destinationScreen.y}px`;
      ui.throwPreview.style.setProperty("--fill-angle", "0deg");
      const playerScreen = worldToScreen(game.player.pos);
      const dx = destinationScreen.x - playerScreen.x;
      const dy = destinationScreen.y - playerScreen.y;
      ui.throwVector.style.left = `${playerScreen.x}px`;
      ui.throwVector.style.top = `${playerScreen.y}px`;
      ui.throwVector.style.width = `${Math.hypot(dx, dy)}px`;
      ui.throwVector.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      ui.throwVector.classList.add("active");
      game.canvas.dataset.predictedLanding = `${Math.round(destination.x)}:${Math.round(destination.y)}`;
      game.canvas.dataset.predictedThrowPower = power.toFixed(2);
    };

    const clearGadget = () => {
      game._selectedGadget = null;
      game._grenadeChargeStartedAt = 0;
      game._pendingThrowPower = 1;
      game.mouse.down = false;
      ui.flashGadget.classList.remove("selected");
      ui.smokeGadget.classList.remove("selected");
      ui.charge.classList.remove("active");
      ui.throwPreview.classList.add("hidden");
      ui.throwPreview.classList.remove("landing-only");
      ui.throwVector.classList.remove("active");
    };

    const selectGadget = (type) => {
      const count = type === "flash" ? game.player.flashGrenades : game.player.smokeGrenades;
      if (count <= 0) {
        game.showToast(`${type.toUpperCase()} EMPTY`);
        clearGadget();
        return;
      }
      if (game._selectedGadget === type) {
        clearGadget();
        game.showToast("PRIMARY READY");
        return;
      }
      game.mouse.down = false;
      game._selectedGadget = type;
      ui.flashGadget.classList.toggle("selected", type === "flash");
      ui.smokeGadget.classList.toggle("selected", type === "smoke");
      ui.chargeName.textContent = `${type.toUpperCase()} THROW`;
      game.showToast(`${type.toUpperCase()} EQUIPPED`);
    };

    const originalResetRound = game.resetRound.bind(game);
    game.resetRound = function (showLoadout = true) {
      originalResetRound(showLoadout);
      this.player.flashGrenades = 99;
      this.player.smokeGrenades = 99;
      this.cameraShake = 0;
      this._flashFeedback = [];
      this._incomingUntil = 0;
      clearGadget();
      applyLayout(this._roundSerial % layouts.length);
      applyWeaponVisual(this.player, this.player.weapon.id);
      this.bots.forEach((bot) => applyWeaponVisual(bot, bot.weapon.id));
      syncGrenadeTelegraphs();
      this._roundSerial += 1;
      this.renderUi();
    };

    const originalTogglePause = game.togglePause.bind(game);
    game.togglePause = function (forced) {
      clearGadget();
      return originalTogglePause(forced);
    };

    const originalFrustum = game.updateCameraFrustum.bind(game);
    game.updateCameraFrustum = function () {
      originalFrustum();
      const scale = clamp(this.viewScale || 1, 1, 1.5);
      this.camera.left *= scale;
      this.camera.right *= scale;
      this.camera.top *= scale;
      this.camera.bottom *= scale;
      this.camera.updateProjectionMatrix();
      this.canvas.dataset.viewScale = scale.toFixed(2);
    };

    const originalVisible = game.isVisible.bind(game);
    game.isVisible = function (observer, target, coneDegrees, distance) {
      const fairDistance = observer.team === "enemy" && target === this.player
        ? Math.min(distance, AI_FAIR_RANGE)
        : distance;
      return originalVisible(observer, target, coneDegrees, fairDistance);
    };

    const originalThrowGrenade = game.throwGrenade.bind(game);
    game.throwGrenade = function (requestedType, actor, target) {
      let type = requestedType;
      let throwTarget = target;

      if (actor.team === "enemy") {
        const hasFlash = actor.flashGrenades > 0;
        const hasSmoke = actor.smokeGrenades > 0;
        if (hasFlash && hasSmoke) type = this.rng.next() < 0.5 ? "flash" : "smoke";
        else if (hasFlash) type = "flash";
        else if (hasSmoke) type = "smoke";
        if (type === "flash") throwTarget = this.player.pos.clone();
        else throwTarget = actor.pos.clone().lerp(this.player.pos, 0.2);
      }

      const power = actor === this.player
        ? clamp(this._pendingThrowPower || 1, 1, 2)
        : this.rng.range(0.95, 1.25);
      const predictedLanding = predictGrenadeLanding(actor, type, power, throwTarget);
      const before = this.grenades.length;
      originalThrowGrenade(type, actor, throwTarget);
      if (this.grenades.length <= before) {
        this._pendingThrowPower = 1;
        return;
      }

      const grenade = this.grenades[this.grenades.length - 1];
      grenade.vel.multiplyScalar(power);
      grenade.throwPower = power;
      grenade.initialFuse = grenade.fuse;
      grenade.predictedLanding = predictedLanding;
      styleGrenadeMesh(grenade);
      this.canvas.dataset.lastThrowPower = power.toFixed(2);
      this.canvas.dataset.lastPredictedLanding = `${Math.round(predictedLanding.x)}:${Math.round(predictedLanding.y)}`;
      this._pendingThrowPower = 1;

      if (actor.team === "enemy") {
        this._incomingType = type;
        this._incomingUntil = this.now + 1.35;
      }
    };

    const originalExplode = game.explode.bind(game);
    game.explode = function (grenade) {
      if (grenade.type === "smoke") {
        const before = this.smokes.length;
        originalExplode(grenade);
        if (this.smokes.length > before) {
          this.smokes[this.smokes.length - 1].endAt = this.now + SMOKE_DURATION;
        }
        this.canvas.dataset.lastSmokeEndAt = (this.now + SMOKE_DURATION).toFixed(2);
        return;
      }

      const affected = [];
      for (const actor of [this.player, ...this.bots]) {
        if (!actor.alive) continue;
        const dx = grenade.pos.x - actor.pos.x;
        const dy = grenade.pos.y - actor.pos.y;
        const distance = Math.hypot(dx, dy);
        const clearLine = !this.rayBlocked(actor.pos, grenade.pos);
        const inRange = clearLine && distance <= FLASH_RADIUS;
        if (!inRange) continue;

        const duration = FLASH_DURATION;
        actor.flashedUntil = Math.max(actor.flashedUntil, this.now + duration);
        if (actor.team === "enemy") {
          actor.state = "blinded";
          actor.hadVisual = false;
          actor.coverTarget = undefined;
        }
        affected.push({ actor, duration });

        const originalColor = actor.team === "player" ? 7202527 : 16737381;
        actor.body.material.color.setHex(0xffffff);
        window.setTimeout(() => actor.body.material.color.setHex(originalColor), 110);
      }

      this._flashFeedback = affected.map(({ actor, duration }) => ({
        actor,
        label: actor === this.player ? "PLAYER" : actor.id.toUpperCase(),
        duration
      }));
      this.visibilityDirty = true;
      this.cameraShake = Math.max(this.cameraShake, 3.5);
      if (grenade.owner.team === "player") {
        this.showToast(affected.length ? `FLASH HIT ×${affected.length}` : "FLASH // NO EFFECT");
      }
      this.canvas.dataset.lastFlashHits = String(affected.length);
    };

    const originalFire = game.fire.bind(game);
    game.fire = function (actor, direction) {
      const shotsBefore = actor.shots;
      originalFire(actor, direction);
      if (actor === this.player && actor.shots > shotsBefore) {
        const kick = actor.weapon.id === "shotgun" ? 7 : actor.weapon.id === "smg" ? 2.6 : 3.8;
        this.cameraShake = Math.min(10, this.cameraShake + kick);
        pulseClass(ui.muzzle, "active");
      }
    };

    const originalDamageActor = game.damageActor.bind(game);
    game.damageActor = function (source, target, amount) {
      const hpBefore = target.hp;
      const wasAlive = target.alive;
      originalDamageActor(source, target, amount);
      if (target.hp >= hpBefore) return;

      const originalColor = target.team === "player" ? 7202527 : 16737381;
      target.body.material.color.setHex(0xffffff);
      window.setTimeout(() => target.body.material.color.setHex(originalColor), 90);

      if (source === this.player) {
        ui.hitmarker.classList.toggle("kill", wasAlive && !target.alive);
        pulseClass(ui.hitmarker, "active");
      }
      if (target === this.player) {
        this.cameraShake = Math.min(12, this.cameraShake + 6);
        pulseClass(ui.damage, "active");
        pulseClass(ui.health, "hit");
      }
    };

    const originalUpdateCamera = game.updateCamera.bind(game);
    game.updateCamera = function () {
      originalUpdateCamera();
      if (this.cameraShake <= 0.03) {
        this.cameraShake = 0;
        return;
      }
      const intensity = this.cameraShake;
      this.camera.position.x += (Math.random() - 0.5) * intensity;
      this.camera.position.y += (Math.random() - 0.5) * intensity;
      this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
      this.cameraShake *= 0.72;
    };

    const originalRenderUi = game.renderUi.bind(game);
    game.renderUi = function () {
      originalRenderUi();
      if (this.player._visualWeaponId !== this.player.weapon.id) applyWeaponVisual(this.player, this.player.weapon.id);
      for (const bot of this.bots) {
        if (bot._visualWeaponId !== bot.weapon.id) applyWeaponVisual(bot, bot.weapon.id);
      }
      syncGrenadeTelegraphs();
      updateThrowPreview();
      const insideSmoke = this.isInsideSmoke(this.player.pos);
      ui.smoke.classList.toggle("active", insideSmoke && this.player.flashedUntil <= this.now);
      ui.zoom.textContent = `VIEW ${this.viewScale.toFixed(2)}×`;
      ui.ammo.classList.toggle("low-ammo", this.player.ammo <= Math.max(2, Math.ceil(this.player.weapon.magSize * 0.2)));

      const activeFlashes = this._flashFeedback.filter((entry) => entry.actor.flashedUntil > this.now);
      this._flashFeedback = activeFlashes;
      ui.flashStatus.textContent = activeFlashes
        .slice(0, 3)
        .map((entry) => `${entry.label} ${(entry.actor.flashedUntil - this.now).toFixed(1)}s`)
        .join(" · ");

      if (this._grenadeChargeStartedAt) {
        const charge = clamp((performance.now() - this._grenadeChargeStartedAt) / 1000, 0, 1);
        ui.charge.classList.add("active");
        ui.chargeBar.style.width = `${charge * 100}%`;
        ui.chargeRange.textContent = `${Math.round((1 + charge) * 100)}%`;
      } else {
        ui.charge.classList.remove("active");
        ui.chargeBar.style.width = "0%";
        ui.chargeRange.textContent = "100%";
      }

      if (this._selectedGadget) ui.status.textContent = `${this._selectedGadget.toUpperCase()} READY // HOLD LMB TO SET RANGE`;
      else if (this._incomingUntil > this.now) ui.status.textContent = `INCOMING ${this._incomingType.toUpperCase()}`;
      else if (insideSmoke) ui.status.textContent = "SMOKE OBSCURED // CLOSE RANGE ONLY";
      else if (this.player.underFireUntil > this.now) ui.status.textContent = "UNDER FIRE // REPOSITION";
      else ui.status.textContent = "";

      this.canvas.dataset.selectedGadget = this._selectedGadget || "primary";
      this.canvas.dataset.aiAcquisitionRange = String(AI_FAIR_RANGE);
      this.canvas.dataset.flashFeedback = ui.flashStatus.textContent;
      this.canvas.dataset.flashDurations = FLASH_DURATION.toFixed(2);
    };

    window.addEventListener("keydown", (event) => {
      if (game.phase !== "playing") return;
      if (event.code === "Digit1") {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearGadget();
        game.showToast("PRIMARY READY");
        return;
      }
      if (event.code !== "Digit2" && event.code !== "Digit3") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectGadget(event.code === "Digit2" ? "flash" : "smoke");
    }, true);

    game.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || game.phase !== "playing" || !game._selectedGadget) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      game.mouse.down = false;
      game.updateMouseWorld();
      game._grenadeChargeStartedAt = performance.now();
    }, true);

    window.addEventListener("pointerup", (event) => {
      if (event.button !== 0 || !game._grenadeChargeStartedAt || !game._selectedGadget) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const held = clamp((performance.now() - game._grenadeChargeStartedAt) / 1000, 0, 1);
      const type = game._selectedGadget;
      game._pendingThrowPower = 1 + held;
      game._grenadeChargeStartedAt = 0;
      game.updateMouseWorld();
      game.throwGrenade(type, game.player, game.mouse.world.clone());
      clearGadget();
    }, true);

    game.canvas.addEventListener("wheel", (event) => {
      if (game.phase !== "playing") return;
      event.preventDefault();
      const direction = Math.sign(event.deltaY);
      game.viewScale = clamp(game.viewScale + direction * 0.08, 1, 1.5);
      game.updateCameraFrustum();
      game.visibilityDirty = true;
      game.showToast(`VIEW ${game.viewScale.toFixed(2)}×`);
    }, { capture: true, passive: false });

    game.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("blur", clearGadget);

    game.player.flashGrenades = 99;
    game.player.smokeGrenades = 99;
    applyLayout(0);
    applyWeaponVisual(game.player, game.player.weapon.id);
    game.bots.forEach((bot) => applyWeaponVisual(bot, bot.weapon.id));
    game.updateCameraFrustum();
    game.renderUi();
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", bootQualityPass, { once: true });
  } else {
    bootQualityPass();
  }
})();
