import { CONTROLS, requireNickname, toast, validatePassword } from "./store.js";
import { createOnlineRoom, joinOnlineRoom, listRooms } from "./multiplayer-api.js";

const nickname = requireNickname();
if (!nickname) throw new Error("닉네임이 필요합니다.");
document.getElementById("my-nickname").textContent = nickname;

const controlsList = document.getElementById("controls-list");
for (const [key, action] of CONTROLS) {
  const li = document.createElement("li");
  li.innerHTML = `<b></b><span></span>`;
  li.querySelector("b").textContent = key;
  li.querySelector("span").textContent = action;
  controlsList.appendChild(li);
}

const listEl = document.getElementById("room-list");
const countEl = document.getElementById("room-count");
let rooms = [];
let pendingRoomId = null;

function render() {
  countEl.textContent = rooms.length;
  listEl.innerHTML = "";
  if (!rooms.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = '<div class="mark">◎</div><div>열려 있는 방이 없습니다.<br />새 방을 만들어 보세요.</div>';
    listEl.appendChild(empty);
    return;
  }
  for (const room of rooms) {
    const full = room.playerCount >= room.capacity || room.status !== "lobby";
    const row = document.createElement("button");
    row.type = "button";
    row.className = full ? "room-row full" : "room-row";
    row.dataset.id = room.id;
    row.disabled = full;
    const title = document.createElement("div");
    title.className = "title";
    if (room.locked) {
      const lock = document.createElement("span");
      lock.className = "lock"; lock.textContent = "🔒"; title.appendChild(lock);
    }
    const name = document.createElement("span");
    name.className = "room-title"; name.textContent = room.title;
    const join = document.createElement("span");
    join.className = "join-label"; join.textContent = full ? "게임 중 / 참가 불가" : "방 참가하기";
    title.append(name, join);
    const host = document.createElement("div");
    host.className = "host"; host.innerHTML = "방장 <b></b>"; host.querySelector("b").textContent = room.host;
    const count = document.createElement("div");
    count.className = "count"; count.textContent = `${room.playerCount} / ${room.capacity}`;
    row.append(title, host, count);
    listEl.appendChild(row);
  }
}

async function refresh(showToast = false) {
  try {
    rooms = await listRooms();
    render();
    if (showToast) toast("온라인 방 목록을 새로고침했습니다.");
  } catch (error) {
    toast(`서버 연결 실패: ${error.message}`, 4000);
  }
}

async function enterRoom(roomId, password = "") {
  try {
    await joinOnlineRoom(roomId, { nickname, password });
    location.href = `room.html?id=${encodeURIComponent(roomId)}`;
  } catch (error) {
    toast(error.message, 3500);
    await refresh();
  }
}

listEl.addEventListener("click", (event) => {
  const row = event.target.closest(".room-row");
  if (!row || row.disabled) return;
  const room = rooms.find((item) => item.id === row.dataset.id);
  if (!room) return refresh();
  if (room.locked) {
    pendingRoomId = room.id;
    document.getElementById("pw-room-title").textContent = room.title;
    document.getElementById("pw-input").value = "";
    document.getElementById("pw-error").textContent = "";
    document.getElementById("pw-modal").classList.remove("hidden");
    document.getElementById("pw-input").focus();
  } else enterRoom(room.id);
});

document.getElementById("refresh").addEventListener("click", () => refresh(true));
document.getElementById("change-nickname").addEventListener("click", () => { location.href = "index.html"; });

const modal = document.getElementById("create-modal");
const form = document.getElementById("create-form");
const titleInput = document.getElementById("room-title");
const passwordInput = document.getElementById("room-password");
const capacityGroup = document.getElementById("room-capacity");
const closeCreate = () => modal.classList.add("hidden");
document.getElementById("create-room").addEventListener("click", () => {
  modal.classList.remove("hidden"); titleInput.value = ""; passwordInput.value = ""; titleInput.focus();
});
document.getElementById("create-cancel").addEventListener("click", closeCreate);
capacityGroup.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-capacity]");
  if (!button) return;
  [...capacityGroup.children].forEach((item) => item.classList.toggle("selected", item === button));
});
for (const input of [passwordInput, document.getElementById("pw-input")]) {
  input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 4); });
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const password = validatePassword(passwordInput.value);
  const error = document.getElementById("create-error");
  if (!title) return void (error.textContent = "방 제목을 입력하세요.");
  if (!password.ok) return void (error.textContent = password.message);
  try {
    const capacity = Number(capacityGroup.querySelector(".selected").dataset.capacity);
    const room = await createOnlineRoom({ title, nickname, capacity, password: password.value });
    location.href = `room.html?id=${encodeURIComponent(room.id)}`;
  } catch (reason) { error.textContent = reason.message; }
});

const pwModal = document.getElementById("pw-modal");
const closePassword = () => { pwModal.classList.add("hidden"); pendingRoomId = null; };
document.getElementById("pw-cancel").addEventListener("click", closePassword);
document.getElementById("pw-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = pendingRoomId; const password = document.getElementById("pw-input").value;
  closePassword(); if (id) enterRoom(id, password);
});
for (const backdrop of [modal, pwModal]) backdrop.addEventListener("click", (event) => {
  if (event.target === backdrop) backdrop.classList.add("hidden");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { closeCreate(); closePassword(); }
});

refresh();
setInterval(refresh, 5000);
