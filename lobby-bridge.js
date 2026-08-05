(() => {
  const params = new URLSearchParams(location.search);
  const launchedFromLobby = params.get("lobby") === "1";
  const characterId = window.resolveBreachlineOperatorId(params.get("character") || "soldier");
  const nickname = params.get("nickname") || "PLAYER";
  const mapId = params.get("map") || "crossroads";

  const operator = window.findBreachlineOperator(characterId);

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

    game.selectedOperatorId = operator.id;
    game.selectedWeapon = operator.baseWeapon;
    document.querySelectorAll("[data-operator]").forEach((card) => {
      card.classList.toggle("selected", card.dataset.operator === operator.id);
    });
    game.startRound();
    setTimeout(() => game.showToast(`${nickname} · ${operator.name} READY`), 50);
  }

  install();
})();
