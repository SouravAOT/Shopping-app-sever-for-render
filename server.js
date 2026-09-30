const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const { convertToCuelinks } = require("./services/cuelinks");
const { getAmazonProduct } = require("./services/amazon");
const { getFlipkartProduct } = require("./services/flipkart");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/*
  Home
*/
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "SmartPick Backend",
    version: "2.0.0"
  });
});

/*
  Health check
*/
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    openai: !!process.env.OPENAI_API_KEY
  });
});

/*
  AI CHAT
  Frontend sends:
  {
    "message": "Show me a gaming PC under 35000"
  }
*/
app.post("/api/ai/chat", async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        error: "Message is required."
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "OPENAI_API_KEY is not configured on the server."
      });
    }

    /*
      Keep only a reasonable amount of chat history.
      This prevents unnecessarily huge API requests.
    */
    const safeHistory = Array.isArray(history)
      ? history
          .filter(item =>
            item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string"
          )
          .slice(-20)
      : [];

    const conversation = [
      ...safeHistory,
      {
        role: "user",
        content: message
      }
    ];

    const response = await openai.responses.create({
      model: "gpt-6-astra",

      instructions: `
You are SmartPick AI, the shopping assistant inside the SmartPick website.

Your main purpose is helping users with shopping and product-related questions.

You can:
- Understand English, Hindi, Bengali and Hinglish.
- Reply in the language/style the user uses.
- Help users choose products according to their budget and requirements.
- Explain product features in simple language.
- Have normal friendly conversation when the user is not asking about shopping.

Important rules:
- Do not pretend that a product exists in the SmartPick catalog unless product data is actually provided to you.
- Do not invent product prices, stock status, ratings, reviews or links.
- If SmartPick product data is not available, clearly say that you don't currently have that product data.
- Do not claim that you checked Amazon or Flipkart unless an actual product/search tool has provided that information.
- You are a shopping assistant, not primarily a coding assistant or image-generation assistant.
- Keep answers useful and reasonably concise.
      `,

      input: conversation
    });

    res.json({
      success: true,
      reply: response.output_text || "Sorry, I couldn't generate a response."
    });

  } catch (error) {
    console.error("AI ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message || "AI request failed."
    });
  }
});

/*
  Convert an Amazon/Flipkart merchant URL
  into a Cuelinks tracking URL.
*/
app.post("/api/affiliate", async (req, res) => {
  try {
    const { url, subid } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Product URL is required."
      });
    }

    const result = await convertToCuelinks(url, subid);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error("AFFILIATE ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/*
  Detect merchant from URL and fetch product information.
*/
app.post("/api/product", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Product URL is required."
      });
    }

    const hostname = new URL(url).hostname.toLowerCase();

    let product;

    if (
      hostname.includes("amazon.in") ||
      hostname.includes("amazon.com")
    ) {
      product = await getAmazonProduct(url);
    }

    else if (
      hostname.includes("flipkart.com")
    ) {
      product = await getFlipkartProduct(url);
    }

    else {
      return res.status(400).json({
        success: false,
        error: "Only supported Amazon/Flipkart URLs are accepted."
      });
    }

    res.json({
      success: true,
      product
    });

  } catch (error) {
    console.error("PRODUCT ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/*
  Start server
*/
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SmartPick Backend running on port ${PORT}`);
});
