const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
    id: {
        type: String,
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
    accounts: {
        type: Array,
        required: false
    }
});