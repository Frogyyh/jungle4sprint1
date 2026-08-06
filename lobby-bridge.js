/* lobby-bridge.js — 로비(ui/)와 게임(game.js) 사이를 잇는 층.
   game.html 에서 가장 마지막에 읽는다 — 앞선 패치들(quality-pass · operator-system ·
   asset-visuals · multiplayer-client)의 덧씌우기를 모두 감싸야 하기 때문이다.

   1) 로비가 주소로 넘긴 값(닉네임 · 병과 · 맵)으로 라운드를 시작한다.
   2) 라운드 결과창을 그린다 — 팀 승패 · 개인 전적(킬 → 딜량 → 명중률 순위) ·
      관전 / 방으로 / 로비로 버튼.

   전적의 출처는 두 갈래다.
   - 온라인(?multiplayer=1): 서버가 보내주는 room.members 가 정답이다.
     피격 판정과 승패를 서버가 확정하므로 화면은 그 값을 그대로 보여준다.
   - 오프라인(게임을 바로 연 경우): 코어의 액터(player · bots)에서 읽는다.
     코어는 딜량을 세지 않아 damageActor 를 감싸 직접 쌓는다. */
(() => {
  const params = new URLSearchParams(location.search);
  const multiplayer = params.get("multiplayer") === "1";
  const launchedFromLobby = params.get("lobby") === "1" || multiplayer;
  const characterId = window.resolveBreachlineOperatorId(params.get("character") || "soldier");
  const nickname = params.get("nickname") || "PLAYER";
  const mapId = params.get("map") || "crossroads";
  const roomId = params.get("room") || "";

  const operator = window.findBreachlineOperator(characterId);
  const $ = (selector) => document.querySelector(selector);

  const LOBBY_URL = "./ui/rooms.html";
  const roomUrl = () => (roomId ? `./ui/room.html?id=${encodeURIComponent(roomId)}` : LOBBY_URL);

  /* ---------------- 결과창 ---------------- */

  function installResultScreen(game) {
    const ui = {
      screen: $("#result-screen"),
      scoreboard: $("#scoreboard"),
      spectateBar: $("#spectate-bar"),
      spectateClose: $("#spectate-close"),
      room: $("#room-return-button"),
      lobby: $("#lobby-return-button"),
    };
    if (!ui.screen || !ui.scoreboard) return;

    // 오프라인 전용: 코어는 킬·발사·명중만 센다. 깎인 체력을 가해자에게 쌓아 딜량으로 쓴다.
    const originalDamageActor = game.damageActor.bind(game);
    game.damageActor = function countDamageDealt(source, target, amount) {
      const hpBefore = target.hp;
      originalDamageActor(source, target, amount);
      const dealt = hpBefore - target.hp;
      if (dealt > 0 && source) source._damageDealt = (source._damageDealt || 0) + dealt;
    };

    const originalResetRound = game.resetRound.bind(game);
    game.resetRound = function resetWithDamageTally(showLoadout = true) {
      originalResetRound(showLoadout);
      for (const actor of [this.player, ...this.bots]) actor._damageDealt = 0;
    };

    /* 화면에 그릴 한 줄. 온라인·오프라인 어느 쪽이든 이 모양으로 맞춰서 넘긴다.
       { name, team, kills, damage, accuracy, alive, mine, offline } */
    const onlineRows = () => {
      const room = window.__multiplayer?.room;
      if (!room?.members?.length) return null;
      const myId = window.__multiplayer.playerId;
      const myTeam = room.members.find((m) => m.id === myId)?.team || "A";
      return {
        winnerIsMine: room.winner ? room.winner === myTeam : null,
        myTeam,
        rows: room.members.map((member) => ({
          name: member.name,
          team: member.team,
          kills: member.kills || 0,
          damage: Math.round(member.damage || 0),
          accuracy: member.shots ? Math.min(100, Math.round((member.hits / member.shots) * 100)) : 0,
          alive: member.alive !== false,
          mine: member.id === myId,
          offline: member.connected === false,
        })),
      };
    };

    const offlineRows = () => {
      const actorName = (actor) => {
        if (actor === game.player) return nickname;
        const id = String(actor.id);
        return /^bot-\d+$/.test(id) ? `HOSTILE ${id.replace(/\D/g, "").padStart(2, "0")}` : id;
      };
      return {
        winnerIsMine: null,
        myTeam: "player",
        rows: [game.player, ...game.bots].map((actor) => ({
          name: actorName(actor),
          team: actor.team === "player" ? "player" : "enemy",
          kills: actor.kills || 0,
          damage: Math.round(actor._damageDealt || 0),
          accuracy: actor.shots ? Math.min(100, Math.round((actor.hits / actor.shots) * 100)) : 0,
          alive: actor.alive,
          mine: actor === game.player,
          offline: false,
        })),
      };
    };

    // 순위는 킬 → 딜량 → 명중률 순으로 가른다.
    const rank = (a, b) => b.kills - a.kills || b.damage - a.damage || b.accuracy - a.accuracy;

    const buildRow = (row, place) => {
      const line = document.createElement("div");
      line.className = row.mine ? "score-row me" : "score-row";
      if (!row.alive) line.classList.add("down");

      const rankCell = document.createElement("span");
      rankCell.className = "score-rank";
      rankCell.textContent = `${place}`;

      const name = document.createElement("span");
      name.className = "score-name";
      name.textContent = row.name;
      if (!row.alive) {
        const down = document.createElement("i");
        down.textContent = "DOWN";
        name.appendChild(down);
      }
      if (row.offline) {
        const left = document.createElement("em");
        left.textContent = "나감";
        name.appendChild(left);
      }

      const numbers = [`${row.kills}`, `${row.accuracy}%`, `${row.damage}`].map((text) => {
        const cell = document.createElement("span");
        cell.textContent = text;
        return cell;
      });

      line.append(rankCell, name, ...numbers);
      return line;
    };

    // won 이 null 이면 아직 진행 중이라 승패를 매기지 않는다(관전 중 요약).
    const buildTeam = (rows, label, won) => {
      const box = document.createElement("div");
      box.className = won === null ? "team-board" : won ? "team-board win" : "team-board lose";

      const head = document.createElement("div");
      head.className = "team-head";
      const title = document.createElement("span");
      title.className = "team-name";
      title.textContent = label;
      const verdict = document.createElement("b");
      const alive = rows.filter((row) => row.alive).length;
      verdict.textContent = won === null ? `${alive} 생존` : won ? "WIN" : "LOSE";
      head.append(title, verdict);

      const columns = document.createElement("div");
      columns.className = "score-row head";
      for (const text of ["#", "OPERATOR", "KILLS", "ACC", "DMG"]) {
        const cell = document.createElement("span");
        cell.textContent = text;
        columns.appendChild(cell);
      }

      box.append(head, columns);
      [...rows].sort(rank).forEach((row, index) => box.appendChild(buildRow(row, index + 1)));
      return box;
    };

    const renderScoreboard = (playerWon, live = false) => {
      const data = (multiplayer && onlineRows()) || offlineRows();
      const won = live
        ? null
        : data.winnerIsMine === null
          ? Boolean(playerWon)
          : data.winnerIsMine;
      const mineRows = data.rows.filter((row) => row.team === data.myTeam);
      const foeRows = data.rows.filter((row) => row.team !== data.myTeam);

      const label = document.createElement("div");
      label.className = "match-mode";
      label.textContent = multiplayer
        ? `온라인 · ${mineRows.length} vs ${foeRows.length}`
        : `프로토타입 · ${mineRows.length} vs ${foeRows.length}`;

      const myLabel = multiplayer ? `TEAM ${data.myTeam}` : "우리 팀";
      const foeLabel = multiplayer
        ? `TEAM ${foeRows[0]?.team || (data.myTeam === "A" ? "B" : "A")}`
        : "상대 팀";

      ui.scoreboard.replaceChildren(
        label,
        buildTeam(mineRows, myLabel, won),
        buildTeam(foeRows, foeLabel, won === null ? null : !won)
      );

    };

    /* ---------------- 아군 관전 ----------------
       내가 쓰러져도 아군이 남아 있으면 라운드는 계속된다(승패는 서버가 팀 전멸로
       정한다). 그동안 카메라와 시야를 살아 있는 아군에게 넘겨 관전 화면을 만든다.
       Esc 를 누르면 관전을 접고 전적·나가기 버튼이 있는 화면으로 빠져나온다. */

    let watching = null; // 지금 따라가는 아군 액터

    const spectateName = $("#spectate-who");

    const teammateToWatch = () => {
      if (!multiplayer || game.player.alive || game.phase !== "playing") return null;
      const mp = window.__multiplayer;
      const room = mp?.room;
      if (!room) return null;
      const myTeam = room.members.find((m) => m.id === mp.playerId)?.team;
      // 이미 보던 아군이 살아 있으면 계속 본다 — 매 프레임 대상이 바뀌면 어지럽다.
      const current = room.members.find((m) => mp.actors?.get(m.id) === watching);
      const pick =
        (current?.alive && current) ||
        room.members.find((m) => m.team === myTeam && m.id !== mp.playerId && m.alive);
      return pick ? mp.actors?.get(pick.id) || null : null;
    };

    const enterSpectate = (actor, member) => {
      watching = actor;
      if (spectateName) spectateName.textContent = member ? `${member.name} 관전 중` : "관전 중";
      if (ui.screen.classList.contains("hidden")) ui.spectateBar?.classList.remove("hidden");
    };

    const leaveSpectate = () => {
      watching = null;
      ui.spectateBar?.classList.add("hidden");
    };

    // 관전 중에는 카메라·시야를 아군 기준으로 계산한다.
    const withWatched = (original) =>
      function runAsSpectator(...args) {
        if (!watching?.alive) return original(...args);
        const realPlayer = this.player;
        this.player = watching;
        try {
          return original(...args);
        } finally {
          this.player = realPlayer;
        }
      };

    game.updateCamera = withWatched(game.updateCamera.bind(game));
    game.updateVisibility = withWatched(game.updateVisibility.bind(game));

    const originalStep = game.step.bind(game);
    game.step = function stepWithSpectator(dt) {
      originalStep(dt);
      if (!multiplayer) return;
      const mp = window.__multiplayer;
      const actor = teammateToWatch();
      if (actor && actor !== watching) {
        const member = mp?.room?.members.find((m) => mp.actors?.get(m.id) === actor);
        enterSpectate(actor, member);
        this.showToast(`${member?.name || "아군"} 관전 중 — ESC 로 나가기`);
      } else if (!actor && watching) {
        // 아군까지 모두 쓰러졌다 — 서버가 곧 종료를 알린다.
        leaveSpectate();
      }
    };

    /* ---- 관전 중 요약 화면 (Esc) ---- */

    const showLiveSummary = () => {
      $("#result-eyebrow").textContent = "SPECTATING";
      const title = $("#result-title");
      title.textContent = "관전 중";
      title.style.color = "var(--cyan)";
      $("#result-copy").textContent = "아군이 아직 싸우고 있습니다. ESC 를 누르면 관전으로 돌아갑니다.";
      renderScoreboard(null, true);
      ui.spectateBar?.classList.add("hidden");
      ui.screen.classList.remove("hidden");
    };

    const backToSpectate = () => {
      ui.screen.classList.add("hidden");
      if (watching) ui.spectateBar?.classList.remove("hidden");
    };

    /* 관전 중 Esc 는 코어의 일시정지 대신 이 화면을 여닫는다.
       코어가 window 의 버블 단계에서 듣고 있어 캡처 단계에서 가로챈다. */
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.code !== "Escape" || !watching) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        if (ui.screen.classList.contains("hidden")) showLiveSummary();
        else backToSpectate();
      },
      true
    );

    /* ---- 관전 / 이동 버튼 ---- */

    // 관전 줄의 "결과 보기" — 아직 교전 중이면 진행 상황 요약을 띄운다.
    ui.spectateClose?.addEventListener("click", () => {
      if (watching) showLiveSummary();
      else {
        ui.spectateBar?.classList.add("hidden");
        ui.screen.classList.remove("hidden");
      }
    });
    ui.room?.addEventListener("click", () => {
      location.href = roomUrl();
    });
    ui.lobby?.addEventListener("click", () => {
      location.href = LOBBY_URL;
    });

    // 온라인이 아니면 돌아갈 방이 없다. 다시 시작은 온라인에서 의미가 없다.
    if (!roomId) ui.room?.classList.add("hidden");
    if (multiplayer) $("#restart-button")?.classList.add("hidden");

    const originalEndRound = game.endRound.bind(game);
    game.endRound = function endRoundWithScoreboard(playerWon, copy) {
      if (this.phase === "result") return;
      originalEndRound(playerWon, copy);
      // 온라인에서는 서버의 종료 신호가 오기 전까지 코어의 판정이 막혀 있다.
      // 실제로 끝났을 때만 전적표를 그린다.
      if (this.phase !== "result") return;
      leaveSpectate(); // 라운드가 끝나면 관전도 끝 — Esc 가로채기도 함께 풀린다
      renderScoreboard(Boolean(playerWon));
    };

    const originalStartRound = game.startRound.bind(game);
    game.startRound = function startRoundWithCleanScoreboard() {
      ui.spectateBar?.classList.add("hidden");
      originalStartRound();
    };
  }

  /* ---------------- 로비에서 넘어온 진입 ---------------- */

  async function install() {
    const game = window.__breachline;
    if (!game) {
      requestAnimationFrame(install);
      return;
    }

    installResultScreen(game);
    document.body.dataset.lobbyCharacter = characterId;
    document.body.dataset.lobbyMap = mapId;
    if (!launchedFromLobby) return;

    if (multiplayer) {
      try {
        await window.__multiplayer?.ready;
      } catch (error) {
        game.showToast(error.message || "MULTIPLAYER CONNECTION FAILED");
        return;
      }
    }
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
