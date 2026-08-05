(() => {
  const params = new URLSearchParams(location.search);
  const launchedFromLobby = params.get("lobby") === "1";
  const characterId = params.get("character") || "vulcan";
  const nickname = params.get("nickname") || "PLAYER";
  const mapId = params.get("map") || "crossroads";

  const weaponByCharacter = {
    vulcan: "rifle", buckshot: "shotgun", wasp: "smg", frog: "frog",
    gemini: "smg", bulwark: "rifle", longshot: "rifle", edge: "shotgun",
    shade: "smg", mortar: "shotgun",
  };
  const characterNames = {
    vulcan: "VULCAN", buckshot: "BUCKSHOT", wasp: "WASP", frog: "FROG",
    gemini: "GEMINI", bulwark: "BULWARK", longshot: "LONGSHOT", edge: "EDGE",
    shade: "SHADE", mortar: "MORTAR",
  };

  function addLobbyButton() {
    const result = document.querySelector("#result-screen");
    if (!result || document.querySelector("#lobby-return-button")) return;
    const button = document.createElement("button");
    button.id = "lobby-return-button";
    button.className = "primary-button lobby-return-button";
    button.type = "button";
    button.textContent = "로비로 돌아가기";
    button.addEventListener("click", () => { location.href = "./ui/rooms.html"; });
    result.appendChild(button);
  }

  function install() {
    const game = window.__breachline;
    if (!game) {
      requestAnimationFrame(install);
      return;
    }

    addLobbyButton();
    document.body.dataset.lobbyCharacter = characterId;
    document.body.dataset.lobbyMap = mapId;
    if (!launchedFromLobby) return;

    const weapon = weaponByCharacter[characterId] || "rifle";
    game.selectedWeapon = weapon;
    document.querySelectorAll("[data-weapon]").forEach((card) => {
      card.classList.toggle("selected", card.dataset.weapon === weapon);
    });
    game.startRound();
    const characterName = characterNames[characterId] || "VULCAN";
    setTimeout(() => game.showToast(`${nickname} · ${characterName} READY`), 50);
  }

  install();
})();
