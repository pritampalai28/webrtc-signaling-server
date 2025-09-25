// server.js - Adapted WebRTC Signaling Server for Render
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const PORT = process.env.PORT || 3000;

// Middleware for JSON parsing
app.use(express.json());

// Simple health-check with more info
app.get('/', (req, res) => {
  const roomsCount = io.sockets.adapter.rooms.size;
  const socketsCount = io.sockets.sockets.size;
  
  res.json({
    message: 'WebRTC Signaling Server',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connectedSockets: socketsCount,
    activeRooms: roomsCount,
    uptime: Math.floor(process.uptime()) + ' seconds'
  });
});

// ICE servers endpoint for WebRTC configuration
app.get('/api/ice-servers', (req, res) => {
  const iceServers = [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: 'stun:stun1.l.google.com:19302'
    },
    {
      urls: 'stun:stun2.l.google.com:19302'
    }
  ];

  // Add TURN server if credentials are provided via environment variables
  if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_SERVER_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.json({ iceServers });
});

// Get room info endpoint
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = io.sockets.adapter.rooms.get(roomId);
  const clients = room ? Array.from(room) : [];
  
  res.json({
    roomId,
    clientCount: clients.length,
    clients: clients,
    maxCapacity: 10 // or whatever limit you want
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  // Join room
  socket.on('join', (roomId) => {
    socket.join(roomId);
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    console.log(`${socket.id} joined ${roomId}. Clients in room:`, clients);
    
    // Notify everyone in room about new participant
    io.to(roomId).emit('room:update', clients);
    
    // Send welcome message to the new client
    socket.emit('joined', { roomId, socketId: socket.id, clients });
  });

  // Leave room
  socket.on('leave', (roomId) => {
    socket.leave(roomId);
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    console.log(`${socket.id} left ${roomId}. Remaining clients:`, clients);
    
    io.to(roomId).emit('room:update', clients);
    socket.emit('left', { roomId, socketId: socket.id });
  });

  // WebRTC signaling events
  socket.on('offer', ({ roomId, sdp, sender }) => {
    console.log(`Offer from ${sender} in room ${roomId}`);
    socket.to(roomId).emit('offer', { sdp, sender });
  });

  socket.on('answer', ({ roomId, sdp, sender }) => {
    console.log(`Answer from ${sender} in room ${roomId}`);
    socket.to(roomId).emit('answer', { sdp, sender });
  });

  socket.on('ice-candidate', ({ roomId, candidate, sender }) => {
    console.log(`ICE candidate from ${sender} in room ${roomId}`);
    socket.to(roomId).emit('ice-candidate', { candidate, sender });
  });

  // Chat messaging
  socket.on('chat-message', ({ roomId, message, sender }) => {
    console.log(`Chat message from ${sender} in room ${roomId}: ${message}`);
    io.to(roomId).emit('chat-message', { 
      message, 
      sender, 
      time: Date.now(),
      timestamp: new Date().toISOString()
    });
  });

  // Handle call events
  socket.on('call-user', ({ roomId, targetSocketId, sender }) => {
    console.log(`Call initiated by ${sender} to ${targetSocketId} in room ${roomId}`);
    socket.to(targetSocketId).emit('incoming-call', { 
      caller: sender, 
      callerSocketId: socket.id,
      roomId 
    });
  });

  socket.on('call-accepted', ({ roomId, targetSocketId, sender }) => {
    console.log(`Call accepted by ${sender} in room ${roomId}`);
    socket.to(targetSocketId).emit('call-accepted', { 
      accepter: sender,
      accepterSocketId: socket.id,
      roomId 
    });
  });

  socket.on('call-rejected', ({ roomId, targetSocketId, sender }) => {
    console.log(`Call rejected by ${sender} in room ${roomId}`);
    socket.to(targetSocketId).emit('call-rejected', { 
      rejecter: sender,
      rejecterSocketId: socket.id,
      roomId 
    });
  });

  socket.on('end-call', ({ roomId, sender }) => {
    console.log(`Call ended by ${sender} in room ${roomId}`);
    socket.to(roomId).emit('call-ended', { 
      ender: sender,
      enderSocketId: socket.id,
      roomId 
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('socket disconnected:', socket.id);
    
    // Clean up rooms - notify remaining clients
    const rooms = Array.from(socket.rooms);
    rooms.forEach(roomId => {
      if (roomId !== socket.id) { // Skip the socket's own room
        const remainingClients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        io.to(roomId).emit('room:update', remainingClients);
        io.to(roomId).emit('user-disconnected', { 
          disconnectedSocket: socket.id,
          remainingClients 
        });
      }
    });
  });
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

// Start server
server.listen(PORT, () => {
  console.log('🚀 Signaling server running on port', PORT);
  console.log('📊 Health check: http://localhost:' + PORT + '/');
  console.log('🧊 ICE servers: http://localhost:' + PORT + '/api/ice-servers');
});
