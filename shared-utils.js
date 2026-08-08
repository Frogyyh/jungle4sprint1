/* shared-utils.js — 패치 체인 공용 유틸 모듈.
   game.html 에서 map-data.js 직후, 패치 스크립트(quality-pass 등) 이전에 로드되어
   window.BREACHLINE_UTIL 로 노출된다. game.js 코어 번들에는 접근하지 않으므로
   목 테스트 환경에서도 그대로 로드할 수 있다.

   포함 항목:
   - 순수 수학 헬퍼: clamp / angleDelta / easeSwing / segmentCircleHit / cameraHalfExtents
   - 지연 평가 벡터: vec·vector (game.player.pos.constructor 를 호출 시점에 읽는다)
   - 패치 체인 래핑: wrap(game, name, handler) — 게임 메서드에 패치를 덧씌운다
   - fx 프리미티브 풀: createFxPool(game) — 스트립/마커 메시 생성·배치·해제의 단일 구현 */
(() => {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  const easeSwing = (progress) => (
    progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
  );

  /* 세그먼트-원 충돌 판정. 코어 _p 는 투사체가 히트박스 내부에서 생성되면(근거리
     점사) 놓치는 결함이 있어, 보정 패스에서 이 함수로 재검사한다. */
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

  const cameraHalfExtents = (camera) => ({
    halfWidth: (camera.right - camera.left) / 2,
    halfHeight: (camera.top - camera.bottom) / 2,
  });

  /* vec·vector 는 game.player.pos.constructor 를 지연 평가하므로
     게임 초기화 후 호출 시점에만 참조한다(정의 시점 참조 없음). */
  const vec = (x = 0, y = 0) => new (window.__breachline).player.pos.constructor(x, y);
  const vector = vec;

  /* 게임 메서드에 패치를 덧씌운다. handler 는 (original, ctx, args) 를 받고
     original 은 이전 패치(또는 코어)가 game 에 바인딩된 상태다.
     등록 순서 = 래핑 순서이므로, 로드 순서에 따라 동일하게 겹겹이 쌓인다. */
  const wrap = (obj, name, handler) => {
    const previous = obj[name].bind(obj);
    obj[name] = function (...args) {
      return handler(previous, this, args);
    };
  };

  /* 스트립/마커 프리미티브의 단일 구현. 로컬(operator-system)과 원격
     (multiplayer-client)이 같은 풀을 써서 모양이 어긋나지 않게 한다. */
  const createFxPool = (game) => {
    const strip = (color, opacity = 0.9) => {
      const mesh = game.floor.clone(false);
      mesh.geometry = game.floor.geometry.clone();
      mesh.material = game.floor.material.clone();
      mesh.material.color.setHex(color);
      mesh.material.transparent = true;
      mesh.material.depthWrite = false;
      mesh.material.opacity = opacity;
      game.fxGroup.add(mesh);
      return mesh;
    };

    const place = (mesh, from, to, width, z = 23) => {
      const parameters = game.floor.geometry?.parameters || {};
      const baseWidth = parameters.width || 2600;
      const baseHeight = parameters.height || 1800;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.max(0.01, Math.hypot(dx, dy));
      mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, z);
      mesh.rotation.z = Math.atan2(dy, dx);
      mesh.scale.set(length / baseWidth, width / baseHeight, 1);
    };

    const dispose = (mesh) => {
      mesh?.parent?.remove(mesh);
      mesh?.geometry?.dispose?.();
      mesh?.material?.dispose?.();
    };

    const marker = (color, scale = 0.45, opacity = 0.8) => {
      const mesh = game.player.body.clone(false);
      mesh.geometry = game.player.body.geometry.clone();
      mesh.material = game.player.body.material.clone();
      mesh.material.color.setHex(color);
      mesh.material.transparent = true;
      mesh.material.depthWrite = false;
      mesh.material.opacity = opacity;
      mesh.scale.setScalar(scale);
      return mesh;
    };

    return { strip, place, dispose, marker };
  };

  window.BREACHLINE_UTIL = Object.freeze({
    clamp,
    angleDelta,
    easeSwing,
    segmentCircleHit,
    cameraHalfExtents,
    TRAP_RING_SEGMENTS: 20,
    vec,
    vector,
    wrap,
    createFxPool,
  });
})();
