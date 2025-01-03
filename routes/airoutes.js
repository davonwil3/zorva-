const express = require('express');
const router = express.Router();
const { adduser, uploadFiles } = require('../controllers/zorva_controllers');
const { getfiles } = require('../controllers/zorva_controllers');
const { search } = require('../controllers/zorva_controllers');
const { getFilesByID } = require('../controllers/zorva_controllers');
const { deletefile } = require('../controllers/zorva_controllers');
const { chat } = require('../controllers/zorva_controllers');
const { listMessages } = require('../controllers/zorva_controllers');

const setupRoutes = (upload) => {
    router.post('/adduser', adduser);
    router.post('/uploadfiles', upload.array('files'), uploadFiles);
    router.post('/search', search);
    router.post('/getfiles', getfiles);
    router.post('/getfilesbyID', getFilesByID);
    router.post('/deletefile', deletefile);
    router.post('/chat', chat);
    router.post('/listMessages', listMessages);
    return router;
};

module.exports = setupRoutes;
