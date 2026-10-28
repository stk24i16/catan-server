// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // すべてのオリジン（PythonAnywhere含む）からの接続を許可
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname)));

const RESOURCE_MAP = {
  forest: { code: 'wood', name: '木材' },
  hills: { code: 'brick', name: '煉瓦' },
  pasture: { code: 'wool', name: '羊毛' },
  fields: { code: 'wheat', name: '小麦' },
  mountains: { code: 'ore', name: '鉱石' }
};

const RESOURCE_NAMES_JA = {
  wood: '木材',
  brick: '煉瓦',
  wool: '羊毛',
  wheat: '小麦',
  ore: '鉱石'
};

const EXACT_TILES = [
  { id: 0, type: 'desert',    number: 0 },
  { id: 1, type: 'fields',    number: 8 },
  { id: 2, type: 'pasture',   number: 11 },
  { id: 3, type: 'hills',     number: 6 },
  { id: 4, type: 'pasture',   number: 3 },
  { id: 5, type: 'forest',    number: 4 },
  { id: 6, type: 'mountains', number: 9 },
  { id: 7, type: 'forest',    number: 10 },
  { id: 8, type: 'fields',    number: 5 },
  { id: 9, type: 'hills',     number: 12 },
  { id: 10, type: 'forest',   number: 11 },
  { id: 11, type: 'pasture',  number: 5 },
  { id: 12, type: 'fields',   number: 2 },
  { id: 13, type: 'hills',    number: 9 },
  { id: 14, type: 'mountains',number: 4 },
  { id: 15, type: 'forest',   number: 8 },
  { id: 16, type: 'mountains',number: 6 },
  { id: 17, type: 'fields',   number: 2 },
  { id: 18, type: 'pasture',  number: 10 }
];

const PORT_HEX_PAIRS = [
  [{ hexId: 0, corner: 0 }, { hexId: 0, corner: 5 }],
  [{ hexId: 1, corner: 0 }, { hexId: 2, corner: 0 }],
  [{ hexId: 2, corner: 1 }, { hexId: 2, corner: 2 }],
  [{ hexId: 6, corner: 1 }, { hexId: 6, corner: 2 }],
  [{ hexId: 11, corner: 2 }, { hexId: 11, corner: 3 }],
  [{ hexId: 18, corner: 3 }, { hexId: 18, corner: 4 }],
  [{ hexId: 16, corner: 3 }, { hexId: 16, corner: 4 }],
  [{ hexId: 12, corner: 4 }, { hexId: 12, corner: 5 }],
  [{ hexId: 3, corner: 4 }, { hexId: 3, corner: 5 }]
];

function generateRandomPorts() {
  const portTypes = [
    { type: '3:1', label: '一般港 (3:1)', img: 'img/port-3to1.png' },
    { type: '3:1', label: '一般港 (3:1)', img: 'img/port-3to1.png' },
    { type: '3:1', label: '一般港 (3:1)', img: 'img/port-3to1.png' },
    { type: '3:1', label: '一般港 (3:1)', img: 'img/port-3to1.png' },
    { type: '3:1', label: '一般港 (3:1)', img: 'img/port-3to1.png' },
    { type: '2:1_wood', label: '木材港 (2:1)', resource: 'wood', img: 'img/port-wood.png' },
    { type: '2:1_brick', label: '煉瓦港 (2:1)', resource: 'brick', img: 'img/port-brick.png' },
    { type: '2:1_wool', label: '羊毛港 (2:1)', resource: 'wool', img: 'img/port-wool.png' },
    { type: '2:1_wheat', label: '小麦港 (2:1)', resource: 'wheat', img: 'img/port-wheat.png' },
    { type: '2:1_ore', label: '鉱石港 (2:1)', resource: 'ore', img: 'img/port-ore.png' }
  ];

  for (let i = portTypes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [portTypes[i], portTypes[j]] = [portTypes[j], portTypes[i]];
  }

  const resultPorts = [];
  PORT_HEX_PAIRS.forEach((pair, idx) => {
    const pInfo = portTypes[idx];
    pair.forEach(v => {
      resultPorts.push({
        type: pInfo.type,
        label: pInfo.label,
        resource: pInfo.resource || null,
        img: pInfo.img,
        hexId: v.hexId,
        corner: v.corner
      });
    });
  });
  return resultPorts;
}

function generateBalancedDevCardDeck() {
  const deck = [
    ...Array(14).fill('knight'),
    ...Array(5).fill('victoryPoint'),
    ...Array(2).fill('roadBuilding'),
    ...Array(2).fill('yearOfPlenty'),
    ...Array(2).fill('monopoly')
  ];

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createInitialGameState() {
  return {
    phase: 'LOBBY',
    setupPhase: 'NOT_STARTED',
    setupOrder: [],
    setupStep: 0,
    pendingSettlement: null,
    players: [],
    turnIndex: 0,
    turnCount: 0,
    dice: [1, 1],
    hasRolled: false,
    robberHexId: 0,
    isMovingRobber: false,
    pendingDiscardPlayers: [],
    board: { tiles: EXACT_TILES, ports: [] },
    devCardDeck: generateBalancedDevCardDeck(),
    activeTradeOffer: null,
    achievements: {
      longestRoadPlayerId: null,
      longestRoadLength: 4,
      largestArmyPlayerId: null,
      largestArmyCount: 2
    },
    winner: null,
    rematchVotes: {}
  };
}

let gameState = createInitialGameState();

const PLAYER_COLORS = ['red', 'blue', 'orange', 'white'];

const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wool: 1, wheat: 1 },
  city: { ore: 3, wheat: 2 },
  devCard: { ore: 1, wheat: 1, wool: 1 }
};

function canAfford(playerResources, cost) {
  for (let res in cost) {
    if ((playerResources[res] || 0) < cost[res]) return false;
  }
  return true;
}

function payCost(playerResources, cost) {
  for (let res in cost) {
    playerResources[res] -= cost[res];
  }
}

function calculateLongestRoadForPlayer(player) {
  const edges = player.roads || [];
  if (edges.length === 0) return 0;

  const graph = {};
  edges.forEach(r => {
    if (!graph[r.v1]) graph[r.v1] = [];
    if (!graph[r.v2]) graph[r.v2] = [];
    graph[r.v1].push(r.v2);
    graph[r.v2].push(r.v1);
  });

  let maxLength = 0;

  function dfs(v, visitedEdges) {
    let maxSub = 0;
    const neighbors = graph[v] || [];
    for (let neighbor of neighbors) {
      const edgeKey = Math.min(v, neighbor) + '-' + Math.max(v, neighbor);
      if (!visitedEdges.has(edgeKey)) {
        visitedEdges.add(edgeKey);
        const len = 1 + dfs(neighbor, visitedEdges);
        visitedEdges.delete(edgeKey);
        if (len > maxSub) maxSub = len;
      }
    }
    return maxSub;
  }

  for (let node in graph) {
    const len = dfs(parseInt(node), new Set());
    if (len > maxLength) maxLength = len;
  }

  return maxLength;
}

function updateAchievements() {
  gameState.players.forEach(p => {
    const len = calculateLongestRoadForPlayer(p);
    p.roadLength = len;
    if (len > gameState.achievements.longestRoadLength) {
      gameState.achievements.longestRoadLength = len;
      gameState.achievements.longestRoadPlayerId = p.id;
      io.emit('chatMessage', { sender: 'アチーブメント', text: `🏆 ${p.name} が最長街道 (${len}本) のアチーブメントを獲得しました！` });
    }
  });

  gameState.players.forEach(p => {
    const count = p.playedKnights || 0;
    if (count > gameState.achievements.largestArmyCount) {
      gameState.achievements.largestArmyCount = count;
      gameState.achievements.largestArmyPlayerId = p.id;
      io.emit('chatMessage', { sender: 'アチーブメント', text: `⚔️ ${p.name} が最大騎士力 (${count}回) のアチーブメントを獲得しました！` });
    }
  });
}

function calculatePlayerTotalScore(p) {
  let score = p.score;
  let vpCards = (p.devCards || []).filter(c => c.type === 'victoryPoint').length;
  score += vpCards;

  if (gameState.achievements.longestRoadPlayerId === p.id) score += 2;
  if (gameState.achievements.largestArmyPlayerId === p.id) score += 2;

  return score;
}

io.on('connection', (socket) => {
  socket.on('joinLobby', (username) => {
    if (gameState.phase !== 'LOBBY') return socket.emit('errorMsg', 'ゲーム進行中です。');
    if (gameState.players.length >= 4) return socket.emit('errorMsg', '満員です。');

    const player = {
      id: socket.id,
      name: username || `Player ${gameState.players.length + 1}`,
      color: null,
      score: 0,
      resources: { wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 },
      devCards: [],
      buildings: [],
      roads: [],
      playedKnights: 0,
      roadLength: 0,
      receivedInitialResources: false
    };

    gameState.players.push(player);
    io.emit('lobbyUpdate', {
      players: gameState.players,
      canStart: gameState.players.length >= 3 && gameState.players.length <= 4
    });
  });

  socket.on('startGame', () => {
    const numPlayers = gameState.players.length;
    if (numPlayers < 3 || numPlayers > 4) return;

    gameState.phase = 'INITIAL_SETUP';
    gameState.board.ports = generateRandomPorts();
    gameState.devCardDeck = generateBalancedDevCardDeck();

    const forward = Array.from({ length: numPlayers }, (_, i) => i);
    const backward = [...forward].reverse();
    gameState.setupOrder = [...forward, ...backward];
    gameState.setupStep = 0;
    gameState.turnIndex = gameState.setupOrder[0];
    gameState.setupPhase = 'SETTLEMENT';
    gameState.pendingSettlement = null;
    gameState.turnCount = 1;

    gameState.players.forEach((p, idx) => {
      p.color = PLAYER_COLORS[idx];
      p.score = 0;
      p.resources = { wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 };
      p.devCards = [];
      p.buildings = [];
      p.roads = [];
      p.playedKnights = 0;
      p.roadLength = 0;
      p.receivedInitialResources = false;
    });

    io.emit('gameStarted', gameState);
  });

  socket.on('placeInitialSettlement', ({ vertexId, hexId, corner, touchingHexCount, touchingHexIds }) => {
    if (gameState.phase !== 'INITIAL_SETUP' || gameState.setupPhase !== 'SETTLEMENT') return;
    const player = gameState.players[gameState.turnIndex];
    if (socket.id !== player.id) return;

    if (touchingHexCount < 3) return socket.emit('errorMsg', '外周の頂点には初期開拓地を配置できません。');

    const isOccupied = gameState.players.some(p => p.buildings.some(b => b.vertexId === vertexId));
    if (isOccupied) return socket.emit('errorMsg', 'すでに建物が存在します。');

    player.buildings.push({ vertexId, hexId, corner, type: 'settlement', touchingHexIds });
    player.score += 1;
    
    gameState.pendingSettlement = { vertexId, hexId, corner };
    gameState.setupPhase = 'ROAD';

    io.emit('gameStateUpdate', gameState);
  });

  socket.on('placeInitialRoad', ({ edgeId, v1, v2 }) => {
    if (gameState.phase !== 'INITIAL_SETUP' || gameState.setupPhase !== 'ROAD') return;
    const player = gameState.players[gameState.turnIndex];
    if (socket.id !== player.id) return;

    const isEdgeOccupied = gameState.players.some(p => p.roads.some(r => r.edgeId === edgeId));
    if (isEdgeOccupied) return socket.emit('errorMsg', '既に街道が存在する辺には配置できません。');

    player.roads.push({ edgeId, v1, v2 });
    gameState.pendingSettlement = null;
    gameState.setupStep += 1;

    if (gameState.setupStep >= gameState.setupOrder.length) {
      gameState.phase = 'INITIAL_RESOURCE_SELECT';
      gameState.setupPhase = 'COMPLETED';
      io.emit('chatMessage', { sender: 'システム', text: '初期配置が完了しました！初期資源を獲得する開拓地を選択してください。' });
    } else {
      gameState.turnIndex = gameState.setupOrder[gameState.setupStep];
      gameState.setupPhase = 'SETTLEMENT';
    }

    io.emit('gameStateUpdate', gameState);
  });

  socket.on('claimInitialResources', ({ vertexId }) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || player.receivedInitialResources) return;

    const building = player.buildings.find(b => b.vertexId === vertexId);
    if (!building) return socket.emit('errorMsg', '選択した開拓地が見つかりません。');

    let gainedNames = [];
    (building.touchingHexIds || []).forEach(hexId => {
      const tile = gameState.board.tiles.find(t => t.id === hexId);
      if (tile && tile.type !== 'desert') {
        const resInfo = RESOURCE_MAP[tile.type];
        if (resInfo) {
          player.resources[resInfo.code] += 1;
          gainedNames.push(resInfo.name);
        }
      }
    });

    player.receivedInitialResources = true;
    io.emit('chatMessage', { sender: 'システム', text: `${player.name} が初期資源 (${gainedNames.join(', ') || 'なし'}) を獲得しました。` });

    if (gameState.players.every(p => p.receivedInitialResources)) {
      gameState.phase = 'PLAYING';
      gameState.turnIndex = 0;
      gameState.hasRolled = false;
      io.emit('chatMessage', { sender: 'システム', text: '全プレイヤーが初期資源を受け取りました。通常プレイを開始します！' });
    }

    io.emit('gameStateUpdate', gameState);
  });

  socket.on('discardResources', ({ discardMap }) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;

    const totalRes = Object.values(player.resources).reduce((a, b) => a + b, 0);
    const unplayedDevs = player.devCards.length;
    const grandTotal = totalRes + unplayedDevs;

    if (grandTotal < 8) return;

    const requiredDiscard = Math.floor(grandTotal / 2);
    const submittedCount = Object.values(discardMap).reduce((a, b) => a + b, 0);

    if (submittedCount !== requiredDiscard) {
      return socket.emit('errorMsg', `捨てる枚数が正しくありません。ちょうど ${requiredDiscard} 枚指定してください。`);
    }

    for (let res in discardMap) {
      if (player.resources[res] < discardMap[res]) {
        return socket.emit('errorMsg', '所持枚数を超える資源は捨てられません。');
      }
    }

    for (let res in discardMap) {
      player.resources[res] -= discardMap[res];
    }

    gameState.pendingDiscardPlayers = gameState.pendingDiscardPlayers.filter(id => id !== socket.id);
    io.emit('chatMessage', { sender: 'システム', text: `${player.name} が手札を ${submittedCount} 枚捨てました。` });

    io.emit('gameStateUpdate', gameState);
  });

  socket.on('moveRobber', (hexId) => {
    const currentPlayer = gameState.players[gameState.turnIndex];
    if (socket.id !== currentPlayer.id || !gameState.isMovingRobber) return;
    if (hexId === gameState.robberHexId) return socket.emit('errorMsg', '同じマスには移動できません。');

    gameState.robberHexId = hexId;
    gameState.isMovingRobber = false;

    const victimCandidates = [];
    gameState.players.forEach(p => {
      if (p.id !== currentPlayer.id) {
        const hasBuildingOnHex = p.buildings.some(b => b.touchingHexIds && b.touchingHexIds.includes(hexId));
        const totalCardCount = Object.values(p.resources).reduce((a, b) => a + b, 0);
        if (hasBuildingOnHex && totalCardCount > 0) {
          victimCandidates.push({ id: p.id, name: p.name, color: p.color, cardCount: totalCardCount });
        }
      }
    });

    if (victimCandidates.length === 1) {
      executeRobbery(currentPlayer.id, victimCandidates[0].id);
    } else if (victimCandidates.length > 1) {
      socket.emit('selectRobberyTarget', victimCandidates);
    } else {
      io.emit('chatMessage', { sender: 'システム', text: `${currentPlayer.name} が盗賊を マス #${hexId} に移動させました。` });
      io.emit('gameStateUpdate', gameState);
    }
  });

  socket.on('chooseRobberyTarget', (targetPlayerId) => {
    const currentPlayer = gameState.players[gameState.turnIndex];
    if (socket.id !== currentPlayer.id) return;
    executeRobbery(currentPlayer.id, targetPlayerId);
  });

  function executeRobbery(robberId, victimId) {
    const robber = gameState.players.find(p => p.id === robberId);
    const victim = gameState.players.find(p => p.id === victimId);
    if (!robber || !victim) return;

    const availableRes = [];
    for (let res in victim.resources) {
      for (let i = 0; i < victim.resources[res]; i++) {
        availableRes.push(res);
      }
    }

    if (availableRes.length > 0) {
      const stolenRes = availableRes[Math.floor(Math.random() * availableRes.length)];
      victim.resources[stolenRes]--;
      robber.resources[stolenRes]++;
      const resName = RESOURCE_NAMES_JA[stolenRes] || stolenRes;
      io.emit('chatMessage', { sender: 'システム', text: `${robber.name} が ${victim.name} から資源 (${resName}) を1枚奪いました！` });
    }
    io.emit('gameStateUpdate', gameState);
  }

  // 1. ダイレクト配信型トレード通信処理
  socket.on('proposeTrade', ({ targetPlayerId, give, get }) => {
    const sender = gameState.players.find(p => p.id === socket.id);
    if (!sender) return;

    if (!canAfford(sender.resources, give)) {
      return socket.emit('errorMsg', '提案するための資源が手札にありません。');
    }

    gameState.activeTradeOffer = {
      senderId: sender.id,
      senderName: sender.name,
      targetPlayerId: targetPlayerId,
      give: give,
      get: get
    };

    if (targetPlayerId === 'ALL') {
      gameState.players.forEach(p => {
        if (p.id !== sender.id) {
          io.to(p.id).emit('tradeProposalReceived', gameState.activeTradeOffer);
        }
      });
    } else {
      io.to(targetPlayerId).emit('tradeProposalReceived', gameState.activeTradeOffer);
    }

    io.emit('gameStateUpdate', gameState);
    io.emit('chatMessage', { sender: 'システム', text: `${sender.name} がトレード案を提示しました。` });
  });

  socket.on('counterTradeProposal', ({ give, get }) => {
    const receiver = gameState.players.find(p => p.id === socket.id);
    const originalOffer = gameState.activeTradeOffer;
    if (!receiver || !originalOffer) return;

    if (!canAfford(receiver.resources, give)) {
      return socket.emit('errorMsg', '対案を出すための資源が手札にありません。');
    }

    gameState.activeTradeOffer = {
      senderId: receiver.id,
      senderName: `${receiver.name} (対案)`,
      targetPlayerId: originalOffer.senderId,
      give: give,
      get: get,
      isCounterOffer: true
    };

    io.to(originalOffer.senderId).emit('tradeProposalReceived', gameState.activeTradeOffer);
    io.emit('gameStateUpdate', gameState);
    io.emit('chatMessage', { sender: 'システム', text: `${receiver.name} が条件変更案（対案）を送り返しました。` });
  });

  socket.on('acceptTrade', () => {
    const offer = gameState.activeTradeOffer;
    if (!offer) return;

    const sender = gameState.players.find(p => p.id === offer.senderId);
    const receiver = gameState.players.find(p => p.id === socket.id);

    if (!sender || !receiver || sender.id === receiver.id) return;

    if (!canAfford(receiver.resources, offer.get)) return socket.emit('errorMsg', '手札の資源が足りません。');
    if (!canAfford(sender.resources, offer.give)) return socket.emit('errorMsg', '提案者の資源が足りません。');

    payCost(sender.resources, offer.give);
    for (let res in offer.get) receiver.resources[res] -= offer.get[res];

    for (let res in offer.give) receiver.resources[res] += offer.give[res];
    for (let res in offer.get) sender.resources[res] += offer.get[res];

    gameState.activeTradeOffer = null;
    io.emit('closeTradePanel');
    io.emit('gameStateUpdate', gameState);
    io.emit('chatMessage', { sender: 'システム', text: `${receiver.name} と ${sender.name} の間でトレードが成立しました！` });
  });

  socket.on('rejectTrade', () => {
    gameState.activeTradeOffer = null;
    io.emit('closeTradePanel');
    io.emit('gameStateUpdate', gameState);
    io.emit('chatMessage', { sender: 'システム', text: 'トレード案が辞退されました。' });
  });

  socket.on('useDevCard', ({ cardId, extraData }) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || gameState.players[gameState.turnIndex].id !== socket.id) return;

    const cardIdx = player.devCards.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;

    const card = player.devCards[cardIdx];
    if (card.boughtTurn === gameState.turnCount) {
      return socket.emit('errorMsg', '購入したターンの発展カードは使用できません。');
    }

    player.devCards.splice(cardIdx, 1);

    if (card.type === 'knight') {
      player.playedKnights = (player.playedKnights || 0) + 1;
      gameState.isMovingRobber = true;
      io.emit('chatMessage', { sender: 'システム', text: `${player.name} が騎士カードを使用！ (通算 ${player.playedKnights}回目)` });
    } else if (card.type === 'yearOfPlenty') {
      const { res1, res2 } = extraData || {};
      if (res1 && res2) {
        player.resources[res1] = (player.resources[res1] || 0) + 1;
        player.resources[res2] = (player.resources[res2] || 0) + 1;
        io.emit('chatMessage', { sender: 'システム', text: `${player.name} が収穫の年を使用し、${RESOURCE_NAMES_JA[res1]} と ${RESOURCE_NAMES_JA[res2]} を獲得！` });
      }
    } else if (card.type === 'monopoly') {
      const { targetRes } = extraData || {};
      if (targetRes) {
        let totalStolen = 0;
        gameState.players.forEach(other => {
          if (other.id !== player.id) {
            totalStolen += other.resources[targetRes] || 0;
            other.resources[targetRes] = 0;
          }
        });
        player.resources[targetRes] += totalStolen;
        io.emit('chatMessage', { sender: 'システム', text: `${player.name} が独占カードを使用し、${RESOURCE_NAMES_JA[targetRes]} を ${totalStolen} 枚獲得！` });
      }
    }

    updateAchievements();
    checkVictory(player);
    io.emit('gameStateUpdate', gameState);
  });

  socket.on('buildStructure', ({ type, vertexId, edgeId, extraData }) => {
    if (gameState.phase !== 'PLAYING') return;
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || gameState.players[gameState.turnIndex].id !== socket.id) return;

    const cost = COSTS[type];
    if (!cost || !canAfford(player.resources, cost)) {
      return socket.emit('errorMsg', '資源が不足しています。');
    }

    if (type === 'settlement') {
      payCost(player.resources, cost);
      player.buildings.push({ vertexId, type: 'settlement', touchingHexIds: extraData.touchingHexIds });
      player.score += 1;
      io.emit('chatMessage', { sender: 'システム', text: `${player.name} が開拓地を建設しました。` });
    } else if (type === 'city') {
      const b = player.buildings.find(b => b.vertexId === vertexId);
      if (b && b.type === 'settlement') {
        payCost(player.resources, cost);
        b.type = 'city';
        player.score += 1;
        io.emit('chatMessage', { sender: 'システム', text: `${player.name} が都市を建設しました。` });
      }
    } else if (type === 'road') {
      payCost(player.resources, cost);
      player.roads.push({ edgeId, v1: extraData.v1, v2: extraData.v2 });
      io.emit('chatMessage', { sender: 'システム', text: `${player.name} が街道を建設しました。` });
    } else if (type === 'devCard') {
      if (gameState.devCardDeck.length > 0) {
        payCost(player.resources, cost);
        const cardType = gameState.devCardDeck.pop();
        const cardObj = {
          id: `dev-${Date.now()}-${Math.random()}`,
          type: cardType,
          boughtTurn: gameState.turnCount
        };
        player.devCards.push(cardObj);
        io.emit('chatMessage', { sender: 'システム', text: `${player.name} が発展カードを購入しました。` });
      } else {
        return socket.emit('errorMsg', '発展カードが山札にありません。');
      }
    }

    updateAchievements();
    checkVictory(player);
    io.emit('gameStateUpdate', gameState);
  });

  socket.on('bankTrade', ({ giveRes, getRes, ratio }) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || gameState.players[gameState.turnIndex].id !== socket.id) return;

    if (player.resources[giveRes] >= ratio) {
      player.resources[giveRes] -= ratio;
      player.resources[getRes] += 1;
      const giveName = RESOURCE_NAMES_JA[giveRes] || giveRes;
      const getName = RESOURCE_NAMES_JA[getRes] || getRes;
      io.emit('gameStateUpdate', gameState);
      io.emit('chatMessage', { sender: 'システム', text: `${player.name} が ${giveName} ${ratio}枚 を ${getName} 1枚 と交換（銀行/港）しました。` });
    }
  });

  socket.on('rollDice', () => {
    if (gameState.phase !== 'PLAYING') return;
    const currentPlayer = gameState.players[gameState.turnIndex];
    if (socket.id !== currentPlayer.id || gameState.hasRolled) return;

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    gameState.dice = [d1, d2];
    gameState.hasRolled = true;

    const sum = d1 + d2;
    const acquiredResources = [];

    if (sum === 7) {
      const bustPlayers = [];
      gameState.players.forEach(p => {
        const totalRes = Object.values(p.resources).reduce((a, b) => a + b, 0);
        const totalDevs = p.devCards.length;
        if (totalRes + totalDevs >= 8) {
          bustPlayers.push(p.id);
        }
      });

      gameState.pendingDiscardPlayers = bustPlayers;
      gameState.isMovingRobber = true;
      io.emit('chatMessage', { sender: 'システム', text: `7が出ました！ ${bustPlayers.length > 0 ? '手札8枚以上のプレイヤーは半分捨ててください。' : ''}` });
    } else {
      const activeTiles = gameState.board.tiles.filter(t => t.number === sum && t.id !== gameState.robberHexId);
      
      activeTiles.forEach(tile => {
        const resInfo = RESOURCE_MAP[tile.type];
        if (!resInfo) return;

        gameState.players.forEach(p => {
          (p.buildings || []).forEach(b => {
            if (b.touchingHexIds && b.touchingHexIds.includes(tile.id)) {
              const amount = (b.type === 'city') ? 2 : 1;
              p.resources[resInfo.code] += amount;
              acquiredResources.push({
                playerName: p.name,
                color: p.color,
                resourceName: resInfo.name,
                amount: amount
              });
            }
          });
        });
      });
    }

    io.emit('animateDiceRoll', {
      dice: gameState.dice,
      sum: sum,
      hitHexIds: sum !== 7 ? gameState.board.tiles.filter(t => t.number === sum).map(t => t.id) : [],
      acquiredResources: acquiredResources
    });

    io.emit('gameStateUpdate', gameState);
  });

  socket.on('endTurn', () => {
    if (gameState.phase !== 'PLAYING') return;
    const currentPlayer = gameState.players[gameState.turnIndex];
    if (socket.id !== currentPlayer.id || !gameState.hasRolled || gameState.isMovingRobber || gameState.pendingDiscardPlayers.length > 0) return;

    gameState.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
    if (gameState.turnIndex === 0) gameState.turnCount++;
    gameState.hasRolled = false;
    gameState.activeTradeOffer = null;
    io.emit('closeTradePanel');

    io.emit('gameStateUpdate', gameState);
  });

  function checkVictory(player) {
    const totalScore = calculatePlayerTotalScore(player);
    if (totalScore >= 10 && gameState.phase !== 'GAME_OVER') {
      gameState.phase = 'GAME_OVER';
      gameState.winner = player.name;
      io.emit('chatMessage', { sender: 'システム', text: `🎉 ${player.name} が 10 ポイントに到達し、ゲームに勝利しました！` });
    }
  }

  socket.on('voteRematch', (vote) => {
    gameState.rematchVotes[socket.id] = vote;
    const voteCount = Object.keys(gameState.rematchVotes).length;

    if (voteCount >= gameState.players.length) {
      let rematchCount = 0;
      let endCount = 0;
      Object.values(gameState.rematchVotes).forEach(v => {
        if (v === 'REMATCH') rematchCount++;
        else endCount++;
      });

      if (rematchCount > endCount) {
        const savedPlayers = gameState.players.map(p => ({ id: p.id, name: p.name }));
        gameState = createInitialGameState();
        savedPlayers.forEach(sp => {
          gameState.players.push({
            id: sp.id,
            name: sp.name,
            color: null,
            score: 0,
            resources: { wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 },
            devCards: [],
            buildings: [],
            roads: [],
            playedKnights: 0,
            roadLength: 0,
            receivedInitialResources: false
          });
        });
        io.emit('chatMessage', { sender: 'システム', text: '投票の結果、再戦が決定しました！初期配置を開始します。' });
        
        gameState.phase = 'INITIAL_SETUP';
        gameState.board.ports = generateRandomPorts();
        const numP = gameState.players.length;
        const forward = Array.from({ length: numP }, (_, i) => i);
        const backward = [...forward].reverse();
        gameState.setupOrder = [...forward, ...backward];
        gameState.setupStep = 0;
        gameState.turnIndex = gameState.setupOrder[0];
        gameState.setupPhase = 'SETTLEMENT';

        gameState.players.forEach((p, idx) => { p.color = PLAYER_COLORS[idx]; });
        io.emit('gameStarted', gameState);
      } else {
        io.emit('chatMessage', { sender: 'システム', text: '投票の結果、ゲームを終了しロビーに戻ります。' });
        gameState = createInitialGameState();
        io.emit('returnToLobby');
      }
    } else {
      io.emit('gameStateUpdate', gameState);
    }
  });

  socket.on('disconnect', () => {
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
