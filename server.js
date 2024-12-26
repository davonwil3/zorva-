const express = require('express');
const app = express();
const port = 10000;
require("dotenv").config();
const airoutes = require('./routes/airoutes');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
      // Keep the original filename (including extension)
      cb(null, file.originalname);
    },
  });
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
mongoose.connect(process.env.MONGODB_URI);


app.use('/api', airoutes(upload));

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
