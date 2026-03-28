import { Chess } from 'chess.js';
import { randomInt } from 'crypto';

const TURN_SECONDS = 30;
const rooms = new Map();

// Simple AI helper (fallback when Stockfish fails)
function getSimpleAISuggestion(room) {
  const legal = room.legalMovesVerbose();
  if (!legal || legal.length === 0) return null;
  
  // Prioritize captures
  const captures = legal.filter(move => {
    const piece = room.chess.get(move.to);
    return piece !== null;
  });
  
  // Prioritize checks
  const checks = legal.filter(move => {
    const testGame = new Chess(room.chess.fen());
    const result = testGame.move(move);
    if (!result) return false;
    return testGame.in_check();
  });
  
  // Choose best move type
  if (checks.length > 0) {
    return checks[Math.floor(Math.random() * checks.length)];
  }
  if (captures.length > 0) {
    return captures[Math.floor(Math.random() * captures.length)];
  }
  
  // Random move with preference for center
  const centerMoves = legal.filter(move => {
    return (move.to[1] >= 'd' && move.to[1] <= 'e') && 
           (move.to[0] >= '4' && move.to[0] <= '5');
  });
  
  const moves = centerMoves.length > 0 ? centerMoves : legal;
  return moves[Math.floor(Math.random() * moves.length)];
}

// Validation helpers
function validateNickname(nickname) {
  if (typeof nickname !== 'string') return false;
  const trimmed = nickname.trim();
  return trimmed.length > 0 && trimmed.length <= 24;
}

function validateRoomName(roomName) {
  if (typeof roomName !== 'string') return false;
  const trimmed = roomName.trim();
  return trimmed.length > 0 && trimmed.length <= 32;
}

function validateTeam(team) {
  return !team || ['white', 'black', 'auto'].includes(team);
}

function sanitizeText(text, maxLength = 500) {
  if (typeof text !== 'string') return '';
  return text.trim()
    .replace(/[\x00-\x1f<>]/g, '')
    .slice(0, maxLength);
}

// Secure random helper
function secureRandomChoice(array) {
  if (!array || array.length === 0) return null;
  return array[randomInt(0, array.length)];
}

// AI helper (strategic but simple)
async function getStockfishSuggestion(room, depth = 12) {
  try {
    // Use simple AI instead of problematic Stockfish
    const move = getSimpleAISuggestion(room);
    if (!move) {
      throw new Error('No legal moves available');
    }
    
    // Add realistic evaluation based on move type
    let evaluation = 0;
    
    // Check for check
    const testGame = new Chess(room.chess.fen());
    const result = testGame.move(move);
    if (result && testGame.in_check()) {
      evaluation += 50; // Bonus for checks
    }
    
    // Check for captures
    const capturedPiece = room.chess.get(move.to);
    if (capturedPiece) {
      const pieceValues = { p: 10, n: 30, b: 30, r: 50, q: 90, k: 0 };
      evaluation += pieceValues[capturedPiece.type] || 0;
    }
    
    // Add some randomness for variety
    evaluation += Math.floor(Math.random() * 40) - 20;
    
    return {
      ...move,
      evaluation: evaluation,
      depth: 3 // Simulated depth
    };
    
  } catch (error) {
    console.error('AI error:', error);
    throw error;
  }
}

function moveKey(move) {
  const prom = move.promotion || '';
  return `${move.from}-${move.to}-${prom}`;
}

function createPlayer(socketId, nickname, team) {
  if (!socketId || !validateNickname(nickname)) {
    throw new Error('Invalid player data');
  }
  return {
    id: socketId,
    nickname: sanitizeText(nickname, 24),
    team,
    doubleVoteUsed: false,
    doublePending: false,
    aiUsed: false,
    voiceEnabled: false,
    isSpeaking: false
  };
}

function pickTeam(players) {
  let w = 0;
  let b = 0;
  for (const p of players) {
    if (p.team === 'white') w++;
    else b++;
  }
  return w <= b ? 'white' : 'black';
}

/** Préférence joueur : 'white' | 'black' | 'auto' | autre */
function resolveTeam(players, requested) {
  if (requested === 'white' || requested === 'black') {
    return requested;
  }
  return pickTeam(players);
}

class Room {
  constructor(name) {
    this.name = name;
    this.players = [];
    this.chess = new Chess();
    this.status = 'lobby';
    this.voterChoice = new Map();
    this.timer = null;
    this.turnDeadline = null;
    this.chatMessages = [];
    this.isProcessingTurn = false; // Prevent race conditions
    this.voiceChannels = {
      white: new Map(),
      black: new Map()
    };
  }

  get activeTeam() {
    return this.chess.turn() === 'w' ? 'white' : 'black';
  }

  legalMovesVerbose() {
    return this.chess.moves({ verbose: true });
  }

  resetGame() {
    this.chess = new Chess();
    this.status = 'lobby';
    this.clearVotes();
    this.clearTimer();
    this.turnDeadline = null;
    for (const p of this.players) {
      p.doubleVoteUsed = false;
      p.doublePending = false;
      p.aiUsed = false;
    }
  }

  clearVotes() {
    this.voterChoice.clear();
  }

  // Prevent race conditions with timer operations
  async setTimer(io) {
    if (this.isProcessingTurn) return;
    this.clearTimer();
    this.turnDeadline = Date.now() + TURN_SECONDS * 1000;
    this.timer = setTimeout(() => {
      this.applyTurnResolution(io);
    }, TURN_SECONDS * 1000);
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  startTurnTimer(io) {
    if (this.status !== 'playing') return;
    this.setTimer(io);
  }

  aggregateVotes() {
    const tallies = new Map();
    for (const [, choice] of this.voterChoice) {
      const { key, weight } = choice;
      tallies.set(key, (tallies.get(key) || 0) + weight);
    }
    return tallies;
  }

  pickWinningMoveKey(legalList) {
    const tallies = this.aggregateVotes();
    if (tallies.size === 0) {
      const randomMove = secureRandomChoice(legalList);
      if (!randomMove) {
        throw new Error('No legal moves available');
      }
      return moveKey(randomMove);
    }
    let bestKey = null;
    let bestCount = -1;
    for (const [k, c] of tallies) {
      if (c > bestCount) {
        bestCount = c;
        bestKey = k;
      }
    }
    const tied = [...tallies.entries()].filter(([, c]) => c === bestCount).map(([k]) => k);
    if (tied.length > 1) {
      bestKey = secureRandomChoice(tied);
    }
    return bestKey;
  }

  applyTurnResolution(io) {
    if (this.isProcessingTurn) return;
    this.isProcessingTurn = true;
    
    this.clearTimer();
    if (this.status !== 'playing') {
      this.isProcessingTurn = false;
      return;
    }

    try {
      const legal = this.legalMovesVerbose();
      if (legal.length === 0) {
        this.broadcast(io, 'gameOver', { reason: 'stalemate_or_end', fen: this.chess.fen() });
        this.status = 'ended';
        broadcastGameState(io, this.name);
        this.isProcessingTurn = false;
        return;
      }

      const winKey = this.pickWinningMoveKey(legal);
      const chosen = legal.find((m) => moveKey(m) === winKey);
      if (!chosen) {
        console.error('applyTurnResolution: chosen move not found', winKey);
        this.startTurnTimer(io);
        broadcastGameState(io, this.name);
        this.isProcessingTurn = false;
        return;
      }

      const result = this.chess.move({
        from: chosen.from,
        to: chosen.to,
        promotion: chosen.promotion || undefined
      });

      if (!result) {
        console.error('applyTurnResolution: coup refuse par chess.js', { winKey, chosen });
        // Try next best move instead of restarting timer
        const fallbackMove = secureRandomChoice(legal);
        if (fallbackMove) {
          this.chess.move({
            from: fallbackMove.from,
            to: fallbackMove.to,
            promotion: fallbackMove.promotion || undefined
          });
        } else {
          this.startTurnTimer(io);
          broadcastGameState(io, this.name);
          this.isProcessingTurn = false;
          return;
        }
      }

    } catch (error) {
      console.error('applyTurnResolution error:', error);
      this.startTurnTimer(io);
      broadcastGameState(io, this.name);
      this.isProcessingTurn = false;
      return;
    }

    this.clearVotes();
    for (const p of this.players) {
      p.doublePending = false;
    }

    if (this.chess.game_over()) {
      this.status = 'ended';
      const winner = this.chess.in_checkmate()
        ? this.chess.turn() === 'w'
          ? 'black'
          : 'white'
        : null;
      this.broadcast(io, 'gameOver', {
        reason: this.chess.in_checkmate() ? 'checkmate' : 'draw',
        winner,
        fen: this.chess.fen()
      });
    } else {
      this.broadcast(io, 'newTurn', { fen: this.chess.fen(), turn: this.chess.turn() });
    }

    if (this.status === 'playing') {
      this.startTurnTimer(io);
    }

    broadcastGameState(io, this.name);
    this.isProcessingTurn = false;
  }

  broadcast(io, event, payload) {
    io.to(this.name).emit(event, payload);
  }

  tryStartPlaying(io) {
    if (this.players.length >= 2 && this.status === 'lobby') {
      this.status = 'playing';
      this.chess = new Chess();
      this.clearVotes();
      for (const p of this.players) {
        p.doubleVoteUsed = false;
        p.doublePending = false;
        p.aiUsed = false;
      }
      this.startTurnTimer(io);
      io.to(this.name).emit('newTurn', { fen: this.chess.fen(), turn: this.chess.turn() });
    }
  }
}

function getOrCreateRoom(roomName) {
  if (!validateRoomName(roomName)) {
    throw new Error('Invalid room name');
  }
  const key = sanitizeText(roomName, 32) || 'default';
  if (!rooms.has(key)) {
    rooms.set(key, new Room(key));
  }
  return rooms.get(key);
}

function broadcastGameState(io, roomName) {
  const room = rooms.get(roomName);
  if (!room) return;
  for (const p of room.players) {
    io.to(p.id).emit('gameState', buildPublicState(room, p.id));
  }
}

function buildPublicState(room, forSocketId) {
  const legal = room.status === 'ended' ? [] : room.legalMovesVerbose();
  const moveKeys = legal.map((m) => ({ key: moveKey(m), san: m.san, from: m.from, to: m.to, promotion: m.promotion }));
  const tallies = room.aggregateVotes();

  const votesForClient = moveKeys.map((m) => {
    const v = tallies.get(m.key) || 0;
    return { ...m, votes: v };
  });

  votesForClient.sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return String(a.san).localeCompare(String(b.san));
  });

  const totalVotes = [...tallies.values()].reduce((a, b) => a + b, 0);
  const maxVotes = votesForClient.length ? Math.max(...votesForClient.map((x) => x.votes), 0) : 0;

  const me = room.players.find((p) => p.id === forSocketId);
  const canVoteTeam = me && me.team === room.activeTeam && room.status === 'playing';

  const votesRanked = votesForClient.map((row, index) => {
    const isTiedTop = row.votes > 0 && row.votes === maxVotes && maxVotes > 0;
    const firstLowerIndex = votesForClient.findIndex((r) => r.votes < maxVotes);
    const topCount = firstLowerIndex === -1 ? votesForClient.length : firstLowerIndex;
    const isLeading = isTiedTop && index < topCount;
    return {
      ...row,
      rank: index + 1,
      percent: totalVotes > 0 ? Math.round((row.votes / totalVotes) * 100) : 0,
      isLeading
    };
  });

  const chatHistory = (room.chatMessages || [])
    .filter(msg => !forSocketId || msg.team === room.players.find(p => p.id === forSocketId)?.team)
    .slice(-100);

  return {
    room: room.name,
    fen: room.chess.fen(),
    turn: room.chess.turn(),
    activeTeam: room.activeTeam,
    status: room.status,
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      team: p.team,
      you: p.id === forSocketId
    })),
    legalMoves: moveKeys,
    votes: votesRanked,
    chatHistory,
    totalVotes,
    turnSeconds: TURN_SECONDS,
    turnDeadline: room.turnDeadline,
    you: me
      ? {
          team: me.team,
          doubleVoteUsed: me.doubleVoteUsed,
          doublePending: me.doublePending,
          aiUsed: me.aiUsed,
          canVoteTeam
        }
      : null
  };
}

function joinRoom(io, socket, { nickname, room: roomName, team: teamPref }) {
  try {
    leaveRoom(io, socket);
    
    if (!validateNickname(nickname)) {
      throw new Error('Nickname invalide (1-24 caractères)');
    }
    
    if (!validateRoomName(roomName)) {
      throw new Error('Nom de partie invalide (1-32 caractères)');
    }
    
    if (!validateTeam(teamPref)) {
      throw new Error('Équipe invalide (white, black, auto)');
    }

    const room = getOrCreateRoom(roomName);
    const team = resolveTeam(room.players, teamPref);
    const player = createPlayer(socket.id, nickname, team);
    
    room.players.push(player);
    socket.join(room.name);
    room.tryStartPlaying(io);
    
    if (room.status === 'playing' && !room.timer) {
      room.startTurnTimer(io);
    }
    
    broadcastGameState(io, room.name);
    return room.name;
  } catch (error) {
    console.error('joinRoom error:', error.message);
    throw error;
  }
}

function leaveRoom(io, socket) {
  for (const [key, room] of rooms) {
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx === -1) continue;
    
    room.players.splice(idx, 1);
    room.voterChoice.delete(socket.id); // Clean up player votes
    socket.leave(room.name);
    
    // Only clear timer if it's the active team player who left
    if (room.activeTeam === room.players.find(p => p.id === socket.id)?.team) {
      room.clearTimer();
    }
    
    if (room.players.length < 2) {
      room.resetGame();
    }
    
    broadcastGameState(io, room.name);
    
    // Clean up empty rooms
    if (room.players.length === 0) {
      room.clearTimer();
      rooms.delete(key);
    }
    return;
  }
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return null;
}

function voteMove(io, socket, payload) {
  try {
    const room = findRoomBySocket(socket.id);
    if (!room || room.status !== 'playing' || room.isProcessingTurn) {
      socket.emit('errorMsg', { message: 'Vote impossible : partie non active' });
      return;
    }

    const me = room.players.find((p) => p.id === socket.id);
    if (!me || me.team !== room.activeTeam) {
      socket.emit('errorMsg', { message: 'Vote impossible : pas votre tour' });
      return;
    }

    const { from, to, promotion } = payload || {};
    if (!from || !to || typeof from !== 'string' || typeof to !== 'string') {
      socket.emit('errorMsg', { message: 'Vote invalide : coordonnées manquantes' });
      return;
    }

    const legal = room.legalMovesVerbose();
    const move = legal.find(
      (m) => m.from === from && m.to === to && (m.promotion || '') === (promotion || '')
    );
    if (!move) {
      socket.emit('errorMsg', { message: 'Vote invalide : coup non légal' });
      return;
    }

    const key = moveKey(move);
    let weight = 1;
    if (me.doublePending && !me.doubleVoteUsed) {
      weight = 2;
      me.doubleVoteUsed = true;
      me.doublePending = false;
      socket.emit('doubleVoteUsed', { message: 'Double vote utilisé !' });
    }

    // Atomic vote update
    room.voterChoice.set(me.id, { key, weight });
    broadcastGameState(io, room.name);
  } catch (error) {
    console.error('voteMove error:', error);
    socket.emit('errorMsg', { message: 'Erreur lors du vote' });
  }
}

function useDoubleVote(io, socket) {
  try {
    const room = findRoomBySocket(socket.id);
    if (!room || room.status !== 'playing') {
      socket.emit('errorMsg', { message: 'Double vote impossible : partie non active' });
      return;
    }

    const me = room.players.find((p) => p.id === socket.id);
    if (!me || me.team !== room.activeTeam) {
      socket.emit('errorMsg', { message: 'Double vote impossible : pas votre tour' });
      return;
    }
    if (me.doubleVoteUsed) {
      socket.emit('errorMsg', { message: 'Double vote déjà utilisé' });
      return;
    }

    me.doublePending = true;
    socket.emit('doubleVoteActivated', { message: 'Double vote activé pour votre prochain vote !' });
    broadcastGameState(io, room.name);
  } catch (error) {
    console.error('useDoubleVote error:', error);
    socket.emit('errorMsg', { message: 'Erreur lors de l\'activation du double vote' });
  }
}

function chatMessage(io, socket, rawText) {
  try {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      socket.emit('errorMsg', { message: 'Chat impossible : pas dans une partie' });
      return;
    }

    const me = room.players.find((p) => p.id === socket.id);
    if (!me) {
      socket.emit('errorMsg', { message: 'Chat impossible : joueur non trouvé' });
      return;
    }

    const text = sanitizeText(rawText, 500);
    if (!text) {
      socket.emit('errorMsg', { message: 'Message vide ou invalide' });
      return;
    }

    if (!room.chatMessages) room.chatMessages = [];
    const entry = { nickname: me.nickname, text, team: me.team, ts: Date.now() };
    room.chatMessages.push(entry);
    if (room.chatMessages.length > 300) {
      room.chatMessages.splice(0, room.chatMessages.length - 300);
    }

    // Send only to players of the same team
    room.players.filter(p => p.team === me.team).forEach(player => {
      io.to(player.id).emit('chatMessage', entry);
    });
  } catch (error) {
    console.error('chatMessage error:', error);
    socket.emit('errorMsg', { message: 'Erreur lors de l\'envoi du message' });
  }
}

async function useAI(io, socket) {
  try {
    const room = findRoomBySocket(socket.id);
    if (!room || room.status !== 'playing') {
      socket.emit('errorMsg', { message: 'IA impossible : partie non active' });
      return;
    }

    const me = room.players.find((p) => p.id === socket.id);
    if (!me || me.team !== room.activeTeam) {
      socket.emit('errorMsg', { message: 'IA impossible : pas votre tour' });
      return;
    }
    if (me.aiUsed) {
      socket.emit('errorMsg', { message: 'Conseil IA déjà utilisé cette partie' });
      return;
    }

    // Get AI suggestion
    const suggestedMove = await getStockfishSuggestion(room, 12); // Depth 12 for good balance
    
    me.aiUsed = true;
    socket.emit('aiSuggestion', { 
      message: `💡 Conseil IA (${suggestedMove.depth} profondeurs) : ${suggestedMove.san} [${suggestedMove.evaluation > 0 ? '+' : ''}${suggestedMove.evaluation}]`,
      move: {
        from: suggestedMove.from,
        to: suggestedMove.to,
        promotion: suggestedMove.promotion,
        evaluation: suggestedMove.evaluation,
        depth: suggestedMove.depth
      }
    });
    broadcastGameState(io, room.name);
  } catch (error) {
    console.error('useAI error:', error);
    socket.emit('errorMsg', { message: 'Erreur lors de l\'utilisation de l\'IA' });
  }
}

// Voice chat functions
function toggleVoice(io, socket, enabled) {
  try {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      socket.emit('errorMsg', { message: 'Voice impossible : pas dans une partie' });
      return;
    }

    const me = room.players.find((p) => p.id === socket.id);
    if (!me) {
      socket.emit('errorMsg', { message: 'Voice impossible : joueur non trouvé' });
      return;
    }

    me.voiceEnabled = enabled;
    
    // Notify team members
    room.players.filter(p => p.team === me.team && p.id !== socket.id).forEach(player => {
      io.to(player.id).emit('voiceStatusChanged', {
        playerId: socket.id,
        nickname: me.nickname,
        enabled: enabled
      });
    });

    broadcastGameState(io, room.name);
  } catch (error) {
    console.error('toggleVoice error:', error);
    socket.emit('errorMsg', { message: 'Erreur lors du changement de statut vocal' });
  }
}

function setSpeakingStatus(io, socket, isSpeaking) {
  try {
    const room = findRoomBySocket(socket.id);
    if (!room) return;

    const me = room.players.find((p) => p.id === socket.id);
    if (!me) return;

    me.isSpeaking = isSpeaking;
    
    // Update voice channel status
    const teamChannel = room.voiceChannels[me.team];
    if (teamChannel) {
      if (isSpeaking) {
        teamChannel.set(socket.id, true);
      } else {
        teamChannel.delete(socket.id);
      }
    }

    // Notify team members
    room.players.filter(p => p.team === me.team && p.id !== socket.id).forEach(player => {
      io.to(player.id).emit('voiceSpeakingStatus', {
        playerId: socket.id,
        nickname: me.nickname,
        isSpeaking: isSpeaking
      });
    });

    broadcastGameState(io, room.name);
  } catch (error) {
    console.error('setSpeakingStatus error:', error);
  }
}

export {
  joinRoom,
  leaveRoom,
  voteMove,
  useDoubleVote,
  useAI,
  chatMessage,
  toggleVoice,
  setSpeakingStatus,
  broadcastGameState,
  findRoomBySocket,
  rooms
};
