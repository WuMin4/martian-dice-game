import { useState, useEffect, useRef } from 'react';
import { Peer, DataConnection } from 'peerjs';
import { Users, Info, Trophy, Check, X, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Target } from 'lucide-react';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Room, GameAction, cloneRoom, processAction } from './lib/gameLogic';

// --- Components ---

const ButtonComponent = ({ className, variant = 'default', ...props }: any) => {
  const variants: any = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2",
        variants[variant],
        className
      )}
      {...props}
    />
  );
};

const InputComponent = ({ className, ...props }: any) => {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
};

// Main App
export default function App() {
  const [appState, setAppState] = useState<'menu' | 'loading' | 'in-room'>('menu');
  const [room, setRoom] = useState<Room | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [myId, setMyId] = useState('');
  const [name, setName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [error, setError] = useState('');
  const [showTutorial, setShowTutorial] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const hostConnRef = useRef<DataConnection | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  const broadcast = (roomState: Room) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'roomState', room: roomState });
      }
    });
  };

  const handleCreateRoom = () => {
    const finalName = name.trim() || `玩家1`;
    setName(finalName);
    setError('');
    setAppState('loading');

    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    const hostId = `martian-dice-v1-${roomId}`;
    
    try {
      const peer = new Peer(hostId);
      peerRef.current = peer;

      peer.on('open', (id) => {
        setMyId(id);
        setIsHost(true);
        const initialRoom: Room = {
          id: roomId,
          players: [{ id, name: finalName, score: 0, wins: 0, isReady: false, connected: true }],
          status: 'waiting',
          currentTurnIndex: 0,
          turnState: null,
          startingPlayerIndex: 0,
          lastRound: false,
          winnerIds: [],
        };
        setRoom(initialRoom);
        setAppState('in-room');
      });

    peer.on('connection', (conn) => {
      connectionsRef.current.push(conn);

      conn.on('data', (data: any) => {
        if (data.type === 'join') {
          setRoom(prev => {
            if (!prev) return prev;
            const next = cloneRoom(prev);
            
            // 自动分配“玩家X”名称
            let finalName = data.name;
            if (finalName.startsWith('Temp_')) {
              finalName = `玩家${next.players.length + 1}`;
            }

            if (next.status !== 'waiting' || next.players.length >= 6 || next.players.some(p => p.name === finalName)) {
              conn.send({ type: 'error', message: '无法加入房间（已满、游戏中或昵称重复）' });
              return prev;
            }
            next.players.push({ id: data.id, name: finalName, score: 0, wins: 0, isReady: false, connected: true });
            broadcast(next);
            return next;
          });
        } else {
          // Game action
          setRoom(prev => {
            if (!prev) return prev;
            const next = processAction(prev, data as GameAction);
            broadcast(next);
            return next;
          });
        }
      });

      conn.on('close', () => {
        connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
        setRoom(prev => {
          if (!prev) return prev;
          const next = processAction(prev, { type: 'disconnect', id: conn.peer });
          broadcast(next);
          return next;
        });
      });
    });

    peer.on('error', (err) => {
        setError('创建房间失败: ' + err.message);
        setAppState('menu');
      });
    } catch (err: any) {
      setError('初始化 P2P 失败: ' + err.message);
      setAppState('menu');
    }
  };

  const handleJoinRoom = () => {
    // 暂时使用随机数，等连接成功后由主机分配正式的“玩家X”名称
    const tempName = name.trim() || `Temp_${Math.floor(Math.random() * 1000)}`;
    setName(tempName);
    if (!roomIdInput.trim() || roomIdInput.length !== 6) return setError('请输入6位房间号');
    setError('');
    setAppState('loading');

    try {
      const peer = new Peer();
      peerRef.current = peer;

      peer.on('open', (id) => {
        setMyId(id);
        const conn = peer.connect(`martian-dice-v1-${roomIdInput}`);
        hostConnRef.current = conn;

        conn.on('open', () => {
          conn.send({ type: 'join', id, name: tempName });
          setIsHost(false);
          setAppState('in-room');
        });

      conn.on('data', (data: any) => {
        if (data.type === 'roomState') {
          setRoom(data.room);
          // Sync my name if it was updated by the host
          const me = data.room.players.find((p: any) => p.id === id);
          if (me && me.name !== name) {
            setName(me.name);
          }
        } else if (data.type === 'error') {
          setError(data.message);
          setAppState('menu');
          peer.destroy();
        }
      });

      conn.on('close', () => {
        setError('与主机的连接已断开');
        setAppState('menu');
        setRoom(null);
      });
    });

    peer.on('error', (err) => {
        setError('连接失败: ' + err.message);
        setAppState('menu');
      });
    } catch (err: any) {
      setError('初始化 P2P 失败: ' + err.message);
      setAppState('menu');
    }
  };

  const dispatchAction = (action: Omit<GameAction, 'id'>) => {
    const fullAction = { ...action, id: myId } as GameAction;
    if (isHost) {
      setRoom(prev => {
        if (!prev) return prev;
        const next = processAction(prev, fullAction);
        broadcast(next);
        return next;
      });
    } else {
      if (hostConnRef.current?.open) {
        hostConnRef.current.send(fullAction);
      }
    }
  };

  if (appState === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <Target className="w-12 h-12 text-orange-500 animate-spin" style={{ animationDuration: '3s' }} />
          <p className="text-zinc-400">正在连接 P2P 网络...</p>
        </div>
      </div>
    );
  }

  if (appState === 'menu' || !room) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-8"
        >
          <div className="text-center space-y-2">
            <h1 className="text-5xl font-black tracking-tighter text-orange-500 flex items-center justify-center gap-3">
              <Target className="w-10 h-10" />
              火星骰
            </h1>
            <p className="text-zinc-400">Martian Dice - P2P 局域网联机版</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-6 shadow-xl">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">你的昵称</label>
              <InputComponent 
                value={name} 
                onChange={(e: any) => setName(e.target.value)} 
                placeholder="输入昵称..." 
                className="bg-zinc-950 border-zinc-800 text-zinc-100"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="grid grid-cols-2 gap-4">
              <ButtonComponent onClick={handleCreateRoom} className="w-full bg-orange-600 hover:bg-orange-700 text-white">
                创建房间
              </ButtonComponent>
              <div className="space-y-2">
                <InputComponent 
                  value={roomIdInput} 
                  onChange={(e: any) => setRoomIdInput(e.target.value)} 
                  placeholder="6位房间号" 
                  maxLength={6}
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 text-center tracking-widest"
                />
                <ButtonComponent onClick={handleJoinRoom} variant="outline" className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                  加入房间
                </ButtonComponent>
              </div>
            </div>
          </div>

          <div className="text-center">
            <button onClick={() => setShowTutorial(true)} className="text-sm text-zinc-500 hover:text-zinc-300 flex items-center justify-center gap-1 mx-auto">
              <Info className="w-4 h-4" /> 游戏规则
            </button>
          </div>
        </motion.div>

        {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-orange-500" /> 房间 {room.id}
              </h2>
              <span className="text-xs px-2 py-1 bg-zinc-800 rounded-full text-zinc-400">
                {room.status === 'waiting' ? '等待中' : room.status === 'playing' ? '游戏中' : '已结束'}
              </span>
            </div>
            
            <div className="space-y-2">
              {room.players.map((p, i) => (
                <div key={p.id} className={cn(
                  "flex items-center justify-between p-2 rounded-lg border",
                  room.status === 'playing' && room.currentTurnIndex === i ? "bg-orange-950/30 border-orange-500/50" : "bg-zinc-950 border-zinc-800",
                  !p.connected && "opacity-50"
                )}>
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2 h-2 rounded-full", p.connected ? "bg-green-500" : "bg-red-500")} />
                    <span className="font-medium text-sm truncate max-w-[80px]">{p.name}</span>
                    {p.id === myId && <span className="text-[10px] bg-zinc-800 px-1 rounded text-zinc-400">我</span>}
                    {p.id === `martian-dice-v1-${room.id}` && <span className="text-[10px] bg-orange-900/50 text-orange-400 px-1 rounded">主机</span>}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {room.status === 'waiting' && (
                      <span className={p.isReady ? "text-green-400" : "text-zinc-500"}>
                        {p.isReady ? <Check className="w-4 h-4" /> : "未准备"}
                      </span>
                    )}
                    {(room.status === 'playing' || room.status === 'finished') && (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-orange-400">{p.score}分</span>
                        <span className="text-xs text-zinc-500 flex items-center"><Trophy className="w-3 h-3 mr-1"/>{p.wins}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {room.status === 'waiting' && (
              <ButtonComponent 
                onClick={() => dispatchAction({ type: 'toggleReady' })}
                className={cn("w-full", room.players.find(p => p.id === myId)?.isReady ? "bg-zinc-700 hover:bg-zinc-600" : "bg-orange-600 hover:bg-orange-700")}
              >
                {room.players.find(p => p.id === myId)?.isReady ? "取消准备" : "准备"}
              </ButtonComponent>
            )}
          </div>
          
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
             <button onClick={() => setShowTutorial(true)} className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-2">
              <Info className="w-4 h-4" /> 查看规则
            </button>
          </div>
        </div>

        {/* Main Game Area */}
        <div className="lg:col-span-3">
          {room.status === 'waiting' && (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-3xl p-8 text-center">
              <Target className="w-16 h-16 text-zinc-700 mb-4" />
              <h3 className="text-2xl font-bold text-zinc-300 mb-2">等待玩家准备</h3>
              <p className="text-zinc-500 max-w-md">
                房间号: <span className="text-orange-400 font-mono text-lg">{room.id}</span><br/>
                至少需要2名玩家，所有人准备后游戏自动开始。
              </p>
            </div>
          )}

          {room.status === 'playing' && room.turnState && (
            <GameBoard room={room} myId={myId} dispatchAction={dispatchAction} />
          )}

          {room.status === 'finished' && (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-6">
              <Trophy className="w-20 h-20 text-yellow-500" />
              <div className="space-y-2">
                <h2 className="text-3xl font-bold text-white">游戏结束!</h2>
                <p className="text-xl text-zinc-300">
                  获胜者: {room.players.filter(p => room.winnerIds.includes(p.id)).map(p => p.name).join(', ')}
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 w-full max-w-md mt-8">
                {room.players.sort((a,b) => b.score - a.score).map((p, i) => (
                  <div key={p.id} className="bg-zinc-950 p-3 rounded-xl flex justify-between items-center border border-zinc-800">
                    <span className="font-medium">{i+1}. {p.name}</span>
                    <span className="text-orange-400 font-mono">{p.score} 分</span>
                  </div>
                ))}
              </div>

              <ButtonComponent onClick={() => dispatchAction({ type: 'playAgain' })} className="bg-orange-600 hover:bg-orange-700 mt-8 px-8">
                再来一局
              </ButtonComponent>
            </div>
          )}
        </div>
      </div>
      {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}
    </div>
  );
}

// --- Game Board Component ---
function GameBoard({ room, myId, dispatchAction }: { room: Room, myId: string, dispatchAction: (action: Omit<GameAction, 'id'>) => void }) {
  const ts = room.turnState!;
  const isMyTurn = room.players[room.currentTurnIndex].id === myId;
  const currentPlayer = room.players[room.currentTurnIndex];

  const handleRoll = () => dispatchAction({ type: 'rollDice' });
  const handleKeep = (value: number) => dispatchAction({ type: 'keepDice', value });
  const handleStop = () => dispatchAction({ type: 'stopTurn' });

  const getDiceVisuals = (value: number) => {
    switch(value) {
      case 1: return { icon: <Dice1 className="w-full h-full" />, color: "text-red-500", bg: "bg-red-950/30 border-red-900/50", name: "数字 1" };
      case 2: return { icon: <Dice2 className="w-full h-full" />, color: "text-blue-400", bg: "bg-blue-950/30 border-blue-900/50", name: "数字 2" };
      case 3: return { icon: <Dice3 className="w-full h-full" />, color: "text-amber-600", bg: "bg-amber-950/30 border-amber-900/50", name: "数字 3" };
      case 4: return { icon: <Dice4 className="w-full h-full" />, color: "text-yellow-400", bg: "bg-yellow-950/30 border-yellow-900/50", name: "数字 4" };
      case 5: return { icon: <Dice5 className="w-full h-full" />, color: "text-green-400", bg: "bg-green-950/30 border-green-900/50", name: "数字 5/6" };
      case 6: return { icon: <Dice6 className="w-full h-full" />, color: "text-green-400", bg: "bg-green-950/30 border-green-900/50", name: "数字 5/6" };
      default: return { icon: <Dice1 className="w-full h-full" />, color: "text-zinc-600", bg: "bg-zinc-900 border-zinc-800", name: "未知" };
    }
  };

  const unkeptDice = ts.dice.filter(d => !d.kept);
  
  const availableToKeep = new Set<number>();
  if (!ts.canRoll && !ts.bust) {
    unkeptDice.forEach(d => {
      if (d.value === 5 || d.value === 6) availableToKeep.add(5);
      else if (d.value >= 2 && d.value <= 4 && !ts.keptTypes.includes(d.value)) availableToKeep.add(d.value);
    });
  }

  let potentialScore = ts.humans + ts.cows + ts.chickens;
  let hasBonus = ts.humans > 0 && ts.cows > 0 && ts.chickens > 0;
  if (hasBonus) potentialScore += 3;
  const isDefended = ts.deathRays >= ts.tanks;

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">
            {isMyTurn ? "你的回合！" : `当前回合: ${currentPlayer.name}`}
          </h2>
          <p className={cn("text-sm mt-1", ts.bust ? "text-red-400 font-bold" : "text-zinc-400")}>
            {ts.message}
          </p>
        </div>
        
        <div className="flex gap-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex items-center gap-3">
            <div className="text-center">
              <div className="text-xs text-zinc-500 mb-1">数字 1</div>
              <div className="text-xl font-mono text-red-500">{ts.tanks}</div>
            </div>
            <div className="text-zinc-600 font-bold">VS</div>
            <div className="text-center">
              <div className="text-xs text-zinc-500 mb-1">数字 5/6</div>
              <div className="text-xl font-mono text-green-400">{ts.deathRays}</div>
            </div>
          </div>
          
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 min-w-[100px] text-center">
            <div className="text-xs text-zinc-500 mb-1">本轮得分</div>
            <div className={cn("text-2xl font-mono font-bold", isDefended && !ts.bust ? "text-orange-400" : "text-zinc-600")}>
              {ts.bust || !isDefended ? 0 : potentialScore}
              {hasBonus && !ts.bust && isDefended && <span className="text-xs text-yellow-500 ml-1">+3</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 min-h-[300px] flex flex-col">
          <h3 className="text-sm font-medium text-zinc-400 mb-4 uppercase tracking-wider">投掷区 ({unkeptDice.length}颗)</h3>
          
          <div className="flex-1 flex flex-wrap content-start gap-3">
            <AnimatePresence>
              {unkeptDice.map(d => {
                const vis = getDiceVisuals(d.value);
                return (
                  <motion.div
                    key={d.id}
                    layout
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className={cn(
                      "w-14 h-14 rounded-xl border-2 flex items-center justify-center p-2 shadow-lg",
                      vis.bg, vis.color,
                      ts.canRoll ? "opacity-50 grayscale" : ""
                    )}
                  >
                    {vis.icon}
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {unkeptDice.length === 0 && (
              <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">
                没有剩余骰子
              </div>
            )}
          </div>

          {isMyTurn && (
            <div className="mt-6 pt-6 border-t border-zinc-800 flex flex-col gap-3">
              {ts.canRoll && (
                <ButtonComponent onClick={handleRoll} className="w-full h-14 text-lg bg-orange-600 hover:bg-orange-700">
                  <Dice5 className="w-6 h-6 mr-2" /> 投掷骰子
                </ButtonComponent>
              )}
              
              {!ts.canRoll && !ts.bust && availableToKeep.size > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-zinc-500 text-center">选择要保留的骰子</div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {Array.from(availableToKeep).map(val => {
                      const vis = getDiceVisuals(val);
                      return (
                        <ButtonComponent 
                          key={val} 
                          onClick={() => handleKeep(val)}
                          variant="outline"
                          className={cn("h-12 border-zinc-700 hover:border-zinc-500", vis.color)}
                        >
                          <div className="w-5 h-5 mr-2">{vis.icon}</div>
                          保留所有 {vis.name}
                        </ButtonComponent>
                      );
                    })}
                  </div>
                </div>
              )}

              {ts.canStop && (
                <ButtonComponent 
                  onClick={handleStop} 
                  variant={ts.bust ? "default" : "outline"}
                  className={cn("w-full h-12", ts.bust ? "bg-red-600 hover:bg-red-700 text-white" : "border-zinc-700 text-zinc-300")}
                >
                  {ts.bust ? "结束回合" : "停止并结算"}
                </ButtonComponent>
              )}
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col gap-6">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">保留区</h3>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col items-center gap-2">
              <Dice2 className={cn("w-8 h-8", ts.humans > 0 ? "text-blue-400" : "text-zinc-700")} />
              <div className="text-2xl font-mono font-bold text-white">{ts.humans}</div>
              <div className="text-xs text-zinc-500">数字 2</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col items-center gap-2">
              <Dice3 className={cn("w-8 h-8", ts.cows > 0 ? "text-amber-600" : "text-zinc-700")} />
              <div className="text-2xl font-mono font-bold text-white">{ts.cows}</div>
              <div className="text-xs text-zinc-500">数字 3</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col items-center gap-2">
              <Dice4 className={cn("w-8 h-8", ts.chickens > 0 ? "text-yellow-400" : "text-zinc-700")} />
              <div className="text-2xl font-mono font-bold text-white">{ts.chickens}</div>
              <div className="text-xs text-zinc-500">数字 4</div>
            </div>
          </div>

          <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-4">
             <div className="text-xs text-zinc-500 mb-3">已保留的骰子实体</div>
             <div className="flex flex-wrap gap-2">
                <AnimatePresence>
                  {ts.dice.filter(d => d.kept).map(d => {
                    const vis = getDiceVisuals(d.value);
                    return (
                      <motion.div
                        key={d.id}
                        layout
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className={cn(
                          "w-10 h-10 rounded-lg border flex items-center justify-center p-1.5",
                          vis.bg, vis.color
                        )}
                      >
                        {vis.icon}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TutorialModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 space-y-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-zinc-400 hover:text-white">
          <X className="w-6 h-6" />
        </button>
        
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Info className="w-6 h-6 text-orange-500" /> 游戏规则：火星骰
        </h2>

        <div className="space-y-4 text-zinc-300 text-sm leading-relaxed">
          <p>在游戏中，玩家轮流投掷骰子，目标是收集数字 2、3、4 得分，同时要用数字 5 或 6 来抵消数字 1 的负面效果。率先达到 <strong>25分</strong> 的玩家获胜。</p>
          
          <h3 className="text-lg font-bold text-white mt-6">骰子点数</h3>
          <ul className="grid grid-cols-2 gap-2">
            <li className="flex items-center gap-2"><Dice1 className="w-4 h-4 text-red-500"/> <strong>数字 1:</strong> 负面效果。</li>
            <li className="flex items-center gap-2"><Dice5 className="w-4 h-4 text-green-400"/> <strong>数字 5/6:</strong> 抵消数字 1。</li>
            <li className="flex items-center gap-2"><Dice2 className="w-4 h-4 text-blue-400"/> <strong>数字 2:</strong> 1分。</li>
            <li className="flex items-center gap-2"><Dice3 className="w-4 h-4 text-amber-600"/> <strong>数字 3:</strong> 1分。</li>
            <li className="flex items-center gap-2"><Dice4 className="w-4 h-4 text-yellow-400"/> <strong>数字 4:</strong> 1分。</li>
          </ul>

          <h3 className="text-lg font-bold text-white mt-6">回合流程</h3>
          <ol className="list-decimal pl-5 space-y-2">
            <li><strong>投掷：</strong> 投掷所有未保留的骰子。</li>
            <li><strong>挑出数字 1：</strong> 所有掷出的数字 1 会被强制保留。</li>
            <li><strong>选择保留：</strong> 必须选择<strong>一种</strong>点数的骰子保留。
              <ul className="list-disc pl-5 mt-1 text-orange-300">
                <li><strong>数字 2、3、4 每种只能选一次：</strong> 本回合选过的点数，后续重掷不能再选。</li>
                <li><strong>数字 5/6 可以无限选：</strong> 每次重掷都可以选数字 5 或 6。</li>
              </ul>
            </li>
            <li><strong>决定：</strong> 选择“停止”结算得分，或“重掷”剩下的骰子。</li>
          </ol>

          <div className="bg-red-950/30 border border-red-900/50 p-3 rounded-lg mt-4">
            <strong>💥 爆掉：</strong> 如果重掷后没有合法点数可以保留（全是数字 1，或全是已选过的点数），回合立刻结束，得分为 0。
          </div>

          <h3 className="text-lg font-bold text-white mt-6">结算计分</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>如果 <strong>数字 1 数量 &gt; 数字 5/6 数量</strong>，得分为 0。</li>
            <li>如果 <strong>数字 5/6 数量 &ge; 数字 1 数量</strong>，每个保留的数字 2、3、4 各得 1 分。</li>
            <li><strong>🌟 全收集加分：</strong> 同时拥有至少一个数字 2、数字 3、数字 4，额外加 3 分！</li>
          </ul>
        </div>

        <ButtonComponent onClick={onClose} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white mt-6">
          我明白了
        </ButtonComponent>
      </div>
    </div>
  );
}
