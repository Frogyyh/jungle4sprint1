(() => {
  "use strict";

  const installAssetVisuals = () => {
    const game = window.__breachline;
    const THREE = window.BREACHLINE_THREE;
    if (!game || !THREE || !game.applyWeaponVisual || !game.__operatorSystemInstalled) {
      requestAnimationFrame(installAssetVisuals);
      return;
    }
    if (game.__assetVisualsInstalled) return;
    game.__assetVisualsInstalled = true;

    const CHARACTER_ROOT = "./Asset/processed/characters";
    const WEAPON_ROOT = "./Asset/processed/weapons";
    const textureCache = new Map();
    const characterIds = new Set([
      "gunslinger", "bulwark", "sentinel", "soldier", "frog",
      "reaper", "hunter", "ninja", "sniper", "demolitionist",
    ]);
    const meleeWeaponIds = new Set(["scythe", "katana"]);
    const characterOffsets = Object.freeze({
      // The source frame includes a left-side coat/scarf flourish. Shift the
      // painted body back over the gameplay origin without changing hitboxes.
      gunslinger: Object.freeze({ x: -3.6, y: 0 }),
    });
    const teamOutlineColors = Object.freeze({
      player: 0x3b9dff,
      enemy: 0xff4258,
    });
    let texturesLoaded = 0;
    let textureFailures = 0;

    const weaponProfiles = Object.freeze({
      rifle: [
        { texture: "rifle.png", x: 0, y: 31, width: 48, height: 26, rotation: Math.PI / 2 },
      ],
      smg: [
        { texture: "rifle.png", x: 0, y: 28, width: 39, height: 21, rotation: Math.PI / 2 },
      ],
      dual_pistols: [
        { texture: "pistol-l.png", x: -7, y: 25, width: 25, height: 15, rotation: -Math.PI / 2, gunSide: -1 },
        { texture: "pistol-r.png", x: 7, y: 25, width: 25, height: 15, rotation: Math.PI / 2, gunSide: 1 },
      ],
      shield_pistol: [
        // 방패 이미지는 방벽(벡터 도형) 메커니즘으로 대체되어 제거됨. 권총만 표시.
        { texture: "pistol-r.png", x: -2, y: 34, width: 23, height: 14, rotation: Math.PI / 2, hand: "right" },
      ],
      railgun: [
        { texture: "railgun.png", x: 0, y: 33, width: 55, height: 25, rotation: Math.PI / 2 },
      ],
      shotgun: [
        { texture: "double-barrel.png", x: 0, y: 31, width: 47, height: 24, rotation: Math.PI / 2 },
      ],
      katana: [
        { texture: "katana.png", x: 0, y: 38, width: 61, height: 13, rotation: Math.PI / 2 },
      ],
      scythe: [
        { texture: "scythe.png", x: 0, y: 38, width: 65, height: 35, rotation: Math.PI / 2 },
      ],
      bolt_action: [
        { texture: "sniper-rifle.png", x: 0, y: 38, width: 65, height: 20, rotation: Math.PI / 2 },
      ],
    });

    const recoilProfiles = Object.freeze({
      rifle: { distance: 3.2, duration: 0.105, roll: 0.018 },
      smg: { distance: 2.2, duration: 0.075, roll: 0.026 },
      dual_pistols: { distance: 2.5, duration: 0.082, roll: 0.038 },
      shield_pistol: { distance: 2.8, duration: 0.1, roll: 0.022 },
      railgun: { distance: 7.5, duration: 0.18, roll: 0.012 },
      shotgun: { distance: 6.2, duration: 0.16, roll: 0.045 },
      bolt_action: { distance: 5.4, duration: 0.15, roll: 0.025 },
      grenade_launcher: { distance: 7, duration: 0.18, roll: 0.04 },
    });

    const refreshAssetDataset = () => {
      game.canvas.dataset.assetTexturesLoaded = String(texturesLoaded);
      game.canvas.dataset.assetTextureFailures = String(textureFailures);
      game.canvas.dataset.assetRendering = "hybrid-texture-three";
    };

    const getTexture = (url) => {
      if (textureCache.has(url)) return textureCache.get(url);
      const image = new Image();
      image.decoding = "async";
      const texture = new THREE.Texture(image);
      texture.colorSpace = "srgb";
      texture.generateMipmaps = true;
      image.addEventListener("load", () => {
        texture.needsUpdate = true;
        texturesLoaded++;
        refreshAssetDataset();
      }, { once: true });
      image.addEventListener("error", () => {
        textureFailures++;
        refreshAssetDataset();
      }, { once: true });
      image.src = url;
      textureCache.set(url, texture);
      return texture;
    };

    const makeTexturedPlane = (url, width, height, tint = 0xffffff) => {
      const geometry = new THREE.PlaneGeometry(width, height);
      const material = new THREE.MeshBasicMaterial({
        color: tint,
        map: getTexture(url),
        transparent: true,
        alphaTest: 0.04,
        depthWrite: false,
        side: 2,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { ...mesh.userData, breachlineAssetPlane: true };
      return mesh;
    };

    const disposeAssetMesh = (mesh) => {
      if (!mesh) return;
      mesh.parent?.remove(mesh);
      mesh.traverse((part) => {
        part.geometry?.dispose?.();
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        for (const material of materials) {
          if (!material) continue;
          if (material.userData?.breachlineSharedAssetTexture || part.userData?.breachlineAssetPlane) {
            material.map = null;
          }
          material.dispose?.();
        }
      });
    };

    const createVisualRoot = (actor) => {
      const root = actor.mesh.clone(false);
      root.clear();
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      root.scale.set(1, 1, 1);
      root.visible = true;
      root.userData = { breachlineWeaponRoot: true };
      actor.mesh.add(root);
      actor._weaponVisualRoot = root;
      return root;
    };

    const clearWeaponRoot = (actor) => {
      const root = actor?._weaponVisualRoot;
      if (!root) return;
      const base = actor._weaponVisualBase;
      for (const child of [...root.children]) {
        root.remove(child);
        if (child === base) {
          actor.mesh.add(child);
          continue;
        }
        disposeAssetMesh(child);
      }
      actor.mesh.remove(root);
      actor._weaponVisualRoot = null;
      actor._assetRecoil = null;
    };

    const clearCharacterVisual = (actor) => {
      if (!actor) return;
      disposeAssetMesh(actor._characterOutline);
      disposeAssetMesh(actor._characterSprite);
      actor._characterOutline = null;
      actor._characterSprite = null;
      actor._assetCharacterId = null;
    };

    const resolveCharacterId = (actor) => {
      const requested = actor === game.player
        ? (actor.operatorId || game.activeOperatorId || game.selectedOperatorId)
        : (actor.operatorId || "soldier");
      return characterIds.has(requested) ? requested : "soldier";
    };

    const applyCharacterVisual = (actor) => {
      if (!actor?.mesh) return;
      const characterId = resolveCharacterId(actor);
      if (actor._assetCharacterId === characterId && actor._characterSprite) return;
      clearCharacterVisual(actor);
      const textureUrl = `${CHARACTER_ROOT}/${characterId}.png`;
      const offset = characterOffsets[characterId] || { x: 0, y: 0 };
      const outlineColor = teamOutlineColors[actor.team] || teamOutlineColors.player;
      const outline = makeTexturedPlane(textureUrl, 59, 59, outlineColor);
      outline.position.set(offset.x, offset.y, 10.4);
      outline.material.opacity = 0.94;
      outline.userData = {
        ...outline.userData,
        breachlineCharacterOutline: true,
        characterId,
        worldOffsetX: offset.x,
        worldOffsetY: offset.y,
      };
      const sprite = makeTexturedPlane(textureUrl, 55, 55, 0xffffff);
      sprite.position.set(offset.x, offset.y, 10.45);
      sprite.userData = {
        ...sprite.userData,
        breachlineCharacterSprite: true,
        characterId,
        worldOffsetX: offset.x,
        worldOffsetY: offset.y,
      };
      actor.mesh.add(outline, sprite);
      actor._characterOutline = outline;
      actor._characterSprite = sprite;
      actor._assetCharacterId = characterId;
      if (actor.body) actor.body.visible = false;
      if (actor.ring?.material?.color) {
        actor.ring.material.color.setHex(outlineColor);
        actor.ring.material.transparent = true;
        actor.ring.material.opacity = actor.team === "enemy" ? 0.74 : 0.78;
      }
    };

    const originalApplyWeaponVisual = game.applyWeaponVisual.bind(game);
    game.applyWeaponVisual = function applyAssetWeaponVisual(actor, requestedId = actor.weapon?.id || "rifle") {
      if (!actor?.mesh) return;
      clearWeaponRoot(actor);
      originalApplyWeaponVisual(actor, requestedId);
      applyCharacterVisual(actor);

      const id = actor._visualWeaponId || requestedId;
      const root = createVisualRoot(actor);
      const assetProfile = weaponProfiles[id];
      const base = actor._weaponVisualBase;

      if (assetProfile) {
        if (base) base.visible = false;
        for (const child of [...actor.mesh.children]) {
          if (!child.userData?.breachlineWeaponClone) continue;
          actor.mesh.remove(child);
          disposeAssetMesh(child);
        }
        assetProfile.forEach((item, index) => {
          const piece = makeTexturedPlane(`${WEAPON_ROOT}/${item.texture}`, item.width, item.height);
          piece.position.set(item.x, item.y, 11 + index * 0.04);
          piece.rotation.z = item.rotation || 0;
          piece.userData = {
            ...piece.userData,
            breachlineWeaponClone: true,
            breachlineWeaponPiece: true,
            breachlineAssetWeapon: true,
            breachlineBaseX: item.x,
            breachlineBaseY: item.y,
            breachlineBaseRotation: item.rotation || 0,
            breachlineGunSide: item.gunSide,
            breachlineHand: item.hand,
            breachlineNormalTextureUrl: `${WEAPON_ROOT}/${item.texture}`,
          };
          root.add(piece);
        });
      } else {
        const pieces = actor.mesh.children.filter((part) => (
          part === base || part.userData?.breachlineWeaponClone
        ));
        for (const piece of pieces) root.add(piece);
      }

      root.userData.weaponId = id;
      root.userData.baseScaleX = 1;
      root.userData.baseScaleY = 1;
      actor._visualWeaponId = id;
    };

    const applyGrenadeAsset = (grenade) => {
      if (!grenade?.mesh || grenade.mesh.userData?.breachlineAssetChecked) return;
      grenade.mesh.userData = { ...grenade.mesh.userData, breachlineAssetChecked: true };
      if (grenade.type !== "frag" && grenade.type !== "launcher") return;
      const tint = grenade.type === "launcher" ? 0xffbdf2 : 0xffe3bd;
      const plane = makeTexturedPlane(`${WEAPON_ROOT}/shell-grenade.png`, 17, 21, tint);
      plane.position.set(0, 0, 2.2);
      plane.userData = { ...plane.userData, breachlineGrenadeAsset: true };
      grenade.mesh.add(plane);
      grenade.mesh.material.transparent = true;
      grenade.mesh.material.opacity = 0.16;
      grenade.mesh.material.depthWrite = false;
    };

    const originalFire = game.fire.bind(game);
    game.fire = function fireWithSeparatedVisualRecoil(actor, direction) {
      const shotsBefore = actor.shots;
      originalFire(actor, direction);
      if (actor.shots <= shotsBefore) return;
      const weaponId = actor.weapon?.id || actor._visualWeaponId;
      const profile = recoilProfiles[weaponId];
      if (!profile || meleeWeaponIds.has(weaponId)) {
        actor._assetRecoil = null;
        if (actor._weaponVisualRoot) {
          actor._weaponVisualRoot.position.set(0, 0, 0);
          actor._weaponVisualRoot.rotation.z = 0;
        }
        if (actor === this.player) this.canvas.dataset.visualRecoilClass = "melee-none";
        return;
      }
      actor._assetRecoil = {
        startAt: this.now,
        endAt: this.now + profile.duration,
        distance: profile.distance,
        roll: (actor.shots % 2 ? -1 : 1) * profile.roll,
      };
      if (actor === this.player) this.canvas.dataset.visualRecoilClass = `firearm-${weaponId}`;
    };

    const updateCharacterTransform = (actor, rotateWithActor) => {
      const parentAngle = actor.mesh.rotation.z;
      const inverseAngle = -parentAngle;
      const cos = Math.cos(inverseAngle);
      const sin = Math.sin(inverseAngle);
      for (const visual of [actor._characterOutline, actor._characterSprite]) {
        if (!visual) continue;
        const offsetX = visual.userData.worldOffsetX || 0;
        const offsetY = visual.userData.worldOffsetY || 0;
        if (rotateWithActor) {
          visual.position.x = offsetX;
          visual.position.y = offsetY;
          visual.rotation.z = 0;
        } else {
          // actor.mesh keeps tracking aim for its weapon. Applying the inverse
          // transform here leaves the character art fixed in world space.
          visual.position.x = offsetX * cos - offsetY * sin;
          visual.position.y = offsetX * sin + offsetY * cos;
          visual.rotation.z = inverseAngle;
        }
      }
    };

    const updateTeamIdentification = (actor) => {
      if (!actor.ring?.material?.color) return;
      const statusOwnsRing = (actor.slowUntil || 0) > game.now || (
        actor === game.player && (
          game._operatorDash?.kind === "hunter"
          || (game.activeOperatorId === "sentinel" && (
            game._revealUntil > game.now || game._railChargeStartedAt !== null
          ))
        )
      );
      if (statusOwnsRing) return;
      actor.ring.material.color.setHex(teamOutlineColors[actor.team] || teamOutlineColors.player);
      actor.ring.material.transparent = true;
      actor.ring.material.opacity = actor.team === "enemy" ? 0.74 : 0.78;
    };

    const updateGunKataPose = (actor, active) => {
      if (actor._visualWeaponId !== "dual_pistols") return;
      const pieces = actor._weaponVisualRoot?.children?.filter((piece) => piece.userData?.breachlineAssetWeapon) || [];
      if (active) {
        const pistolLeftTexture = getTexture(`${WEAPON_ROOT}/pistol-l.png`);
        for (const [index, piece] of pieces.entries()) {
          const side = piece.userData.breachlineGunSide || (index ? 1 : -1);
          piece.userData.breachlineGunSide = side;
          piece.userData.breachlineGunKataHand = side < 0 ? "left" : "right";
          if (piece.material?.map !== pistolLeftTexture) {
            piece.material.map = pistolLeftTexture;
            piece.material.needsUpdate = true;
          }
          // Two copies of PistolL are held away from the body during the spin:
          // 왼손 총은 전방(0°), 오른손 총은 180° 회전해 두 총구가 서로 반대
          // 방향(양 방향)을 향한다.
          piece.rotation.z = side < 0 ? 0 : Math.PI;
        }
      } else if (actor._gunKataAssetPose) {
        for (const piece of pieces) {
          const normalUrl = piece.userData.breachlineNormalTextureUrl;
          if (!normalUrl || !piece.material) continue;
          piece.material.map = getTexture(normalUrl);
          piece.material.needsUpdate = true;
          piece.rotation.z = piece.userData.breachlineBaseRotation || 0;
          delete piece.userData.breachlineGunKataHand;
        }
      }
      actor._gunKataAssetPose = active;
      if (actor === game.player) game.canvas.dataset.gunKataAssetPose = active ? "dual-pistol-l-spin" : "idle";
    };

    const updateActorVisual = (actor) => {
      applyCharacterVisual(actor);
      const gunKataActive = (actor === game.player && game._operatorDash?.kind === "gunslinger")
        || actor._remoteGunKataActive;
      updateCharacterTransform(actor, gunKataActive);
      updateTeamIdentification(actor);
      updateGunKataPose(actor, gunKataActive);
      const root = actor._weaponVisualRoot;
      if (!root) return;

      root.scale.x = Math.abs(root.userData.baseScaleX || 1);
      root.scale.y = Math.abs(root.userData.baseScaleY || 1);
      root.userData.facingHemisphere = Math.cos(actor.dir) < 0 ? "left" : "right";

      if (gunKataActive) {
        actor._assetRecoil = null;
        root.position.set(0, 0, 0);
        root.rotation.z = 0;
        return;
      }

      const recoil = actor._assetRecoil;
      if (!recoil || game.now >= recoil.endAt || meleeWeaponIds.has(actor.weapon?.id)) {
        actor._assetRecoil = null;
        root.position.set(0, 0, 0);
        root.rotation.z = 0;
        return;
      }
      const progress = Math.max(0, Math.min(1, (game.now - recoil.startAt) / Math.max(0.001, recoil.endAt - recoil.startAt)));
      const impulse = Math.sin(progress * Math.PI) * (1 - progress * 0.22);
      root.position.set(0, -recoil.distance * impulse, 0);
      root.rotation.z = recoil.roll * impulse;
    };

    const updateGrenadeVisuals = (dt) => {
      for (const grenade of game.grenades) {
        applyGrenadeAsset(grenade);
        const speed = grenade.type === "flash" ? 9 : grenade.type === "smoke" ? 5 : 12;
        grenade.mesh.rotation.z += speed * dt;
      }
    };

    const originalDamageActor = game.damageActor.bind(game);
    game.damageActor = function damageWithSpriteFeedback(source, target, amount) {
      const hpBefore = target.hp;
      originalDamageActor(source, target, amount);
      if (target.hp >= hpBefore || !target._characterSprite?.material?.color) return;
      target._assetPulseUntil = this.now + 0.09;
      target._characterSprite.material.color.setHex(0xff6f72);
    };

    const originalStep = game.step.bind(game);
    game.step = function stepAssetVisuals(dt) {
      originalStep(dt);
      updateActorVisual(this.player);
      for (const bot of this.bots) updateActorVisual(bot);
      updateGrenadeVisuals(dt);
      for (const actor of [this.player, ...this.bots]) {
        if (!actor._characterSprite?.material?.color || this.now < (actor._assetPulseUntil || 0)) continue;
        actor._characterSprite.material.color.setHex(0xffffff);
      }
      this.canvas.dataset.assetWeaponRoot = String(Boolean(this.player._weaponVisualRoot));
      this.canvas.dataset.weaponMirrored = String(Boolean(
        this.player._weaponVisualRoot && (
          this.player._weaponVisualRoot.scale.x < 0 || this.player._weaponVisualRoot.scale.y < 0
        )
      ));
    };

    const originalResetRound = game.resetRound.bind(game);
    game.resetRound = function resetAssetVisuals(...args) {
      originalResetRound(...args);
      for (const actor of [this.player, ...this.bots]) {
        actor._assetPulseUntil = 0;
        actor._gunKataAssetPose = false;
        if (actor._characterSprite?.material?.color) actor._characterSprite.material.color.setHex(0xffffff);
      }
      this.applyWeaponVisual(this.player, this.player.weapon.id);
      for (const bot of this.bots) this.applyWeaponVisual(bot, bot.weapon.id);
      this.canvas.dataset.gunKataAssetPose = "idle";
    };

    const originalRender = game.render.bind(game);
    game.render = function renderWithAssetMetrics() {
      originalRender();
      this.canvas.dataset.assetTextureCache = String(textureCache.size);
      this.canvas.dataset.rendererGeometries = String(this.renderer.info.memory.geometries);
      this.canvas.dataset.rendererTextures = String(this.renderer.info.memory.textures);
      this.canvas.dataset.rendererDrawCalls = String(this.renderer.info.render.calls);
    };

    game.applyWeaponVisual(game.player, game.player.weapon.id);
    for (const bot of game.bots) game.applyWeaponVisual(bot, bot.weapon.id);
    game.assetTextureCache = textureCache;
    game.canvas.dataset.assetCharacters = [...characterIds].join(",");
    game.canvas.dataset.assetWeaponProfiles = Object.keys(weaponProfiles).join(",");
    game.canvas.dataset.meleeVisualRecoil = "disabled";
    game.canvas.dataset.characterAimRotation = "weapon-only";
    game.canvas.dataset.teamOutlineStyle = "blue-red-silhouette-rim";
    refreshAssetDataset();
  };

  installAssetVisuals();
})();
