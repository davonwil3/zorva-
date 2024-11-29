const express = require('express');
const router = express.Router();
const { chatbot} = require( '../controllers/zorva_controllers');

router.post('/chatbot', chatbot);

module.exports = router;