const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
      // null for public messages, userId for private messages
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    text: { type: String, required: true, maxlength: 2000 },
    anonymous: { type: Boolean, default: false },
    mentionedUserIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ],
    seenBy: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ],
    reactions: [reactionSchema],
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

module.exports = mongoose.model('Message', messageSchema);

