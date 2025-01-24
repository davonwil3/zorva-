const mongoose = require('mongoose');
const AutoIncrement = require('mongoose-sequence')(mongoose);
const { title } = require('process');
const { v4: uuidv4 } = require('uuid');



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
  quickInsightsThreadID:{
    type: String,
    required: false

  }

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
        type: [String],
        default: [],
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
  filenames: { type: [String], default: [], required: false },
  citation: { type: [String], default: [], required: false },
});

const quickInsights = new mongoose.Schema({
  insightID: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4, // Automatically generates a UUID
  },
  userID: {
    type: String,
    required: true,
  },
  assistantID: {
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
  text: {
    type: String,
    required: true,
  },
  filenames: {
    type: [String],
    default: [],
    required: false,
  },
});

const quickInsightsSavedResponses = new mongoose.Schema({
  userID: {
    type: String,
    required: true,
  },
  assistantID: {
    type: String,
    required: true,
  },
  threadID: {
    type: String,
    required: true,
  },
  quickInsightsIDs: {
    type: [String],
    required: true,
  },
});



ConversationSchema.plugin(AutoIncrement, { inc_field: 'conversation_id' });




const User = mongoose.model('User', UserSchema);
const Conversations = mongoose.model('Conversation', ConversationSchema);
const Message = mongoose.model('Message', messageSchema);
const QuickInsights = mongoose.model('QuickInsights', quickInsights);
const QuickInsightsSavedResponses = mongoose.model(
  'QuickInsightsSavedResponses',
  quickInsightsSavedResponses
);

module.exports = {
  User,
  Conversations,
  Message,
  QuickInsights,
  QuickInsightsSavedResponses,
};