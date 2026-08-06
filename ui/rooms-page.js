/* ui/rooms-page.js — ui/rooms.html 방 목록 화면 로직 */
import {
  CONTROLS,
  checkPassword,
  createRoom,
  findRoom,
  hasPassword,
  joinRoom,
  loadRooms,
  playerCount,
  requireNickname,
  toast,
  validatePassword,
} from "./store.js";

const nickname = requireNickname();
if (nickname) {
  document.getElementById("my-nickname").textContent = nickname;
}

const controlsList = document.getElementById("controls-list");
for (const [key, action] of CONTROLS) {
  const li = document.createElement("li");
  const b = document.createElement("b");
  b.textContent = key;
  const span = document.createElement("span");
  span.textContent = action;
  li.append(b, span);
  controlsList.appendChild(li);
}

const listEl = document.getElementById("room-list");
const countEl = document.getElementById("room-count");

function render() {
  const rooms = loadRooms();
  countEl.textContent = rooms.length;
  listEl.innerHTML = "";

  if (rooms.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML =
      '<div class="mark">✦</div><div>열려 있는 방이 없습니다<br />왼쪽 아래에서 방을 만들어 보세요</div>';
    listEl.appendChild(empty);
    return;
  }

  for (const room of rooms) {
    const players = playerCount(room);
    const full = players >= room.capacity;
    const row = document.createElement("button");
    row.type = "button";
    row.className = full ? "room-row full" : "room-row";
    row.dataset.id = room.id;
    if (full) row.disabled = true;

    const title = document.createElement("div");
    title.className = "title";
    if (hasPassword(room)) {
      const lock = document.createElement("span");
      lock.className = "lock";
      lock.textContent = "🔒";
      lock.title = "비밀번호가 있는 방";
      title.appendChild(lock);
    }
    const name = document.createElement("span");
    name.className = "room-title";
    name.textContent = room.title;
    const join = document.createElement("span");
    join.className = "join-label";
    join.textContent = hasPassword(room) ? "🔒 방 참여하기" : "▶ 방 참여하기";
    title.append(name, join);

    const host = document.createElement("div");
    host.className = "host";
    host.innerHTML = "방장 <b></b>";
    host.querySelector("b").textContent = room.host;

    const count = document.createElement("div");
    count.className = "count";
    count.innerHTML =
      '<span class="now"></span><span class="slash">/</span><span class="cap"></span>';
    count.querySelector(".now").textContent = players;
    count.querySelector(".cap").textContent = room.capacity;

    row.append(title, host, count);
    listEl.appendChild(row);
  }
}

/** 참여 처리. 잠긴 방이면 비밀번호를 먼저 확인한다. */
function enterRoom(roomId) {
  const room = joinRoom(roomId, nickname);
  if (!room) {
    toast("정원이 가득 찬 방입니다.");
    render();
    return;
  }
  location.href = `room.html?id=${encodeURIComponent(room.id)}`;
}

listEl.addEventListener("click", (event) => {
  const row = event.target.closest(".room-row");
  if (!row || row.disabled) return;

  const room = findRoom(row.dataset.id);
  if (!room) {
    render();
    return;
  }
  if (hasPassword(room)) {
    openPasswordModal(room);
    return;
  }
  enterRoom(room.id);
});

document.getElementById("refresh").addEventListener("click", () => {
  render();
  toast("방 목록을 새로고침했습니다.");
});

document.getElementById("change-nickname").addEventListener("click", () => {
  location.href = "index.html";
});

/* ---------- 방 만들기 모달 ---------- */

const modal = document.getElementById("create-modal");
const createForm = document.getElementById("create-form");
const titleInput = document.getElementById("room-title");
const createError = document.getElementById("create-error");
const passwordInput = document.getElementById("room-password");
const capacityGroup = document.getElementById("room-capacity");

/** 숫자만 남긴다. */
const digitsOnly = (input) => {
  input.value = input.value.replace(/\D/g, "").slice(0, 4);
};

function openModal() {
  modal.classList.remove("hidden");
  createError.textContent = "";
  titleInput.value = "";
  passwordInput.value = "";
  titleInput.focus();
}

function closeModal() {
  modal.classList.add("hidden");
}

document.getElementById("create-room").addEventListener("click", openModal);
document.getElementById("create-cancel").addEventListener("click", closeModal);

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeModal();
  closePasswordModal();
});

capacityGroup.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-capacity]");
  if (!button) return;
  for (const b of capacityGroup.children) b.classList.remove("selected");
  button.classList.add("selected");
});

titleInput.addEventListener("input", () => {
  createError.textContent = "";
});

passwordInput.addEventListener("input", () => {
  digitsOnly(passwordInput);
  createError.textContent = "";
});

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) {
    createError.textContent = "방 제목을 입력하세요.";
    titleInput.focus();
    return;
  }
  // 비워두면 공개방, 적으면 숫자 4자리여야 한다.
  const password = validatePassword(passwordInput.value);
  if (!password.ok) {
    createError.textContent = password.message;
    passwordInput.focus();
    return;
  }
  const capacity = Number(
    capacityGroup.querySelector(".selected").dataset.capacity
  );
  const room = createRoom({
    title,
    host: nickname,
    capacity,
    password: password.value,
  });
  closeModal();
  // 방을 만든 사람은 곧바로 방 안(방장)으로 들어간다.
  joinRoom(room.id, nickname);
  location.href = `room.html?id=${encodeURIComponent(room.id)}`;
});

/* ---------- 잠긴 방 비밀번호 입력 ---------- */

const pwModal = document.getElementById("pw-modal");
const pwForm = document.getElementById("pw-form");
const pwInput = document.getElementById("pw-input");
const pwError = document.getElementById("pw-error");
let pendingRoomId = null;

function openPasswordModal(room) {
  pendingRoomId = room.id;
  document.getElementById("pw-room-title").textContent = room.title;
  pwInput.value = "";
  pwError.textContent = "";
  pwModal.classList.remove("hidden");
  pwInput.focus();
}

function closePasswordModal() {
  pwModal.classList.add("hidden");
  pendingRoomId = null;
}

pwInput.addEventListener("input", () => {
  digitsOnly(pwInput);
  pwError.textContent = "";
});

pwForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const room = findRoom(pendingRoomId);
  if (!room) {
    closePasswordModal();
    render();
    return;
  }
  if (!checkPassword(room, pwInput.value)) {
    pwError.textContent = "비밀번호가 맞지 않습니다.";
    pwInput.value = "";
    pwInput.focus();
    return;
  }
  const id = room.id;
  closePasswordModal();
  enterRoom(id);
});

document.getElementById("pw-cancel").addEventListener("click", closePasswordModal);

pwModal.addEventListener("click", (event) => {
  if (event.target === pwModal) closePasswordModal();
});

render();
