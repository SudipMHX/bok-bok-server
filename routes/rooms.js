const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const Room = require('../models/Room');
const Message = require('../models/Message');

// Rate limiter: max 5 room creations per IP per hour
const createRoomLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many rooms created from this IP. Please try again after an hour.',
      data: null,
    });
  },
});

// POST /api/rooms - Create a new room
router.post('/', createRoomLimiter, async (req, res) => {
  try {
    const { roomName, expireHours, isPrivate } = req.body;

    if (!roomName || typeof roomName !== 'string' || roomName.trim() === '') {
      return res.status(400).json({ success: false, message: 'roomName is required.', data: null });
    }
    if (roomName.trim().length > 60) {
      return res.status(400).json({ success: false, message: 'roomName must be 60 characters or less.', data: null });
    }

    const hours = Number(expireHours);
    if (!expireHours || isNaN(hours) || hours < 1 || hours > 24) {
      return res.status(400).json({
        success: false,
        message: 'expireHours must be a number between 1 and 24.',
        data: null,
      });
    }

    const roomId = crypto.randomBytes(3).toString('hex'); // 6-char hex
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const room = await Room.create({
      roomName: roomName.trim(),
      roomId,
      isPrivate: Boolean(isPrivate),
      expiresAt,
    });

    return res.status(201).json({
      success: true,
      message: 'Room created successfully.',
      data: room,
    });
  } catch (err) {
    console.error('POST /api/rooms error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.', data: null });
  }
});

// GET /api/rooms/public - List all public rooms with live userCount and totalJoined
router.get('/public', async (req, res) => {
  try {
    const io = req.app.get('io');

    // Fetch rooms and totalJoined counts in parallel
    const [rooms, joinedCounts] = await Promise.all([
      Room.find({ isPrivate: false })
        .select('roomName roomId expiresAt -_id')
        .sort({ createdAt: -1 })
        .lean(),
      // Single aggregation: group messages by roomId → count distinct senderNames
      Message.aggregate([
        { $group: { _id: '$roomId', senders: { $addToSet: '$senderName' } } },
        { $project: { _id: 1, totalJoined: { $size: '$senders' } } },
      ]),
    ]);

    // Build a lookup map: roomId → totalJoined
    const joinedMap = new Map(joinedCounts.map((r) => [r._id, r.totalJoined]));

    const roomsWithStats = rooms.map((room) => ({
      ...room,
      userCount: io?.sockets.adapter.rooms.get(room.roomId)?.size ?? 0,
      totalJoined: joinedMap.get(room.roomId) ?? 0,
    }));

    return res.status(200).json({
      success: true,
      message: 'Public rooms fetched successfully.',
      data: roomsWithStats,
    });
  } catch (err) {
    console.error('GET /api/rooms/public error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.', data: null });
  }
});

// GET /api/rooms/:roomId - Get a single room by roomId
router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;

    const [room, uniqueNicknames] = await Promise.all([
      Room.findOne({ roomId }).select('-_id -__v').lean(),
      Message.distinct('senderName', { roomId }),
    ]);

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.', data: null });
    }

    return res.status(200).json({
      success: true,
      message: 'Room found.',
      data: { ...room, totalJoined: uniqueNicknames.length },
    });
  } catch (err) {
    console.error('GET /api/rooms/:roomId error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.', data: null });
  }
});

module.exports = router;
