const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Room = require('../models/Room');
const leoProfanity = require('leo-profanity');

// GET /api/messages/:roomId - Paginated messages for a room (newest first)
router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    // Run find + count in parallel — no need to wait for one before the other
    const [messages, total] = await Promise.all([
      Message.find({ roomId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-_id -__v')
        .lean(),
      Message.countDocuments({ roomId }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Messages fetched successfully.',
      data: {
        messages,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('GET /api/messages/:roomId error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.', data: null });
  }
});

// POST /api/messages/:roomId - Post a new message to a room
router.post('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { senderName, text } = req.body;

    if (!senderName || typeof senderName !== 'string' || senderName.trim() === '') {
      return res.status(400).json({ success: false, message: 'senderName is required.', data: null });
    }
    if (senderName.trim().length > 30) {
      return res.status(400).json({ success: false, message: 'senderName must be 30 characters or less.', data: null });
    }

    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ success: false, message: 'text is required.', data: null });
    }
    if (text.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Message text must be 500 characters or less.', data: null });
    }

    // Lightweight existence check — only fetches _id, not the full document
    const roomExists = await Room.exists({ roomId });
    if (!roomExists) {
      return res.status(404).json({ success: false, message: 'Room not found or has expired.', data: null });
    }

    let cleanedText;
    try {
      cleanedText = leoProfanity.clean(text.trim());
    } catch {
      cleanedText = text.trim();
    }

    const savedMessage = await Message.create({
      roomId,
      senderName: senderName.trim(),
      text: cleanedText,
    });

    return res.status(201).json({
      success: true,
      message: 'Message posted successfully.',
      data: {
        roomId: savedMessage.roomId,
        senderName: savedMessage.senderName,
        text: savedMessage.text,
        createdAt: savedMessage.createdAt,
      },
    });
  } catch (err) {
    console.error('POST /api/messages/:roomId error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.', data: null });
  }
});

module.exports = router;
