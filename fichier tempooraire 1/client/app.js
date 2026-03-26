/* global Chessboard, io, $ */

(function () {
  var socket = null;
  var board = null;
  var timerInterval = null;
  var gameClient = { state: null };
  var voiceChat = null;

  var lobby = document.getElementById('lobby');
  var gameEl = document.getElementById('game');
  var nicknameEl = document.getElementById('nickname');
  var roomEl = document.getElementById('room');
  var teamSelectEl = document.getElementById('teamSelect');
  var btnJoin = document.getElementById('btnJoin');
  var lobbyMsg = document.getElementById('lobbyMsg');

  var yourTeamEl = document.getElementById('yourTeam');
  var activeTeamEl = document.getElementById('activeTeam');
  var turnColorEl = document.getElementById('turnColor');
  var timerEl = document.getElementById('timer');
  var gameStatusEl = document.getElementById('gameStatus');
  var movesListEl = document.getElementById('movesList');
  var playersListEl = document.getElementById('playersList');
  var btnDouble = document.getElementById('btnDouble');
  var btnAI = document.getElementById('btnAI');
  var doubleStatusEl = document.getElementById('doubleStatus');
  var aiStatusEl = document.getElementById('aiStatus');
  var toastEl = document.getElementById('toast');
  
  // Voice chat elements
  var voiceToggleBtn = document.getElementById('voiceToggleBtn');
  var voiceMuteBtn = document.getElementById('voiceMuteBtn');
  var voiceStatusEl = document.getElementById('voiceStatus');
  var voiceParticipantsEl = document.getElementById('voiceParticipants');
  var chatMessagesEl = document.getElementById('chatMessages');
  var chatInputEl = document.getElementById('chatInput');
  var chatSendEl = document.getElementById('chatSend');

  function showToast(text, type = 'info') {
    toastEl.textContent = text;
    toastEl.className = 'toast';
    if (type === 'error') {
      toastEl.classList.add('error');
    } else if (type === 'success') {
      toastEl.classList.add('success');
    }
    toastEl.classList.remove('hidden');
    setTimeout(function () {
      toastEl.classList.add('hidden');
    }, 4000);
  }

  function renderChatHistory(list) {
    if (!chatMessagesEl) return;
    chatMessagesEl.innerHTML = '';
    (list || []).forEach(function (entry) {
      appendChatLine(entry, false);
    });
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function appendChatLine(entry, scroll) {
    if (!chatMessagesEl || !entry) return;
    var div = document.createElement('div');
    div.className = 'chat-line';
    var nick = document.createElement('span');
    nick.className = 'nick';
    nick.textContent = entry.nickname + ' : ';
    var text = document.createTextNode(entry.text);
    div.appendChild(nick);
    div.appendChild(text);
    chatMessagesEl.appendChild(div);
    if (scroll !== false) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function sendChat() {
    if (!socket || !chatInputEl) return;
    var t = (chatInputEl.value || '').trim();
    if (!t) return;
    socket.emit('chatMessage', { text: t });
    chatInputEl.value = '';
  }

  function initBoardOnce() {
    if (board) return;
    board = Chessboard('board', {
      position: 'start',
      draggable: true,
      pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
      onDragStart: function (source, piece) {
        var s = gameClient.state;
        if (!s || !s.you || !s.you.canVoteTeam || s.status !== 'playing') return false;
        if (s.activeTeam === 'white' && piece.search(/^b/) !== -1) return false;
        if (s.activeTeam === 'black' && piece.search(/^w/) !== -1) return false;
        return true;
      },
      onDrop: function (source, target) {
        var s = gameClient.state;
        if (!s || !s.legalMoves || !socket) return 'snapback';

        var matches = s.legalMoves.filter(function (m) {
          return m.from === source && m.to === target;
        });
        if (!matches.length) return 'snapback';

        var m = matches[0];
        if (matches.length > 1) {
          var queen = matches.find(function (x) {
            return x.promotion === 'q';
          });
          m = queen || matches[0];
        }

        socket.emit('voteMove', {
          from: m.from,
          to: m.to,
          promotion: m.promotion || undefined
        });
        showToast('Vote enregistré : ' + m.san);
        return 'snapback';
      },
      onSnapEnd: function () {}
    });
  }

  function updateTimer(deadline) {
    if (timerInterval) clearInterval(timerInterval);
    if (!deadline) {
      timerEl.textContent = '—';
      return;
    }
    function tick() {
      var left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      timerEl.textContent = String(left);
    }
    tick();
    timerInterval = setInterval(tick, 250);
  }

  function renderGameState(state) {
    gameClient.state = state;
    initBoardOnce();
    if (state.fen) board.position(state.fen);
    if (state.you && state.you.team === 'black') {
      board.orientation('black');
    } else {
      board.orientation('white');
    }

    if (state.you) {
      yourTeamEl.textContent = state.you.team === 'white' ? 'Blancs' : 'Noirs';
    }
    activeTeamEl.textContent = state.activeTeam === 'white' ? 'Blancs' : 'Noirs';
    turnColorEl.textContent = state.turn === 'w' ? 'Trait aux blancs' : 'Trait aux noirs';

    var statusLabels = {
      lobby: 'En attente (≥2 joueurs)',
      playing: 'En cours',
      ended: 'Terminé'
    };
    gameStatusEl.textContent = statusLabels[state.status] || state.status;

    updateTimer(state.turnDeadline);

    movesListEl.innerHTML = '';
    var votes = state.votes || [];
    var canVote = state.you && state.you.canVoteTeam;

    votes.forEach(function (row) {
      var div = document.createElement('div');
      div.className = 'move-row' + (row.isLeading ? ' leading' : '');

      var rank = document.createElement('div');
      rank.className = 'move-rank';
      rank.textContent = '#' + row.rank;

      var meta = document.createElement('div');
      meta.className = 'move-meta';
      meta.innerHTML = '<strong>' + row.san + '</strong> · ' + row.from + '→' + row.to;

      var votesSpan = document.createElement('div');
      votesSpan.className = 'move-votes';
      votesSpan.textContent = row.votes + ' vote(s) · ' + row.percent + '%';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Voter';
      btn.disabled = !canVote || state.status !== 'playing';
      btn.addEventListener('click', function () {
        socket.emit('voteMove', {
          from: row.from,
          to: row.to,
          promotion: row.promotion || undefined
        });
        showToast('Vote enregistré : ' + row.san);
      });

      div.appendChild(rank);
      div.appendChild(meta);
      div.appendChild(votesSpan);
      div.appendChild(btn);
      movesListEl.appendChild(div);
    });

    playersListEl.innerHTML = '';
    (state.players || []).forEach(function (p) {
      var li = document.createElement('li');
      li.textContent = p.nickname + ' — ' + (p.team === 'white' ? 'Blancs' : 'Noirs');
      if (p.you) li.className = 'you';
      playersListEl.appendChild(li);
    });

    if (state.you) {
      btnDouble.disabled =
        !state.you.canVoteTeam ||
        state.you.doubleVoteUsed ||
        state.status !== 'playing';
      
      btnAI.disabled =
        !state.you.canVoteTeam ||
        state.you.aiUsed ||
        state.status !== 'playing';
      
      // Update voice controls
      if (voiceToggleBtn) {
        voiceToggleBtn.disabled = false;
        voiceToggleBtn.textContent = state.you.voiceEnabled ? '🎤 Désactiver vocal' : '🎤 Activer vocal';
        voiceToggleBtn.className = state.you.voiceEnabled ? 'voice-btn' : 'voice-btn';
      }
      
      if (voiceMuteBtn) {
        voiceMuteBtn.disabled = !state.you.voiceEnabled;
      }
      
      if (state.you.doubleVoteUsed) {
        doubleStatusEl.textContent = 'Double vote déjà utilisé cette partie.';
      } else if (state.you.doublePending) {
        doubleStatusEl.textContent = 'Prochain vote comptera double.';
      } else {
        doubleStatusEl.textContent = '';
      }
      
      if (state.you.aiUsed) {
        aiStatusEl.textContent = 'Conseil IA déjà utilisé cette partie.';
      } else {
        aiStatusEl.textContent = '';
      }
      
      // Update voice status
      if (voiceStatusEl) {
        voiceStatusEl.textContent = state.you.voiceEnabled ? '🎤 Chat vocal actif' : '🔇 Chat vocal inactif';
      }
      
      // Update voice participants
      if (voiceParticipantsEl && state.voiceStatus) {
        voiceParticipantsEl.innerHTML = '';
        state.voiceStatus.forEach(participant => {
          const div = document.createElement('div');
          div.className = 'voice-participant' + (participant.isSpeaking ? ' speaking' : '');
          div.textContent = participant.nickname || 'Joueur';
          voiceParticipantsEl.appendChild(div);
        });
      }
    }

    renderChatHistory(state.chatHistory);
  }

  btnJoin.addEventListener('click', function () {
    var nick = (nicknameEl.value || '').trim();
    var room = (roomEl.value || '').trim();
    var team = teamSelectEl ? teamSelectEl.value : 'auto';
    if (!nick || !room) {
      lobbyMsg.textContent = 'Renseigne pseudo et nom de partie.';
      return;
    }
    if (socket) {
      socket.removeAllListeners();
      socket.close();
    }
    lobbyMsg.textContent = 'Connexion…';
    socket = io();
    btnJoin.disabled = true;

    socket.on('connect', function () {
      socket.emit('joinGame', { nickname: nick, room: room, team: team });
    });

    socket.on('joined', function () {
      lobby.classList.add('hidden');
      gameEl.classList.remove('hidden');
      lobbyMsg.textContent = '';
      btnJoin.disabled = false;
    });

    socket.on('gameState', function (state) {
      renderGameState(state);
    });

    socket.on('chatMessage', function (entry) {
      appendChatLine(entry, true);
    });

    socket.on('newTurn', function () {
      showToast('Nouveau tour — votez !');
    });

    socket.on('gameOver', function (data) {
      var m = 'Partie terminée : ' + (data.reason || '');
      if (data.winner) m += ' — Gagnant : ' + data.winner;
      showToast(m);
    });

    socket.on('doubleVoteUsed', function (data) {
      showToast(data.message || 'Double vote utilisé !');
    });

    socket.on('doubleVoteActivated', function (data) {
      showToast(data.message || 'Double vote activé !');
    });

    socket.on('aiSuggestion', function (data) {
      showToast(data.message, 'success');
      // Highlight the suggested move on the board
      if (data.move && board) {
        board.move(data.move.from + '-' + data.move.to);
        setTimeout(() => {
          board.position(gameClient.state.fen, false);
        }, 1000);
      }
    });

    socket.on('voiceStatusChanged', function (data) {
      console.log('Voice status changed:', data);
      // Update UI for team member voice status
    });

    socket.on('voiceSpeakingStatus', function (data) {
      console.log('Speaking status:', data);
      // Update speaking indicator
    });

    socket.on('voiceSignal', function (data) {
      if (voiceChat) {
        voiceChat.handleSignal(data);
      }
    });

    socket.on('errorMsg', function (err) {
      lobbyMsg.textContent = (err && err.message) || 'Erreur';
      showToast(err.message || 'Erreur');
    });

    socket.on('disconnect', function () {
      lobbyMsg.textContent = 'Déconnecté du serveur.';
      btnJoin.disabled = false;
    });

    socket.on('connect_error', function () {
      lobbyMsg.textContent = 'Impossible de joindre le serveur. Lance npm start dans chess-vote-mvp.';
      btnJoin.disabled = false;
    });
  });

  if (btnDouble) btnDouble.addEventListener('click', function () {
    if (socket) socket.emit('useDoubleVote');
  });
  
  if (btnAI) btnAI.addEventListener('click', function () {
    if (socket) socket.emit('useAI');
  });
  
  // Voice chat controls
  if (voiceToggleBtn) voiceToggleBtn.addEventListener('click', function () {
    if (!voiceChat) {
      voiceChat = new VoiceChatManager(socket);
    }
    const currentState = voiceChat.voiceEnabled;
    voiceChat.toggleVoice(!currentState);
  });
  
  if (voiceMuteBtn) voiceMuteBtn.addEventListener('click', function () {
    if (voiceChat) {
      voiceChat.toggleMute();
    }
  });

  if (chatSendEl) chatSendEl.addEventListener('click', sendChat);
  if (chatInputEl) {
    chatInputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChat();
      }
    });
  }
})();
