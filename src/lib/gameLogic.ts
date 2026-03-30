export type Player = {
  id: string;
  name: string;
  score: number;
  wins: number;
  isReady: boolean;
  connected: boolean;
};

export type Dice = {
  id: string;
  value: number; // 1: Tank, 2: Human, 3: Cow, 4: Chicken, 5: Death Ray, 6: Death Ray
  kept: boolean;
};

export type TurnState = {
  dice: Dice[];
  keptTypes: number[];
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

export type Room = {
  id: string;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  currentTurnIndex: number;
  turnState: TurnState | null;
  startingPlayerIndex: number;
  lastRound: boolean;
  winnerIds: string[];
};

export type GameAction = 
  | { type: 'join'; id: string; name: string }
  | { type: 'disconnect'; id: string }
  | { type: 'toggleReady'; id: string }
  | { type: 'rollDice'; id: string }
  | { type: 'keepDice'; id: string; value: number }
  | { type: 'stopTurn'; id: string }
  | { type: 'playAgain'; id: string };

export const cloneRoom = (room: Room): Room => JSON.parse(JSON.stringify(room));

export const createInitialTurnState = (): TurnState => {
  const dice: Dice[] = Array.from({ length: 13 }).map((_, i) => ({
    id: `dice-${i}`,
    value: 1,
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

export const rollUnkeptDice = (turnState: TurnState) => {
  let rolledCount = 0;
  turnState.dice.forEach(d => {
    if (!d.kept) {
      d.value = Math.floor(Math.random() * 6) + 1;
      rolledCount++;
    }
  });

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

  let hasValidKeep = false;
  turnState.dice.forEach(d => {
    if (!d.kept) {
      if (d.value === 5 || d.value === 6) {
        hasValidKeep = true;
      } else if (d.value >= 2 && d.value <= 4) {
        if (!turnState.keptTypes.includes(d.value)) {
          hasValidKeep = true;
        }
      }
    }
  });

  if (!hasValidKeep) {
    turnState.bust = true;
    turnState.message = "爆掉啦！没有可以保留的骰子。本回合得分为 0。";
    turnState.canStop = true;
  } else {
    turnState.message = `掷出了 ${rolledCount} 个骰子。出现了 ${newTanks} 个数字 1。请选择要保留的骰子。`;
  }
};

export const calculateScore = (turnState: TurnState) => {
  if (turnState.bust) return 0;
  if (turnState.tanks > turnState.deathRays) return 0;
  
  let score = turnState.humans + turnState.cows + turnState.chickens;
  if (turnState.humans > 0 && turnState.cows > 0 && turnState.chickens > 0) {
    score += 3;
  }
  return score;
};

export const nextTurn = (room: Room) => {
  const currentPlayer = room.players[room.currentTurnIndex];
  if (room.turnState) {
    const score = calculateScore(room.turnState);
    currentPlayer.score += score;
    if (currentPlayer.score >= 25) {
      room.lastRound = true;
    }
  }

  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;

  if (room.lastRound && room.currentTurnIndex === room.startingPlayerIndex) {
    room.status = 'finished';
    let maxScore = -1;
    room.players.forEach(p => {
      if (p.score > maxScore) maxScore = p.score;
    });
    room.winnerIds = room.players.filter(p => p.score === maxScore).map(p => p.id);
    room.players.forEach(p => {
      if (room.winnerIds.includes(p.id)) p.wins++;
      p.isReady = false;
    });
    room.turnState = null;
  } else {
    room.turnState = createInitialTurnState();
  }
};

export const processAction = (room: Room, action: GameAction): Room => {
  const newRoom = cloneRoom(room);
  
  switch(action.type) {
    case 'join':
      if (newRoom.players.length < 6 && newRoom.status === 'waiting') {
        newRoom.players.push({ id: action.id, name: action.name, score: 0, wins: 0, isReady: false, connected: true });
      }
      break;
    case 'disconnect':
      const pDisc = newRoom.players.find(p => p.id === action.id);
      if (pDisc) pDisc.connected = false;
      break;
    case 'toggleReady':
      const pReady = newRoom.players.find(p => p.id === action.id);
      if (pReady && newRoom.status === 'waiting') {
        pReady.isReady = !pReady.isReady;
        if (newRoom.players.length >= 2 && newRoom.players.every(p => p.isReady)) {
          newRoom.status = 'playing';
          newRoom.players.forEach(p => p.score = 0);
          newRoom.startingPlayerIndex = Math.floor(Math.random() * newRoom.players.length);
          newRoom.currentTurnIndex = newRoom.startingPlayerIndex;
          newRoom.lastRound = false;
          newRoom.winnerIds = [];
          newRoom.turnState = createInitialTurnState();
        }
      }
      break;
    case 'rollDice':
      if (newRoom.status === 'playing' && newRoom.players[newRoom.currentTurnIndex].id === action.id && newRoom.turnState?.canRoll) {
        rollUnkeptDice(newRoom.turnState);
      }
      break;
    case 'keepDice':
      if (newRoom.status === 'playing' && newRoom.players[newRoom.currentTurnIndex].id === action.id && newRoom.turnState) {
        const ts = newRoom.turnState;
        const value = action.value;
        if (ts.canRoll || ts.bust) break;
        if (value >= 2 && value <= 4 && ts.keptTypes.includes(value)) break;

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
          if (value >= 2 && value <= 4) ts.keptTypes.push(value);
          ts.canRoll = ts.dice.some(d => !d.kept);
          ts.canStop = true;
          const typeName = value === 5 ? "数字 5/6" : `数字 ${value}`;
          ts.message = `保留了 ${keptCount} 个 ${typeName}。你可以选择停止并结算，或者继续重掷剩下的骰子。`;
          if (!ts.canRoll) ts.message = `保留了 ${keptCount} 个 ${typeName}。没有剩余骰子，必须停止。`;
        }
      }
      break;
    case 'stopTurn':
      if (newRoom.status === 'playing' && newRoom.players[newRoom.currentTurnIndex].id === action.id && newRoom.turnState?.canStop) {
        nextTurn(newRoom);
      }
      break;
    case 'playAgain':
      if (newRoom.status === 'finished') {
        newRoom.status = 'waiting';
        newRoom.players.forEach(p => {
          p.score = 0;
          p.isReady = false;
        });
      }
      break;
  }
  return newRoom;
};
