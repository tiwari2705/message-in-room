const mongoose = require('mongoose');

const pollSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    question: { type: String, required: true, maxlength: 200 },
    options: [{ type: String, maxlength: 80 }],
    votes: {
      // userId -> option index
      type: Map,
      of: Number,
      default: {},
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Poll', pollSchema);

