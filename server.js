const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");
const Groq = require("groq-sdk");

const app = express();

app.use(cors());

/*
 * Images can make requests larger, so keep this reasonably high.
 */
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;

/* =========================
   API KEYS
========================= */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/*
 * IMPORTANT:
 * Your variable name is intentionally CLOUD_API_KEY.
 * Do NOT rename it to GROQ_API_KEY.
 */
const CLOUD_API_KEY = process.env.CLOUD_API_KEY;


/* =========================
   AI CLIENTS
========================= */

const ai = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY
    })
  : null;

const groq = CLOUD_API_KEY
  ? new Groq({
      apiKey: CLOUD_API_KEY
    })
  : null;


/* =========================
   STARTUP CHECK
========================= */

if (!GEMINI_API_KEY) {
  console.error("WARNING: GEMINI_API_KEY is missing.");
}

if (!CLOUD_API_KEY) {
  console.error("WARNING: CLOUD_API_KEY is missing.");
}


/* =========================
   SMARTPICK AI IDENTITY
========================= */

const SYSTEM_INSTRUCTION = `
You are SmartPick AI, the shopping assistant inside the SmartPick website.

IDENTITY:
- Your name is SmartPick AI.
- You are the AI assistant of SmartPick.
- Your main purpose is shopping assistance.
- You can also answer normal general-knowledge and everyday questions.

MAIN SHOPPING JOB:
Help users with:
- Products
- Product comparisons
- Shopping decisions
- Budgets
- Specifications
- Features
- Compatibility
- Product categories
- General shopping advice
- Understanding product photos
- Explaining what a photographed product appears to be
- Helping users understand possible price ranges
- Explaining where a product might commonly be sold

IMPORTANT PRODUCT ACCURACY:
Never invent live prices, stock, ratings, review counts or store availability.

Only claim live/current product information when that information is actually
provided by SmartPick's backend, product catalog, API, or another available
tool.

If exact live information is unavailable, clearly say that the information
is an estimate or general information.

IMAGE UNDERSTANDING:
When the user provides an image:
- Actually analyze the image when image data is available.
- Identify visible products, objects, labels, logos, model names or other
  useful visual information when possible.
- If the image appears to contain a product, explain what the product
  appears to be.
- If the model or exact product cannot be identified with confidence,
  say that clearly instead of inventing it.
- You may discuss likely product category, visible specifications,
  possible uses and approximate/general price ranges.
- Never claim that you have seen an image if no image was actually provided.

GENERAL KNOWLEDGE:
You may answer normal general-knowledge questions.
You should know and explain common facts, places, concepts, technology,
science, games, computers, internet concepts and everyday topics.

CODE:
You are NOT primarily a coding assistant.
However, if a user asks about a small piece of code:
- You may explain simple errors.
- You may explain what a small code section does.
- You may point out obvious small mistakes.
- You should avoid generating extremely large software projects.
- Keep coding help reasonably small and explanatory.

LANGUAGE:
Understand:
- English
- Hindi
- Bengali
- Hinglish
- Roman Hindi

Reply naturally in the language/style used by the user.

STYLE:
- Friendly
- Clear
- Helpful
- Concise
- Do not unnecessarily repeat the user's question.
- Do not claim capabilities that you do not have.

OWNER / CREATOR INFORMATION:

If the user asks who created SmartPick, who owns SmartPick,
who made SmartPick, or who the creator is, say:

"SmartPick was created by Sourovik. The creator's title is MITRA."

If the user asks for the company name, say:

"The company name is Sourovik."

Do not invent any additional personal information about the owner,
creator or company.

You are SmartPick AI for the SmartPick shopping platform.
`;


/* =========================
   HELPERS
========================= */

function cleanHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => {
      return (
        item &&
        typeof item.role === "string" &&
        typeof item.text === "string"
      );
    })
    .slice(-20);
}


/*
 * Convert SmartPick history into Gemini format.
 */
function buildGeminiHistory(history) {
  const contents = [];

  for (const item of history) {
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: item.text
        }
      ]
    });
  }

  return contents;
}


/*
 * Convert SmartPick history into Groq format.
 */
function buildGroqHistory(history) {
  const messages = [];

  for (const item of history) {
    messages.push({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.text
    });
  }

  return messages;
}


/*
 * Extract base64 image data from either:
 *
 * 1. data:image/jpeg;base64,....
 *
 * OR
 *
 * 2. raw base64
 */
function normalizeImage(image, imageMimeType) {
  if (!image || typeof image !== "string") {
    return null;
  }

  let mimeType = imageMimeType || "image/jpeg";
  let base64Data = image;

  if (image.startsWith("data:")) {
    const match = image.match(
      /^data:([^;]+);base64,(.+)$/s
    );

    if (!match) {
      return null;
    }

    mimeType = match[1];
    base64Data = match[2];
  }

  return {
    mimeType,
    base64Data
  };
}


/*
 * Convert an image into Gemini inlineData.
 */
function createGeminiImagePart(image, imageMimeType) {
  const normalized = normalizeImage(
    image,
    imageMimeType
  );

  if (!normalized) {
    return null;
  }

  return {
    inlineData: {
      mimeType: normalized.mimeType,
      data: normalized.base64Data
    }
  };
}


/*
 * Convert an image into Groq image_url format.
 */
function createGroqImagePart(image, imageMimeType) {
  const normalized = normalizeImage(
    image,
    imageMimeType
  );

  if (!normalized) {
    return null;
  }

  return {
    type: "image_url",
    image_url: {
      url: `data:${normalized.mimeType};base64,${normalized.base64Data}`
    }
  };
}


/* =========================
   HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "SmartPick AI Backend",
    version: "2.0.0"
  });
});


app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    gemini: !!GEMINI_API_KEY,
    cloudFallback: !!CLOUD_API_KEY
  });
});


/* =========================
   AI CHAT
========================= */

app.post("/api/ai/chat", async (req, res) => {

  const {
    message,
    history = [],
    image = null,
    imageMimeType = "image/jpeg"
  } = req.body;


  /* =========================
     INPUT VALIDATION
  ========================= */

  if (
    (!message || typeof message !== "string") &&
    !image
  ) {
    return res.status(400).json({
      success: false,
      error: "Message or image is required."
    });
  }


  const userMessage =
    typeof message === "string"
      ? message.trim()
      : "";


  const safeHistory = cleanHistory(history);

  const normalizedImage = normalizeImage(
    image,
    imageMimeType
  );


  /* =========================
     GEMINI CONTENT
  ========================= */

  const geminiContents = buildGeminiHistory(
    safeHistory
  );


  const currentGeminiParts = [];


  if (userMessage) {
    currentGeminiParts.push({
      text: userMessage
    });
  }


  if (normalizedImage) {
    currentGeminiParts.push({
      inlineData: {
        mimeType: normalizedImage.mimeType,
        data: normalizedImage.base64Data
      }
    });
  }


  geminiContents.push({
    role: "user",
    parts: currentGeminiParts
  });


  /* =========================
     GROQ CONTENT
  ========================= */

  const groqMessages = [
    {
      role: "system",
      content: SYSTEM_INSTRUCTION
    }
  ];


  groqMessages.push(
    ...buildGroqHistory(safeHistory)
  );


  const groqCurrentContent = [];


  if (userMessage) {
    groqCurrentContent.push({
      type: "text",
      text: userMessage
    });
  }


  if (normalizedImage) {
    groqCurrentContent.push(
      createGroqImagePart(
        image,
        imageMimeType
      )
    );
  }


  groqMessages.push({
    role: "user",
    content: groqCurrentContent
  });


  /* =========================
     PRIMARY AI: GEMINI
  ========================= */

  try {

    if (!ai) {
      throw new Error(
        "Gemini API key is not configured."
      );
    }


    const response =
      await ai.models.generateContent({

        /*
         * Keep this model if this is the model
         * configured for your Gemini API.
         */
        model: "gemini-3.8-flash",

        contents: geminiContents,

        config: {
          systemInstruction:
            SYSTEM_INSTRUCTION,

          temperature: 0.7,

          maxOutputTokens: 1000
        }
      });


    const answer =
      response.text ||
      "Sorry, I couldn't generate a response.";


    return res.json({
      success: true,
      provider: "gemini",
      answer
    });

  } catch (geminiError) {

    console.error(
      "Gemini error:",
      geminiError
    );


    /* =========================
       FALLBACK: GROQ CLOUD
    ========================= */

    try {

      if (!groq) {
        return res.status(502).json({
          success: false,
          error:
            "Gemini failed and CLOUD_API_KEY is not configured."
        });
      }


      /*
       * Qwen 3.8 27B supports both text and image input.
       *
       * Therefore the fallback can also understand
       * product photos instead of immediately saying
       * that it cannot see images.
       */
      const completion =
        await groq.chat.completions.create({

          model: "qwen/qwen3.8-27b",

          messages: groqMessages,

          temperature: 0.7,

          max_completion_tokens: 1000,

          stream: false
        });


      const answer =
        completion
          .choices?.[0]
          ?.message
          ?.content ||
        "Sorry, I couldn't generate a response.";


      return res.json({
        success: true,
        provider: "cloud-fallback",
        answer
      });

    } catch (fallbackError) {

      console.error(
        "Cloud fallback error:",
        fallbackError
      );


      return res.status(502).json({
        success: false,
        error:
          "Both SmartPick AI services failed."
      });
    }
  }
});


/* =========================
   AFFILIATE
========================= */

app.post("/api/affiliate", async (req, res) => {

  try {

    const { url } = req.body;


    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL is required."
      });
    }


    /*
     * Cuelinks integration can be connected here.
     */
    return res.json({
      success: true,
      originalUrl: url,
      affiliateUrl: url
    });

  } catch (error) {

    console.error(
      "Affiliate error:",
      error
    );


    return res.status(500).json({
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
        success: false,
        error: "Product URL is required."
      });
    }


    /*
     * Product data integration is intentionally
     * kept separate from AI chat.
     */
    return res.json({
      success: false,
      message:
        "Product data integration is not configured yet.",
      url
    });

  } catch (error) {

    console.error(
      "Product error:",
      error
    );


    return res.status(500).json({
      success: false,
      error: "Product request failed."
    });
  }
});


/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {

  console.log(
    `SmartPick AI Backend running on port ${PORT}`
  );

  console.log(
    `Gemini configured: ${!!GEMINI_API_KEY}`
  );

  console.log(
    `Cloud fallback configured: ${!!CLOUD_API_KEY}`
  );
});
