const { get } = require('mongoose');
const OpenAI = require('openai');
const openai = new OpenAI(process.env.OPENAI_API_KEY)
const User = require('../models/schemas').User;
const fs = require('fs');
const XLSX = require('xlsx');
const csv = require('csv-parse');
const { promisify } = require('util');
const path = require('path');
const FileRecord = require('../models/schemas').FileRecord;

const parseCSV = promisify(csv.parse);

const adduser = async (req, res) => {
  const { firebaseUid, email } = req.body;
  console.log("firebaseUid:", firebaseUid);

  try {
    // 1. Create the assistant
    const assistant = await openai.beta.assistants.create({
      name: "Zorva assistant",
      instructions: "You are an expert data analytics advisor that gives insights about data.",
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
    });
    const assistantID = assistant.id;
    console.log("Created new assistant with ID:", assistantID);

    // 2. Create an empty vector store
    let vectorStore;
    try {
      vectorStore = await openai.beta.vectorStores.create({
        name: "Uploads",
      });
      console.log("Vector Store Created Successfully:", vectorStore);
    } catch (error) {
      console.error("Error creating vector store:", error);
      return res.status(500).send("Failed to create vector store");
    }

    const vectorStoreID = vectorStore.id;
    console.log("Vector Store ID:", vectorStoreID);

    try {
      await openai.beta.assistants.update(assistantID, {
        tool_resources: {
          file_search: { vector_store_ids: [vectorStoreID] },
        },
      });
      console.log("Attached vector store to assistant:", assistantID);
    } catch (error) {
      console.error("Error attaching vector store:", error);
      return res.status(500).send("Failed to attach vector store to assistant");
    }

    // 4. Create a new user document in the database
    const newUser = new User({
      firebaseUid,
      email,
      assistantID,
      vectorStoreID,
    });

    await newUser.save();
    console.log("User added successfully");


    res.status(200).send("User, Vector Store, and Assistant fully configured");

  } catch (error) {

    console.log("Error adding user:", error);
    res.status(500).send("Error adding user");
  }
};

const uploadFiles = async (req, res) => {
  try {
    const { firebaseUid } = req.body;
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).send('User not found');
    }

    const vectorStoreId = user.vectorStoreID;

    if (!req.files || req.files.length === 0) {
      return res.status(400).send('No files received');
    }

    console.log('req.files:', req.files);

    const newFileIds = [];
    const processedData = [];

    for (const file of req.files) {
      // If Excel or CSV
      if (/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
        const jsonData = await convertToJSON(file);
        if (jsonData) {
          const fileMetadata = {
            originalName: jsonData.originalName,
            fileName: jsonData.fileName,
            extension: jsonData.extension,
            sheetNames: jsonData.sheetNames,
            uploadDate: new Date().toISOString(),
            recordCounts: {}
          };

          for (const [sheetName, data] of Object.entries(jsonData.sheets)) {
            fileMetadata.recordCounts[sheetName] = data.length;
          }

          // Collect all sheet-file IDs in an array
          const sheetFileIds = [];

          await Promise.all(
            Object.entries(jsonData.sheets).map(async ([sheetName, sheetData]) => {
              const tempFilePath = `/tmp/${jsonData.fileName}-${sheetName}-${Date.now()}.json`;
              await fs.promises.writeFile(
                tempFilePath,
                JSON.stringify(
                  {
                    metadata: { ...fileMetadata, currentSheet: sheetName },
                    data: sheetData
                  },
                  null,
                  2
                )
              );
              const response = await openai.files.create({
                file: fs.createReadStream(tempFilePath),
                purpose: 'assistants'
              });
              sheetFileIds.push(response.id);
              await fs.promises.unlink(tempFilePath);
            })
          );

          const newFileRecord = new FileRecord({
            fileId: sheetFileIds[0],
            filename: jsonData.originalName,
            userId: user.firebaseUid,
            vectorStoreId,
            sheetFileIds
          });
          try {
            await newFileRecord.save();
            console.log('FileRecord saved successfully:', newFileRecord);
          } catch (error) {
            console.error('Error saving FileRecord:', error);
          }

          newFileIds.push(...sheetFileIds);

          processedData.push({
            ...fileMetadata,
            fileIds: sheetFileIds
          });
        }
      } else {
        // For non-Excel/CSV files
        const response = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: 'assistants'
        });

        const newFileRecord = new FileRecord({
          fileId: response.id,
          filename: file.originalname,
          userId: user.firebaseUid,
          vectorStoreId
        });
        try {
          await newFileRecord.save();
          console.log('FileRecord saved successfully:', newFileRecord);
        } catch (error) {
          console.error('Error saving FileRecord:', error);
        }

        newFileIds.push(response.id);
        processedData.push({
          originalName: file.originalname,
          fileIds: [response.id]
        });
      }
    }

    // Add these new files to the vector store
    await openai.beta.vectorStores.fileBatches.createAndPoll(vectorStoreId, {
      file_ids: newFileIds
    });

    // Clean up local files
    for (const file of req.files) {
      fs.unlinkSync(file.path);
    }

    console.log('Files processed and uploaded:', processedData);

    return res.status(200).json({
      message: 'Files uploaded and vector store updated successfully',
      processedFiles: processedData
    });
  } catch (error) {
    console.error('Error processing files:', error);
    return res.status(500).send('Error processing files');
  }
};

const convertToJSON = async (file) => {
  if (!file || !file.path) {
    throw new Error('Invalid file or missing file path.');
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  let workbook;
  try {
    const fileBuffer = await fs.promises.readFile(file.path);
    if (ext === '.csv') {
      const csvData = fileBuffer.toString('utf8');
      const rows = csvData.split('\n').map((row) => row.split(','));
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      workbook = {
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: worksheet },
      };
    } else {
      workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    }
  } catch (err) {
    console.error('Error reading or parsing file:', err);
    throw new Error('Failed to read or parse the file. Please ensure it is a valid Excel/CSV.');
  }

  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('No sheets found in the workbook.');
  }

  const sheets = {};
  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      raw: false,
    });
    sheets[sheetName] = jsonData;
  }

  return {
    originalName: file.originalname,
    fileName: file.filename,
    extension: ext,
    sheetNames,
    sheets,
  };
};


const getfiles = async (req, res) => {
  try {
    const { firebaseUid } = req.body;
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const vectorStoreId = user.vectorStoreID;

    // Retrieve files from the vector store
    const storeFiles = await openai.beta.vectorStores.files.list(vectorStoreId);

    // Match each vector store file with our local FileRecord for the filename
    const filesWithMetadata = await Promise.all(
      storeFiles.data.map(async (file) => {
        const localRecord = await FileRecord.findOne({ fileId: file.id });
        return {
          id: file.id,
          filename: localRecord ? localRecord.filename : '(No filename)',
          created_at: file.created_at,
          usage_bytes: file.usage_bytes || 0
        };
      })
    );

    return res.status(200).json({ files: filesWithMetadata });
  } catch (error) {
    console.error('Error fetching files:', error);
    return res.status(500).send('Error fetching files');
  }
};

module.exports = {
  adduser,
  uploadFiles,
  getfiles
}