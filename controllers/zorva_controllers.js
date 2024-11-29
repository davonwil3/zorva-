require("dotenv").config();
import OpenAI from "openai";
const openai = new OpenAI(process.env.OPENAI_API_KEY)