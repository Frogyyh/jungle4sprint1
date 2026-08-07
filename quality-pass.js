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
    const $ = (selector) => document.querySelector(selector);
    const FLASH_RADIUS = 200;
    const FLASH_DURATION = 1;
    const SMOKE_DURATION = 10;
    const AI_FAIR_RANGE = 620;
    const DEFAULT_VIEW_SCALE = 1.25;
    const SNIPER_VIEW_SCALE = 1.5;

    const ui = {
      flashGadget: $("#flash-gadget"),
      smokeGadget: $("#smoke-gadget"),
      fragGadget: $("#frag-gadget"),
      charge: $("#grenade-charge"),
      chargeName: $("#grenade-charge-name"),
      chargeRange: $("#grenade-charge-range"),
      chargeBar: $("#grenade-charge-bar"),
      zoom: $("#zoom-status"),
      layout: $("#map-layout"),
      flashStatus: $("#flash-status"),
      smokeStatus: $("#smoke-status"),
      hitmarker: $("#hitmarker"),
      damage: $("#damage-overlay"),
      damageDirection: $("#damage-direction-world"),
      damageBorder: $("#damage-direction-border"),
      smoke: $("#smoke-overlay"),
      muzzle: $("#muzzle-flash"),
      status: $("#status-message"),
      ammo: $("#ammo"),
      health: $(".health-block")
    };
    ui.telegraphs = $("#throw-telegraphs");
    ui.throwPreview = $("#throw-preview");
    ui.throwVector = $("#throw-vector");

    game.viewScale = DEFAULT_VIEW_SCALE;
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
    game.canvas.dataset.cameraZoomMode = "fixed";
    game.canvas.dataset.identificationBounds = "camera-frustum";

    const mapData = window.BREACHLINE_MAP_DATA;
    const THREE = window.BREACHLINE_THREE;
    const requestedMapId = new URLSearchParams(location.search).get("map") || "crossroads";
    const selectedMap = mapData.find(requestedMapId);
    const blockingTypes = new Set(["boundary", "wall", "cover", "crate", "water"]);

    const disposeMapMesh = (mesh) => {
      if (!mesh) return;
      game.worldGroup.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    };

    const makeMapMesh = (object) => {
      const color = selectedMap.theme[object.type] || selectedMap.theme.wall;
      const width = object.r ? object.r * 2 : object.w;
      const height = object.r ? object.r * 2 : object.h;
      // game.js exposes PlaneGeometry to extension scripts. Keeping map pieces
      // flat also matches the top-down renderer and avoids relying on Three.js
      // constructors that may be removed by the production bundle tree-shaker.
      const geometry = new THREE.PlaneGeometry(width, height);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: object.type === "bush" || object.type === "water",
        opacity: object.type === "bush" ? 0.72 : object.type === "water" ? 0.78 : 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(object.x, object.y, object.type === "water" ? 1 : 8);
      mesh.userData.breachlineMapObject = object.type;
      return mesh;
    };

    const applyLayout = () => {
      for (const wall of game.walls) disposeMapMesh(wall.mesh);
      for (const mesh of game._mapDecorationMeshes || []) disposeMapMesh(mesh);
      game.walls.length = 0;
      game._mapDecorationMeshes = [];

      for (const object of selectedMap.objects) {
        const mesh = makeMapMesh(object);
        game.worldGroup.add(mesh);
        if (blockingTypes.has(object.type)) {
          game.walls.push({
            id: object.id, x: object.x, y: object.y, w: object.w, h: object.h,
            kind: object.type === "boundary" ? "boundary" : "cover", type: object.type, mesh,
          });
        } else {
          game._mapDecorationMeshes.push(mesh);
        }
      }
      if (selectedMap.objective) {
        const objectiveMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(92, 92),
          new THREE.MeshBasicMaterial({ color: selectedMap.theme.accent, transparent: true, opacity: 0.22 })
        );
        objectiveMesh.position.set(selectedMap.objective[0], selectedMap.objective[1], 1.5);
        objectiveMesh.userData.breachlineMapObject = "objective";
        game.worldGroup.add(objectiveMesh);
        game._mapDecorationMeshes.push(objectiveMesh);
      }
      game.floor.material.color.set(selectedMap.theme.floor);
      game.scene.background.set(selectedMap.theme.floor);
      game.visibilityDirty = true;
      game._activeLayout = selectedMap.name;
      game._activeMapId = selectedMap.id;
      ui.layout.textContent = `MAP // ${selectedMap.name}`;
      game.canvas.dataset.mapLayout = selectedMap.name;
      game.canvas.dataset.mapId = selectedMap.id;
    };

    const bushes = selectedMap.objects.filter((object) => object.type === "bush");
    const insideBush = (position, bush) => (
      position.x >= bush.x - bush.w / 2 && position.x <= bush.x + bush.w / 2 &&
      position.y >= bush.y - bush.h / 2 && position.y <= bush.y + bush.h / 2
    );
    const originalIsVisible = game.isVisible.bind(game);
    game.isVisible = function (observer, target, fov, range) {
      const targetBush = bushes.find((bush) => insideBush(target.pos, bush));
      if (targetBush && !insideBush(observer.pos, targetBush) && observer.pos.distanceTo(target.pos) > 185) return false;
      return originalIsVisible(observer, target, fov, range);
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
        // 방패 이미지 제거 — 방벽은 벡터 도형(operator-system)으로 표시된다.
        { x: -2, y: 34, w: 4, h: 16, color: 0xffc36f },
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
      dagger: [
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
      "frog-tongue": "frog_tongue", tongue: "frog_tongue", frog: "frog_tongue",
      "bolt-action": "bolt_action", sniper: "bolt_action",
      "grenade-launcher": "grenade_launcher", launcher: "grenade_launcher",
      shuriken: "dagger"
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
        piece.material.transparent = shape.opacity !== undefined;
        piece.material.opacity = shape.opacity ?? 1;
        piece.material.depthWrite = shape.opacity === undefined;
        piece.userData = {
          ...piece.userData,
          breachlineWeaponPiece: true,
          breachlineBaseX: shape.x,
          breachlineBaseY: shape.y,
          breachlineBaseRotation: shape.r || 0,
        };
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
      const profile = {
        flash: { shell: 0xffd85e, core: 0xffffff, band: 0xff7a32, scale: 1, coreScale: 0.42, bandX: 0.17, bandY: 0.85 },
        smoke: { shell: 0x526b78, core: 0xaad5c0, band: 0x5ad68a, scale: 1.16, coreScale: 0.5, bandX: 0.92, bandY: 0.18 },
        frag: { shell: 0x596a42, core: 0xd5dd94, band: 0xff765f, scale: 1.14, coreScale: 0.48, bandX: 0.9, bandY: 0.2 },
        launcher: { shell: 0x5e456b, core: 0xffc5f5, band: 0xb86cff, scale: 1.08, coreScale: 0.46, bandX: 0.86, bandY: 0.22 },
      }[grenade.type] || { shell: 0x7088a8, core: 0xc4d0d4, band: 0x283a4c, scale: 1.12, coreScale: 0.5, bandX: 0.92, bandY: 0.18 };
      mesh.scale.setScalar(profile.scale);
      mesh.material.color.setHex(profile.shell);

      const core = mesh.clone(false);
      core.geometry = mesh.geometry.clone();
      core.material = mesh.material.clone();
      core.material.color.setHex(profile.core);
      core.position.set(0, 0, 0.8);
      core.scale.set(profile.coreScale, profile.coreScale, 1);
      core.userData = { breachlineGrenadeDetail: true };
      mesh.add(core);

      const band = mesh.clone(false);
      band.geometry = mesh.geometry.clone();
      band.material = mesh.material.clone();
      band.material.color.setHex(profile.band);
      band.position.set(0, 0, 0.9);
      band.scale.set(profile.bandX, profile.bandY, 1);
      band.userData = { breachlineGrenadeDetail: true };
      mesh.add(band);
    };
    game.styleGrenadeMesh = styleGrenadeMesh;

    const gadgetRadius = (type) => ({ flash: 200, smoke: 150, frag: 100, launcher: 67 }[type] || 100);
    game.getGadgetRadius = gadgetRadius;

    const predictGrenadeLanding = (actor, type, power, target) => {
      const direction = target
        ? target.clone().sub(actor.pos)
        : actor.pos.clone().set(Math.cos(actor.dir), Math.sin(actor.dir));
      if (direction.lengthSq() < 0.001) direction.set(Math.cos(actor.dir), Math.sin(actor.dir));
      direction.normalize();

      const position = actor.pos.clone().add(direction.clone().multiplyScalar(32));
      const velocity = direction.clone().multiplyScalar((type === "launcher" ? 620 : 500) * clamp(power, 0.8, 2));
      let fuse = type === "frag" ? 2 : 1.5;
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

    game.showDamageDirection = (sourcePosition) => {
      if (!sourcePosition || !ui.damageDirection || !ui.damageBorder) return;
      const playerScreen = worldToScreen(game.player.pos);
      const sourceScreen = worldToScreen(sourcePosition);
      const dx = sourceScreen.x - playerScreen.x;
      const dy = sourceScreen.y - playerScreen.y;
      const distance = Math.hypot(dx, dy) || 1;
      const nx = dx / distance;
      const ny = dy / distance;
      const angle = Math.atan2(ny, nx) * 180 / Math.PI;
      ui.damageDirection.style.left = `${playerScreen.x + nx * 62}px`;
      ui.damageDirection.style.top = `${playerScreen.y + ny * 62}px`;
      ui.damageDirection.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;

      const edgeWeights = {
        top: Math.max(0, -ny),
        right: Math.max(0, nx),
        bottom: Math.max(0, ny),
        left: Math.max(0, -nx),
      };
      for (const [edge, weight] of Object.entries(edgeWeights)) {
        const element = ui.damageBorder.querySelector(`.${edge}`);
        if (element) element.style.opacity = `${0.12 + weight * 0.88}`;
      }
      pulseClass(ui.damageDirection, "active");
      pulseClass(ui.damageBorder, "active");
      game.canvas.dataset.lastDamageDirection = `${Math.round(angle)}`;
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
    game.positionGrenadeTelegraph = positionTelegraph;

    game._grenadeTelegraphs = new Map();
    const syncGrenadeTelegraphs = () => {
      const activeIds = new Set();
      for (const grenade of game.grenades) {
        // 유탄발사기 직사 유탄은 비행 중 범위/타이머를 표시하지 않는다.
        if (grenade.directFire) continue;
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
        const destination = grenade.pos;
        const initialFuse = Math.max(0.01, grenade.initialFuse || grenade.fuse);
        const progress = 1 - grenade.fuse / initialFuse;
        positionTelegraph(
          element,
          destination,
          grenade.type,
          gadgetRadius(grenade.type),
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
      game.canvas.dataset.grenadeTelegraphAnchor = "projectile";
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
      // 지시선 + 착탄 예정 지점에 효과 범위(반경) 원 표시
      const rangeRadius = gadgetRadius(type);
      const size = Math.max(42, rangeRadius * 2 * destinationScreen.unitsToPixels);
      ui.throwPreview.classList.remove("hidden");
      ui.throwPreview.classList.remove("landing-only");
      ui.throwPreview.classList.toggle("smoke", type === "smoke");
      ui.throwPreview.style.left = `${destinationScreen.x}px`;
      ui.throwPreview.style.top = `${destinationScreen.y}px`;
      ui.throwPreview.style.width = `${size}px`;
      ui.throwPreview.style.height = `${size}px`;
      ui.throwPreview.style.setProperty("--fill-angle", "0deg");
      const icon = ui.throwPreview.querySelector(".telegraph-icon");
      const timer = ui.throwPreview.querySelector(".telegraph-time");
      if (icon) icon.textContent = "●";
      if (timer) timer.textContent = `R${rangeRadius}`;
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

    // 폭탄마: 유탄 발사 중에는 착탄 지점에 폭발 반경(67) 고리와 도달 예상 시간을
    // 고정 표시한다. 조준 중에는 아무것도 표시하지 않는다(크로스헤어 원 제거).
    const LAUNCHER_RADIUS = 67;
    const updateLauncherPreview = () => {
      if (game.activeOperatorId !== "demolitionist") return; // 다른 캐릭터 프리뷰를 건드리지 않는다
      const inFlight = game.grenades.find((grenade) => grenade.directFire);
      if (!inFlight) {
        ui.throwPreview.classList.add("hidden");
        return;
      }
      const launcherSpeed = game.player.weapon?.projectileSpeed || 620;
      const center = inFlight.targetPos;
      const remaining = inFlight.pos.distanceTo(inFlight.targetPos);
      const travelTime = remaining / (inFlight.speed || launcherSpeed);

      const screen = worldToScreen(center);
      const size = Math.max(42, LAUNCHER_RADIUS * 2 * screen.unitsToPixels);
      ui.throwPreview.classList.remove("hidden");
      ui.throwPreview.classList.remove("landing-only", "smoke");
      ui.throwPreview.style.setProperty("--telegraph", "#c58bff");
      ui.throwPreview.style.setProperty("--telegraph-soft", "rgba(197, 139, 255, 0.2)");
      ui.throwPreview.style.left = `${screen.x}px`;
      ui.throwPreview.style.top = `${screen.y}px`;
      ui.throwPreview.style.width = `${size}px`;
      ui.throwPreview.style.height = `${size}px`;
      ui.throwPreview.style.setProperty("--fill-angle", "0deg");
      const icon = ui.throwPreview.querySelector(".telegraph-icon");
      const timer = ui.throwPreview.querySelector(".telegraph-time");
      if (icon) icon.textContent = "●";
      if (timer) timer.textContent = `IMPACT ${travelTime.toFixed(1)}s`;
      game.canvas.dataset.launcherPreview = `${Math.round(center.x)}:${Math.round(center.y)}`;
      game.canvas.dataset.launcherPreviewTime = travelTime.toFixed(2);
      game.canvas.dataset.launcherPreviewPinned = "true";
    };

    const clearGadget = () => {
      game._selectedGadget = null;
      game._grenadeChargeStartedAt = 0;
      game._pendingThrowPower = 1;
      game.mouse.down = false;
      ui.flashGadget.classList.remove("selected");
      ui.smokeGadget.classList.remove("selected");
      ui.fragGadget?.classList.remove("selected");
      ui.charge.classList.remove("active");
      ui.throwPreview.classList.add("hidden");
      ui.throwPreview.classList.remove("landing-only");
      ui.throwVector.classList.remove("active");
    };

    const selectGadget = (type) => {
      const count = game.getGadgetCount
        ? game.getGadgetCount(type)
        : type === "flash" ? game.player.flashGrenades : game.player.smokeGrenades;
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
      ui.fragGadget?.classList.toggle("selected", type === "frag");
      ui.chargeName.textContent = `${type.toUpperCase()} THROW`;
      game.showToast(`${type.toUpperCase()} EQUIPPED`);
    };
    game.clearGadget = clearGadget;
    game.selectGadget = selectGadget;

    // 피격판정 통일: 모든 캐릭터가 동일한 원형 히트박스(반경 20)를 사용한다.
    // 코어 기본값(18)보다 시각 스프라이트(55px)에 근접해 피격 감각이 원활하다.
    const ACTOR_RADIUS = 20;
    const applyActorRadius = (game2) => {
      game2.player.radius = ACTOR_RADIUS;
      for (const bot of game2.bots) bot.radius = ACTOR_RADIUS;
    };

    const originalResetRound = game.resetRound.bind(game);
    game.resetRound = function (showLoadout = true) {
      originalResetRound(showLoadout);
      applyActorRadius(this);
      this.cameraShake = 0;
      this._flashFeedback = [];
      this._incomingUntil = 0;
      this.player._breachlineColorPulseSerial = (this.player._breachlineColorPulseSerial || 0) + 1;
      this.player._assetPulseUntil = 0;
      if (this.player._characterSprite?.material?.color) {
        this.player._characterSprite.material.color.setHex(0xffffff);
      }
      ui.damage?.classList.remove("active");
      ui.damage?.style.removeProperty("opacity");
      ui.health?.classList.remove("hit");
      ui.hitmarker?.classList.remove("active", "kill");
      ui.hitmarker?.style.removeProperty("left");
      ui.hitmarker?.style.removeProperty("top");
      ui.smoke?.classList.remove("active");
      ui.smokeStatus?.classList.remove("active", "inside");
      if (ui.smokeStatus) {
        ui.smokeStatus.textContent = "";
        ui.smokeStatus.style.setProperty("--smoke-progress", "0%");
      }
      clearGadget();
      applyLayout();
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
      const operatorId = this.activeOperatorId || this.selectedOperatorId;
      const scale = operatorId === "sniper" ? SNIPER_VIEW_SCALE : DEFAULT_VIEW_SCALE;
      this.viewScale = scale;
      this.camera.left *= scale;
      this.camera.right *= scale;
      this.camera.top *= scale;
      this.camera.bottom *= scale;
      this.camera.updateProjectionMatrix();
      this.canvas.dataset.viewScale = scale.toFixed(2);
    };

    const isActorInsideCamera = (actor) => {
      if (!actor?.pos) return false;
      const margin = Math.max(4, actor.radius || 0);
      const left = game.camera.position.x + game.camera.left + margin;
      const right = game.camera.position.x + game.camera.right - margin;
      const bottom = game.camera.position.y + game.camera.bottom + margin;
      const top = game.camera.position.y + game.camera.top - margin;
      return actor.pos.x >= left && actor.pos.x <= right && actor.pos.y >= bottom && actor.pos.y <= top;
    };

    // 부채꼴 외에 캐릭터 주변에 항상 보이는 원형 시야 (반경 100, 벽/연막 차단 적용).
    // 아이언(시야각 20도 제한)에게도 동일하게 360도 원형으로 적용된다.
    const NEAR_VISION_RADIUS = 100;

    const originalVisible = game.isVisible.bind(game);
    game.isVisible = function (observer, target, coneDegrees, distance) {
      // 피아식별 규칙: 아군은 항상 식별, 적은 시야 안에서만 식별된다.
      if (observer !== target && observer.team === target.team) return true;
      if ((observer === this.player || target === this.player)) {
        const otherActor = observer === this.player ? target : observer;
        if (!isActorInsideCamera(otherActor)) return false;
      }
      // 연막 내부에서는 원형·부채꼴 시야 구분 없이 서로 식별 가능하다.
      if (observer !== target && observer.alive && target.alive) {
        const inSameSmoke = this.smokes.some((smoke) => smoke.endAt > this.now
          && observer.pos.distanceTo(smoke.pos) < smoke.radius
          && target.pos.distanceTo(smoke.pos) < smoke.radius);
        if (inSameSmoke) return true;
      }
      // 원형 근접 시야: 부채꼴 각도와 무관하게 근처는 항상 인식한다.
      if (observer !== target && observer.alive && target.alive) {
        const delta = target.pos.clone().sub(observer.pos);
        if (delta.lengthSq() <= NEAR_VISION_RADIUS * NEAR_VISION_RADIUS
          && !this.smokeBlocks(observer.pos, target.pos)
          && !this.rayBlocked(observer.pos, target.pos)) {
          return true;
        }
      }
      const fairDistance = observer.team === "enemy" && target === this.player
        ? Math.min(distance, AI_FAIR_RANGE)
        : distance;
      return originalVisible(observer, target, coneDegrees, fairDistance);
    };

    // 시야 메시(부채꼴)에 원형 근접 시야를 덧붙인다.
    // 아이언의 방패 시야 클램프(20도)에 영향받지 않도록 코어 traceVision 을 그대로 사용한다.
    const coreTraceVision = game.traceVision.bind(game);
    const originalUpdateVisibility = game.updateVisibility.bind(game);
    game.updateVisibility = function updateVisibilityWithNearCircle() {
      originalUpdateVisibility();
      const mesh = this.visibilityMesh;
      if (!mesh?.geometry) return;
      const geometry = mesh.geometry;
      if (geometry.userData?.breachlineNearVision) return;
      const positionsAttr = geometry.getAttribute("position");
      if (!positionsAttr) return;
      const positions = Array.from(positionsAttr.array);
      const segments = 40;
      const points = [];
      for (let index = 0; index <= segments; index++) {
        const angle = Math.PI * 2 * index / segments;
        const direction = this.player.pos.clone().set(Math.cos(angle), Math.sin(angle));
        points.push(coreTraceVision(this.player.pos, direction, NEAR_VISION_RADIUS));
      }
      for (let index = 0; index < segments; index++) {
        positions.push(
          this.player.pos.x, this.player.pos.y, 12,
          points[index].x, points[index].y, 12,
          points[index + 1].x, points[index + 1].y, 12,
        );
      }
      const nextGeometry = new geometry.constructor();
      nextGeometry.setAttribute("position", new positionsAttr.constructor(positions, 3));
      nextGeometry.userData.breachlineNearVision = true;
      this.visibilityMesh.geometry = nextGeometry;
      geometry.dispose();
    };

    const originalThrowGrenade = game.throwGrenade.bind(game);
    game.throwGrenade = function (requestedType, actor, target) {
      const power = actor === this.player
        ? clamp(this._pendingThrowPower || 1, 1, 2)
        : this.rng.range(0.95, 1.25);
      // 폭탄마 수류탄(frag) 등 특수 투척물도 투척 파워를 적용한다.
      if (requestedType !== "flash" && requestedType !== "smoke" && this.createSpecialGrenade) {
        const grenade = this.createSpecialGrenade(requestedType, actor, target);
        if (grenade && actor === this.player) {
          grenade.vel.multiplyScalar(power);
          grenade.throwPower = power;
        }
        this._pendingThrowPower = 1;
        return grenade;
      }
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

      const predictedLanding = predictGrenadeLanding(actor, type, power, throwTarget);
      const before = this.grenades.length;
      originalThrowGrenade(type, actor, throwTarget);
      if (this.grenades.length <= before) {
        this._pendingThrowPower = 1;
        return;
      }

      const grenade = this.grenades[this.grenades.length - 1];
      grenade.fuse = 1.5;
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
          const smoke = this.smokes[this.smokes.length - 1];
          smoke.endAt = this.now + SMOKE_DURATION;
          smoke.owner = grenade.owner;
          smoke._breachlineSmokeStartedAt = this.now;
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
        const inRange = distance <= FLASH_RADIUS;
        if (!inRange) continue;
        if (actor === this.player && this._operatorDash?.invulnerable) continue;

        const duration = FLASH_DURATION;
        actor.flashedUntil = Math.max(actor.flashedUntil, this.now + duration);
        if (actor.team === "enemy") {
          actor.state = "blinded";
          actor.hadVisual = false;
          actor.coverTarget = undefined;
        }
        affected.push({ actor, duration });

        const originalColor = actor.body.material.color.getHex();
        const colorToken = (actor._breachlineColorPulseSerial || 0) + 1;
        actor._breachlineColorPulseSerial = colorToken;
        actor.body.material.color.setHex(0xffffff);
        window.setTimeout(() => {
          if (actor._breachlineColorPulseSerial === colorToken) actor.body.material.color.setHex(originalColor);
        }, 110);
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

    const originalUpdateSmokes = game.updateSmokes.bind(game);
    game.updateSmokes = function updateAnimatedSmokes() {
      for (const smoke of this.smokes) {
        if (!smoke?.mesh || smoke.endAt <= this.now) continue;
        const meshData = smoke.mesh.userData || (smoke.mesh.userData = {});
        if (meshData.breachlineBaseRotation === undefined) {
          meshData.breachlineBaseRotation = smoke.mesh.rotation.z || 0;
        }
        smoke.mesh.rotation.z = meshData.breachlineBaseRotation + Math.sin(this.now * 0.22 + smoke.id) * 0.075;

        // 내부 시점에서는 퍼프를 숨겨 "연막 원 공간"만 보이게 한다.
        // (바깥에서 볼 때만 뭉게뭉게 효과 유지)
        const playerInside = this.player.pos.distanceTo(smoke.pos) < smoke.radius;
        let puffIndex = 0;
        for (const puff of smoke.mesh.children) {
          if (!puff.userData?.breachlineSmokePuff) continue;
          const data = puff.userData;
          if (data.breachlineBaseX === undefined) {
            data.breachlineBaseX = puff.position.x;
            data.breachlineBaseY = puff.position.y;
            data.breachlineBaseScale = puff.scale.x;
            data.breachlineBaseOpacity = puff.material.opacity;
          }
          puff.visible = !playerInside;
          // 3계층 드리프트: 코어는 좁게, 외곽 림은 넓게 흔들린다.
          const layerScale = data.breachlineSmokeLayer === 2 ? 1.6 : data.breachlineSmokeLayer === 1 ? 1.15 : 0.8;
          const phase = this.now * 0.58 + (data.breachlineSmokeSeed || puffIndex * 2.17);
          const drift = smoke.radius * 0.02 * layerScale;
          const breathe = 1 + Math.sin(this.now * 0.9 + puffIndex * 1.43) * 0.055;
          let nextX = data.breachlineBaseX + Math.cos(phase) * drift;
          let nextY = data.breachlineBaseY + Math.sin(phase * 0.87) * drift;
          // 퍼프는 반드시 연막 범위 내부에서만 표시된다 (외부 침범 금지)
          const puffRadius = data.breachlineBaseScale * (smoke.mesh.scale.x || 1) * 1.06;
          const maxRadius = Math.max(1, smoke.radius - puffRadius);
          const radial = Math.hypot(nextX, nextY);
          if (radial > maxRadius) {
            nextX *= maxRadius / radial;
            nextY *= maxRadius / radial;
          }
          puff.position.x = nextX;
          puff.position.y = nextY;
          puff.scale.setScalar(data.breachlineBaseScale * breathe);
          puff.material.opacity = data.breachlineBaseOpacity * (0.9 + Math.sin(phase + 0.7) * 0.1);
          puffIndex += 1;
        }
      }
      return originalUpdateSmokes();
    };

    const originalFire = game.fire.bind(game);
    game.fire = function (actor, direction) {
      const shotsBefore = actor.shots;
      originalFire(actor, direction);
      if (actor.shots > shotsBefore && actor.ammo === 0 && actor.reserve > 0) {
        this.reload(actor);
      }
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

      const originalColor = target.body.material.color.getHex();
      const colorToken = (target._breachlineColorPulseSerial || 0) + 1;
      target._breachlineColorPulseSerial = colorToken;
      target.body.material.color.setHex(0xffffff);
      window.setTimeout(() => {
        if (target._breachlineColorPulseSerial === colorToken) target.body.material.color.setHex(originalColor);
      }, 90);

      if (source === this.player) {
        const targetScreen = worldToScreen(target.pos);
        const markerInset = 20;
        const markerX = clamp(targetScreen.x, targetScreen.rect.left + markerInset, targetScreen.rect.right - markerInset);
        const markerY = clamp(targetScreen.y, targetScreen.rect.top + markerInset, targetScreen.rect.bottom - markerInset);
        ui.hitmarker.style.left = `${markerX}px`;
        ui.hitmarker.style.top = `${markerY}px`;
        ui.hitmarker.classList.toggle("kill", wasAlive && !target.alive);
        pulseClass(ui.hitmarker, "active");
        this.canvas.dataset.lastHitmarkerPosition = `${Math.round(markerX)}:${Math.round(markerY)}`;
      }
      if (target === this.player) {
        this.cameraShake = Math.min(12, this.cameraShake + 6);
        pulseClass(ui.damage, "active");
        pulseClass(ui.health, "hit");
        game.showDamageDirection(source?.pos);
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
      updateLauncherPreview();
      const insideSmoke = this.isInsideSmoke(this.player.pos);
      ui.smoke.classList.toggle("active", insideSmoke && this.player.flashedUntil <= this.now);
      const fixedScale = this.activeOperatorId === "sniper" ? SNIPER_VIEW_SCALE : DEFAULT_VIEW_SCALE;
      ui.zoom.textContent = `VIEW ${fixedScale.toFixed(2)}× // FIXED`;
      ui.ammo.classList.toggle("low-ammo", this.player.ammo <= Math.max(2, Math.ceil(this.player.weapon.magSize * 0.2)));

      let trackedSmoke = null;
      let trackedSmokeContainsPlayer = false;
      for (const smoke of this.smokes) {
        if (smoke.endAt <= this.now) continue;
        const containsPlayer = this.player.pos.distanceTo(smoke.pos) < smoke.radius;
        const ownedByPlayer = smoke.owner === this.player;
        if (!containsPlayer && !ownedByPlayer) continue;
        if (
          !trackedSmoke
          || (containsPlayer && !trackedSmokeContainsPlayer)
          || (containsPlayer === trackedSmokeContainsPlayer && smoke.endAt > trackedSmoke.endAt)
        ) {
          trackedSmoke = smoke;
          trackedSmokeContainsPlayer = containsPlayer;
        }
      }
      if (ui.smokeStatus) {
        if (trackedSmoke) {
          const remaining = Math.max(0, trackedSmoke.endAt - this.now);
          const startedAt = trackedSmoke._breachlineSmokeStartedAt ?? Math.max(0, trackedSmoke.endAt - SMOKE_DURATION);
          const duration = Math.max(0.001, trackedSmoke.endAt - startedAt);
          const progress = clamp(remaining / duration, 0, 1);
          ui.smokeStatus.textContent = `${trackedSmokeContainsPlayer ? "OBSCURED" : "SMOKE"} · ${remaining.toFixed(1)}s`;
          ui.smokeStatus.classList.add("active");
          ui.smokeStatus.classList.toggle("inside", trackedSmokeContainsPlayer);
          ui.smokeStatus.style.setProperty("--smoke-progress", `${(progress * 100).toFixed(1)}%`);
          ui.smokeStatus.setAttribute("aria-label", `Smoke ${remaining.toFixed(1)} seconds remaining`);
          this.canvas.dataset.smokeTimerRemaining = remaining.toFixed(2);
        } else {
          ui.smokeStatus.textContent = "";
          ui.smokeStatus.classList.remove("active", "inside");
          ui.smokeStatus.style.setProperty("--smoke-progress", "0%");
          ui.smokeStatus.removeAttribute("aria-label");
          this.canvas.dataset.smokeTimerRemaining = "0.00";
        }
      }

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
      this.canvas.dataset.identificationViewScale = fixedScale.toFixed(2);
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
      // 병과별 투척물: 군인=섬광탄, 스나이퍼=연막탄, 폭탄마=수류탄 (모두 2번키)
      const gadgetByKey = {
        Digit2: game.activeOperatorId === "sniper" ? "smoke"
          : game.activeOperatorId === "demolitionist" ? "frag" : "flash",
      };
      if (["Digit2", "Digit3", "Digit4"].includes(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      const gadgetType = gadgetByKey[event.code];
      if (!gadgetType) return;
      if (game.canUseGadget && !game.canUseGadget(gadgetType)) {
        return;
      }
      selectGadget(gadgetType);
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

    game.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("blur", clearGadget);

    applyLayout();
    applyActorRadius(game);
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
