const express = require('express');
const router = express.Router();
const { adduser } = require('../controllers/zorva_controllers');
const { uploadfiles } = require('../controllers/zorva_controllers');

module.exports = (upload) => {
    router.post('/adduser', adduser);
    router.post('/uploadfiles', upload.array('files'), uploadfiles);
    return router;
};