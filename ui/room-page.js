/* ui/room-page.js — ui/room.html 방 상세 화면 로직 */
import {
  CHARACTERS,
  MAPS,
  characterPortrait,
  findCharacter,
  findMap,
  mapPreview,
} from "./data.js";
import {
  TEAMS,
  addTestMember,
  allGuestsReady,
  findMember,
  findRoom,
  getJoinedRoomId,
  hasPassword,
  isHost,
  joinRoom,
  kickMember,
  leaveRoom,
  playerCount,
  requireNickname,
  setCharacter,
  setMap,
  setReady,
  startGame,
  switchTeam,
  toast,
} from "./store.js";

const me = requireNickname();
if (!me) throw new Error("no nickname");

const roomId = new URLSearchParams(location.search).get("id") || getJoinedRoomId();
if (!roomId || !findRoom(roomId)) {
  location.replace("rooms.html");
  throw new Error("no room");
}
// 주소로 바로 들어온 경우에도 참여 처리를 해 둔다.
// 잠긴 방은 방 목록에서 비밀번호를 확인하고 들어와야 한다.
const entering = findRoom(roomId);
if (hasPassword(entering) && !findMember(entering, me)) {
  alert("비밀번호가 있는 방입니다. 방 목록에서 참여해 주세요.");
  location.replace("rooms.html");
  throw new Error("locked room");
}
if (!joinRoom(roomId, me)) {
  alert("정원이 가득 찬 방입니다.");
  location.replace("rooms.html");
  throw new Error("room full");
}

const el = (id) => document.getElementById(id);
const perTeam = () => Math.floor(findRoom(roomId).capacity / TEAMS.length);

/* ---------------- 렌더 ---------------- */

function renderSlots(room) {
  for (const team of TEAMS) {
    const box = el(`slots-${team.toLowerCase()}`);
    box.innerHTML = "";
    const members = room.members.filter((m) => m.team === team);

    for (let i = 0; i < perTeam(); i += 1) {
      const m = members[i];

      // 빈 자리를 누르면 그 팀에 테스트 봇이 들어온다.
      if (!m) {
        const empty = document.createElement("button");
        empty.type = "button";
        empty.className = "slot empty";
        empty.textContent = "＋ 봇 추가";
        empty.addEventListener("click", () => addBot(team));
        box.appendChild(empty);
        continue;
      }

      const slot = document.createElement("div");
      slot.className = m.name === me ? "slot me" : "slot";

      const portrait = document.createElement("div");
      const character = m.characterId ? findCharacter(m.characterId) : null;
      if (character) {
        portrait.className = "slot-portrait";
        portrait.innerHTML = characterPortrait(character, 38);
      } else {
        portrait.className = "slot-portrait none";
        portrait.textContent = "?";
      }

      const info = document.createElement("div");
      info.className = "slot-info";
      const nameRow = document.createElement("div");
      nameRow.className = "slot-name";
      const nameText = document.createElement("span");
      nameText.textContent = m.name;
      nameRow.appendChild(nameText);
      if (isHost(room, m.name)) {
        const tag = document.createElement("span");
        tag.className = "host-tag";
        tag.textContent = "방장";
        nameRow.appendChild(tag);
      }
      const charLine = document.createElement("div");
      charLine.className = "slot-char";
      charLine.textContent = character
        ? `${character.name} · ${character.role}`
        : "캐릭터 미선택";
      info.append(nameRow, charLine);

      const ready = document.createElement("div");
      // 방장은 준비 대상이 아니다.
      if (isHost(room, m.name)) {
        ready.className = "slot-ready off";
        ready.textContent = "HOST";
      } else {
        ready.className = m.ready ? "slot-ready on" : "slot-ready off";
        ready.textContent = m.ready ? "READY" : "WAIT";
      }

      slot.append(portrait, info, ready);

      // 내보내기. 방장만, 방장 자신은 대상이 아니다.
      const canKick = isHost(room, me) && !isHost(room, m.name);
      if (canKick) {
        slot.classList.add("kickable");
        slot.title = `READY 표시에 1초 동안 마우스를 올려두면 내보내기가 나타납니다`;

        /* READY 위에 1초 머물면 그 자리에 내보내기 버튼이 나온다.
           지나가다 스치는 것으로는 뜨지 않게 하려고 시간을 둔다. */
        const kick = document.createElement("button");
        kick.type = "button";
        kick.className = "slot-kick hidden";
        kick.textContent = "내보내기";
        kick.addEventListener("click", () => askKick(m.name));
        slot.appendChild(kick);

        let holdTimer = null;
        const resetHold = () => {
          clearTimeout(holdTimer);
          holdTimer = null;
          ready.classList.remove("holding");
          ready.classList.remove("hidden");
          kick.classList.add("hidden");
        };
        ready.addEventListener("mouseenter", () => {
          if (holdTimer) return;
          ready.classList.add("holding");
          holdTimer = setTimeout(() => {
            holdTimer = null; // 다 찼다 — 아래 mouseleave 가 되돌리지 않게 비운다
            ready.classList.remove("holding");
            ready.classList.add("hidden");
            kick.classList.remove("hidden");
          }, 1000);
        });
        // 1초를 채우기 전에 READY 를 벗어나면 처음부터 다시.
        ready.addEventListener("mouseleave", () => {
          if (holdTimer) resetHold();
        });
        // 자리 밖으로 나가면 원래대로. 버튼으로 옮겨 가는 동안은 유지된다.
        slot.addEventListener("mouseleave", resetHold);
      }
      slot.addEventListener("contextmenu", (event) => {
        event.preventDefault(); // 브라우저 기본 메뉴 대신 안내를 띄운다
        if (!canKick) {
          toast(
            isHost(room, m.name)
              ? "방장은 내보낼 수 없습니다."
              : "방장만 참여자를 내보낼 수 있습니다."
          );
          return;
        }
        askKick(m.name);
      });

      box.appendChild(slot);
    }
  }

  for (const button of document.querySelectorAll(".team-join")) {
    const team = button.dataset.team;
    const mine = findMember(room, me);
    const full = room.members.filter((m) => m.team === team).length >= perTeam();
    button.disabled = !mine || mine.team === team || full;
  }
}

function renderMap(room) {
  const map = findMap(room.mapId);
  el("map-preview").innerHTML = mapPreview(map);
  el("map-name").textContent = map.name;
  el("map-sub").textContent = map.subtitle;
  el("map-desc").textContent = map.desc;
  // 맵은 방장만 바꾼다.
  el("open-map").disabled = !isHost(room, me);
  el("open-map").textContent = isHost(room, me) ? "맵 선택" : "맵 선택 (방장만 가능)";
}

function renderFooter(room) {
  const mine = findMember(room, me);
  const host = isHost(room, me);
  const action = el("action-button");
  const hint = el("foot-hint");

  if (host) {
    const ready = allGuestsReady(room);
    action.textContent = "게임 시작";
    action.classList.remove("ready-on");
    // 방장 제외 전원이 준비해야 시작할 수 있다.
    action.disabled = !ready;
    hint.textContent = ready
      ? "전원 준비 완료 — 시작할 수 있습니다."
      : room.members.length < 2
        ? "참여자를 기다리는 중입니다."
        : "참여자가 모두 준비하면 시작할 수 있습니다.";
  } else {
    const on = Boolean(mine && mine.ready);
    action.textContent = on ? "준비 완료" : "준비";
    action.classList.toggle("ready-on", on);
    action.disabled = false;
    hint.textContent = on
      ? "방장이 시작하기를 기다리는 중입니다."
      : "준비를 누르면 방장이 게임을 시작할 수 있습니다.";
  }
}

function render() {
  const room = findRoom(roomId);
  if (!room) {
    location.replace("rooms.html");
    return;
  }
  el("room-title").textContent = room.title;
  el("room-host").textContent = room.host;
  el("room-count").textContent = `${playerCount(room)}/${room.capacity}`;
  el("my-name").textContent = me;
  const pw = el("room-pw");
  pw.classList.toggle("hidden", !hasPassword(room));
  if (hasPassword(room)) pw.textContent = `🔒 ${room.password}`;
  renderSlots(room);
  renderMap(room);
  renderFooter(room);
}

/* ---------------- 팀 이동 / 나가기 ---------------- */

for (const button of document.querySelectorAll(".team-join")) {
  button.addEventListener("click", () => {
    if (switchTeam(roomId, me, button.dataset.team)) {
      render();
    } else {
      toast("그 팀은 자리가 없습니다.");
    }
  });
}

// 테스트용: 서버 연동 시 이 블록과 버튼을 함께 지운다.
// team 을 주면 그 팀으로, 없으면 자리가 남은 팀으로 들어간다.
function addBot(team = null) {
  const pool = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
  const added = addTestMember(roomId, pool.id);
  if (!added) {
    toast("빈 자리가 없습니다.");
    return;
  }
  if (team && added.team !== team) {
    switchTeam(roomId, added.name, team);
    setReady(roomId, added.name, true); // 팀을 옮기면 준비가 풀린다
  }
  render();
  toast(`${added.name} 이(가) 참여했습니다. (테스트)`);
}

el("add-test").addEventListener("click", () => addBot());

el("leave").addEventListener("click", () => {
  leaveRoom(roomId, me);
  location.href = "rooms.html";
});

/* ---------------- 준비 / 시작 ---------------- */

el("action-button").addEventListener("click", () => {
  const room = findRoom(roomId);
  if (isHost(room, me)) {
    if (!allGuestsReady(room)) return;
    toast("작전을 시작합니다.");
    setTimeout(startGame, 600);
    return;
  }
  const mine = findMember(room, me);
  setReady(roomId, me, !mine.ready);
  render();
});

/* ---------------- 내보내기 확인 팝업 ---------------- */

const kickModal = el("kick-modal");
let kickTarget = null;

/* confirm() 대신 화면 가운데 팝업으로 묻는다. */
function askKick(name) {
  kickTarget = name;
  // 닉네임은 사용자가 지은 문자열이라 텍스트 노드로 넣는다.
  const who = document.createElement("span");
  who.className = "kick-name";
  who.textContent = name;
  el("kick-message").replaceChildren(who, " 님을 정말 내보내겠습니까?");
  kickModal.classList.remove("hidden");
  el("kick-confirm").focus();
}

function closeKickModal() {
  kickTarget = null;
  kickModal.classList.add("hidden");
}

el("kick-cancel").addEventListener("click", closeKickModal);

el("kick-confirm").addEventListener("click", () => {
  const name = kickTarget;
  closeKickModal();
  if (name && kickMember(roomId, me, name)) {
    render();
    toast(`${name} 을(를) 내보냈습니다.`);
  }
});

/* ---------------- 캐릭터 선택 팝업 ---------------- */

const charModal = el("char-modal");
const charRow = el("char-row");
const charDetail = el("char-detail");
const charBack = el("char-back");
const charConfirm = el("char-confirm");
let picked = null;

function renderRow() {
  charRow.innerHTML = "";
  for (const character of CHARACTERS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = picked === character.id ? "char-card picked" : "char-card";
    card.style.setProperty("--accent", character.color);
    card.dataset.id = character.id;
    card.innerHTML = `${characterPortrait(character, 58)}
      <span class="cname">${character.name}</span>
      <span class="ckorean">${character.koreanName}</span>
      <span class="crole">${character.role}</span>`;
    charRow.appendChild(card);
  }
}

function renderDetail(character) {
  charDetail.style.setProperty("--accent", character.color);
  const stats = Object.entries(character.stats)
    .map(
      ([label, value]) => `
      <div class="stat-row">
        <span>${label}</span>
        <span class="pips">${Array.from(
          { length: 5 },
          (_, i) => `<i class="${i < value ? "on" : ""}"></i>`
        ).join("")}</span>
      </div>`
    )
    .join("");

  charDetail.innerHTML = `
    <div class="detail-portrait">
      ${characterPortrait(character, 150)}
      <div class="tagline">“${character.tagline}”</div>
    </div>
    <div class="detail-body">
      <h3>${character.name} <small>${character.koreanName}</small></h3>
      <div class="detail-tags">
        <span class="tag">${character.role}</span>
        <span class="tag weapon">${character.weapon}</span>
        ${character.implemented ? '<span class="tag built">게임 구현 완료</span>' : ""}
      </div>
      <p class="detail-desc">${character.desc}</p>
      <div class="detail-stats">${stats}</div>
      <ul class="detail-traits">
        ${character.traits.map((t) => `<li>${t}</li>`).join("")}
      </ul>
    </div>`;
}

/* 캐릭터를 고르면 목록은 감추고 왼쪽 이미지 · 오른쪽 설명만 남는다. */
function showDetail(id) {
  picked = id;
  renderDetail(findCharacter(id));
  charRow.classList.add("hidden");
  charDetail.classList.remove("hidden");
  charBack.classList.remove("hidden");
  charConfirm.disabled = false;
}

function showList() {
  renderRow();
  charRow.classList.remove("hidden");
  charDetail.classList.add("hidden");
  charBack.classList.add("hidden");
}

charRow.addEventListener("click", (event) => {
  const card = event.target.closest(".char-card");
  if (card) showDetail(card.dataset.id);
});

charBack.addEventListener("click", showList);

/* 이미 캐릭터를 골랐더라도 항상 10인 목록부터 연다 —
   다시 열었을 때 상세만 보이면 다른 캐릭터로 바꿀 길이 한 단계 멀어진다.
   고른 캐릭터는 목록에서 강조(picked)로 남는다. */
function openCharModal() {
  const mine = findMember(findRoom(roomId), me);
  picked = mine?.characterId
    ? window.resolveBreachlineOperatorId(mine.characterId)
    : null;
  charConfirm.disabled = !picked;
  showList();
  charModal.classList.remove("hidden");
}

function closeCharModal() {
  charModal.classList.add("hidden");
}

el("open-char").addEventListener("click", openCharModal);
el("char-cancel").addEventListener("click", closeCharModal);

charConfirm.addEventListener("click", () => {
  if (!picked) return;
  setCharacter(roomId, me, picked);
  closeCharModal();
  render();
  toast(`${findCharacter(picked).name} 을(를) 선택했습니다.`);
});

/* ---------------- 맵 선택 팝업 ---------------- */

const mapModal = el("map-modal");

function renderMapChoices() {
  const room = findRoom(roomId);
  const box = el("map-choices");
  box.innerHTML = "";
  for (const map of MAPS) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = room.mapId === map.id ? "map-choice picked" : "map-choice";
    choice.dataset.id = map.id;
    choice.innerHTML = `${mapPreview(map, 220)}
      <span class="mc-name">${map.name}</span>
      <span class="mc-sub">${map.subtitle}</span>`;
    box.appendChild(choice);
  }
}

el("open-map").addEventListener("click", () => {
  if (!isHost(findRoom(roomId), me)) return;
  renderMapChoices();
  mapModal.classList.remove("hidden");
});

el("map-choices").addEventListener("click", (event) => {
  const choice = event.target.closest(".map-choice");
  if (!choice) return;
  setMap(roomId, choice.dataset.id);
  mapModal.classList.add("hidden");
  render();
  toast(`맵을 ${findMap(choice.dataset.id).name} 으로 바꿨습니다.`);
});

el("map-cancel").addEventListener("click", () => mapModal.classList.add("hidden"));

/* 배경 클릭 · Esc 로 팝업 닫기 */
for (const modal of [charModal, mapModal, kickModal]) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      if (modal === kickModal) closeKickModal();
      else modal.classList.add("hidden");
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  charModal.classList.add("hidden");
  mapModal.classList.add("hidden");
  closeKickModal();
});

render();
