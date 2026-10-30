const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ---------------------------------------------------------
// 1. 盤面生成用データ・ユーティリティ
// ---------------------------------------------------------

// 資源タイル（計19枚）
const TILE_RESOURCES = [
  'wood', 'wood', 'wood', 'wood',       // 森林 (4)
  'wool', 'wool', 'wool', 'wool',       // 牧草地 (4)
  'wheat', 'wheat', 'wheat', 'wheat',   // 農地 (4)
  'brick', 'brick', 'brick',             // 丘陵 (3)
  'ore', 'ore', 'ore',                   // 山脈 (3)
  'desert'                              // 砂漠 (1)
];

// 数字トークン（計18個 / 砂漠を除く）
const TILE_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

// 港の定義（PythonAnywhere側の静的ファイルパスに合わせて指定）
const PORT_TYPES = [
  { type: '3:1', label: '一般港 (3:1)', img: '/static/catan/img/port-3to1.png' },
  { type: '3:1', label: '一般港 (3:1)', img: '/static/catan/img/port-3to1.png' },
  { type: '3:1', label: '一般港 (3:1)', img: '/static/catan/img/port-3to1.png' },
  { type: '3:1', label: '一般港 (3:1)', img: '/static/catan/img/port-3to1.png' },
  { type: '3:1', label: '一般港 (3:1)', img: '/static/catan/img/port-3to1.png' },
  { type: '2:1_wood', label: '木材港 (2:1)', resource: 'wood', img: '/static/catan/img/port-wood.png' },
  { type: '2:1_brick', label: '煉瓦港 (2:1)', resource: 'brick', img: '/static/catan/img/port-brick.png' },
  { type: '2:1_wool', label: '羊毛港 (2:1)', resource: 'wool', img: '/static/catan/img/port-wool.png' },
  { type: '2:1_wheat', label: '小麦港 (2:1)', resource: 'wheat', img: '/static/catan/img/port-wheat.png' },
  { type: '2:1_ore', label: '鉱石港 (2:1)', resource: 'ore', img: '/static/catan/img/port-ore.png' }
];

// 港の配置位置（hexIdと対応する角 corner）
const PORT_LOCATIONS = [
  { hexId: 0, corner: 0 }, { hexId: 1, corner: 1 }, { hexId: 3, corner: 5 },
  { hexId: 6, corner: 2 }, { hexId: 11, corner: 2 }, { hexId: 12, corner: 4 },
  { hexId: 15, corner: 3 }, { hexId: 17, corner: 4 }, { hexId: 18, corner: 3 }
];

// 配列のランダムシャッフル関数（フィッシャー・イェーツ）
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// カタンの盤面（Hex 19枚 + 港）を初期化・生成する関数
function generateCatanBoard() {
  const shuffledResources = shuffle(TILE_RESOURCES);
  const shuffledNumbers = shuffle(TILE_NUMBERS);
  const shuffledPorts = shuffle(PORT_TYPES);

  let numberIdx = 0;
  let robberHexId = null;

  const hexes = shuffledResources.map((resource, id) => {
    let number = null;
    if (resource === 'desert') {
      robberHexId = id; // 盗賊の初期位置は砂漠タイル
    } else {
      number = shuffledNumbers[numberIdx++];
    }

    return {
      id: id,
      resource: resource, // wood, brick, wool, wheat, ore, desert
      number: number
    };
  });

  // 港の結合
  const ports = PORT_LOCATIONS.map((loc, idx) => ({
    ...loc,
    ...shuffledPorts[idx]
  }));

  return {
    hexes: hexes,
    ports: ports,
    robberHexId: robberHexId
  };
}

// ---------------------------------------------------------
// 2. ゲーム状態の管理
// ---------------------------------------------------------

let gameState = {
  players: [],
  board: null,
  phase: 'LOBBY', // LOBBY, INITIAL_SETUP, PLAYING, GAME_OVER
  turnIndex: 0,
  turnCount: 1,
  hasRolled: false,
  isMovingRobber: false,
  achievements: {
    longestRoadPlayerId: null,
    longestRoadLength: 4,
    largestArmyPlayerId: null,
    largestArmyCount: 2
  }
};

const PLAYER_COLORS = ['red', 'blue', 'orange', 'white'];

// ---------------------------------------------------------
// 3. Socket.io 通信ハンドラ
// ---------------------------------------------------------

io.on('connection', (socket) => {
  console.log(`[接続] ユーザー接続: ${socket.id}`);

  // ① ロビー参加
  socket.on('joinLobby', (username) => {
    if (gameState.phase !== 'LOBBY') {
      socket.emit('errorMsg', 'ゲームはすでに開始されています。');
      return;
    }

    if (gameState.players.find(p => p.id === socket.id)) return;

    const newPlayer = {
      id: socket.id,
      name: username || `P${gameState.players.length + 1}`,
      color: PLAYER_COLORS[gameState.players.length % 4],
      resources: { wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 },
      devCards: [],
      buildings: [],
      roads: [],
      victoryPoints: 0,
      playedKnights: 0,
      roadLength: 0,
      receivedInitialResources: false
    };

    gameState.players.push(newPlayer);

    io.emit('lobbyUpdate', {
      players: gameState.players,
      canStart: gameState.players.length >= 2 // 2人以上で開始可能（テスト時便利）
    });
  });

  // ② ゲーム開始ボタン処理
  socket.on('startGame', () => {
    if (gameState.players.length < 2) return;

    // 盤面を新規生成（Hexタイル＆港）
    const newBoard = generateCatanBoard();
    gameState.board = newBoard;
    gameState.robberHexId = newBoard.robberHexId;
    gameState.phase = 'INITIAL_SETUP';
    gameState.setupPhase = 'SETTLEMENT';
    gameState.turnIndex = 0;

    console.log('[開始] Web Catan ゲームが開始されました！');
    io.emit('gameStarted', gameState);
  });

  // ③ サイコロを振る
  socket.on('rollDice', () => {
    const p = gameState.players[gameState.turnIndex];
    if (!p || p.id !== socket.id || gameState.hasRolled) return;

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;

    gameState.hasRolled = true;

    // 7が出た場合は盗賊移動モードへ
    if (sum === 7) {
      gameState.isMovingRobber = true;
    } else {
      // 該当数字タイルの資源分配処理
      gameState.board.hexes.forEach(hex => {
        if (hex.number === sum && hex.id !== gameState.robberHexId) {
          gameState.players.forEach(player => {
            (player.buildings || []).forEach(b => {
              if (b.touchingHexIds && b.touchingHexIds.includes(hex.id)) {
                const count = (b.type === 'city') ? 2 : 1;
                player.resources[hex.resource] += count;
              }
            });
          });
        }
      });
    }

    io.emit('diceRolled', { d1, d2, sum, gameState });
  });

  // ④ ターン終了
  socket.on('endTurn', () => {
    const p = gameState.players[gameState.turnIndex];
    if (!p || p.id !== socket.id || !gameState.hasRolled) return;

    gameState.hasRolled = false;
    gameState.isMovingRobber = false;
    gameState.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
    gameState.turnCount++;

    io.emit('gameStateUpdate', gameState);
  });

  // ⑤ 建築処理（街道・開拓地・都市・発展カード）
  socket.on('buildStructure', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;

    if (data.type === 'settlement') {
      player.resources.wood -= 1;
      player.resources.brick -= 1;
      player.resources.wool -= 1;
      player.resources.wheat -= 1;
      player.buildings.push({ type: 'settlement', vertexId: data.vertexId, touchingHexIds: data.extraData?.touchingHexIds || [] });
      player.victoryPoints += 1;
    } else if (data.type === 'city') {
      player.resources.ore -= 3;
      player.resources.wheat -= 2;
      const bIdx = player.buildings.findIndex(b => b.vertexId === data.vertexId && b.type === 'settlement');
      if (bIdx !== -1) player.buildings.splice(bIdx, 1);
      player.buildings.push({ type: 'city', vertexId: data.vertexId });
      player.victoryPoints += 1;
    } else if (data.type === 'road') {
      player.resources.wood -= 1;
      player.resources.brick -= 1;
      player.roads.push({ edgeId: data.edgeId });
    }

    io.emit('gameStateUpdate', gameState);
  });

  // 切断処理
  socket.on('disconnect', () => {
    console.log(`[切断] ユーザー切断: ${socket.id}`);
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    if (gameState.players.length === 0) {
      // プレイヤーが全員いなくなったら初期化
      gameState.phase = 'LOBBY';
    } else {
      io.emit('lobbyUpdate', { players: gameState.players, canStart: gameState.players.length >= 2 });
    }
  });
});

// ---------------------------------------------------------
// 4. サーバー起動
// ---------------------------------------------------------
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Socket.io サーバーが起動しました（ポート: ${PORT}）`);
});
