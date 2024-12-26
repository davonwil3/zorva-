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
        type: String,
        required: false
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
        required: true
    },
    assistantID: {
        type: String,
        required: true
    },
    userID: {
        type: String,
        required: true
    },
    threadID: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: false
    },
    date: {
        type: Date,
        default: Date.now
    }
});

ConversationSchema.plugin(AutoIncrement, { inc_field: 'conversation_id' });

const User = mongoose.model('User', UserSchema);
const Conversation = mongoose.model('Conversation', ConversationSchema);

module.exports = {
    User,
    Conversation
};