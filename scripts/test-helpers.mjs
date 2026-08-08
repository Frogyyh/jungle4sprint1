/* test-helpers.mjs — 브라우저 패치 스크립트용 테스트 하니스.
   실제 game.js(미니파이드 번들) 대신 window.__breachline 목 객체를 세우고,
   vm 샌드박스 안에서 balance/operators/map-data/quality-pass/operator-system/
   multiplayer-client/lobby-bridge 를 game.html 과 같은 순서로 로드한다.
   브라우저 전역(window/document/location/sessionStorage/WebSocket)은 최소한의
   페이크로 대체한다. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- 기하 (three.js Vector3 대체) ---------------- */

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z ?? this.z;
    return this;
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  copy(other) {
    this.x = other.x;
    this.y = other.y;
    this.z = other.z;
    return this;
  }

  add(other) {
    return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  sub(other) {
    return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  multiplyScalar(scalar) {
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  normalize() {
    const length = this.length() || 1;
    return new Vector3(this.x / length, this.y / length, this.z / length);
  }

  length() {
    return Math.hypot(this.x, this.y, this.z);
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  distanceTo(other) {
    return this.sub(other).length();
  }

  distanceToSquared(other) {
    return this.sub(other).lengthSq();
  }

  lerp(target, alpha) {
    this.x += (target.x - this.x) * alpha;
    this.y += (target.y - this.y) * alpha;
    this.z += (target.z - this.z) * alpha;
    return this;
  }

  setScalar(scalar) {
    this.x = scalar;
    this.y = scalar;
    this.z = scalar;
    return this;
  }
}

/* ---------------- 브라우저 페이크 ---------------- */

export function makeClassList() {
  const names = new Set();
  return {
    add: (...items) => items.forEach((item) => names.add(item)),
    remove: (...items) => items.forEach((item) => names.delete(item)),
    toggle(name, force) {
      const on = force === undefined ? !names.has(name) : Boolean(force);
      if (on) names.add(name);
      else names.delete(name);
      return on;
    },
    contains: (name) => names.has(name),
    _names: names,
  };
}

export function makeElement() {
  const element = {
    dataset: Object.create(null),
    style: {
      setProperty(name, value) {
        element.style[name] = value;
      },
      removeProperty(name) {
        delete element.style[name];
      },
    },
    className: "",
    innerHTML: "",
    textContent: "",
    children: [],
    parent: null,
    classList: makeClassList(),
    listeners: Object.create(null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, handler) {
      (element.listeners[type] ||= []).push(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of element.listeners[type] || []) handler(event);
    },
    appendChild(child) {
      element.children.push(child);
      child.parent = element;
      return child;
    },
    append(...children) {
      for (const child of children) element.appendChild(child);
    },
    remove() {
      if (!element.parent) return;
      const index = element.parent.children.indexOf(element);
      if (index >= 0) element.parent.children.splice(index, 1);
      element.parent = null;
    },
    replaceChildren(...children) {
      element.children = children;
      for (const child of children) child.parent = element;
    },
    closest: () => null,
    getAttribute(name) {
      return element.dataset[name];
    },
    setAttribute(name, value) {
      element.dataset[name] = String(value);
    },
    removeAttribute(name) {
      delete element.dataset[name];
    },
  };
  return element;
}

export function makeDocument() {
  const registry = new Map();
  const querySelector = (selector) => {
    if (!registry.has(selector)) registry.set(selector, makeElement());
    return registry.get(selector);
  };
  return {
    querySelector,
    querySelectorAll: () => [],
    getElementById: (id) => querySelector(`#${id}`),
    createElement: () => makeElement(),
    addEventListener() {},
    removeEventListener() {},
    body: { dataset: Object.create(null) },
    documentElement: { classList: makeClassList() },
    _registry: registry,
  };
}

export function makeFakeWebSocket() {
  return class FakeWebSocket {
    static OPEN = 1;
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      this.sent = [];
      this.listeners = Object.create(null);
      FakeWebSocket.instances.push(this);
    }

    addEventListener(type, handler) {
      (this.listeners[type] ||= []).push(handler);
    }

    send(payload) {
      this.sent.push(payload);
    }

    close() {
      this.readyState = 3;
    }

    dispatch(type, event) {
      for (const handler of this.listeners[type] || []) handler(event);
    }
  };
}

export function createSandbox(options = {}) {
  const { search = "" } = options;
  const session = new Map();
  const url = new URL(`https://breachline.test/game.html${search}`);
  const WebSocket = options.WebSocket || makeFakeWebSocket();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    performance,
    URL,
    URLSearchParams,
    WebSocket,
    document: makeDocument(),
    location: {
      href: url.href,
      search: url.search,
      protocol: url.protocol,
      host: url.host,
      pathname: url.pathname,
      origin: url.origin,
    },
    sessionStorage: {
      getItem: (key) => (session.has(key) ? session.get(key) : null),
      setItem: (key, value) => session.set(key, String(value)),
      removeItem: (key) => session.delete(key),
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    BREACHLINE_THREE: {
      Mesh: function Mesh(geometry, material) {
        const mesh = makeMesh();
        mesh.geometry = geometry;
        mesh.material = material;
        return mesh;
      },
      MeshBasicMaterial: function MeshBasicMaterial(options) {
        return { ...options, color: { set() {}, setHex() {} }, dispose() {} };
      },
      PlaneGeometry: function PlaneGeometry(width, height) {
        const geometry = makeGeometry();
        geometry.parameters = { width, height };
        return geometry;
      },
    },
  };
  const context = vm.createContext(sandbox);
  context.window = context;
  return context;
}

export function loadScript(context, filename) {
  const source = fs.readFileSync(path.join(ROOT, filename), "utf8");
  vm.runInContext(source, context, { filename });
}

export const GAME_CHAIN = [
  "balance.js",
  "operators.js",
  "map-data.js",
  "shared-utils.js",
  "quality-pass.js",
  "operator-system.js",
];

export function loadGameChain(context) {
  for (const filename of GAME_CHAIN) loadScript(context, filename);
}

/* game.html 순서와 동일하게 __breachline 을 먼저 세우고 체인을 로드한다.
   각 스크립트는 로드 시점에 game 이 있어야 패치를 설치한다. */
export function makeGameContext(options = {}) {
  const context = createSandbox(options);
  context.__breachline = makeGame();
  return { context, game: context.__breachline };
}

/* ---------------- three.js 오브젝트 페이크 ---------------- */

function BufferAttribute(array, itemSize) {
  return { array, itemSize, constructor: BufferAttribute, userData: Object.create(null) };
}

export function makeMaterial() {
  return {
    color: {
      set() {},
      setHex() {},
      getHex() {
        return 0;
      },
    },
    transparent: false,
    opacity: 1,
    depthWrite: true,
    clone() {
      return makeMaterial();
    },
    dispose() {},
  };
}

export function makeGeometry() {
  const geometry = {
    parameters: { width: 2600, height: 1800 },
    userData: Object.create(null),
    _attributes: Object.create(null),
    dispose() {},
    clone() {
      return makeGeometry();
    },
    setAttribute(name, attribute) {
      geometry._attributes[name] = attribute;
    },
    getAttribute(name) {
      return geometry._attributes[name] || { array: new Float64Array(0), constructor: BufferAttribute };
    },
  };
  geometry.constructor = makeGeometry;
  return geometry;
}

export function makeMesh() {
  const mesh = {
    position: new Vector3(),
    rotation: {
      z: 0,
      copy(other) {
        mesh.rotation.z = other.z;
        return mesh.rotation;
      },
    },
    scale: new Vector3(1, 1, 1),
    userData: Object.create(null),
    material: makeMaterial(),
    geometry: makeGeometry(),
    parent: null,
    visible: true,
    children: [],
    traverse(visit) {
      visit(this);
    },
    add(child) {
      mesh.children.push(child);
      child.parent = mesh;
      return mesh;
    },
    remove(child) {
      const index = mesh.children.indexOf(child);
      if (index >= 0) mesh.children.splice(index, 1);
    },
    clone() {
      return makeMesh();
    },
  };
  return mesh;
}

export function makeGroup() {
  const group = {
    children: [],
    visible: true,
    add(child) {
      group.children.push(child);
      child.parent = group;
      return group;
    },
    remove(child) {
      const index = group.children.indexOf(child);
      if (index >= 0) group.children.splice(index, 1);
    },
    traverse(visit) {
      for (const child of group.children) {
        visit(child);
        child.traverse?.(visit);
      }
    },
  };
  group.constructor = makeGroup;
  return group;
}

/* ---------------- 게임 목 객체 ---------------- */

export function makeActor(id, x, y, team = "enemy") {
  return {
    id,
    team,
    x,
    y,
    pos: new Vector3(x, y, 0),
    dir: 0,
    hp: 100,
    maxHp: 100,
    radius: 18,
    alive: true,
    weapon: { id: "rifle", name: "ASSAULT RIFLE", magSize: 30, reserve: 9999, rpm: 420, reload: 2.5 },
    ammo: 30,
    reserve: 9999,
    shots: 0,
    hits: 0,
    kills: 0,
    nextShotAt: 0,
    reloadUntil: 0,
    lastDamageAt: -Infinity,
    fragGrenades: 0,
    flashGrenades: 0,
    smokeGrenades: 0,
    slowUntil: 0,
    mesh: makeMesh(),
    body: makeMesh(),
    ring: { material: makeMaterial() },
    _damageDealt: 0,
    syncMesh() {},
  };
}

export function makeBotClass() {
  return class Bot {
    constructor(id, position, weapon) {
      this.id = id;
      this.pos = position;
      this.dir = 0;
      this.team = "enemy";
      this.hp = 100;
      this.maxHp = 100;
      this.radius = 18;
      this.alive = true;
      this.weapon = weapon || { id: "rifle", magSize: 30, reserve: 9999 };
      this.ammo = this.weapon.magSize;
      this.reserve = this.weapon.reserve;
      this.shots = 0;
      this.hits = 0;
      this.kills = 0;
      this.mesh = makeMesh();
      this.body = makeMesh();
      this.ring = { material: makeMaterial() };
      this._targetPos = this.pos.clone();
      this._targetDir = 0;
      this._damageDealt = 0;
    }

    syncMesh() {}
  };
}

export function makeGame() {
  const player = makeActor("player", 0, 0, "player");
  const game = {
    now: 0,
    elapsed: 0,
    phase: "playing",
    player,
    bots: [],
    projectiles: [],
    grenades: [],
    smokes: [],
    walls: [],
    _mapDecorationMeshes: [],
    camera: {
      left: -960,
      right: 960,
      top: 640,
      bottom: -640,
      position: new Vector3(0, 0, 1000),
      updateProjectionMatrix() {},
    },
    scene: { background: { set() {} } },
    renderer: {
      info: { memory: {}, render: {} },
      render() {},
    },
    canvas: {
      dataset: Object.create(null),
      addEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }),
    },
    floor: makeMesh(),
    fxGroup: makeGroup(),
    entityGroup: makeGroup(),
    worldGroup: makeGroup(),
    projectileGroup: makeGroup(),
    visibilityGroup: makeGroup(),
    visibilityMesh: { geometry: makeGeometry() },
    visibilityDirty: false,
    mouse: { world: new Vector3(300, 0, 0), down: false },
    keys: new Set(),
    selectedOperatorId: null,
    activeOperatorId: null,
    viewScale: 1,
    step() {},
    render() {},
    renderUi() {},
    damageActor(source, target, amount) {
      target.hp = Math.max(0, target.hp - amount);
    },
    isVisible() {
      game._isVisibleCalls = (game._isVisibleCalls || 0) + 1;
      return true;
    },
    traceVision(from, direction, distance) {
      return from.clone().add(direction.clone().normalize().multiplyScalar(distance));
    },
    updateVisibility() {},
    updateCameraFrustum() {},
    startRound() {
      game.phase = "playing";
    },
    resetRound() {
      game.phase = "playing";
    },
    endRound() {
      game.phase = "result";
    },
    updateBots() {},
    moveBot() {},
    moveActor() {},
    updatePlayer() {},
    updateCamera() {},
    updateGrenades() {},
    fire() {},
    spawnProjectile(source, position, direction, weapon) {
      const projectile = {
        source,
        pos: position.clone(),
        damage: weapon?.damage || 0,
        _prevPos: position.clone(),
      };
      game.projectiles.push(projectile);
      return projectile;
    },
    removeProjectile(index) {
      game.projectiles.splice(index, 1);
    },
    explode() {},
    throwGrenade() {},
    updateSmokes() {},
    updateProjectiles() {},
    reload(actor) {
      actor.ammo = actor.weapon.magSize;
    },
    showToast(message) {
      (game._toasts ||= []).push(message);
    },
    rayBlocked: () => false,
    smokeBlocks: () => false,
    isInsideSmoke: () => false,
    updateMouseWorld() {},
    applyWeaponVisual(actor, weaponId) {
      actor._appliedWeaponVisual = weaponId;
    },
    clearGadget() {},
    damageSummon() {},
    showDamageDirection() {},
    togglePause() {},
    getTeamCounts: () => null,
  };
  return game;
}
