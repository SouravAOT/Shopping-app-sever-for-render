const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY is missing.");
}

const ai = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

/* =========================
   HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "SmartPick Gemini Backend",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    gemini: !!GEMINI_API_KEY
  });
});

/* =========================
   GEMINI AI
========================= */

app.post("/api/ai/chat", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API key is not configured."
      });
    }

    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    const safeHistory = Array.isArray(history)
      ? history.slice(-20)
      : [];

    const contents = [];

    for (const item of safeHistory) {
      if (
        item &&
        typeof item.role === "string" &&
        typeof item.text === "string"
      ) {
        contents.push({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.text }]
        });
      }
    }

    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents,
      config: {
        systemInstruction: `
You are SmartPick AI, the shopping assistant inside the SmartPick website.

Your main job is to help users with shopping, products, comparisons,
budgets, product specifications and recommendations.

You can also answer normal everyday questions naturally.

Language:
- Understand English.
- Understand Hindi.
- Understand Bengali.
- Understand Hinglish.
- Reply in the language/style the user uses.

Be friendly, clear and concise.

Do not pretend that a product is available in SmartPick unless the
SmartPick product catalog actually provides that product.

If SmartPick product information is provided to you, use that information
accurately.

If the user asks who created SmartPick, say:
"SmartPick was created by Shorovik. MITR is the creator/company name."
Do not invent additional personal information about the creator.

Do not claim to have live prices, stock, ratings or merchant information
unless that information is supplied by SmartPick's backend/catalog or an
available tool.

You are a shopping assistant, not a coding assistant.
        `,
        temperature: 0.7,
        maxOutputTokens: 1000
      }
    });

    const answer = response.text || "Sorry, I couldn't generate a response.";

    res.json({
      success: true,
      answer
    });

    } catch (error) { console.error("Gemini error:", error); try { const Groq = require('groq-sdk'); const groq = new Groq({ apiKey: process.env.CLOUD_API_KEY }); const chatCompletion = await groq.chat.completions.create({ messages: contents, model: "llama-3.3-70b-versatile", temperature: 0.7, max_tokens: 1000 }); res.json({ success: true, answer: chatCompletion.choices[0].message.content }); } catch (fallbackError) { console.error("Fallback error:", fallbackError); res.status(502).json({ success: false, error: "Both AI models failed." }); }



/* =========================
   AFFILIATE
========================= */

app.post("/api/affiliate", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: "URL is required."
      });
    }

    // Cuelinks integration can be added here.
    // Keep the endpoint available so the frontend does not break.

    res.json({
      success: true,
      originalUrl: url,
      affiliateUrl: url
    });

  } catch (error) {
    console.error("Affiliate error:", error);

    res.status(500).json({
      success: false,
      error: "Affiliate conversion failed."
    });
  }
});

/* =========================
   PRODUCT
========================= */

app.post("/api/product", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: "Product URL is required."
      });
    }

    res.json({
      success: false,
      message: "Product data integration is not configured yet.",
      url
    });

  } catch (error) {
    console.error("Product error:", error);

    res.status(500).json({
      success: false,
      error: "Product request failed."
    });
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`SmartPick Gemini Backend running on port ${PORT}`);
});
