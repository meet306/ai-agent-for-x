import { config } from "dotenv";
import readline from "readline/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

config();

// -------------------- Gemini Setup (v1 API) --------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// -------------------- MCP Setup --------------------
const mcpClient = new Client({
  name: "example-client",
  version: "1.0.0",
});

let tools = [];
const chatHistory = [];

// -------------------- Readline --------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// -------------------- Connect MCP --------------------
await mcpClient.connect(
  new SSEClientTransport(new URL("http://localhost:3001/sse"))
);

console.log("Connected to mcp server");

// -------------------- Load MCP Tools --------------------
const toolResponse = await mcpClient.listTools();
tools = toolResponse.tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: {
    type: tool.inputSchema.type,
    properties: tool.inputSchema.properties,
    required: tool.inputSchema.required,
  },
}));

// -------------------- Gemini Model --------------------
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-pro", // or gemini-1.5-flash
});

// -------------------- Chat Loop --------------------
async function chatLoop(toolCall = null) {
  if (toolCall) {
    console.log("Calling tool:", toolCall.name);

    const toolResult = await mcpClient.callTool({
      name: toolCall.name,
      arguments: toolCall.args,
    });

    chatHistory.push({
      role: "user",
      parts: [
        {
          text: "Tool result: " + toolResult.content[0].text,
        },
      ],
    });
  } else {
    const question = await rl.question("You: ");
    chatHistory.push({
      role: "user",
      parts: [{ text: question }],
    });
  }

  try {
    console.log("Sending to Gemini...");

    const result = await model.generateContent({
      contents: chatHistory,
      tools: [
        {
          functionDeclarations: tools,
        },
      ],
    });

    const candidate = result.response.candidates[0];
    const part = candidate.content.parts[0];

    if (part.functionCall) {
      return chatLoop(part.functionCall);
    }

    const text = part.text;

    chatHistory.push({
      role: "model",
      parts: [{ text }],
    });

    console.log(`AI: ${text}`);
    return chatLoop();
  } catch (error) {
    console.error("Gemini Error:", error.message);
    process.exit(1);
  }
}

// -------------------- Start --------------------
chatLoop();
