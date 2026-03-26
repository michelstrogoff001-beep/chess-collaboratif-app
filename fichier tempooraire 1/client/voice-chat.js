// WebRTC Voice Chat Manager
class VoiceChatManager {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.peers = new Map(); // playerId -> peer connection
    this.isMuted = false;
    this.voiceEnabled = false;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.speakingThreshold = 0.02;
    this.speakingTimeout = null;
  }

  async initialize() {
    try {
      // Request microphone access
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      });

      // Setup audio analysis for speaking detection
      this.setupAudioAnalysis();
      
      console.log('Voice chat initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize voice chat:', error);
      this.showError('Impossible d\'accéder au microphone');
      return false;
    }
  }

  setupAudioAnalysis() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    const source = this.audioContext.createMediaStreamSource(this.localStream);
    source.connect(this.analyser);
    this.analyser.fftSize = 256;
    
    // Start speaking detection
    this.detectSpeaking();
  }

  detectSpeaking() {
    if (!this.analyser) return;
    
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length / 255; // Normalize to 0-1
    
    const isSpeaking = average > this.speakingThreshold;
    
    // Clear existing timeout
    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
    }
    
    // Set timeout to stop speaking after silence
    if (isSpeaking) {
      this.speakingTimeout = setTimeout(() => {
        this.onSpeakingStatusChanged(false);
      }, 500);
      this.onSpeakingStatusChanged(true);
    }
    
    // Continue detection
    requestAnimationFrame(() => this.detectSpeaking());
  }

  onSpeakingStatusChanged(isSpeaking) {
    if (this.socket) {
      this.socket.emit('speakingStatus', isSpeaking);
    }
  }

  toggleVoice(enabled) {
    this.voiceEnabled = enabled;
    
    if (enabled) {
      this.initialize().then(success => {
        if (success) {
          this.socket.emit('toggleVoice', true);
          this.showSuccess('Chat vocal activé');
        }
      });
    } else {
      this.cleanup();
      this.socket.emit('toggleVoice', false);
      this.showInfo('Chat vocal désactivé');
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }
    
    this.updateMuteButton();
    return this.isMuted;
  }

  createPeerConnection(playerId, initiator = false) {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    const peer = new SimplePeer({
      initiator: initiator,
      trickle: false,
      config: configuration,
      stream: this.localStream
    });

    peer.on('signal', (data) => {
      this.socket.emit('voiceSignal', {
        targetPlayerId: playerId,
        signal: data
      });
    });

    peer.on('stream', (stream) => {
      console.log('Received voice stream from', playerId);
      this.onRemoteStream(playerId, stream);
    });

    peer.on('connect', () => {
      console.log('Voice connection established with', playerId);
    });

    peer.on('close', () => {
      console.log('Voice connection closed with', playerId);
      this.removePeerConnection(playerId);
    });

    peer.on('error', (error) => {
      console.error('Peer connection error with', playerId, error);
    });

    this.peers.set(playerId, peer);
    return peer;
  }

  handleSignal(data) {
    const { sourcePlayerId, signal } = data;
    let peer = this.peers.get(sourcePlayerId);
    
    if (!peer) {
      peer = this.createPeerConnection(sourcePlayerId, false);
    }
    
    peer.signal(signal);
  }

  onRemoteStream(playerId, stream) {
    const audioElement = document.createElement('audio');
    audioElement.autoplay = true;
    audioElement.srcObject = stream;
    audioElement.id = `remote-audio-${playerId}`;
    
    // Store reference for cleanup
    this.remoteAudioElements = this.remoteAudioElements || new Map();
    this.remoteAudioElements.set(playerId, audioElement);
    
    console.log('Playing audio from', playerId);
  }

  removePeerConnection(playerId) {
    const peer = this.peers.get(playerId);
    if (peer) {
      peer.destroy();
      this.peers.delete(playerId);
    }
    
    // Remove audio element
    if (this.remoteAudioElements) {
      const audioElement = this.remoteAudioElements.get(playerId);
      if (audioElement) {
        audioElement.pause();
        audioElement.srcObject = null;
        audioElement.remove();
        this.remoteAudioElements.delete(playerId);
      }
    }
  }

  updateMuteButton() {
    const muteBtn = document.getElementById('voiceMuteBtn');
    if (muteBtn) {
      muteBtn.textContent = this.isMuted ? '🎤' : '🔇';
      muteBtn.className = this.isMuted ? 'voice-btn muted' : 'voice-btn';
    }
  }

  cleanup() {
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
      });
      this.localStream = null;
    }
    
    // Close all peer connections
    this.peers.forEach((peer, playerId) => {
      this.removePeerConnection(playerId);
    });
    
    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Clear timeout
    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
      this.speakingTimeout = null;
    }
  }

  // UI helper methods
  showError(message) {
    if (typeof showToast === 'function') {
      showToast(message, 'error');
    } else {
      console.error(message);
    }
  }

  showSuccess(message) {
    if (typeof showToast === 'function') {
      showToast(message, 'success');
    } else {
      console.log(message);
    }
  }

  showInfo(message) {
    if (typeof showToast === 'function') {
      showToast(message, 'info');
    } else {
      console.log(message);
    }
  }
}

// Export for use in main app
window.VoiceChatManager = VoiceChatManager;
