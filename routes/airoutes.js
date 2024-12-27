const express = require('express');
const router = express.Router();
const { adduser, uploadFiles } = require('../controllers/zorva_controllers');

const setupRoutes = (upload) => {
    router.post('/adduser', adduser);
    router.post('/uploadfiles', upload.array('files'), uploadFiles);
    return router;
};

module.exports = setupRoutes;
