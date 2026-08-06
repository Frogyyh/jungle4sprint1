/* ui/landing-page.js — ui/index.html 닉네임 입력 화면 */
import { getNickname, setNickname, validateNickname } from "./store.js";

const form = document.getElementById("nickname-form");
const input = document.getElementById("nickname");
const error = document.getElementById("nickname-error");

// 뒤로 돌아온 경우 이전 닉네임을 되살린다.
input.value = getNickname();

input.addEventListener("input", () => {
  error.textContent = "";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = validateNickname(input.value);
  if (!result.ok) {
    error.textContent = result.message;
    input.focus();
    return;
  }
  setNickname(result.value);
  location.href = "rooms.html";
});
