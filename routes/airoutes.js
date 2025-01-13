const express = require('express');
const router = express.Router();
const { adduser, uploadFiles } = require('../controllers/zorva_controllers');
const { getfiles } = require('../controllers/zorva_controllers');
const { search } = require('../controllers/zorva_controllers');
const { getFilesByID } = require('../controllers/zorva_controllers');
const { deletefile } = require('../controllers/zorva_controllers');
const { chat } = require('../controllers/zorva_controllers');
const { listMessages } = require('../controllers/zorva_controllers');
const { saveInsight} = require('../controllers/zorva_controllers'); 
const { getInsights} = require('../controllers/zorva_controllers');
const { saveTitle} = require('../controllers/zorva_controllers');
const {generateTitle} = require('../controllers/zorva_controllers');
const {getConversations} = require('../controllers/zorva_controllers');

const setupRoutes = (upload) => {
    router.post('/adduser', adduser);
    router.post('/uploadfiles', upload.array('files'), uploadFiles);
    router.post('/search', search);
    router.post('/getfiles', getfiles);
    router.post('/getfilesbyID', getFilesByID);
    router.post('/deletefile', deletefile);
    router.post('/chat', chat);
    router.post('/listMessages', listMessages);
    router.post('/saveInsight', saveInsight);
    router.post('/getInsights', getInsights);
    router.post('/saveTitle', saveTitle);
    router.post('/generateTitle', generateTitle);
    router.post('/getConversations', getConversations);
    return router;
};

module.exports = setupRoutes;
