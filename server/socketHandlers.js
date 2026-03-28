import {
  joinRoom,
  leaveRoom,
  voteMove,
  useDoubleVote,
  useAI,
  chatMessage,
  toggleVoice,
  setSpeakingStatus,
  broadcastGameState,
  findRoomBySocket
} from './gameManager.js';

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('joinGame', (payload) => {
      try {
        if (!payload || typeof payload !== 'object') {
          throw new Error('Payload invalide');
        }
        
        const { nickname, room, team } = payload;
        const roomName = joinRoom(io, socket, { nickname, room, team });
        socket.emit('joined', { room: roomName });
      } catch (error) {
        console.error('joinGame error:', error.message);
        socket.emit('errorMsg', { message: error.message || 'Impossible de rejoindre la partie.' });
      }
    });

    socket.on('voteMove', (payload) => {
      try {
        if (!payload || typeof payload !== 'object') {
          socket.emit('errorMsg', { message: 'Vote invalide : données manquantes' });
          return;
        }
        voteMove(io, socket, payload);
      } catch (error) {
        console.error('voteMove socket error:', error);
        socket.emit('errorMsg', { message: 'Erreur lors du vote' });
      }
    });

    socket.on('useDoubleVote', () => {
      try {
        useDoubleVote(io, socket);
      } catch (error) {
        console.error('useDoubleVote socket error:', error);
        socket.emit('errorMsg', { message: 'Erreur lors de l\'activation du double vote' });
      }
    });

    socket.on('useAI', () => {
      try {
        useAI(io, socket);
      } catch (error) {
        console.error('useAI socket error:', error);
        socket.emit('errorMsg', { message: 'Erreur lors de l\'utilisation de l\'IA' });
      }
    });

    socket.on('toggleVoice', (enabled) => {
      try {
        toggleVoice(io, socket, enabled);
      } catch (error) {
        console.error('toggleVoice socket error:', error);
        socket.emit('errorMsg', { message: 'Erreur lors du changement de statut vocal' });
      }
    });

    socket.on('speakingStatus', (isSpeaking) => {
      try {
        setSpeakingStatus(io, socket, isSpeaking);
      } catch (error) {
        console.error('speakingStatus socket error:', error);
      }
    });

    socket.on('chatMessage', (payload) => {
      try {
        const text = typeof payload === 'string' ? payload : payload && payload.text;
        if (!text) {
          socket.emit('errorMsg', { message: 'Message vide' });
          return;
        }
        chatMessage(io, socket, text);
      } catch (error) {
        console.error('chatMessage socket error:', error);
        socket.emit('errorMsg', { message: 'Erreur lors de l\'envoi du message' });
      }
    });

    socket.on('disconnect', () => {
      try {
        leaveRoom(io, socket);
      } catch (error) {
        console.error('disconnect error:', error);
      }
    });

    socket.on('requestState', () => {
      try {
        const room = findRoomBySocket(socket.id);
        if (room) broadcastGameState(io, room.name);
      } catch (error) {
        console.error('requestState error:', error);
      }
    });
  });
}

export { registerSocketHandlers };
