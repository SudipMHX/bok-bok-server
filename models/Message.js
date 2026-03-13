const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
  },
  senderName: {
    type: String,
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Covers paginated fetch: filter by roomId, sort by createdAt — no in-memory sort needed
messageSchema.index({ roomId: 1, createdAt: -1 });

// Covers distinct('senderName', { roomId }) calls for totalJoined count
messageSchema.index({ roomId: 1, senderName: 1 });

module.exports = mongoose.model('Message', messageSchema);
