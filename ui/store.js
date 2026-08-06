/* Breachline UI — 화면 사이에서 공유하는 상태 + 방 목록 목업.
   백엔드가 붙기 전까지 sessionStorage 를 저장소로 쓴다.
   서버가 생기면 loadRooms / createRoom / joinRoom / updateRoom 만
   fetch 로 바꾸면 나머지 화면 코드는 그대로 둘 수 있다. */

const NICKNAME_KEY = "breachline.nickname";
const ROOMS_KEY = "breachline.rooms";
const JOINED_KEY = "breachline.joinedRoom";

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;
export const TEAMS = ["A", "B"];

/* ---------------- 닉네임 ---------------- */

/** 닉네임 규칙: 2~12자, 한글/영문/숫자/밑줄만. */
export function validateNickname(raw) {
  const name = (raw || "").trim();
  if (!name) return { ok: false, message: "닉네임을 입력하세요." };
  if (name.length < NICKNAME_MIN || name.length > NICKNAME_MAX) {
    return { ok: false, message: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자여야 합니다.` };
  }
  if (!/^[가-힣a-zA-Z0-9_]+$/.test(name)) {
    return { ok: false, message: "한글·영문·숫자·밑줄(_)만 쓸 수 있습니다." };
  }
  return { ok: true, value: name };
}

export function getNickname() {
  return sessionStorage.getItem(NICKNAME_KEY) || "";
}

export function setNickname(name) {
  sessionStorage.setItem(NICKNAME_KEY, name);
}

/** 닉네임 없이 들어온 화면을 시작 페이지로 돌려보낸다. */
export function requireNickname() {
  const name = getNickname();
  if (!name) {
    location.replace("index.html");
    return null;
  }
  return name;
}

/* ---------------- 방 ---------------- */

const member = (name, team, ready = false, characterId = null) => ({
  name,
  team,
  ready,
  characterId,
});

/* 방 목록은 비어 있는 상태에서 시작한다. 목업 방은 두지 않는다 —
   실제로 만든 방만 보여야 목록·정원·비밀번호 흐름을 그대로 확인할 수 있다. */
export function loadRooms() {
  const raw = sessionStorage.getItem(ROOMS_KEY);
  if (!raw) {
    sessionStorage.setItem(ROOMS_KEY, "[]");
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRooms(rooms) {
  sessionStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
}

export function playerCount(room) {
  return room.members.length;
}

export function findRoom(id) {
  return loadRooms().find((room) => room.id === id) || null;
}

/** 방 하나를 고쳐서 저장한다. mutator 가 false 를 돌려주면 저장하지 않는다. */
export function updateRoom(id, mutator) {
  const rooms = loadRooms();
  const room = rooms.find((r) => r.id === id);
  if (!room) return null;
  if (mutator(room) === false) return room;
  saveRooms(rooms);
  return room;
}

/* ---- 방 비밀번호 (숫자 4자리, 없으면 공개방) ---- */

export const PASSWORD_LENGTH = 4;

/** 빈 값이면 공개방으로 통과시킨다. 값이 있으면 숫자 4자리여야 한다. */
export function validatePassword(raw) {
  const password = (raw || "").trim();
  if (!password) return { ok: true, value: null };
  if (!new RegExp(`^\\d{${PASSWORD_LENGTH}}$`).test(password)) {
    return { ok: false, message: `비밀번호는 숫자 ${PASSWORD_LENGTH}자리여야 합니다.` };
  }
  return { ok: true, value: password };
}

export const hasPassword = (room) => Boolean(room && room.password);

export const checkPassword = (room, input) =>
  !hasPassword(room) || room.password === (input || "").trim();

/* 같은 밀리초에 방을 두 개 만들면 Date.now() 만으로는 id 가 겹친다.
   새로고침해도 겹치지 않도록 무작위 꼬리를 붙이고, 기존 방과 대조한다. */
function nextRoomId(rooms) {
  let id;
  do {
    id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (rooms.some((room) => room.id === id));
  return id;
}

/** 방 만들기. 만든 사람이 방장이자 A팀 첫 참여자다. */
export function createRoom({ title, host, capacity, password = null }) {
  const rooms = loadRooms();
  const room = {
    id: nextRoomId(rooms),
    title,
    host,
    capacity,
    password,
    mapId: "crossroads",
    members: [member(host, "A")],
  };
  rooms.unshift(room);
  saveRooms(rooms);
  return room;
}

/** 자리가 남은 팀. 둘 다 차 있으면 null. */
function openTeam(room) {
  const perTeam = Math.floor(room.capacity / TEAMS.length);
  return (
    TEAMS.find((team) => room.members.filter((m) => m.team === team).length < perTeam) || null
  );
}

/** 참여 성공 시 room 을, 정원이 찼으면 null 을 돌려준다. 이미 있으면 그대로 통과. */
export function joinRoom(id, name) {
  const rooms = loadRooms();
  const room = rooms.find((r) => r.id === id);
  if (!room) return null;

  if (!room.members.some((m) => m.name === name)) {
    if (room.members.length >= room.capacity) return null;
    const team = openTeam(room) || TEAMS[0];
    room.members.push(member(name, team));
    saveRooms(rooms);
  }
  sessionStorage.setItem(JOINED_KEY, room.id);
  return room;
}

export function leaveRoom(id, name) {
  updateRoom(id, (room) => {
    room.members = room.members.filter((m) => m.name !== name);
  });
  sessionStorage.removeItem(JOINED_KEY);
}

export function getJoinedRoomId() {
  return sessionStorage.getItem(JOINED_KEY);
}

export function getJoinedRoom() {
  const id = getJoinedRoomId();
  return id ? findRoom(id) : null;
}

/* ---------------- 방 내부 상태 ---------------- */

export const isHost = (room, name) => room.host === name;

export const findMember = (room, name) => room.members.find((m) => m.name === name) || null;

/** 방장을 뺀 참여자가 모두 준비했는가. 혼자면 시작할 수 없다. */
export function allGuestsReady(room) {
  const guests = room.members.filter((m) => m.name !== room.host);
  return guests.length > 0 && guests.every((m) => m.ready);
}

export function setReady(roomId, name, ready) {
  return updateRoom(roomId, (room) => {
    const m = findMember(room, name);
    if (!m) return false;
    m.ready = ready;
  });
}

export function setCharacter(roomId, name, characterId) {
  return updateRoom(roomId, (room) => {
    const m = findMember(room, name);
    if (!m) return false;
    m.characterId = characterId;
  });
}

export function setMap(roomId, mapId) {
  return updateRoom(roomId, (room) => {
    room.mapId = mapId;
  });
}

/** 팀 이동. 옮길 팀이 꽉 찼으면 false. */
export function switchTeam(roomId, name, team) {
  let moved = false;
  updateRoom(roomId, (room) => {
    const perTeam = Math.floor(room.capacity / TEAMS.length);
    const m = findMember(room, name);
    if (!m || m.team === team) return false;
    if (room.members.filter((x) => x.team === team).length >= perTeam) return false;
    m.team = team;
    m.ready = false; // 팀을 옮기면 준비 해제
    moved = true;
  });
  return moved;
}

/** 방장이 참여자를 내보낸다. 방장 자신은 내보낼 수 없다. */
export function kickMember(roomId, hostName, target) {
  let kicked = false;
  updateRoom(roomId, (room) => {
    if (!isHost(room, hostName)) return false;
    if (target === room.host || !findMember(room, target)) return false;
    room.members = room.members.filter((m) => m.name !== target);
    kicked = true;
  });
  return kicked;
}

/* 테스트용: 서버가 없어 혼자 접속하므로 준비/시작 흐름을 확인할 수 없다.
   빈 자리에 준비 완료된 더미 참여자를 하나 넣는다. 서버 연동 시 삭제할 것. */
const BOT_NAMES = ["탄창", "각도장인", "연막탄", "문지기", "코너캠퍼", "야시경"];

export function addTestMember(roomId, characterId = null) {
  let added = null;
  updateRoom(roomId, (room) => {
    if (room.members.length >= room.capacity) return false;
    const team = openTeam(room) || TEAMS[0];
    const name =
      BOT_NAMES.find((n) => !room.members.some((m) => m.name === n)) ||
      `게이머${room.members.length + 1}`;
    added = member(name, team, true, characterId);
    room.members.push(added);
  });
  return added;
}

/* ---------------- 게임 진입 ---------------- */

/** 로비 → 게임(루트 index.html). 게임 자체 로드아웃 화면에서 작전이 시작된다. */
export const GAME_URL = "../game.html";

export function startGame() {
  const room = getJoinedRoom();
  const nickname = getNickname();
  const player = room ? findMember(room, nickname) : null;
  const params = new URLSearchParams({ lobby: "1" });

  if (nickname) params.set("nickname", nickname);
  if (player?.characterId) params.set("character", player.characterId);
  if (room?.mapId) params.set("map", room.mapId);

  location.href = `${GAME_URL}?${params}`;
}

/** 게임의 현재 조작 체계. 병과 공통 입력을 기준으로 쓴다. */
export const CONTROLS = [
  ["WASD", "이동"],
  ["마우스", "조준"],
  ["좌클릭", "기본 공격"],
  ["우클릭", "특수 공격"],
  ["SPACE", "특수 능력"],
  ["2", "군인 섬광탄"],
  ["R", "재장전"],
];

/* ---------------- 공용 ---------------- */

/** 화면 하단에 잠깐 뜨는 알림. */
export function toast(message, duration = 2000) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), duration);
}
