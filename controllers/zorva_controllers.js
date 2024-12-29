const { get } = require('mongoose');
const OpenAI = require('openai');
const openai = new OpenAI(process.env.OPENAI_API_KEY)
const User = require('../models/schemas').User;
const fs = require('fs');
const xlsx = require('xlsx');
const csv = require('csv-parse');
const { promisify } = require('util');
const path = require('path');
const FileRecord = require('../models/schemas').FileRecord;

const parseCSV = promisify(csv.parse);

const adduser = async (req, res) => {
  const { firebaseUid, email } = req.body;
  console.log("firebaseUid:", firebaseUid);
  let assistantID;

  try {
    // 1. Create the assistant
    const filesearchassistant = await openai.beta.assistants.create({
      name: "Zorva assistant file search",
      instructions: `
      You are a file search assistant. Your role is to:
      - Parse the user's query to identify search intent.
      - Search the indexed files for relevant matches based on the query.
      - Provide the user with the relevant file citations.
    `,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
    });
    const filesearchID = filesearchassistant.id;
    console.log("Created new file assistant with ID:", assistantID);

    const dataanalysisassistant = await openai.beta.assistants.create({
      name: "Zorva assistant data analysis",
      instructions: "You are an expert data analytics advisor that gives insights about data.",
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
    });
    const dataanalysisID = dataanalysisassistant.id;
    console.log("Created new data assistant with ID:", dataanalysisID);

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
      await openai.beta.assistants.update(filesearchID, {
        tool_resources: {
          file_search: { vector_store_ids: [vectorStoreID] },
        },
      });
      await openai.beta.assistants.update(dataanalysisID, {
        tool_resources: {
          file_search: { vector_store_ids: [vectorStoreID] },
        },
      });
      console.log("Attached vector store to assistants:");
    } catch (error) {
      console.error("Error attaching vector store:", error);
      return res.status(500).send("Failed to attach vector store to assistant");
    }

    assistantID = {
      filesearchID: filesearchID,
      dataanalysisID: dataanalysisID,
    };
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

    for (const file of req.files) {
      // If Excel or CSV
      if (/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
        try {
          const newFilePath = await convertToJSON(file);
          const response = await openai.files.create({
            file: fs.createReadStream(newFilePath),
            purpose: 'assistants'
          });

          newFileIds.push(response.id);
          console.log(`Converted and saved as: ${newFilePath}`);
        } catch (error) {
          console.error(`Error converting file: ${file.originalname}`, error);
        }
      } else {
        // For non-Excel/CSV files
        const response = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: 'assistants'
        });

        newFileIds.push(response.id);
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

    return res.status(200).json({
      message: 'Files uploaded and vector store updated successfully',
    });
  } catch (error) {
    console.error('Error processing files:', error);
    return res.status(500).send('Error processing files');
  }
};

const convertToJSON = async (file) => {
  const filePath = file.path;
  const fileExtension = path.extname(file.originalname).toLowerCase();

  let jsonData = [];

  if (fileExtension === '.csv') {
    // Read CSV file
    const data = fs.readFileSync(filePath, 'utf-8');
    const rows = data.split('\n');
    const headers = rows[0].split(',');

    jsonData = rows.slice(1).map(row => {
      const values = row.split(',');
      return headers.reduce((acc, header, index) => {
        acc[header.trim()] = values[index].trim();
        return acc;
      }, {});
    });
  } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
    // Read Excel file
    const workbook = xlsx.readFile(filePath);
    const sheetNames = workbook.SheetNames;
    jsonData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetNames[0]]);
  } else {
    throw new Error('Unsupported file format');
  }

  // Create new JSON file with updated name
  const newFileName = `${file.originalname}.json`;
  const newFilePath = path.join(path.dirname(filePath), newFileName);

  fs.writeFileSync(newFilePath, JSON.stringify(jsonData, null, 2));

  return newFilePath;
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

    // Extract file IDs from the vector store files
    const fileIds = storeFiles.data.map((file) => file.id);

    // Retrieve file metadata from OpenAI Files API
    const filesWithMetadata = await Promise.all(
      fileIds.map(async (fileId) => {
        const file = await openai.files.retrieve(fileId);
        return {
          id: file.id,
          filename: file.filename || '(No filename)', // Retrieve filename from OpenAI Files API
          created_at: file.created_at,
          usage_bytes: file.bytes || 0, // Adjusted property name for consistency
        };
      })
    );

    return res.status(200).json({ files: filesWithMetadata });
  } catch (error) {
    console.error('Error fetching vector files:', error);
    return res.status(500).send('Error fetching vector files');
  }
};

const search = async (req, res) => {
  try {
    const { firebaseUid, query, searchByFilename } = req.body; // Add searchByFilename flag
    const user = await User.findOne({ firebaseUid });
    const filesearchID = user.assistantID.filesearchID;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let citations = [];

    // Content-based search
    // Step 1: Create a Thread
    const thread = await openai.beta.threads.create({
      messages: [
        {
          role: "user",
          content: query,
        },
      ],
    });

    // Step 2: Send a message
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: filesearchID,
    });

    // Step 3: Get the response
    const messages = await openai.beta.threads.messages.list(thread.id, {
      run_id: run.id,
    });

    const message = messages.data.pop();
    if (message?.content[0].type === "text") {
      const { text } = message.content[0];
      const { annotations } = text;
    
      let index = 0;
      for (const annotation of annotations) {
        text.value = text.value.replace(annotation.text, `[${index}]`);
    
        // Safely access file_citation.file_id
        if (annotation.file_citation && annotation.file_citation.file_id) {
          citations.push(annotation.file_citation.file_id);
        }
    
        index++;
      }
    
      console.log("Matched Text:", text.value);
    }
  
    console.log("Citations:", citations);
    return res.status(200).json({ fileIDs: citations });
  } catch (error) {
    console.error("Error searching:", error);
    return res.status(500).send("Error searching");
  }
};



module.exports = {
  adduser,
  uploadFiles,
  getfiles,
  search
}