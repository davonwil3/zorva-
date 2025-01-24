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
const { text } = require('stream/consumers');
const { QuickInsights } = require('../models/schemas');
const Conversations = require('../models/schemas').Conversations;
const Message = require('../models/schemas').Message;
const quickInsights = require('../models/schemas').quickInsights;
const QuickInsightsSavedResponses = require('../models/schemas').QuickInsightsSavedResponses;



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
      instructions: `
      You are an expert data analytics advisor. Your role is to assist users by analyzing data from various files. 
      When users ask about specific data or files already in the system:
      - Check the vector store for any files relevant to the query.
      - Use the file search tool to locate the most relevant data within these files.
      - Analyze the found data to respond to the user's query.
`,
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

// get user by firebaseUid
const getUser = async (req, res) => {
  const { firebaseUid } = req.body;
  try {
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json({ user }); // Return the user object inside a 'user' key
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
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

    // Create a single JSON object containing all sheets
    const allSheetsData = {};
    sheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const sheetData = xlsx.utils.sheet_to_json(worksheet);
      allSheetsData[sheetName] = sheetData;
    });

    jsonData = allSheetsData;
    console.log('All Excel Data:', jsonData);
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

const chat = async (req, res) => {
  try {
    const { firebaseUid, query, fileIDs } = req.body;
    let { threadID, filenames } = req.body;


    console.log("Received Firebase UID:", firebaseUid);
    console.log("Received query:", query);
    console.log("Received threadID:", threadID);
    console.log("Received filenames:", filenames);
    console.log("Received fileIDs:", fileIDs);

    // Step 1: Find the user in the database
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const assistantID = user.assistantID?.dataanalysisID;
    if (!assistantID) {
      return res.status(400).json({ error: "Assistant ID not found for user" });
    }

    if ((!fileIDs || fileIDs.length === 0) && !query) {
      return res.status(400).json({ error: "No file IDs or query provided. Cannot proceed." });
    }

    const filenamesText = filenames
      ?.map((name) => name.replace(/\.[^/.]+$/, ""))
      .map((name) => `Filename: ${name}`)
      .join(", ") || "";

    let instructions = filenamesText
      ? `files to analyze: ${filenamesText}\n\n${query || ""}\n\nNote: At the end of the response, respond "Follow Up Questions" followed by 3 follow-up questions as a JSON array like this: [{"question": "Sample question"}].`
      : query + `Note: At the end of the response, respond "Follow Up Questions" followed by 3 follow-up questions as a JSON array like this: [{"question": "Sample question"}].`;

    // Step 2: Create a new thread if threadID is missing
    if (!threadID) {
      const threadPayload = {
        messages: [{ role: "user", content: instructions }],
      };

      const thread = await openai.beta.threads.create(threadPayload);
      if (!thread || !thread.id) {
        throw new Error("Thread creation failed");
      }

      // Save the thread to your database
      const newConversation = new Conversations({
        conversation_id: 1, // Adjust this if you have a specific ID logic
        assistantID: assistantID,
        userID: firebaseUid,
        threadID: thread.id,

      });

      console.log("Thread created successfully:", thread.id);
      threadID = thread.id;
      await newConversation.save();
    } else {
      const messagePayload = { role: "user", content: instructions };
      await openai.beta.threads.messages.create(threadID, messagePayload);
    }

    // Save the query, instructions, and filenames to the database

    const newMessage = new Message({
      threadID: threadID,
      role: "user",
      query: query, // User-visible query
      content: instructions, // Full instructions sent to OpenAI
      filenames: filenames || [],
    });
    await newMessage.save();

    // Stream from OpenAI
    let completeResponse = "";
    let questionsArray = undefined;
    let citations = [];
    let messageCitations = undefined;

    await new Promise((resolve, reject) => {
      openai.beta.threads.runs
        .stream(threadID, {
          assistant_id: assistantID,
          max_completion_tokens: 2000,
        })
        .on("messageDone", (event) => {
          if (event.content && Array.isArray(event.content) && event.content.length > 0 && event.content[0]?.type === "text") {
            const { text } = event.content[0];
            completeResponse += text.value;
            messageCitations = event.content[0];

            // Remove "Follow Up Questions" if it exists
            completeResponse = completeResponse.replace(/Follow Up Questions[:]?/gi, "").trim();

            // Check for JSON block in the accumulated response
            const jsonMatch = completeResponse.match(/```json\s*([\s\S]*?)\s*```/i);
            if (jsonMatch && jsonMatch[1]) {
              try {
                // Parse the JSON block and remove it from the response
                questionsArray = JSON.parse(jsonMatch[1]);
                console.log("Extracted Questions Array:", questionsArray);

                completeResponse = completeResponse.replace(jsonMatch[0], "").trim();
              } catch (error) {
                console.error("Error parsing JSON array:", error);
              }
            }
          }
        })

        .on("end", () => {
          // Clean up the complete response
          completeResponse = completeResponse.replace(/[^\x20-\x7E\n\r]|[*#]/g, (char) => {
            // Allow specific symbols like $, €, £, and standard punctuation except * and #
            if (/[\u0024\u00A3\u20AC!"$%&'()+,\-./:;<=>?@[\\\]^_{|}~]/.test(char)) {
              return char; // Keep these symbols
            }
            return ""; // Remove all other non-ASCII and excluded symbols
          });

          // Extract citations from the message content
          if (fileIDs && fileIDs.length > 0) {
            for (const fileID of fileIDs) {
              citations.push(fileID);
            }
          } else {
            const annotations = messageCitations?.text.annotations;
            if (annotations) {
              for (const citation of annotations) {
                if (citation.file_citation?.file_id) {
                  citations.push(citation.file_citation.file_id);
                }
              }
            }
          }
          resolve(); // Resolve the streaming process
        })

        .on("error", reject);
    });

    // Save the assistant's cleaned response to the database
    const assistantMessage = new Message({
      threadID: threadID,
      role: "assistant",
      query: null,
      content: completeResponse,
      citation: citations,
    });
    await assistantMessage.save();

    // Send the final JSON response
    const finalJson = JSON.stringify({
      response: completeResponse, // Cleaned response without JSON block
      threadID,
      questionsArray, // Extracted questions array
      citations, // Collected file IDs
    });
    console.log("citations:", citations);
    res.write(finalJson);
    res.end();
  } catch (error) {
    console.error("Error in chat function:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error processing chat request" });
    }
  }
};

// get quick insights by file id
const generateInsights = async (req, res) => {
  try {
    const { firebaseUid, fileIDs, filenames, } = req.body;
    let { threadID } = req.body;
    const user = await User.findOne({ firebaseUid });
    const assistantID = user.assistantID?.dataanalysisID;

    console.log("Request body:", req.body);
    console.log("Filenames:", filenames);
    console.log("fileIDs:", fileIDs);
    console.log("threadID:", threadID);
  

    if (!assistantID) {
      return res.status(400).json({ error: 'Assistant ID not found for user' });
    }
    if (!fileIDs || fileIDs.length === 0) {
      return res.status(400).json({ error: 'No file IDs provided' });
    }
    console.log('file names:', filenames);
    let userMessage = `find the files with the file name  : ${filenames} and give in depth insights on your findings. Note: The response should be in JSON with an array of insights at least 8, each containing only  a title, description, and the filename associated with that insight.  do not provide any other objeccts except title and description and filenames. make sure you are actually looking inside of the file with that filename do not hallucinate.  give insights such as trends, averages, and other in depth insights `;
    // Create a thread for insights
    if (!threadID) {
      isNew = true;

      const thread = await openai.beta.threads.create({
        messages: [
          {
            role: "user",
            content: userMessage,
          },
        ],
      });
      threadID = thread.id;
      console.log("Thread created successfully:", thread.id);

      // add a quickInsightsThreadID field to user
      user.quickInsightsThreadID = threadID;
      await user.save();

    }

    // Run the thread
    const run = await openai.beta.threads.runs.createAndPoll(threadID, {
      assistant_id: assistantID,
      max_completion_tokens: 9000,
    });

    if (!run || !run.id) {
      throw new Error("Run creation failed");
    }

    // Step 6: Retrieve the assistant’s response messages
    const messages = await openai.beta.threads.messages.list(threadID, {
      run_id: run.id,
    });
    if (!messages || messages.data.length === 0) {
      throw new Error("No messages returned from the assistant");
    }

    // Extract the assistant’s final message
    const response = messages.data.pop();
    const contentResponse = response.content[0].text.value;
    console.log("Response from assistant:", contentResponse);

    // extract the array from response
    const regex = /\[([\s\S]*)\]/;
    const match = contentResponse.match(regex);
    let jsonArray = [];
    if (match && match[1]) {
      try {
        jsonArray = JSON.parse(`[${match[1]}]`);
      } catch (error) {
        console.error("Error parsing JSON array:", error);
        return res.status(500).json({ error: "Error parsing JSON array from assistant response" });
      }
    }

    // iterate over json array and create insights
    const insights = jsonArray.map((item) => ({
      userID: firebaseUid,
      assistantID: assistantID,
      threadID: threadID,
      title: item.title,
      text: item.description,
      filenames: item.filename,
    }));
    // Save quick insights to the database and retrieve the saved documents
    const savedInsights = await QuickInsights.insertMany(insights);
    console.log("Insights saved to database:", savedInsights);

    return res.status(200).json({ insights: savedInsights, threadID: threadID });


  } catch (error) {
    console.error("Error in generateInsights function:", error);
    return res.status(500).json({ error: "Error processing generateInsights request" });
  }
}



const generateTitle = async (req, res) => {
  try {
    // 1. Extract relevant data from the request body
    const { firebaseUid, query } = req.body;

    // 2. Fetch user from DB to get the right assistant ID
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const assistantID = user.assistantID?.dataanalysisID;
    if (!assistantID) {
      return res
        .status(400)
        .json({ error: 'Assistant ID not found for user' });
    }

    // 3. Create a new thread to ask for a short “title”
    //    The instruction tells the model to only return the title, no extra fluff
    const threadTitle = await openai.beta.threads.create({
      messages: [
        {
          role: 'user',
          content: `Provide a title for the following query, summarizing it concisely. Respond only with the title, and do not include any additional words or labels: ${query}`,
        },
      ],
    });

    if (!threadTitle || !threadTitle.id) {
      throw new Error('Thread creation for title generation failed');
    }

    // 4. Run the thread, waiting for completion
    const runTitle = await openai.beta.threads.runs.createAndPoll(
      threadTitle.id,
      {
        assistant_id: assistantID,
        max_completion_tokens: 2000,
      }
    );

    if (!runTitle || !runTitle.id) {
      throw new Error('Run creation for title generation failed');
    }

    // 5. Retrieve the assistant’s final message
    const messagesTitle = await openai.beta.threads.messages.list(
      threadTitle.id,
      {
        run_id: runTitle.id,
      }
    );

    if (!messagesTitle || messagesTitle.data.length === 0) {
      throw new Error('No messages returned from the assistant');
    }

    // The last message in the array should contain the summarized title
    const responseTitle = messagesTitle.data.pop();
    const contentTitle = responseTitle.content[0].text.value.trim();
    console.log('Title generated from assistant:', contentTitle);

    // 6. Return the title to the client
    return res.status(200).json({ title: contentTitle });
  } catch (error) {
    console.error('Error generating title:', error);
    return res.status(500).json({ error: 'Error generating title' });
  }
};

// save title of chat
const saveTitle = async (req, res) => {
  try {
    const { firebaseUid, title, threadID } = req.body;
    const user = await User.findOne({ firebaseUid });
    const conversation = await Conversations.findOne({ threadID });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    conversation.title = title;
    await conversation.save();

    console.log('Title saved successfully:', title);

    return res.status(200).json({ title: title });

  } catch (error) {
    console.error('Error in saveTitle function:', error);
    return res.status(500).json({ error: 'Error processing saveTitle request' });
  }
}
// list all messages in a conversation
const listMessages = async (req, res) => {
  try {
    const { firebaseUid, threadID } = req.body;

    // Step 1: Validate the user
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Step 2: Retrieve messages for the thread
    const messages = await Message.find({ threadID }).sort({ timestamp: 1 });

    if (!messages || messages.length === 0) {
      return res.status(404).json({ error: "No messages found in this thread." });
    }

    // Step 3: Format messages to include citations
    const formattedMessages = messages.map((message) => {
      return {
        sender: message.role,
        text: message.role === "user" ? message.query : message.content, // Use `query` for user messages
        filenames: message.filenames.length > 0 ? message.filenames : undefined, // Include filenames for user messages
        fileCitations: message.citation.length > 0 ? message.citation : undefined, // Include citations if available
        timestamp: message.timestamp,
      };
    });

    // Step 4: Send formatted messages back
    return res.status(200).json({ messages: formattedMessages });
  } catch (error) {
    console.error("Error in listMessages function:", error);
    return res.status(500).json({ error: "Error processing listMessages request" });
  }
};

// save a conversation insight
const saveInsight = async (req, res) => {
  const { type } = req.body;
  if (type === 'chat') {
    try {
      const { threadID, text, data, fileReference } = req.body;

      // Fetch the conversation
      const conversation = await Conversations.findOne({ threadID });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Find the maximum existing insightID and increment it
      const maxInsightID =
        conversation.savedInsights.length > 0
          ? Math.max(...conversation.savedInsights.map((insight) => insight.insightID || 0))
          : 0;

      const newInsight = {
        insightID: maxInsightID + 1, // Increment the ID
        text,
        data,
        fileReference,
      };

      conversation.savedInsights.push(newInsight);
      await conversation.save();

      // Return the newly saved insight
      const savedInsight = newInsight;
      return res.status(200).json({ message: 'Insight saved successfully', savedInsight });
    } catch (error) {
      console.error('Error in saveInsight function:', error);
      return res.status(500).json({ error: 'Error processing saveInsight request' });
    }
  } else {
    try {
      const { insight, threadID } = req.body;
      console.log('insight:', insight);

      // save insight into quickInsightsSavedResponses
      const quickInsight = await QuickInsights.findOne({ insightID: insight.insightID, })
      const updatedQuickInsight = await QuickInsightsSavedResponses.findOneAndUpdate(
        { threadID },
        {
          $push: { quickInsightsIDs: quickInsight.insightID },
          $set: { assistantID: quickInsight.assistantID, userID: quickInsight.userID },
        },
        { new: true, upsert: true } // Return the updated document, create if not exists
      );
      console.log('quick insight saved successfully');
      return res.status(200).json({ message: 'Quick insight saved successfully' });
    }
    catch (error) {
      console.error('Error in saveInsight function:', error);
      return res.status(500).json({ error: 'Error processing saveInsight request' });
    }
  };
}

// delete insight
const deleteInsight = async (req, res) => {
  try {
    const { threadID, insightID } = req.body;

    // Find the conversation by threadID
    const conversation = await Conversations.findOne({ threadID });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Find the index of the insight to delete
    const index = conversation.savedInsights.findIndex(
      (insight) => insight.insightID === Number(insightID) // Ensure numeric comparison
    );

    if (index === -1) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    // Remove the insight from the array
    conversation.savedInsights.splice(index, 1);
    await conversation.save();

    console.log('Insight deleted successfully');

    return res.status(200).json({ message: 'Insight deleted successfully' });
  } catch (error) {
    console.error('Error in deleteInsight function:', error);
    return res.status(500).json({ error: 'Error processing deleteInsight request' });
  }
};


// get all insights saved in a conversation
const getInsights = async (req, res) => {
  try {
    const { firebaseUid, threadID } = req.body;
    const user = await User.findOne({ firebaseUid });
    const conversation = await Conversations.findOne({ threadID });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(200).json({ insights: conversation.savedInsights });
  }
  catch (error) {
    console.error('Error in getInsights function:', error);
    return res.status(500).json({ error: 'Error processing getInsights request' });
  }
}

// get converstations
const getConversations = async (req, res) => {
  try {
    const { firebaseUid } = req.body;
    const user = await User.findOne({ firebaseUid });
    const conversations = await Conversations.find({ userID: firebaseUid });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ conversations: conversations });

  } catch (error) {
    console.error('Error in getConversations function:', error);
    return res.status(500).json({ error: 'Error processing getConversations request' });
  }
}

// delete conversation
const deleteConversation = async (req, res) => {
  try {
    const { threadID } = req.body;
    const conversation = await Conversations.findOne({ threadID });


    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Delete conversation from MongoDB
    await Conversations.deleteOne({ threadID });
    // delete conversation from open ai
    await openai.beta.threads.del(threadID);

    console.log('Conversation deleted successfully');
    return res.status(200).json({ message: 'Conversation deleted successfully' });

  } catch (error) {
    console.error('Error in deleteConversation function:', error);
    return res.status(500).json({ error: 'Error processing deleteConversation request' });
  }
}


module.exports = {
  adduser,
  uploadFiles,
  getfiles,
  search,
  getFilesByID,
  deletefile,
  chat,
  listMessages,
  saveInsight,
  getInsights,
  saveTitle,
  generateTitle,
  getConversations,
  deleteConversation,
  deleteInsight,
  generateInsights,
  getUser

}