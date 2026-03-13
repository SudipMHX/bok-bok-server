require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const leoProfanity = require('leo-profanity');

const roomsRouter = require('./routes/rooms');
const messagesRouter = require('./routes/messages');
const Message = require('./models/Message');
const Room = require('./models/Room');
const { startCleanupJob } = require('./utils/cleanup');

// ─── Express Setup ────────────────────────────────────────────────────────────
const app = express();
const CORS_ORIGIN = process.env.CORS_ORIGIN;
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '16kb' })); // guard against large payloads

// ─── Health Check (required by Render) ──────────────────────────────────────
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/rooms', roomsRouter);
app.use('/api/messages', messagesRouter);

// ─── Catch-All 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
    data: null,
  });
});

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ─── Socket.io ───────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
});

// Make `io` accessible in any route via req.app.get('io')
app.set('io', io);

/**
 * Memory-based per-socket rate limiter.
 * Tracks message timestamps per socket.id.
 * Blocks if > 3 messages within the last 1 second.
 */
const msgTimestamps = new Map(); // socketId -> number[]

function isSpamming(socketId) {
  const now = Date.now();
  const timestamps = (msgTimestamps.get(socketId) || []).filter(
    (t) => now - t < 1000 // keep only last 1 second
  );
  timestamps.push(now);
  msgTimestamps.set(socketId, timestamps);
  return timestamps.length > 3;
}

// ─── Socket Event Handlers ───────────────────────────────────────────────────
io.on('connection', (socket) => {


  // Track which room this socket is in (for disconnect cleanup)
  let currentRoomId = null;
  let currentSenderName = null;

  // ── join_room ──────────────────────────────────────────────────────────────
  socket.on('join_room', async ({ roomId, senderName } = {}) => {
    if (!roomId || !senderName) return;

    // Lightweight check — only fetches _id
    const roomExists = await Room.exists({ roomId });
    if (!roomExists) {
      socket.emit('error', { message: 'Room not found or has expired.' });
      return;
    }

    socket.join(roomId);
    currentRoomId = roomId;
    currentSenderName = senderName;



    io.to(roomId).emit('system_message', { text: `${senderName} joined the room` });

    // Cheap count: read directly from the adapter instead of fetching all socket objects
    const count = io.sockets.adapter.rooms.get(roomId)?.size ?? 0;
    io.to(roomId).emit('room_users_count', { count });
  });

  // ── typing ─────────────────────────────────────────────────────────────────
  socket.on('typing', ({ roomId, senderName } = {}) => {
    if (!roomId || !senderName) return;
    socket.to(roomId).emit('user_typing', { senderName });
  });

  // ── stop_typing ────────────────────────────────────────────────────────────
  socket.on('stop_typing', ({ roomId, senderName } = {}) => {
    if (!roomId || !senderName) return;
    socket.to(roomId).emit('user_typing', { senderName: null });
  });

  // ── send_message ───────────────────────────────────────────────────────────
  socket.on('send_message', async ({ roomId, senderName, text } = {}, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};

    if (!roomId || !senderName || !text) {
      return ack({ success: false, message: 'roomId, senderName, and text are required.' });
    }

    // Anti-spam: block if > 3 messages per second
    if (isSpamming(socket.id)) {
      return ack({ success: false, message: 'You are sending messages too fast. Slow down!' });
    }

    let cleanedText;
    try {
      cleanedText = leoProfanity.clean(text);
    } catch {
      cleanedText = text;
    }

    try {
      const savedMessage = await Message.create({ roomId, senderName, text: cleanedText });

      io.to(roomId).emit('receive_message', {
        roomId: savedMessage.roomId,
        senderName: savedMessage.senderName,
        text: savedMessage.text,
        createdAt: savedMessage.createdAt,
      });

      ack({ success: true, message: 'Delivered' });
    } catch (err) {
      console.error('[send_message] DB error:', err);
      ack({ success: false, message: 'Failed to send message. Please try again.' });
    }
  });

  // ── disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {


    msgTimestamps.delete(socket.id);

    if (currentRoomId && currentSenderName) {
      io.to(currentRoomId).emit('system_message', { text: `${currentSenderName} left the room` });

      // Socket already removed from room at this point, so size is already decremented
      const count = io.sockets.adapter.rooms.get(currentRoomId)?.size ?? 0;
      io.to(currentRoomId).emit('room_users_count', { count });
    }
  });
});

// ─── Global Error Guards ─────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
  // Only exit on truly fatal errors; log and continue for recoverable ones
  if (err.code === 'ERR_USE_AFTER_CLOSE' || err.code === 'ECONNRESET') return;
  process.exit(1);
});

// ─── MongoDB + Server Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('[MongoDB] Connected successfully.');
    startCleanupJob();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Bok-Bok API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[MongoDB] Connection failed:', err.message);
    // process.exit(1);
  });
