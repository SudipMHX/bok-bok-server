const Room = require('../models/Room');
const Message = require('../models/Message');

/**
 * Finds all expired rooms, deletes their messages, then deletes the rooms.
 * Also sweeps for orphaned messages from rooms that no longer exist.
 */
async function cleanupExpiredRooms() {
  try {
    const now = new Date();

    // 1. Find all rooms whose expiry has passed
    const expiredRooms = await Room.find({ expiresAt: { $lte: now } }).select('roomId').lean();
    const expiredRoomIds = expiredRooms.map((r) => r.roomId);

    if (expiredRoomIds.length > 0) {
      // Delete messages first, then rooms
      const [msgResult, roomResult] = await Promise.all([
        Message.deleteMany({ roomId: { $in: expiredRoomIds } }),
        Room.deleteMany({ roomId: { $in: expiredRoomIds } }),
      ]);

      console.log(
        `[Cleanup] Removed ${roomResult.deletedCount} expired room(s) ` +
        `and ${msgResult.deletedCount} associated message(s).`
      );
    }

    // 2. Sweep for orphaned messages (room was deleted outside of this job)
    const messageRoomIds = await Message.distinct('roomId');
    if (messageRoomIds.length === 0) return; // nothing to clean — exit early

    const activeRooms = await Room.find({ roomId: { $in: messageRoomIds } }).select('roomId').lean();
    const activeRoomSet = new Set(activeRooms.map((r) => r.roomId)); // O(1) lookup

    const orphanedRoomIds = messageRoomIds.filter((id) => !activeRoomSet.has(id));

    if (orphanedRoomIds.length > 0) {
      const orphanResult = await Message.deleteMany({ roomId: { $in: orphanedRoomIds } });
      console.log(`[Cleanup] Removed ${orphanResult.deletedCount} orphaned message(s).`);
    }
  } catch (err) {
    console.error('[Cleanup] Error during room cleanup:', err.message);
  }
}

/**
 * Starts the cleanup interval. Call this once after MongoDB connects.
 * @param {number} intervalMs - How often to run (default: 60 000ms / 1 min)
 */
async function startCleanupJob(intervalMs = 60_000) {
  // Drop legacy TTL index if present (we manage deletion manually now)
  try {
    await Room.collection.dropIndex('expiresAt_1');
  } catch {
    // Index doesn't exist — that's fine
  }

  // Run immediately on startup to clear anything that expired while server was down
  cleanupExpiredRooms();

  setInterval(cleanupExpiredRooms, intervalMs);
  console.log(`[Cleanup] Scheduled expired-room cleanup every ${intervalMs / 1000}s.`);
}

module.exports = { startCleanupJob, cleanupExpiredRooms };
