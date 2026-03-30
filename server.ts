import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });
  const PORT = 3000;

  // --- Game Logic & State ---
  
  type Player = {
    id: string;
    name: string;
    score: number;
    wins: number;
    isReady: boolean;
    connected: boolean;
  };

  type Dice = {
    id: string;
    value: number; // 1: Tank, 2: Human, 3: Cow, 4: Chicken, 5: Death Ray, 6: Death Ray
    kept: boolean;
  };

  type TurnState = {
    dice: Dice[];
    keptTypes: number[]; // 2, 3, 4
    tanks: number;
    deathRays: number;
    humans: number;
    cows: number;
    chickens: number;
    canRoll: boolean;
    canStop: boolean;
    bust: boolean;
    message: string;
  };

  type Room = {
    id: string;
    players: Player[];
    status: 'waiting' | 'playing' | 'finished';
    currentTurnIndex: number;
    turnState: TurnState | null;
    startingPlayerIndex: number;
    lastRound: boolean;
    winnerIds: string[];
  };

  const rooms = new Map<string, Room>();

  const generateRoomId = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const createInitialTurnState = (): TurnState => {
    const dice: Dice[] = Array.from({ length: 13 }).map((_, i) => ({
      id: `dice-${i}`,
      value: 1, // Will be rolled
      kept: false,
    }));
    return {
      dice,
      keptTypes: [],
      tanks: 0,
      deathRays: 0,
      humans: 0,
      cows: 0,
      chickens: 0,
      canRoll: true,
      canStop: false,
      bust: false,
      message: "你的回合！请投掷骰子。",
    };
  };

  const rollUnkeptDice = (turnState: TurnState) => {
    let rolledCount = 0;
    turnState.dice.forEach(d => {
      if (!d.kept) {
        d.value = Math.floor(Math.random() * 6) + 1;
        rolledCount++;
      }
    });

    // Auto keep tanks
    let newTanks = 0;
    turnState.dice.forEach(d => {
      if (!d.kept && d.value === 1) {
        d.kept = true;
        turnState.tanks++;
        newTanks++;
      }
    });

    turnState.canRoll = false;
    turnState.canStop = false;

    // Check for bust
    let hasValidKeep = false;
    turnState.dice.forEach(d => {
      if (!d.kept) {
        if (d.value === 5 || d.value === 6) {
          hasValidKeep = true; // Can always keep death rays
        } else if (d.value >= 2 && d.value <= 4) {
          if (!turnState.keptTypes.includes(d.value)) {
            hasValidKeep = true; // Can keep this earthling
          }
        }
      }
    });

    if (!hasValidKeep) {
      turnState.bust = true;
      turnState.message = "爆掉啦！没有可以保留的骰子。本回合得分为 0。";
      turnState.canStop = true; // Allow them to acknowledge and end turn
    } else {
      turnState.message = `掷出了 ${rolledCount} 个骰子。出现了 ${newTanks} 个数字 1。请选择要保留的骰子。`;
    }
  };

  const calculateScore = (turnState: TurnState) => {
    if (turnState.bust) return 0;
    if (turnState.tanks > turnState.deathRays) return 0;
    
    let score = turnState.humans + turnState.cows + turnState.chickens;
    if (turnState.humans > 0 && turnState.cows > 0 && turnState.chickens > 0) {
      score += 3; // Bonus
    }
    return score;
  };

  const nextTurn = (room: Room) => {
    const currentPlayer = room.players[room.currentTurnIndex];
    if (room.turnState) {
      const score = calculateScore(room.turnState);
      currentPlayer.score += score;
      if (currentPlayer.score >= 25) {
        room.lastRound = true;
      }
    }

    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;

    // Check if game ended
    if (room.lastRound && room.currentTurnIndex === room.startingPlayerIndex) {
      room.status = 'finished';
      // Determine winners
      let maxScore = -1;
      room.players.forEach(p => {
        if (p.score > maxScore) maxScore = p.score;
      });
      room.winnerIds = room.players.filter(p => p.score === maxScore).map(p => p.id);
      room.players.forEach(p => {
        if (room.winnerIds.includes(p.id)) {
          p.wins++;
        }
        p.isReady = false;
      });
      room.turnState = null;
    } else {
      room.turnState = createInitialTurnState();
    }
  };

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("createRoom", (name: string, callback) => {
      const roomId = generateRoomId();
      const newRoom: Room = {
        id: roomId,
        players: [{ id: socket.id, name, score: 0, wins: 0, isReady: false, connected: true }],
        status: 'waiting',
        currentTurnIndex: 0,
        turnState: null,
        startingPlayerIndex: 0,
        lastRound: false,
        winnerIds: [],
      };
      rooms.set(roomId, newRoom);
      socket.join(roomId);
      callback({ success: true, roomId });
      io.to(roomId).emit("roomUpdate", newRoom);
    });

    socket.on("joinRoom", (roomId: string, name: string, callback) => {
      const room = rooms.get(roomId);
      if (!room) {
        return callback({ success: false, message: "房间不存在" });
      }
      if (room.status !== 'waiting') {
        return callback({ success: false, message: "游戏已经开始" });
      }
      if (room.players.length >= 6) {
        return callback({ success: false, message: "房间已满" });
      }

      const existingPlayer = room.players.find(p => p.name === name);
      if (existingPlayer) {
         return callback({ success: false, message: "昵称已被占用" });
      }

      room.players.push({ id: socket.id, name, score: 0, wins: 0, isReady: false, connected: true });
      socket.join(roomId);
      callback({ success: true, roomId });
      io.to(roomId).emit("roomUpdate", room);
    });

    socket.on("toggleReady", (roomId: string) => {
      const room = rooms.get(roomId);
      if (room && room.status === 'waiting') {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          player.isReady = !player.isReady;
          
          // Check if all ready to start
          if (room.players.length >= 2 && room.players.every(p => p.isReady)) {
            room.status = 'playing';
            room.players.forEach(p => p.score = 0);
            room.startingPlayerIndex = Math.floor(Math.random() * room.players.length);
            room.currentTurnIndex = room.startingPlayerIndex;
            room.lastRound = false;
            room.winnerIds = [];
            room.turnState = createInitialTurnState();
          }
          io.to(roomId).emit("roomUpdate", room);
        }
      }
    });

    socket.on("rollDice", (roomId: string) => {
      const room = rooms.get(roomId);
      if (room && room.status === 'playing' && room.players[room.currentTurnIndex].id === socket.id && room.turnState) {
        if (room.turnState.canRoll) {
          rollUnkeptDice(room.turnState);
          io.to(roomId).emit("roomUpdate", room);
        }
      }
    });

    socket.on("keepDice", (roomId: string, value: number) => {
      const room = rooms.get(roomId);
      if (room && room.status === 'playing' && room.players[room.currentTurnIndex].id === socket.id && room.turnState) {
        const ts = room.turnState;
        if (ts.canRoll || ts.bust) return; // Cannot keep if already rolled or busted

        // Validate keep
        if (value >= 2 && value <= 4 && ts.keptTypes.includes(value)) {
          return; // Already kept this earthling
        }

        let keptCount = 0;
        ts.dice.forEach(d => {
          if (!d.kept && ((value === 5 && (d.value === 5 || d.value === 6)) || d.value === value)) {
            d.kept = true;
            keptCount++;
            if (value === 2) ts.humans++;
            if (value === 3) ts.cows++;
            if (value === 4) ts.chickens++;
            if (value === 5) ts.deathRays++;
          }
        });

        if (keptCount > 0) {
          if (value >= 2 && value <= 4) {
            ts.keptTypes.push(value);
          }
          
          ts.canRoll = ts.dice.some(d => !d.kept);
          ts.canStop = true;
          
          const typeName = value === 5 ? "数字 5/6" : `数字 ${value}`;
          ts.message = `保留了 ${keptCount} 个 ${typeName}。你可以选择停止并结算，或者继续重掷剩下的骰子。`;
          
          if (!ts.canRoll) {
             ts.message = `保留了 ${keptCount} 个 ${typeName}。没有剩余骰子，必须停止。`;
          }

          io.to(roomId).emit("roomUpdate", room);
        }
      }
    });

    socket.on("stopTurn", (roomId: string) => {
      const room = rooms.get(roomId);
      if (room && room.status === 'playing' && room.players[room.currentTurnIndex].id === socket.id && room.turnState) {
        if (room.turnState.canStop) {
          nextTurn(room);
          io.to(roomId).emit("roomUpdate", room);
        }
      }
    });

    socket.on("playAgain", (roomId: string) => {
      const room = rooms.get(roomId);
      if (room && room.status === 'finished') {
        room.status = 'waiting';
        room.players.forEach(p => {
          p.score = 0;
          p.isReady = false;
        });
        io.to(roomId).emit("roomUpdate", room);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      rooms.forEach((room, roomId) => {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          room.players[playerIndex].connected = false;
          // If all players disconnected, delete room
          if (room.players.every(p => !p.connected)) {
            rooms.delete(roomId);
          } else {
            io.to(roomId).emit("roomUpdate", room);
          }
        }
      });
    });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
