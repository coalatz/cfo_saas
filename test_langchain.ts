import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

async function run() {
  try {
    const llm = new ChatOpenAI({
      model: "nemotron-3-super:cloud",
      temperature: 0.1,
      maxTokens: 1000,
      apiKey: "ollama",
      configuration: { baseURL: "http://localhost:11434/v1" },
    });

    console.log("Invoking LLM...");
    const response = await llm.invoke([
      new SystemMessage("You are a helpful assistant. Reply with JSON { \"ok\": true }"),
      new HumanMessage("Hello!"),
    ]);
    
    console.log("Response:", response);
    console.log("Response Content:", response.content);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
