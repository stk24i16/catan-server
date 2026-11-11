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

// 港の定義
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

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// カタン公式構成の発展カード山札生成（計25枚）
function generateDevCardDeck() {
  const deck = [
    ...Array(14).fill('knight'),
    ...Array(5).fill('victoryPoint'),
    ...Array(2).fill('roadBuilding'),
    ...Array(2).fill('yearOfPlenty'),
    ...Array(2).fill('monopoly')
  ];
  return shuffle(deck);
}

function generateCatanBoard() {
  const shuffledResources = shuffle(TILE_RESOURCES);
  const shuffledNumbers = shuffle(TILE_NUMBERS);
  const shuffledPorts = shuffle(PORT_TYPES);

  let numberIdx = 0;
  let robberHexId = null;

  const hexes = shuffledResources.map((resource, id) => {
    let number = null;
    if (resource === 'desert') {
      robberHexId = id;
    } else {
      number = shuffledNumbers[numberIdx++];
    }

    return {
      id: id,
      resource: resource,
      number: number
    };
  });

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
  devCardDeck: [],
  phase: 'LOBBY',
  turnIndex: 0,
  turnCount: 1,
  hasRolled: false,
  isMovingRobber: false,
  setupStep: 0,
  currentTrade: null,
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
      canStart: gameState.players.length >= 2
    });
  });

  // ② ゲーム開始処理
  socket.on('startGame', () => {
    if (gameState.players.length < 2) return;

    const newBoard = generateCatanBoard();
    gameState.board = newBoard;
    gameState.robberHexId = newBoard.robberHexId;
    gameState.devCardDeck = generateDevCardDeck(); // 発展カード山札を生成
    gameState.phase = 'INITIAL_SETUP';
    gameState.setupPhase = 'SETTLEMENT';
    gameState.turnIndex = 0;
    gameState.setupStep = 0;

    console.log('[開始] Web Catan ゲームが開始されました！');
    io.emit('gameStarted', gameState);
  });

  // 初期開拓地の配置処理
  socket.on('placeInitialSettlement', (data) => {
    const p = gameState.players[gameState.turnIndex];
    if (!p || p.id !== socket.id || gameState.phase !== 'INITIAL_SETUP' || gameState.setupPhase !== 'SETTLEMENT') return;

    gameState.pendingSettlement = {
      vertexId: data.vertexId,
      touchingHexIds: data.touchingHexIds || []
    };
    gameState.setupPhase = 'ROAD';

    io.emit('gameStateUpdate', gameState);
  });

  // 初期街道の配置処理
  socket.on('placeInitialRoad', (data) => {
    const p = gameState.players[gameState.turnIndex];
    if (!p || p.id !== socket.id || gameState.phase !== 'INITIAL_SETUP' || gameState.setupPhase !== 'ROAD' || !gameState.pendingSettlement) return;

    p.buildings.push({
      type: 'settlement',
      vertexId: gameState.pendingSettlement.vertexId,
      touchingHexIds: gameState.pendingSettlement.touchingHexIds
    });
    p.roads.push({ edgeId: data.edgeId });
    p.victoryPoints = (p.victoryPoints || 0) + 1;

    gameState.pendingSettlement = null;
    gameState.setupStep = (gameState.setupStep || 0) + 1;

    const totalSteps = gameState.players.length * 2;
    if (gameState.setupStep < totalSteps) {
      const n = gameState.players.length;
      const step = gameState.setupStep;
      if (step < n) {
        gameState.turnIndex = step;
      } else {
        gameState.turnIndex = (2 * n - 1) - step;
      }
      gameState.setupPhase = 'SETTLEMENT';
    } else {
      gameState.phase = 'INITIAL_RESOURCE_SELECT';
      gameState.turnIndex = 0;
    }

    io.emit('gameStateUpdate', gameState);
  });

  // 初期資源の獲得処理
  socket.on('claimInitialResources', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || player.receivedInitialResources) return;

    const b = player.buildings.find(b => b.vertexId === data.vertexId);
    if (b && b.touchingHexIds) {
      b.touchingHexIds.forEach(hexId => {
        const hex = gameState.board.hexes.find(h => h.id === hexId);
        if (hex && hex.resource && hex.resource !== 'desert') {
          player.resources[hex.resource] = (player.resources[hex.resource] || 0) + 1;
        }
      });
    }
    player.receivedInitialResources = true;

    if (gameState.players.every(p => p.receivedInitialResources)) {
      gameState.phase = 'PLAYING';
      gameState.turnIndex = 0;
    }

    io.emit('gameStateUpdate', gameState);
  });

  // ③ サイコロを振る（獲得資源ログ生成付き）
  socket.on('rollDice', () => {
    const p = gameState.players[gameState.turnIndex];
    if (!p || p.id !== socket.id || gameState.hasRolled) return;

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;

    gameState.hasRolled = true;
    const gainedSummary = [];

    if (sum === 7) {
      gameState.isMovingRobber = true;
    } else {
      gameState.board.hexes.forEach(hex => {
        if (hex.number === sum && hex.id !== gameState.robberHexId) {
          gameState.players.forEach(player => {
            (player.buildings || []).forEach(b => {
              if (b.touchingHexIds && b.touchingHexIds.includes(hex.id)) {
                const count = (b.type === 'city') ? 2 : 1;
                player.resources[hex.resource] = (player.resources[hex.resource] || 0) + count;

                let pLog = gainedSummary.find(g => g.playerId === player.id);
                if (!pLog) {
                  pLog = { playerId: player.id, name: player.name, color: player.color, gained: {} };
                  gainedSummary.push(pLog);
                }
                pLog.gained[hex.resource] = (pLog.gained[hex.resource] || 0) + count;
              }
            });
          });
        }
      });
    }

    io.emit('diceRolled', { d1, d2, sum, gainedSummary, gameState });
  });

  // ⑥ 銀行・港トレード処理
  socket.on('bankTrade', (data) => {
    const p = gameState.players[gameState.turnIndex];
    if (!p || p.id !== socket.id || !gameState.hasRolled || gameState.phase !== 'PLAYING') return;

    const { giveRes, getRes, ratio } = data;
    if (p.resources[giveRes] >= ratio) {
      p.resources[giveRes] -= ratio;
      p.resources[getRes] = (p.resources[getRes] || 0) + 1;
      io.emit('gameStateUpdate', gameState);
    } else {
      socket.emit('errorMsg', '交換に必要な資源が不足しています。');
    }
  });

  // ⑦ プレイヤー間トレード提案（1対1限定）
  socket.on('proposeTrade', (data) => {
    const p = gameState.players[gameState.turnIndex];
    if (!p || p.id !== socket.id || !gameState.hasRolled || gameState.phase !== 'PLAYING') return;
    if (!data.targetPlayerId || data.targetPlayerId === 'ALL') return;

    gameState.currentTrade = {
      senderId: socket.id,
      senderName: p.name,
      targetPlayerId: data.targetPlayerId,
      give: data.give,
      get: data.get
    };

    io.to(data.targetPlayerId).emit('tradeProposalReceived', gameState.currentTrade);
  });

  // ⑧ トレード承認（成立）
  socket.on('acceptTrade', () => {
    if (!gameState.currentTrade) return;

    const sender = gameState.players.find(p => p.id === gameState.currentTrade.senderId);
    const receiver = gameState.players.find(p => p.id === socket.id);

    if (!sender || !receiver) return;

    const give = gameState.currentTrade.give;
    const get = gameState.currentTrade.get;

    let canTrade = true;
    for (let res in give) { if ((sender.resources[res] || 0) < give[res]) canTrade = false; }
    for (let res in get) { if ((receiver.resources[res] || 0) < get[res]) canTrade = false; }

    if (canTrade) {
      for (let res in give) {
        sender.resources[res] -= give[res];
        receiver.resources[res] += give[res];
      }
      for (let res in get) {
        receiver.resources[res] -= get[res];
        sender.resources[res] += get[res];
      }
      gameState.currentTrade = null;
      io.emit('closeTradePanel');
      io.emit('gameStateUpdate', gameState);
    } else {
      socket.emit('errorMsg', 'トレードに必要な資源が不足しています。');
    }
  });

  // ⑨ トレード拒否
  socket.on('rejectTrade', () => {
    gameState.currentTrade = null;
    io.emit('closeTradePanel');
  });

  // ⑩ 対案（カウンターオファー）送信
  socket.on('counterTradeProposal', (data) => {
    if (!gameState.currentTrade) return;
    const originalSenderId = gameState.currentTrade.senderId;
    const counterSender = gameState.players.find(p => p.id === socket.id);

    gameState.currentTrade = {
      senderId: socket.id,
      senderName: `${counterSender.name} (対案)`,
      targetPlayerId: originalSenderId,
      give: data.give,
      get: data.get
    };

    io.to(originalSenderId).emit('tradeProposalReceived', gameState.currentTrade);
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

  // ⑤ 建築・発展カード購入処理
  socket.on('buildStructure', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;

    if (data.type === 'settlement') {
      if (player.resources.wood >= 1 && player.resources.brick >= 1 && player.resources.wool >= 1 && player.resources.wheat >= 1) {
        player.resources.wood -= 1;
        player.resources.brick -= 1;
        player.resources.wool -= 1;
        player.resources.wheat -= 1;
        player.buildings.push({ type: 'settlement', vertexId: data.vertexId, touchingHexIds: data.extraData?.touchingHexIds || [] });
        player.victoryPoints += 1;
      }
    } else if (data.type === 'city') {
      if (player.resources.ore >= 3 && player.resources.wheat >= 2) {
        player.resources.ore -= 3;
        player.resources.wheat -= 2;
        const bIdx = player.buildings.findIndex(b => b.vertexId === data.vertexId && b.type === 'settlement');
        if (bIdx !== -1) player.buildings.splice(bIdx, 1);
        player.buildings.push({ type: 'city', vertexId: data.vertexId });
        player.victoryPoints += 1;
      }
    } else if (data.type === 'road') {
      if (player.resources.wood >= 1 && player.resources.brick >= 1) {
        player.resources.wood -= 1;
        player.resources.brick -= 1;
        player.roads.push({ edgeId: data.edgeId });
      }
    } else if (data.type === 'devCard') { // 発展カードの購入
      if (player.resources.ore >= 1 && player.resources.wheat >= 1 && player.resources.wool >= 1) {
        if (gameState.devCardDeck && gameState.devCardDeck.length > 0) {
          player.resources.ore -= 1;
          player.resources.wheat -= 1;
          player.resources.wool -= 1;

          const drawnType = gameState.devCardDeck.pop();
          player.devCards.push({
            id: `dev_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: drawnType,
            boughtTurn: gameState.turnCount
          });
        } else {
          socket.emit('errorMsg', '発展カードの山札が残っていません。');
          return;
        }
      } else {
        socket.emit('errorMsg', '資源が不足しています（鉱石1, 小麦1, 羊毛1）。');
        return;
      }
    }

    io.emit('gameStateUpdate', gameState);
  });

  // 切断処理
  socket.on('disconnect', () => {
    console.log(`[切断] ユーザー切断: ${socket.id}`);
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    if (gameState.players.length === 0) {
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
