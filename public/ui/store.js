/* Breachline UI 화면에서 공유하는 입력 검증과 표시 도우미. */

const NICKNAME_KEY = "breachline.nickname";

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;
export const PASSWORD_LENGTH = 4;

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

export function requireNickname() {
  const name = getNickname();
  if (!name) {
    location.replace("index.html");
    return null;
  }
  return name;
}

export function validatePassword(raw) {
  const password = (raw || "").trim();
  if (!password) return { ok: true, value: null };
  if (!new RegExp(`^\\d{${PASSWORD_LENGTH}}$`).test(password)) {
    return { ok: false, message: `비밀번호는 숫자 ${PASSWORD_LENGTH}자리여야 합니다.` };
  }
  return { ok: true, value: password };
}

export const CONTROLS = [
  ["WASD", "이동"],
  ["마우스", "조준"],
  ["좌클릭", "기본 공격"],
  ["우클릭", "특수 공격"],
  ["SPACE", "특수 능력"],
  ["2", "군인 섬광탄"],
  ["R", "재장전"],
];

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
