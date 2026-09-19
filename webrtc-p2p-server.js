const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Armazena APENAS metadados das salas (não vídeo!)
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('✓ Conexão:', socket.id);

  // Criador inicia sala
  socket.on('create-room', (data) => {
    const roomCode = Math.random().toString(36).substr(2, 8).toUpperCase();
    
    const room = {
      code: roomCode,
      creatorId: socket.id,
      creatorName: data.creatorName,
      videoName: data.videoName,
      viewers: [socket.id],
      createdAt: Date.now()
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);
    
    socket.emit('room-created', { roomCode, room });
    console.log(`📺 Sala criada: ${roomCode} (Criador: ${data.creatorName})`);
  });

  // Espectador entra na sala
  socket.on('join-room', (data) => {
    const { roomCode, userName } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Sala não encontrada' });
      return;
    }

    socket.join(roomCode);
    room.viewers.push(socket.id);
    socket.userData = { roomCode, userName };

    io.to(roomCode).emit('user-joined', {
      userId: socket.id,
      userName,
      viewerCount: room.viewers.length
    });

    console.log(`✓ ${userName} entrou em ${roomCode}`);
  });

  // ========== SIGNALING WEBRTC ==========
  // Criador envia SDP offer pro espectador
  socket.on('webrtc-offer', (data) => {
    const { roomCode, targetUserId, offer } = data;
    io.to(targetUserId).emit('receive-offer', {
      fromUserId: socket.id,
      offer
    });
  });

  // Espectador responde com SDP answer
  socket.on('webrtc-answer', (data) => {
    const { targetUserId, answer } = data;
    io.to(targetUserId).emit('receive-answer', {
      fromUserId: socket.id,
      answer
    });
  });

  // Troca de ICE candidates (servidores STUN públicos)
  socket.on('webrtc-ice-candidate', (data) => {
    const { targetUserId, candidate } = data;
    io.to(targetUserId).emit('receive-ice-candidate', {
      fromUserId: socket.id,
      candidate
    });
  });

  // ========== SINCRONIZAÇÃO DE VÍDEO ==========
  socket.on('video-sync', (data) => {
    const { roomCode, currentTime, isPlaying } = data;
    socket.to(roomCode).emit('video-sync', {
      currentTime,
      isPlaying,
      fromUserId: socket.id
    });
  });

  socket.on('video-action', (data) => {
    const { roomCode, action, currentTime } = data; // action: play/pause/seek
    socket.to(roomCode).emit('video-action', {
      action,
      currentTime,
      fromUserId: socket.id
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    rooms.forEach((room, code) => {
      if (room.viewers.includes(socket.id)) {
        room.viewers = room.viewers.filter(id => id !== socket.id);

        // Se criador sair, deleta sala (e vídeo de todos)
        if (room.creatorId === socket.id) {
          rooms.delete(code);
          io.to(code).emit('room-closed', { message: 'Criador saiu. Sala encerrada.' });
          console.log(`🗑️  Sala ${code} deletada (criador saiu)`);
        } else {
          // Apenas notifica que alguém saiu
          io.to(code).emit('user-left', {
            userId: socket.id,
            viewerCount: room.viewers.length
          });
        }
      }
    });
    console.log('✗ Desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║  🎬 WebRTC P2P Watch Party Server    ║
║                                       ║
║  Rodando em: http://localhost:${PORT}  ║
║  Signaling apenas (sem armazenamento) ║
╚═══════════════════════════════════════╝
  `);
});
