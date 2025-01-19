const mongoose = require('mongoose');
const AutoIncrementFactory = require('mongoose-sequence');
const AutoIncrement = AutoIncrementFactory(mongoose);

const UserSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: false
  },
  lastName: {
    type: String,
    required: false
  },
  email: {
    type: String,
    required: true
  },
  assistantID: {
    filesearchID: {
      type: String,
      required: true
    },
    dataanalysisID: {
      type: String,
      required: true
    }
  },
  vectorStoreID: {
    type: String,
    required: false
  },
  date: {
    type: Date,
    default: Date.now
  },

});

const ConversationSchema = new mongoose.Schema({
  conversation_id: {
    type: Number,
    required: true,
  },
  assistantID: {
    type: String,
    required: true,
  },
  userID: {
    type: String,
    required: true,
  },
  threadID: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: false,
  },
  savedInsights: [
    {
      insightID: {
        type: Number, // AutoIncrement generates numbers
        required: false,
      },
      text: {
        type: String,
        required: true,
      },
      data: {
        type: String,
        required: false,
      },
      fileReference: {
        type: String,
        required: false,
      },
    },
  ],
  date: {
    type: Date,
    default: Date.now,
  },
});

const messageSchema = new mongoose.Schema({
  threadID: String,
  role: String, // "user" or "assistant"
  query: String, // User-visible query
  content: String, // Full content sent to OpenAI (with instructions)
  timestamp: { type: Date, default: Date.now },
  filenames:
    [
      {
        type: String,
        required: false,
      }
    ]
});

ConversationSchema.plugin(AutoIncrement, { inc_field: 'conversation_id' });


const User = mongoose.model('User', UserSchema);
const Conversations = mongoose.model('Conversation', ConversationSchema);
const Message = mongoose.model('Message', messageSchema);

module.exports = {
  User,
  Conversations,
  Message
};