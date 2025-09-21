// index.js
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


// Simple health-check
app.get('/', (req, res) => res.send('WebRTC Signaling Server'));


// rooms: each room holds list of socket ids (max 2 for direct peer-to-peer)
io.on('connection', (socket) => {
console.log('socket connected:', socket.id);


socket.on('join', (roomId) => {
socket.join(roomId);
const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
console.log(`${socket.id} joined ${roomId}. Clients in room:`, clients);
// notify everyone in room about new participant
io.to(roomId).emit('room:update', clients);
});


socket.on('leave', (roomId) => {
socket.leave(roomId);
const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
io.to(roomId).emit('room:update', clients);
});


socket.on('offer', ({ roomId, sdp, sender }) => {
socket.to(roomId).emit('offer', { sdp, sender });
});


socket.on('answer', ({ roomId, sdp, sender }) => {
socket.to(roomId).emit('answer', { sdp, sender });
});


socket.on('ice-candidate', ({ roomId, candidate, sender }) => {
socket.to(roomId).emit('ice-candidate', { candidate, sender });
});


socket.on('chat-message', ({ roomId, message, sender }) => {
io.to(roomId).emit('chat-message', { message, sender, time: Date.now() });
});


socket.on('disconnect', () => {
console.log('socket disconnected:', socket.id);
// optional: you can iterate rooms and emit room:update
});
});


server.listen(PORT, () => console.log('Signaling server running on', PORT));