const express = require('express');
const router = express.Router();
const { chatbot} = require( '../controllers/zorva_controllers');
const { adduser } = require('../controllers/zorva_controllers');

router.post('/chatbot', chatbot);
router.post('/adduser', adduser);

module.exports = router;