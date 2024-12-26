
const OpenAI = require('openai');
const openai = new OpenAI(process.env.OPENAI_API_KEY)
const User = require('../models/schemas').User;


const createfilesearch = async (req, res) => {
  const { assistantId } = req.body;
  console.log("assistantId:", assistantId);

  try {
    if (assistantId) {
      const response = await openai.beta.assistants.retrieve(assistantId);
      console.log("Using existing assistant:", response.id);
    } else {
      // Create a new assistant if no ID exists
      const assistant = await openai.beta.assistants.create({
        name: "Financial Analyst Assistant",
        instructions: "You are an expert financial analyst. Use your knowledge base to answer questions about audited financial statements.",
        model: "gpt-4o",
        tools: [{ type: "file_search" }],
      });
      assistantId = assistant.id;

      console.log("Created new assistant with ID:", assistantId);
    }

    res.status(200).json({ assistantId });
  } catch (error) {
    console.error("Error checking or creating assistant:", error);
    res.status(500).json({ error: "An error occurred while setting up the assistant." });
  }
};

const uploadfiles = async (req, res) => {
  const fileStreams = ["edgar/goog-10k.pdf", "edgar/brka-10k.txt"].map((path) =>
    fs.createReadStream(path),
  );

  // Create a vector store including our two files.
  let vectorStore = await openai.beta.vectorStores.create({
    name: "Financial Statement",
  });

  await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, fileStreams)

  await openai.beta.assistants.update(assistant.id, {
    tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
    });
};



const adduser = async (req, res) => {
  const { firebaseUid } = req.body;
  const { email } = req.body;
  console.log("firebaseUid:", firebaseUid);
  try {
    // Create a new user document
    const newUser = new User({
      firebaseUid,
      email
    });

    // Save the user document to the database
    await newUser.save();

    // Send a success response
    console.log("User added successfully");
  } catch (error) {
    // Handle errors
    console.log("Error adding user:", error);
  }
};




module.exports = {
  chatbot,
  adduser
}