const socket = io();

const state = {
  room: null,
  lastErrorAt: 0
};

const refs = {
  connectionState: document.querySelector("#connectionState"),
  nameInput: document.querySelector("#nameInput"),
  createRoomBtn: document.querySelector("#createRoomBtn"),
  joinRoomBtn: document.querySelector("#joinRoomBtn"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  roomBadge: document.querySelector("#roomBadge"),
  roomCodeText: document.querySelector("#roomCodeText"),
  yourRoleText: document.querySelector("#yourRoleText"),
  inviteLinkInput: document.querySelector("#inviteLinkInput"),
  copyLinkBtn: document.querySelector("#copyLinkBtn"),
  startBtn: document.querySelector("#startBtn"),
  rematchBtn: document.querySelector("#rematchBtn"),
  blackPlayerText: document.querySelector("#blackPlayerText"),
  whitePlayerText: document.querySelector("#whitePlayerText"),
  statusText: document.querySelector("#statusText"),
  board: document.querySelector("#board")
};

const urlCode = new URLSearchParams(window.location.search).get("room");
if (urlCode) {
  refs.roomCodeInput.value = urlCode.toUpperCase();
}

function saveSession(room) {
  localStorage.setItem(
    "gomoku-now-session",
    JSON.stringify({
      code: room.code,
      role: room.yourRole,
      name: refs.nameInput.value.trim() || roleLabel(room.yourRole)
    })
  );
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("gomoku-now-session") || "null");
  } catch {
    return null;
  }
}

function roleLabel(role) {
  if (role === "black") return "黑方";
  if (role === "white") return "白方";
  return "-";
}

function showStatus(text) {
  refs.statusText.textContent = text;
}

function showError(message) {
  state.lastErrorAt = Date.now();
  showStatus(message);
}

function playerText(role, player) {
  const label = role === "black" ? "黑方" : "白方";
  const online = player.connected ? "在线" : "离线";
  return `${label}：${player.name} · ${online}`;
}

function boardCellClass(cellRole) {
  if (!cellRole) return "";
  return cellRole === "black" ? "black" : "white";
}

function isMyTurn(room) {
  return room.status === "playing" && room.currentTurn === room.yourRole;
}

function inviteUrl(code) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  return url.toString();
}

function renderBoard(room) {
  refs.board.innerHTML = "";
  const winSet = new Set((room.winLine || []).map(([r, c]) => `${r}:${c}`));

  for (let row = 0; row < room.boardSize; row += 1) {
    for (let col = 0; col < room.boardSize; col += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cell ${boardCellClass(room.board[row][col])}`;

      if (room.lastMove && room.lastMove.row === row && room.lastMove.col === col) {
        button.classList.add("last-move");
      }
      if (winSet.has(`${row}:${col}`)) {
        button.classList.add("win");
      }
      if (!room.board[row][col] && isMyTurn(room)) {
        button.classList.add("playable");
      }

      button.addEventListener("click", () => {
        if (!state.room || !isMyTurn(state.room) || state.room.board[row][col]) {
          return;
        }
        socket.emit("move:play", { row, col });
      });
      refs.board.appendChild(button);
    }
  }
}

function renderRoom(room) {
  state.room = room;
  saveSession(room);

  refs.roomBadge.textContent = room.status === "waiting" ? "等人加入" : room.status === "ready" ? "可开始" : room.status === "playing" ? "对局中" : "已结束";
  refs.roomCodeText.textContent = room.code;
  refs.yourRoleText.textContent = roleLabel(room.yourRole);
  refs.blackPlayerText.textContent = playerText("black", room.players.black);
  refs.whitePlayerText.textContent = playerText("white", room.players.white);
  refs.inviteLinkInput.value = inviteUrl(room.code);
  refs.startBtn.disabled = !(room.canStart && room.status !== "playing");
  refs.rematchBtn.disabled = room.status !== "finished";

  if (room.status === "waiting") {
    showStatus("房间已创建，等你妹用链接进来。");
  } else if (room.status === "ready") {
    showStatus(room.canStart ? "两位玩家都已就位，点“开始对局”。" : "等待玩家回到房间。");
  } else if (room.status === "playing") {
    showStatus(isMyTurn(room) ? "轮到你落子。" : `轮到${roleLabel(room.currentTurn)}落子。`);
  } else if (room.status === "finished") {
    if (room.winner === "draw") {
      showStatus("平局，再来一局吧。");
    } else if (room.winner === room.yourRole) {
      showStatus("你赢了，再来一局？");
    } else {
      showStatus(`${roleLabel(room.winner)}获胜，再来一局？`);
    }
  }

  renderBoard(room);
}

function currentName() {
  return refs.nameInput.value.trim() || "玩家";
}

function tryReconnect() {
  const session = loadSession();
  if (!session || state.room) return;
  refs.nameInput.value = session.name || refs.nameInput.value;
  socket.emit("room:reconnect", session);
}

refs.createRoomBtn.addEventListener("click", () => {
  socket.emit("room:create", { name: currentName() });
});

refs.joinRoomBtn.addEventListener("click", () => {
  socket.emit("room:join", {
    code: refs.roomCodeInput.value.trim(),
    name: currentName()
  });
});

refs.startBtn.addEventListener("click", () => {
  socket.emit("game:start");
});

refs.rematchBtn.addEventListener("click", () => {
  socket.emit("game:rematch");
});

refs.copyLinkBtn.addEventListener("click", async () => {
  if (!refs.inviteLinkInput.value) return;
  try {
    await navigator.clipboard.writeText(refs.inviteLinkInput.value);
    showStatus("邀请链接已复制，发给你妹就行。");
  } catch {
    refs.inviteLinkInput.select();
    document.execCommand("copy");
    showStatus("邀请链接已复制。");
  }
});

socket.on("connect", () => {
  refs.connectionState.textContent = "已连接";
  refs.connectionState.style.color = "#1d7a3c";
  tryReconnect();
});

socket.on("disconnect", () => {
  refs.connectionState.textContent = "连接断开，正在重连";
  refs.connectionState.style.color = "#b54925";
});

socket.on("room:joined", renderRoom);
socket.on("room:state", renderRoom);
socket.on("action:error", showError);

showStatus("先创建房间，或者输入房间号加入。");
