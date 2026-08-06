import { CHARACTERS, MAPS, characterPortrait, findCharacter, findMap, mapPreview } from "./data.js";
import { requireNickname, toast } from "./store.js";
import { clearSession, connectRoom, getOnlineRoom, getSession, sendAction } from "./multiplayer-api.js";

const me = requireNickname();
const roomId = new URLSearchParams(location.search).get("id");
const session = getSession(roomId);
if (!me || !roomId || !session) {
  location.replace("rooms.html");
  throw new Error("온라인 방 세션이 없습니다.");
}

const el = (id) => document.getElementById(id);
let room = null;
let socket = null;
let picked = null;
let kickTarget = null;
const mine = () => room?.members.find((member) => member.id === session.playerId);
const isHost = () => room?.hostId === session.playerId;
const perTeam = () => (room?.capacity || 2) / 2;
const allReady = () => room?.members.length > 1 && room.members.filter((m) => m.id !== room.hostId).every((m) => m.ready);
const bothTeamsPresent = () => new Set(room?.members.map((member) => member.team)).size === 2;
const canStart = () => allReady() && bothTeamsPresent();

function renderSlots() {
  for (const team of ["A", "B"]) {
    const box = el(`slots-${team.toLowerCase()}`);
    box.innerHTML = "";
    const members = room.members.filter((member) => member.team === team);
    for (let index = 0; index < perTeam(); index += 1) {
      const member = members[index];
      if (!member) {
        // 빈 자리: 방장은 눌러서 봇을 채울 수 있다. 봇은 게임 중 방장 화면이 조종한다.
        if (isHost()) {
          const add = document.createElement("button");
          add.type = "button";
          add.className = "slot empty";
          add.textContent = "＋ 봇 추가";
          add.addEventListener("click", () => sendAction(socket, "addbot"));
          box.appendChild(add);
        } else {
          const empty = document.createElement("div");
          empty.className = "slot empty"; empty.textContent = "온라인 참가자 대기 중";
          box.appendChild(empty);
        }
        continue;
      }
      const slot = document.createElement("div");
      slot.className = member.id === session.playerId ? "slot me" : "slot";
      const portrait = document.createElement("div");
      const character = findCharacter(member.characterId);
      portrait.className = character ? "slot-portrait" : "slot-portrait none";
      portrait.innerHTML = character ? characterPortrait(character, 38) : "?";
      const info = document.createElement("div");
      info.className = "slot-info";
      const name = document.createElement("div");
      name.className = "slot-name"; name.textContent = member.name;
      if (member.id === room.hostId) {
        const tag = document.createElement("span"); tag.className = "host-tag"; tag.textContent = "방장"; name.appendChild(tag);
      }
      if (member.bot) {
        const tag = document.createElement("span"); tag.className = "bot-tag"; tag.textContent = "BOT"; name.appendChild(tag);
      }
      const char = document.createElement("div");
      char.className = "slot-char"; char.textContent = character ? `${character.name} · ${character.role}` : "캐릭터 미선택";
      info.append(name, char);
      const ready = document.createElement("div");
      ready.className = member.id === room.hostId || member.ready ? "slot-ready on" : "slot-ready off";
      ready.textContent = member.id === room.hostId ? "HOST" : member.ready ? "READY" : "WAIT";
      slot.append(portrait, info, ready);
      if (isHost() && member.id !== room.hostId) {
        const kick = document.createElement("button");
        kick.type = "button"; kick.className = "slot-kick"; kick.textContent = "내보내기";
        kick.addEventListener("click", () => openKick(member));
        slot.appendChild(kick);
      }
      box.appendChild(slot);
    }
  }
  document.querySelectorAll(".team-join").forEach((button) => {
    const team = button.dataset.team;
    button.disabled = mine()?.team === team || room.members.filter((m) => m.team === team).length >= perTeam();
  });
}

function renderMap() {
  const map = findMap(room.mapId);
  el("map-preview").innerHTML = mapPreview(map);
  el("map-name").textContent = map.name;
  el("map-sub").textContent = map.subtitle;
  el("map-desc").textContent = map.desc;
  el("open-map").disabled = !isHost();
  el("open-map").textContent = isHost() ? "맵 선택" : "맵 선택 (방장만 가능)";
}

function renderFooter() {
  const action = el("action-button");
  if (isHost()) {
    action.textContent = "게임 시작"; action.disabled = !canStart(); action.classList.remove("ready-on");
    el("foot-hint").textContent = !bothTeamsPresent() ? "A팀과 B팀에 최소 한 명씩 필요합니다." : canStart() ? "전원 준비 완료 — 시작할 수 있습니다." : "참가자가 모두 준비하면 시작할 수 있습니다.";
  } else {
    action.textContent = mine()?.ready ? "준비 완료" : "준비";
    action.disabled = false; action.classList.toggle("ready-on", Boolean(mine()?.ready));
    el("foot-hint").textContent = mine()?.ready ? "방장이 게임을 시작하기를 기다리는 중입니다." : "캐릭터 선택 후 준비를 눌러주세요.";
  }
}

function render() {
  if (!room) return;
  el("room-title").textContent = room.title;
  el("room-host").textContent = room.host;
  el("room-count").textContent = `${room.members.length}/${room.capacity}`;
  el("my-name").textContent = me;
  el("room-pw").classList.toggle("hidden", !room.locked);
  el("room-pw").textContent = room.locked ? "🔒 비공개 방" : "";
  el("add-test").classList.add("hidden");
  renderSlots(); renderMap(); renderFooter();
}

function startUrl(nextRoom = room) {
  const player = nextRoom.members.find((member) => member.id === session.playerId);
  const params = new URLSearchParams({
    multiplayer: "1", room: roomId, nickname: me,
    character: player?.characterId || "soldier", map: nextRoom.mapId,
  });
  return `../game.html?${params}`;
}

function handleMessage(message) {
  if (message.room) { room = message.room; render(); }
  if (message.type === "start") location.href = startUrl(message.room);
  if (message.type === "room" && !message.room.members.some((m) => m.id === session.playerId)) {
    clearSession(); alert("방에서 나가졌습니다."); location.replace("rooms.html");
  }
}

document.querySelectorAll(".team-join").forEach((button) => button.addEventListener("click", () => sendAction(socket, "team", button.dataset.team)));
el("leave").addEventListener("click", () => { socket?.close(1000, "leave"); clearSession(); location.href = "rooms.html"; });
el("action-button").addEventListener("click", () => {
  if (isHost()) { if (canStart()) sendAction(socket, "start"); }
  else sendAction(socket, "ready", !mine()?.ready);
});

const kickModal = el("kick-modal");
function openKick(member) {
  kickTarget = member;
  const who = document.createElement("span"); who.className = "kick-name"; who.textContent = member.name;
  el("kick-message").replaceChildren(who, " 님을 정말 내보내겠습니까?");
  kickModal.classList.remove("hidden");
}
const closeKick = () => { kickTarget = null; kickModal.classList.add("hidden"); };
el("kick-cancel").addEventListener("click", closeKick);
el("kick-confirm").addEventListener("click", () => { if (kickTarget) sendAction(socket, "kick", kickTarget.id); closeKick(); });

const charModal = el("char-modal");
const charRow = el("char-row");
function showCharacterList() {
  charRow.innerHTML = ""; el("char-detail").classList.add("hidden"); el("char-back").classList.add("hidden");
  for (const character of CHARACTERS) {
    const card = document.createElement("button");
    card.type = "button"; card.className = picked === character.id ? "char-card picked" : "char-card";
    card.style.setProperty("--accent", character.color); card.dataset.id = character.id;
    card.innerHTML = `${characterPortrait(character, 58)}<span class="cname">${character.name}</span><span class="ckorean">${character.koreanName}</span><span class="crole">${character.role}</span>`;
    charRow.appendChild(card);
  }
  charRow.classList.remove("hidden");
}
charRow.addEventListener("click", (event) => {
  const card = event.target.closest(".char-card"); if (!card) return;
  picked = card.dataset.id; const character = findCharacter(picked);
  el("char-detail").innerHTML = `<div class="detail-portrait">${characterPortrait(character, 150)}</div><div class="detail-body"><h3>${character.name} <small>${character.koreanName}</small></h3><div class="detail-tags"><span class="tag">${character.role}</span><span class="tag weapon">${character.weapon}</span></div><p class="detail-desc">${character.desc}</p><ul class="detail-traits">${character.traits.map((trait) => `<li>${trait}</li>`).join("")}</ul></div>`;
  charRow.classList.add("hidden"); el("char-detail").classList.remove("hidden"); el("char-back").classList.remove("hidden"); el("char-confirm").disabled = false;
});
el("char-back").addEventListener("click", showCharacterList);
el("open-char").addEventListener("click", () => { picked = mine()?.characterId || null; el("char-confirm").disabled = !picked; showCharacterList(); charModal.classList.remove("hidden"); });
el("char-cancel").addEventListener("click", () => charModal.classList.add("hidden"));
el("char-confirm").addEventListener("click", () => { if (picked) sendAction(socket, "character", picked); charModal.classList.add("hidden"); });

const mapModal = el("map-modal");
el("open-map").addEventListener("click", () => {
  if (!isHost()) return;
  const box = el("map-choices"); box.innerHTML = "";
  for (const map of MAPS) {
    const choice = document.createElement("button"); choice.type = "button"; choice.className = room.mapId === map.id ? "map-choice picked" : "map-choice"; choice.dataset.id = map.id;
    choice.innerHTML = `${mapPreview(map, 220)}<span class="mc-name">${map.name}</span><span class="mc-sub">${map.subtitle}</span>`;
    box.appendChild(choice);
  }
  mapModal.classList.remove("hidden");
});
el("map-choices").addEventListener("click", (event) => { const choice = event.target.closest(".map-choice"); if (choice) { sendAction(socket, "map", choice.dataset.id); mapModal.classList.add("hidden"); } });
el("map-cancel").addEventListener("click", () => mapModal.classList.add("hidden"));
for (const modal of [charModal, mapModal, kickModal]) modal.addEventListener("click", (event) => { if (event.target === modal) modal.classList.add("hidden"); });

try {
  room = (await getOnlineRoom(roomId)).room;
  render();
  socket = connectRoom(roomId, {
    message: handleMessage,
    close: (event) => { if (event.code === 4003) { clearSession(); alert("방장에 의해 퇴장되었습니다."); location.replace("rooms.html"); } else if (!location.pathname.endsWith("game.html")) toast("실시간 서버 연결이 끊겼습니다.", 4000); },
    error: () => toast("실시간 서버 연결에 실패했습니다.", 4000),
  });
} catch (error) {
  alert(error.message); location.replace("rooms.html");
}
