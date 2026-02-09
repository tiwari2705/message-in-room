const mongoose = require('mongoose');

const roomMembershipSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member',
    },
    muted: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'joinedAt', updatedAt: true } },
);

roomMembershipSchema.index({ roomId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('RoomMembership', roomMembershipSchema);

