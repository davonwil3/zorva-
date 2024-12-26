
const { get } = require('mongoose');
const OpenAI = require('openai');
const openai = new OpenAI(process.env.OPENAI_API_KEY)
const User = require('../models/schemas').User;
const fs = require('fs');

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


const uploadfiles = async (req, res) => {
  try {
    const { firebaseUid } = req.body;
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).send('User not found');
    }
    const assistantId = user.assistantID;
    const vectorStoreId = user.vectorStoreID;

    console.log("assistantId:", assistantId);
    console.log("vectorStoreId:", vectorStoreId);

    if (!req.files || req.files.length === 0) {
      return res.status(400).send("No files received");
    }

    const newFileIds = [];

    for (const file of req.files) {
      const response = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants", // or "search", check the docs if there's a better purpose
      });
      newFileIds.push(response.id);
    }

    await openai.beta.vectorStores.fileBatches.createAndPoll(
      vectorStoreId,
      { file_ids: newFileIds },
      );
    // Clean up uploaded files from your server's temp folder
    req.files.forEach((file) => fs.unlinkSync(file.path));

    console.log('Files uploaded to OpenAI, vector store updated, assistant updated');
    const filenames = await getFilenamesFromVectorStore(vectorStoreId);
    console.log("Filenames:", filenames);
    res.status(200).send('Files uploaded and vector store updated successfully');

  } catch (error) {
    console.error('Error processing files:', error);
    res.status(500).send('Error processing files');
  }
 
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
  uploadfiles
}