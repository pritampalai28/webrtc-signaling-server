// server.js - Improved WebRTC Signaling Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// Store room and user information
const rooms = new Map();
const userSockets = new Map();

// Middleware for JSON parsing
app.use(express.json());

// Simple health-check with more info
app.get('/', (req, res) => {
  const roomsCount = rooms.size;
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
    },
    {
      urls: 'stun:stun3.l.google.com:19302'
    }
  ];

  // Add TURN server if credentials are provided via environment variables
  const iceServers: RTCIceServer[] = [
  {
    urls: ["stun:bn-turn1.xirsys.com"],
  },
];

// Add TURN server if credentials are provided via environment variables
if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
  iceServers.push({
    urls: [
      "turn:bn-turn1.xirsys.com:80?transport=udp",
      "turn:bn-turn1.xirsys.com:3478?transport=udp",
      "turn:bn-turn1.xirsys.com:80?transport=tcp",
      "turn:bn-turn1.xirsys.com:3478?transport=tcp",
      "turns:bn-turn1.xirsys.com:443?transport=tcp",
      "turns:bn-turn1.xirsys.com:5349?transport=tcp"
    ],
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL,
  });
}


  res.json({ iceServers });
});

// Get room info endpoint
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  res.json({
    roomId,
    clientCount: room ? room.clients.length : 0,
    clients: room ? room.clients : [],
    maxCapacity: 10
  });
});

// Helper functions
function addUserToRoom(roomId, socketId, userInfo = {}) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      clients: [],
      createdAt: Date.now()
    });
  }
  
  const room = rooms.get(roomId);
  const existingUserIndex = room.clients.findIndex(client => client.socketId === socketId);
  
  if (existingUserIndex === -1) {
    room.clients.push({
      socketId,
      ...userInfo,
      joinedAt: Date.now()
    });
  }
  
  userSockets.set(socketId, { roomId, ...userInfo });
  return room;
}

function removeUserFromRoom(roomId, socketId) {
  if (!rooms.has(roomId)) return null;
  
  const room = rooms.get(roomId);
  room.clients = room.clients.filter(client => client.socketId !== socketId);
  
  // Remove empty rooms
  if (room.clients.length === 0) {
    rooms.delete(roomId);
    return null;
  }
  
  userSockets.delete(socketId);
  return room;
}

function getRoomClients(roomId) {
  const room = rooms.get(roomId);
  return room ? room.clients : [];
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id} at ${new Date().toISOString()}`);

  // Join room with enhanced error handling
  socket.on('join', (data) => {
    try {
      const roomId = typeof data === 'string' ? data : data.roomId;
      const userInfo = typeof data === 'object' ? data.userInfo : {};
      
      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      socket.join(roomId);
      const room = addUserToRoom(roomId, socket.id, userInfo);
      
      console.log(`${socket.id} joined room ${roomId}. Total clients: ${room.clients.length}`);
      
      // Send current room state to all clients
      const clients = room.clients.map(client => ({
        socketId: client.socketId,
        ...client
      }));
      
      // Notify all clients in room about the update
      io.to(roomId).emit('room:update', {
        roomId,
        clients,
        action: 'user-joined',
        newUser: socket.id
      });
      
      // Send welcome message to the new client
      socket.emit('joined', { 
        roomId, 
        socketId: socket.id, 
        clients,
        success: true
      });
      
    } catch (error) {
      console.error('Error in join event:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Leave room
  socket.on('leave', (roomId) => {
    try {
      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      socket.leave(roomId);
      const room = removeUserFromRoom(roomId, socket.id);
      
      console.log(`${socket.id} left room ${roomId}`);
      
      if (room) {
        const clients = room.clients;
        io.to(roomId).emit('room:update', {
          roomId,
          clients,
          action: 'user-left',
          leftUser: socket.id
        });
      }
      
      socket.emit('left', { roomId, socketId: socket.id, success: true });
      
    } catch (error) {
      console.error('Error in leave event:', error);
      socket.emit('error', { message: 'Failed to leave room' });
    }
  });

  // WebRTC signaling events with validation
  socket.on('offer', ({ roomId, sdp, sender, target }) => {
    try {
      if (!roomId || !sdp || !sender) {
        socket.emit('error', { message: 'Missing required offer parameters' });
        return;
      }

      console.log(`Offer from ${sender} in room ${roomId} ${target ? `to ${target}` : '(broadcast)'}`);
      
      if (target) {
        // Send to specific user
        socket.to(target).emit('offer', { sdp, sender, roomId });
      } else {
        // Broadcast to room
        socket.to(roomId).emit('offer', { sdp, sender, roomId });
      }
    } catch (error) {
      console.error('Error in offer event:', error);
      socket.emit('error', { message: 'Failed to send offer' });
    }
  });

  socket.on('answer', ({ roomId, sdp, sender, target }) => {
    try {
      if (!roomId || !sdp || !sender) {
        socket.emit('error', { message: 'Missing required answer parameters' });
        return;
      }

      console.log(`Answer from ${sender} in room ${roomId} ${target ? `to ${target}` : '(broadcast)'}`);
      
      if (target) {
        socket.to(target).emit('answer', { sdp, sender, roomId });
      } else {
        socket.to(roomId).emit('answer', { sdp, sender, roomId });
      }
    } catch (error) {
      console.error('Error in answer event:', error);
      socket.emit('error', { message: 'Failed to send answer' });
    }
  });

  socket.on('ice-candidate', ({ roomId, candidate, sender, target }) => {
    try {
      if (!roomId || !candidate || !sender) {
        socket.emit('error', { message: 'Missing required ICE candidate parameters' });
        return;
      }

      console.log(`ICE candidate from ${sender} in room ${roomId} ${target ? `to ${target}` : '(broadcast)'}`);
      
      if (target) {
        socket.to(target).emit('ice-candidate', { candidate, sender, roomId });
      } else {
        socket.to(roomId).emit('ice-candidate', { candidate, sender, roomId });
      }
    } catch (error) {
      console.error('Error in ice-candidate event:', error);
      socket.emit('error', { message: 'Failed to send ICE candidate' });
    }
  });

  // Chat messaging with validation
  socket.on('chat-message', ({ roomId, message, sender }) => {
    try {
      if (!roomId || !message || !sender) {
        socket.emit('error', { message: 'Missing required message parameters' });
        return;
      }

      console.log(`Chat message from ${sender} in room ${roomId}: ${message}`);
      
      const messageData = {
        message: message.trim(),
        sender,
        roomId,
        time: Date.now(),
        timestamp: new Date().toISOString(),
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
      
      io.to(roomId).emit('chat-message', messageData);
    } catch (error) {
      console.error('Error in chat-message event:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Enhanced call events
  socket.on('call-user', ({ roomId, targetSocketId, sender }) => {
    try {
      if (!roomId || !targetSocketId || !sender) {
        socket.emit('error', { message: 'Missing required call parameters' });
        return;
      }

      console.log(`Call initiated by ${sender} to ${targetSocketId} in room ${roomId}`);
      
      // Check if target user exists in the room
      const room = rooms.get(roomId);
      if (!room || !room.clients.find(client => client.socketId === targetSocketId)) {
        socket.emit('error', { message: 'Target user not found in room' });
        return;
      }

      socket.to(targetSocketId).emit('incoming-call', { 
        caller: sender, 
        callerSocketId: socket.id,
        roomId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error in call-user event:', error);
      socket.emit('error', { message: 'Failed to initiate call' });
    }
  });

  socket.on('call-accepted', ({ roomId, targetSocketId, sender }) => {
    try {
      console.log(`Call accepted by ${sender} in room ${roomId}`);
      socket.to(targetSocketId).emit('call-accepted', { 
        accepter: sender,
        accepterSocketId: socket.id,
        roomId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error in call-accepted event:', error);
    }
  });

  socket.on('call-rejected', ({ roomId, targetSocketId, sender }) => {
    try {
      console.log(`Call rejected by ${sender} in room ${roomId}`);
      socket.to(targetSocketId).emit('call-rejected', { 
        rejecter: sender,
        rejecterSocketId: socket.id,
        roomId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error in call-rejected event:', error);
    }
  });

  socket.on('end-call', ({ roomId, sender }) => {
    try {
      console.log(`Call ended by ${sender} in room ${roomId}`);
      socket.to(roomId).emit('call-ended', { 
        ender: sender,
        enderSocketId: socket.id,
        roomId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error in end-call event:', error);
    }
  });

  // Ping/Pong for connection health
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  // Handle disconnect with proper cleanup
  socket.on('disconnect', (reason) => {
    console.log(`Socket disconnected: ${socket.id}, reason: ${reason}`);
    
    try {
      const userInfo = userSockets.get(socket.id);
      
      if (userInfo && userInfo.roomId) {
        const room = removeUserFromRoom(userInfo.roomId, socket.id);
        
        if (room) {
          console.log(`Cleaned up ${socket.id} from room ${userInfo.roomId}. Remaining: ${room.clients.length}`);
          
          // Notify remaining clients
          io.to(userInfo.roomId).emit('room:update', {
            roomId: userInfo.roomId,
            clients: room.clients,
            action: 'user-disconnected',
            disconnectedUser: socket.id
          });
          
          io.to(userInfo.roomId).emit('user-disconnected', { 
            disconnectedSocket: socket.id,
            remainingClients: room.clients,
            reason
          });
        }
      }
    } catch (error) {
      console.error('Error during disconnect cleanup:', error);
    }
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error('Socket error for', socket.id, ':', error);
  });
});

// Server event handlers
io.engine.on('connection_error', (error) => {
  console.error('Connection error:', error);
});

// Periodic cleanup of stale rooms (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const staleTimeout = 30 * 60 * 1000; // 30 minutes
  
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.createdAt > staleTimeout && room.clients.length === 0) {
      console.log(`Cleaning up stale room: ${roomId}`);
      rooms.delete(roomId);
    }
  }
}, 5 * 60 * 1000);

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, () => {
  console.log('🚀 Signaling server running on port', PORT);
  console.log('📊 Health check: http://localhost:' + PORT + '/');
  console.log('🧊 ICE servers: http://localhost:' + PORT + '/api/ice-servers');
  console.log('Environment:', process.env.NODE_ENV || 'development');
});
