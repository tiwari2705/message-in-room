const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, unique: true, index: true },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    settings: {
      locked: { type: Boolean, default: false },
      privateChatEnabled: { type: Boolean, default: true },
      durationMinutes: { type: Number, default: 30 },
    },
    expiresAt: { type: Date, required: true, index: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Room', roomSchema);

