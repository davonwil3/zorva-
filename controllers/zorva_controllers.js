
const OpenAI = require('openai');
const openai = new OpenAI(process.env.OPENAI_API_KEY)

const chatbot = async (req, res) => {
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
  

module.exports = {
    chatbot
}