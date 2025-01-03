const { get } = require('mongoose');
const OpenAI = require('openai');
const openai = new OpenAI(process.env.OPENAI_API_KEY)
const User = require('../models/schemas').User;
const fs = require('fs');
const xlsx = require('xlsx');
const { promisify } = require('util');
const path = require('path');
const AWS = require('aws-sdk');
const mime = require('mime-types'); 
const cache = require('./cache');


// Configure AWS SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: 'us-east-2',
});

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

    console.log('Files received for upload:', req.files);

    const newFileIds = [];

    for (const file of req.files) {
      console.log(`Processing file: ${file.originalname} at path: ${file.path}`);
      let response;
      let openAiFileId;

      // Save the original file path for S3 upload later
      const originalFilePath = file.path;
      const originalFileName = file.originalname;

      // Check if file has an extension
      const hasExtension = /\.[^/.]+$/.test(file.originalname);

      if (!hasExtension) {
        // Detect MIME type and add an appropriate extension
        const extension = mime.extension(file.mimetype);
        if (extension) {
          const newOriginalName = `${file.originalname}.${extension}`;
          file.originalname = newOriginalName;
          console.log(`File lacked an extension. Updated name: ${file.originalname}`);
        } else {
          console.error(`Unsupported MIME type: ${file.mimetype}`);
          throw new Error(`Unsupported MIME type: ${file.mimetype}`);
        }
      }

      // Convert to JSON only for OpenAI if the file is Excel or CSV
      if (
        /\.(xlsx|xls|csv)$/i.test(file.originalname) ||
        ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'].includes(file.mimetype)
      ) {
        console.log('Converting file to JSON for OpenAI...');
        const { newFilePath, newFileName } = await convertToJSON(file);
        file.path = newFilePath; // Update file object to use JSON file path for OpenAI upload
        file.originalname = newFileName; // Update file name for consistency

        console.log('Uploading converted JSON file to OpenAI:', newFilePath);
        response = await openai.files.create({
          file: fs.createReadStream(newFilePath),
          purpose: 'assistants',
        });
      } else {
        console.log('Uploading original file to OpenAI:', file.path);
        response = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: 'assistants',
        });
      }

      openAiFileId = response.id;
      newFileIds.push(openAiFileId);
      console.log(`File uploaded to OpenAI with ID: ${openAiFileId}`);

      // Upload the original file to AWS S3 using OpenAI file ID as the key
      const mimeType = mime.lookup(originalFilePath) || 'application/octet-stream'; // Detect MIME type
      const s3Params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `uploads/${openAiFileId}`, // Use OpenAI file ID as S3 key
        Body: fs.createReadStream(originalFilePath), // Use the original file path for S3 upload
        ContentType: mimeType,
        ContentDisposition: 'inline',
      };

      console.log('Uploading original file to S3:', s3Params.Key);
      await s3.upload(s3Params).promise();
      console.log(`File uploaded to S3 with OpenAI ID: ${openAiFileId}`);
    }

    // Add files to vector store
    console.log('Adding files to vector store:', newFileIds);
    await openai.beta.vectorStores.fileBatches.createAndPoll(vectorStoreId, {
      file_ids: newFileIds,
    });

    // Clean up local files
    for (const file of req.files) {
      console.log('Deleting local file:', file.path);
      fs.unlinkSync(file.path);
    }

    return res.status(200).json({
      message: 'Files uploaded to S3 and OpenAI successfully',
    });

  } catch (error) {
    console.error('Error processing files:', error.message);
    return res.status(500).send('Error processing files');
  }
};

const convertToJSON = async (file) => {
  const filePath = file.path;
  let fileExtension = path.extname(file.originalname).toLowerCase();

  console.log(`Converting file: ${file.originalname}`);
  console.log(`File path: ${filePath}`);
  console.log(`File extension: ${fileExtension}`);

  // If no extension, detect it based on MIME type and add it
  if (!fileExtension) {
    const extensionFromMime = mime.extension(file.mimetype); // Use `mime-types` to detect extension
    if (extensionFromMime) {
      fileExtension = `.${extensionFromMime}`;
      file.originalname += fileExtension; // Append detected extension to the original name
      console.log(`File lacked an extension. Added detected extension: ${fileExtension}`);
    } else {
      console.error('Unsupported MIME type:', file.mimetype);
      throw new Error('Unsupported file type');
    }
  }

  let jsonData = [];

  if (fileExtension === '.csv') {
    console.log('Processing as a CSV file');
    // Read CSV file
    const data = fs.readFileSync(filePath, 'utf-8');
    const rows = data.split('\n').filter((row) => row.trim() !== ''); // Remove empty rows
    const headers = rows[0].split(',');

    console.log('CSV Headers:', headers);

    jsonData = rows.slice(1).map((row, rowIndex) => {
      const values = row.split(',');
      const rowObject = headers.reduce((acc, header, index) => {
        acc[header.trim()] = values[index]?.trim() || '';
        return acc;
      }, {});
      console.log(`Row ${rowIndex + 1}:`, rowObject);
      return rowObject;
    });
  } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
    console.log('Processing as an Excel file');
    // Read Excel file
    const workbook = xlsx.readFile(filePath);
    const sheetNames = workbook.SheetNames;
    console.log('Excel Sheet Names:', sheetNames);

    jsonData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetNames[0]]);
    console.log('Excel Data:', jsonData);
  } else {
    console.error('Unsupported file format:', fileExtension);
    throw new Error('Unsupported file format');
  }

  // Append `.json` after the original filename (with extension)
  const newFileName = `${path.basename(file.originalname)}.json`; // Keep the original extension + .json
  const newFilePath = path.join(path.dirname(filePath), newFileName);

  console.log('Writing JSON file:', newFilePath);

  // Write the JSON data to a file
  fs.writeFileSync(newFilePath, JSON.stringify(jsonData, null, 2));

  console.log(`File converted to JSON successfully: ${newFilePath}`);
  return {
    newFilePath,
    newFileName,
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

// The main function to handle fetching files by ID
const getFilesByID = async (req, res) => {
  try {
    const { firebaseUid, fileIDs } = req.body;

    // Validate input
    if (!firebaseUid || !Array.isArray(fileIDs)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    // Fetch user based on firebaseUid
    const user = await User.findOne({ firebaseUid });

    console.log('Fetching files for user:', user);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Helper function to get or set signed URL in cache
    const getSignedUrl = async (fileId, key) => {
      const cacheKey = `signedUrl:${fileId}`;

      // Attempt to get the URL from the cache
      const cachedUrl = cache.get(cacheKey);
      if (cachedUrl) {
        console.log(`Cache hit for file ID ${fileId}`);
        return cachedUrl;
      }

      console.log(`Cache miss for file ID ${fileId}. Generating new signed URL.`);

      // Generate a signed URL with 1-hour expiration
      const url = s3.getSignedUrl('getObject', {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        Expires: 3600, // 1 hour in seconds
        ResponseContentDisposition: 'inline',
      });

      // Store the signed URL in the cache
      cache.set(cacheKey, url);
      console.log(`Generated and cached new signed URL for file ID ${fileId}`);

      return url;
    };

    // Fetch files from S3 based on fileIDs
    const filesWithMetadata = await Promise.all(
      fileIDs.map(async (fileId) => {
        const key = `uploads/${fileId}`; // Ensure this matches your S3 object keys
        console.log('Attempting to fetch file with Key:', key);

        const params = {
          Bucket: process.env.AWS_BUCKET_NAME, // Ensure this is set to "zorvauploads"
          Key: key,
        };

        try {
          // Check if the file exists and retrieve metadata
          const fileData = await s3.headObject(params).promise();

          // Get or generate signed URL from cache
          const url = await getSignedUrl(fileId, key);

          console.log('File metadata:', fileData);
          console.log('Signed URL:', url);

          return {
            id: fileId,
            filename: fileData.Metadata?.filename || fileId, // Assuming you store filename in metadata
            contentType: fileData.ContentType || 'unknown',
            contentLength: fileData.ContentLength || 0,
            data: url, // Return the signed URL
          };
        } catch (err) {
          if (err.code === 'NotFound') {
            console.error(`File with ID ${fileId} not found in S3.`);
            throw new Error(`File with ID ${fileId} not found.`);
          } else {
            console.error(`Error fetching file with ID ${fileId}:`, err.message);
            throw new Error(`Unable to retrieve file with ID ${fileId}.`);
          }
        }
      })
    );

    // Respond with the files and their metadata
    res.status(200).json({ files: filesWithMetadata });
  } catch (error) {
    console.error('Error fetching files:', error.message);
    res.status(500).json({ error: error.message || 'An error occurred' });
  }
};


const search = async (req, res) => {
  try {
    const { firebaseUid, query, searchByFilename } = req.body; // Add searchByFilename flag

    // Step 1: Fetch the user and verify existence
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const filesearchID = user.assistantID?.filesearchID;
    if (!filesearchID) {
      return res.status(400).json({ error: 'filesearchID not found for user' });
    }

    let citations = [];

    // Step 2: Create a thread
    console.log("Creating thread with query:", query);
    const thread = await openai.beta.threads.create({
      messages: [
        {
          role: "user",
          content: query,
        },
      ],
    });

    if (!thread || !thread.id) {
      throw new Error("Thread creation failed");
    }

    console.log("Thread created successfully:", thread);

    // Step 3: Send a message and poll the result
    console.log("Running assistant with filesearchID:", filesearchID);
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: filesearchID,
      max_completion_tokens: 500, // Adjust based on expected output size
    });
    if (!run || !run.id) {
      throw new Error("Run creation failed");
    }

    // Step 4: Retrieve the response messages
    const messages = await openai.beta.threads.messages.list(thread.id, {
      run_id: run.id,
    });

    if (!messages || messages.data.length === 0) {
      throw new Error("No messages returned from the assistant");
    }

    // Step 5: Process the latest message to extract citations
    const message = messages.data.pop();
    if (message?.content?.[0]?.type === "text") {
      const { text } = message.content[0];
      const { annotations } = text || {};

      if (!annotations || annotations.length === 0) {
        console.log("No annotations found in the response text");
      } else {
        let index = 0;
        for (const annotation of annotations) {
          if (annotation.file_citation?.file_id) {
            citations.push(annotation.file_citation.file_id);
          }
          index++;
        }
      }
    } else {
      console.log("Message content is missing or invalid");
    }

    console.log("Citations extracted:", citations);
    return res.status(200).json({ fileIDs: citations });
  } catch (error) {
    console.error("Error in search function:", error);
    return res.status(500).json({ error: "Error processing search request" });
  }
};


// delete files from s3 and openai
const deletefile = async (req, res) => {
  try {
    const { firebaseUid, fileID } = req.body;
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const vectorStoreId = user.vectorStoreID;

    // Delete file from OpenAI
    await openai.files.del(fileID);
    await openai.beta.vectorStores.files.del(vectorStoreId, fileID);

    console.log(`File deleted from OpenAI with ID: ${fileID}`);

    // Delete file from S3
    const key = `uploads/${fileID}`;
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    };

    await s3.deleteObject(params).promise();
    console.log(`File deleted from S3 with Key: ${key}`);

    return res.status(200).json({ message: 'File deleted successfully from s3' });
  }
  catch (error) {
    console.error('Error deleting file:', error);
    return res.status(500).send('Error deleting file');
  }
}





module.exports = {
  adduser,
  uploadFiles,
  getfiles,
  search,
  getFilesByID,
  deletefile
}