const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const crypto = require("crypto");

const PORT = process.env.PORT || 3100;
const BOARD_SIZE = 25;
const WIN_LENGTH = 5;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6;
const RECONNECT_GRACE_MS = 1000 * 60 * 3;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || "";

app.get("/app-config.js", (_req, res) => {
  res.type("application/javascript");
  res.send(
    `window.__APP_CONFIG__ = ${JSON.stringify({
      publicBaseUrl
    })};`
  );
});
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function generateRoomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function normalizeName(name, fallback) {
  const text = String(name || "").trim();
  return text ? text.slice(0, 24) : fallback;
}

function createRoom(hostName) {
  let code = generateRoomCode();
  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  const room = {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "waiting",
    board: createEmptyBoard(),
    currentTurn: "black",
    winner: null,
    winLine: [],
    lastMove: null,
    moveHistory: [],
    rematchVotes: new Set(),
    undoRequest: null,
    players: {
      black: { id: null, name: hostName, connected: false, lastSeenAt: null },
      white: { id: null, name: "等待加入", connected: false, lastSeenAt: null }
    }
  };
  rooms.set(code, room);
  return room;
}

function cloneState(room, viewerRole = null) {
  return {
    code: room.code,
    status: room.status,
    board: room.board,
    boardSize: BOARD_SIZE,
    currentTurn: room.currentTurn,
    winner: room.winner,
    winLine: room.winLine,
    lastMove: room.lastMove,
    moveHistoryLength: room.moveHistory.length,
    undoRequest: room.undoRequest,
    yourRole: viewerRole,
    players: {
      black: { name: room.players.black.name, connected: room.players.black.connected },
      white: { name: room.players.white.name, connected: room.players.white.connected }
    },
    canStart: Boolean(room.players.black.id && room.players.white.id),
    rematchVotes: room.rematchVotes.size
  };
}

function emitRoomState(room) {
  for (const role of ["black", "white"]) {
    const player = room.players[role];
    if (player.id) {
      io.to(player.id).emit("room:state", cloneState(room, role));
    }
  }
}

function resetBoard(room, status = "ready") {
  room.board = createEmptyBoard();
  room.currentTurn = "black";
  room.winner = null;
  room.winLine = [];
  room.lastMove = null;
  room.moveHistory = [];
  room.status = status;
  room.rematchVotes.clear();
  room.undoRequest = null;
  room.updatedAt = Date.now();
}

function rollbackOneMove(room) {
  const move = room.moveHistory.pop();
  if (!move) {
    return false;
  }

  room.board[move.row][move.col] = null;
  room.currentTurn = move.role;
  room.lastMove = room.moveHistory.length ? room.moveHistory[room.moveHistory.length - 1] : null;
  room.winner = null;
  room.winLine = [];
  room.status = "playing";
  room.undoRequest = null;
  room.updatedAt = Date.now();
  return true;
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    for (const role of ["black", "white"]) {
      if (room.players[role].id === socketId) {
        return { room, role };
      }
    }
  }
  return null;
}

function roomRoleAvailable(room, role) {
  return !room.players[role].id;
}

function hasFive(room, row, col, role) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];

  for (const [dx, dy] of directions) {
    const line = [[row, col]];
    for (const step of [-1, 1]) {
      let r = row + dx * step;
      let c = col + dy * step;
      while (
        r >= 0 &&
        r < BOARD_SIZE &&
        c >= 0 &&
        c < BOARD_SIZE &&
        room.board[r][c] === role
      ) {
        if (step === -1) {
          line.unshift([r, c]);
        } else {
          line.push([r, c]);
        }
        r += dx * step;
        c += dy * step;
      }
    }

    if (line.length >= WIN_LENGTH) {
      return line;
    }
  }

  return null;
}

function boardFull(board) {
  return board.every((row) => row.every((cell) => cell !== null));
}

function joinRoomAsRole(room, role, socket, name) {
  room.players[role].id = socket.id;
  room.players[role].name = normalizeName(name, role === "black" ? "黑方" : "白方");
  room.players[role].connected = true;
  room.players[role].lastSeenAt = Date.now();
  room.updatedAt = Date.now();
  socket.join(room.code);
}

function removeStaleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const allDisconnected = ["black", "white"].every((role) => !room.players[role].connected);
    const idleTooLong = now - room.updatedAt > ROOM_TTL_MS;
    if (allDisconnected && idleTooLong) {
      rooms.delete(code);
    }
  }
}

setInterval(removeStaleRooms, 60_000).unref();

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }) => {
    const hostName = normalizeName(name, "黑方");
    const room = createRoom(hostName);
    joinRoomAsRole(room, "black", socket, hostName);
    socket.emit("room:joined", cloneState(room, "black"));
    emitRoomState(room);
  });

  socket.on("room:join", ({ code, name }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("action:error", "房间不存在");
      return;
    }

    if (roomRoleAvailable(room, "white")) {
      joinRoomAsRole(room, "white", socket, normalizeName(name, "白方"));
      room.status = "ready";
      socket.emit("room:joined", cloneState(room, "white"));
      emitRoomState(room);
      return;
    }

    if (roomRoleAvailable(room, "black")) {
      joinRoomAsRole(room, "black", socket, normalizeName(name, "黑方"));
      if (room.players.white.id) {
        room.status = "ready";
      }
      socket.emit("room:joined", cloneState(room, "black"));
      emitRoomState(room);
      return;
    }

    socket.emit("action:error", "房间已满");
  });

  socket.on("room:reconnect", ({ code, role, name }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room || !["black", "white"].includes(role)) {
      socket.emit("action:error", "无法恢复房间");
      return;
    }

    const player = room.players[role];
    if (
      player.connected ||
      (player.lastSeenAt && Date.now() - player.lastSeenAt > RECONNECT_GRACE_MS)
    ) {
      socket.emit("action:error", "重连窗口已失效");
      return;
    }

    joinRoomAsRole(room, role, socket, normalizeName(name, player.name));
    socket.emit("room:joined", cloneState(room, role));
    emitRoomState(room);
  });

  socket.on("game:start", () => {
    const found = findRoomBySocket(socket.id);
    if (!found) {
      return;
    }

    const { room } = found;
    if (room.players.black.id && room.players.white.id) {
      resetBoard(room, "playing");
      emitRoomState(room);
    }
  });

  socket.on("move:play", ({ row, col }) => {
    const found = findRoomBySocket(socket.id);
    if (!found) {
      return;
    }

    const { room, role } = found;
    if (room.status !== "playing") {
      socket.emit("action:error", "当前不在对局中");
      return;
    }
    if (room.currentTurn !== role) {
      socket.emit("action:error", "还没轮到你");
      return;
    }
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      row >= BOARD_SIZE ||
      col < 0 ||
      col >= BOARD_SIZE
    ) {
      socket.emit("action:error", "落子坐标非法");
      return;
    }
    if (room.board[row][col] !== null) {
      socket.emit("action:error", "这个位置已经有棋子了");
      return;
    }

    room.board[row][col] = role;
    room.lastMove = { row, col, role };
    room.moveHistory.push({ row, col, role });
    room.undoRequest = null;
    room.updatedAt = Date.now();

    const winLine = hasFive(room, row, col, role);
    if (winLine) {
      room.status = "finished";
      room.winner = role;
      room.winLine = winLine;
    } else if (boardFull(room.board)) {
      room.status = "finished";
      room.winner = "draw";
      room.winLine = [];
    } else {
      room.currentTurn = role === "black" ? "white" : "black";
    }

    emitRoomState(room);
  });

  socket.on("game:rematch", () => {
    const found = findRoomBySocket(socket.id);
    if (!found) {
      return;
    }

    const { room, role } = found;
    if (room.status !== "finished") {
      socket.emit("action:error", "当前还不能再来一局");
      return;
    }

    room.rematchVotes.add(role);
    if (room.rematchVotes.size === 2) {
      resetBoard(room, "playing");
    }
    emitRoomState(room);
  });

  socket.on("game:undo", () => {
    const found = findRoomBySocket(socket.id);
    if (!found) {
      return;
    }

    const { room, role } = found;
    if (room.status !== "playing") {
      socket.emit("action:error", "当前只有对局中才能悔棋");
      return;
    }
    if (room.moveHistory.length === 0) {
      socket.emit("action:error", "现在还没有可悔的棋");
      return;
    }

    if (!room.undoRequest) {
      room.undoRequest = { requester: role };
      room.updatedAt = Date.now();
      emitRoomState(room);
      return;
    }

    if (room.undoRequest.requester === role) {
      socket.emit("action:error", "已经发出悔棋申请，等对方同意");
      return;
    }

    rollbackOneMove(room);
    emitRoomState(room);
  });

  socket.on("disconnect", () => {
    const found = findRoomBySocket(socket.id);
    if (!found) {
      return;
    }

    const { room, role } = found;
    room.players[role].id = null;
    room.players[role].connected = false;
    room.players[role].lastSeenAt = Date.now();
    room.updatedAt = Date.now();

    if (room.status === "playing") {
      room.status = "ready";
    }

    emitRoomState(room);
  });
});

server.listen(PORT, () => {
  console.log(`Gomoku server listening on http://localhost:${PORT}`);
});
