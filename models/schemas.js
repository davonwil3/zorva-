const mongoose = require('mongoose');
const AutoIncrementFactory = require('mongoose-sequence');
const AutoIncrement = AutoIncrementFactory(mongoose);

const AccountSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    ownerID: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    }
});

AccountSchema.plugin(AutoIncrement, {inc_field: 'id'});

const UserSchema = new mongoose.Schema({
    firebaseId: {
        type: String,
        required: true
    },
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    accounts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account'
    }]
});

const AssistantSchema = new mongoose.Schema({
    id: {
        type: Number, 
        required: true
    },
    name: {
        type: String,
        required: true
    },
    ownerID: {
        type: String,
        required: true
    },
    settings: {
        type: Object,
        required: false
    },
    date: {
        type: Date,
        default: Date.now
    }
});

AssistantSchema.plugin(AutoIncrement, {inc_field: 'id'});

const ConversationSchema = new mongoose.Schema({
    id: {
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
    messages: {
        type: Array,
        required: false
    },
    date: {
        type: Date,
        default: Date.now
    }
});

ConversationSchema.plugin(AutoIncrement, {inc_field: 'id'});

const Account = mongoose.model('Account', AccountSchema);
const User = mongoose.model('User', UserSchema);
const Assistant = mongoose.model('Assistant', AssistantSchema);
const Conversation = mongoose.model('Conversation', ConversationSchema);

module.exports = {
    Account,
    User,
    Assistant,
    Conversation
};