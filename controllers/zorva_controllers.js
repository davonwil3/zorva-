
const { get } = require('mongoose');
const OpenAI = require('openai');
const openai = new OpenAI(process.env.OPENAI_API_KEY)
const User = require('../models/schemas').User;
const fs = require('fs');
const XLSX = require('xlsx');
const  csv = require('csv-parse');
const { promisify } = require('util');
const path = require('path');

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

    // 1. Validate and retrieve the user
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).send('User not found');
    }

    const assistantId = user.assistantID;
    const vectorStoreId = user.vectorStoreID;

    // 2. Confirm we actually have files in the request
    if (!req.files || req.files.length === 0) {
      return res.status(400).send('No files received');
    }

    console.log('req.files:', req.files);
    const filePaths = req.files.map((file) => file.path);
    console.log('File paths received:', filePaths);

    const newFileIds = [];
    const processedData = [];

    // 3. Iterate through each file to process
    for (const file of req.files) {
      // Check if file is Excel or CSV
      if (/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
        const jsonData = await convertToJSON(file);
        if (jsonData) {
          // Build metadata
          const fileMetadata = {
            originalName: jsonData.originalName,
            fileName: jsonData.fileName,
            extension: jsonData.extension,
            sheetNames: jsonData.sheetNames,
            uploadDate: new Date().toISOString(),
            recordCounts: {}
          };

          // Calculate record counts for each sheet
          for (const [sheetName, data] of Object.entries(jsonData.sheets)) {
            fileMetadata.recordCounts[sheetName] = data.length;
          }

          // Create separate JSON files for each sheet and upload to OpenAI
          const fileIds = await Promise.all(
            Object.entries(jsonData.sheets).map(async ([sheetName, sheetData]) => {
              const tempFilePath = `/tmp/${jsonData.fileName}-${sheetName}-${Date.now()}.json`;

              // Write JSON data to a temporary file
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

              // Upload file to OpenAI
              const response = await openai.files.create({
                file: fs.createReadStream(tempFilePath),
                purpose: 'assistants'
              });

              // Remove temporary file
              await fs.promises.unlink(tempFilePath);

              return response.id;
            })
          );

          newFileIds.push(...fileIds);
          processedData.push({
            ...fileMetadata,
            fileIds
          });
        }
      } else {
        // 4. Handle other file types
        const response = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: 'assistants'
        });

        newFileIds.push(response.id);
        processedData.push({
          originalName: file.originalname,
          fileIds: [response.id]
        });
      }
    }

    // 5. Update the vector store with newly uploaded files
    await openai.beta.vectorStores.fileBatches.createAndPoll(vectorStoreId, {
      file_ids: newFileIds
    });

    // 6. Clean up uploaded files on the server
    for (const file of req.files) {
      fs.unlinkSync(file.path);
    }

    // 7. Retrieve the updated filenames from the vector store (optional)
    const filenames = await getFilenamesFromVectorStore(vectorStoreId);

    console.log('Files processed and uploaded:', processedData);

    // 8. Send final response
    return res.status(200).json({
      message: 'Files uploaded and vector store updated successfully',
      processedFiles: processedData,
      filenames
    });
  } catch (error) {
    console.error('Error processing files:', error);
    return res.status(500).send('Error processing files');
  }
};



// Helper function to convert Excel/CSV to JSON
const convertToJSON = async (file) => {
  // 1. Basic Validation
  if (!file || !file.path) {
    throw new Error('Invalid file or missing file path.');
  }

  // 2. Check Extension
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  let workbook;
  try {
    // 3. Read File Asynchronously
    const fileBuffer = await fs.promises.readFile(file.path);

    if (ext === '.csv') {
      // 3a. CSV Parsing
      const csvData = fileBuffer.toString('utf8');
      // Split into rows and columns
      const rows = csvData.split('\n').map((row) => row.split(','));

      // Convert rows to a worksheet
      const worksheet = xlsx.utils.aoa_to_sheet(rows);
      // Create a pseudo-workbook
      workbook = {
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: worksheet },
      };
    } else {
      // 3b. XLS/XLSX Parsing
      workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    }
  } catch (err) {
    console.error('Error reading or parsing file:', err);
    throw new Error('Failed to read or parse the file. Please ensure it is a valid Excel/CSV.');
  }

  // 4. Validate Workbook Content
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('No sheets found in the workbook.');
  }

  // 5. Convert Each Sheet to JSON
  const sheets = {};
  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    // Convert rows in each sheet to a JSON array
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',  // Provide a default value for empty cells
      raw: false,  // Convert cell dates and numbers as needed
    });
    sheets[sheetName] = jsonData;
  }

  // 6. Return Consolidated Data
  return {
    originalName: file.originalname,
    fileName: file.filename,            // or path.basename(file.path) if you prefer
    extension: ext,
    sheetNames,
    sheets,
  };
};


const getFilenamesFromVectorStore = async (vectorStoreId) => {
  const fileIds = [];
  const filenames = [];

  try {
    // Step 1: List files from vector store
    for await (const file of openai.beta.vectorStores.files.list(vectorStoreId)) {
      fileIds.push(file.id); // Collect file IDs
    }

    // Step 2: Retrieve file metadata for each file
    for (const fileId of fileIds) {
      const file = await openai.files.retrieve(fileId);
      filenames.push(file.filename); // Collect filenames
    }

    return filenames; // Return all filenames
  } catch (error) {
    console.error('Error retrieving filenames:', error);
    return [];
  }
};



module.exports = {
  adduser,
  uploadFiles
}