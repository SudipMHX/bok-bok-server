const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomName: {
    type: String,
    required: true,
    trim: true,
  },
  roomId: {
    type: String,
    required: true,
    unique: true,
  },
  isPrivate: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true, // used by cleanup job
  },
});

// Compound index: covers GET /api/rooms/public (filter by isPrivate, sort by createdAt)
roomSchema.index({ isPrivate: 1, createdAt: -1 });

module.exports = mongoose.model('Room', roomSchema);
