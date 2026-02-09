const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 40,
      unique: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('User', userSchema);

