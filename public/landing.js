/* landing.js — index.html 닉네임 입력 화면 */
import { getNickname, setNickname, validateNickname } from "./ui/store.js";

const form = document.querySelector("#nickname-form");
const input = document.querySelector("#nickname-input");
const error = document.querySelector("#nickname-error");
input.value = getNickname();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = validateNickname(input.value);

  if (!result.ok) {
    error.textContent = result.message;
    input.focus();
    return;
  }

  setNickname(result.value);
  location.href = "./ui/rooms.html";
});

input.addEventListener("input", () => {
  error.textContent = "";
});
