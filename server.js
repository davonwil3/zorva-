const express = require('express');
const app = express();
const port = 10000;
require("dotenv").config();
const airoutes = require('./routes/airoutes');
const cors = require('cors');
const mongoose = require('mongoose');


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
mongoose.connect(process.env.MONGODB_URI);


app.use('/api', airoutes);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
