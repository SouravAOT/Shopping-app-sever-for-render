const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");
const { convertToCuelinks } = require("./services/cuelinks");

const app = express();

const PORT = Number(process.env.PORT || 10000);

// --------------------------------------------------
// AI MODELS
// --------------------------------------------------

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const GROQ_MODEL =
  process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const DAILY_AI_LIMIT =
  Number(process.env.DAILY_AI_LIMIT || 1000);

// --------------------------------------------------
// AI CLIENTS
// --------------------------------------------------

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    })
  : null;

const groqAvailable = Boolean(
  process.env.GROQ_API_KEY
);

// --------------------------------------------------
// EXPRESS
// --------------------------------------------------

app.use(cors({ origin: true }));

app.use(
  express.json({
    limit: "40mb"
  })
);

// --------------------------------------------------
// DAILY AI LIMIT
// --------------------------------------------------

let dailyUsage = {
  date: "",
  count: 0
};

function indiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function consumeAiSlot() {
  const today = indiaDate();

  if (dailyUsage.date !== today) {
    dailyUsage = {
      date: today,
      count: 0
    };
  }

  if (dailyUsage.count >= DAILY_AI_LIMIT) {
    return false;
  }

  dailyUsage.count += 1;

  return true;
}

// --------------------------------------------------
// BASIC ROUTES
// --------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "SmartPick AI Backend",
    version: "4.3.0",
    geminiModel: GEMINI_MODEL,
    groqModel: GROQ_MODEL,
    fallback: "GroqCloud text fallback enabled"
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",

    gemini: Boolean(
      process.env.GEMINI_API_KEY
    ),

    groq: Boolean(
      process.env.GROQ_API_KEY
    ),

    cuelinks: Boolean(
      process.env.CUELINKS_API_KEY
    ),

    geminiModel: GEMINI_MODEL,

    groqModel: GROQ_MODEL,

    fallback: Boolean(
      process.env.GROQ_API_KEY
    ),

    dailyAiLimit: DAILY_AI_LIMIT
  });
});

// --------------------------------------------------
// CUELINKS AFFILIATE
// --------------------------------------------------

app.post("/api/affiliate", async (req, res) => {
  try {
    const {
      url,
      subid,
      subid2,
      subid3
    } = req.body || {};

    if (
      !url ||
      !/^https?:\/\//i.test(url)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "A valid merchant URL is required."
      });
    }

    if (!process.env.CUELINKS_API_KEY) {
      return res.json({
        success: true,
        tracking_url: url,
        affiliated: false,
        direct: true
      });
    }

    const result =
      await convertToCuelinks(url, {
        subid,
        subid2,
        subid3
      });

    return res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error(
      "Affiliate conversion error:",
      error.response?.data ||
        error.message
    );

    return res.json({
      success: true,
      tracking_url:
        req.body?.url,
      affiliated: false,
      fallback: true
    });
  }
});

// --------------------------------------------------
// CATALOG
// --------------------------------------------------

function cleanCatalog(catalog) {
  if (!Array.isArray(catalog)) {
    return [];
  }

  return catalog
    .slice(0, 30)
    .map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      originalPrice: p.originalPrice,
      discount: p.discount,
      brand: p.brand,
      rating: p.rating,
      reviewsCount: p.reviewsCount,
      merchant: p.merchant,
      categories: p.categories,
      description: p.description,
      tags: p.tags
    }));
}

// --------------------------------------------------
// SMARTPICK SYSTEM PROMPT
// --------------------------------------------------

function buildSystem(catalog) {
  return `
You are SmartPick AI, the shopping assistant inside the SmartPick website.

You are friendly, natural, helpful and conversational.

LANGUAGES:

Reply in the same language/style used by the user.

You can communicate in:
- English
- Hindi
- Bengali
- Hinglish

MAIN PURPOSE:

- Help users discover products.
- Help users compare products.
- Help users understand specifications.
- Help users choose products according to budget.
- Help users search the SmartPick catalog.
- Help users understand product photos they send.
- Answer normal everyday questions naturally.

IMPORTANT ACCURACY RULES:

- Never invent product prices.
- Never invent ratings.
- Never invent review counts.
- Never invent stock availability.
- Never invent merchant information.
- Never claim that you opened Amazon, Flipkart or another merchant page unless that information was actually supplied by the application.
- Use the supplied SmartPick catalog when discussing SmartPick products.

PRODUCT MATCHING:

If suitable products exist in the supplied catalog:

- Mention the matching products naturally.
- Use their actual catalog information.
- The application may display matching product cards separately.

If no suitable SmartPick catalog product exists:

- Clearly say that a matching SmartPick product is not currently available.
- You may suggest useful categories or search terms.

CREATOR INFORMATION:

If the user asks who created SmartPick AI, answer:

"SmartPick was created by Shorovik. MITR is the creator/company name."

Do not invent additional biography.

CURRENT SMARTPICK CATALOG:

${JSON.stringify(
  cleanCatalog(catalog)
)}
`;
}

// --------------------------------------------------
// ERROR HELPER
// --------------------------------------------------

function getErrorMessage(error) {
  if (!error) {
    return "Unknown AI error.";
  }

  return (
    error.message ||
    error.error?.message ||
    error.response?.data?.error?.message ||
    "AI request failed."
  );
}

// --------------------------------------------------
// GEMINI FAILURE DETECTION
// --------------------------------------------------

function isGeminiTemporaryFailure(error) {
  const message =
    getErrorMessage(error).toLowerCase();

  const status =
    error?.status ||
    error?.code ||
    error?.response?.status ||
    "";

  return (
    String(status) === "503" ||
    String(status) === "429" ||
    message.includes("503") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("temporarily")
  );
}

// --------------------------------------------------
// GROQCLOUD TEXT FALLBACK
// --------------------------------------------------

async function askGroqFallback({
  message,
  history,
  catalog
}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY is not configured on the server."
    );
  }

  const safeHistory =
    Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (
                item.role === "user" ||
                item.role === "assistant"
              ) &&
              typeof item.content ===
                "string" &&
              item.content.trim()
          )
          .slice(-20)
      : [];

  const messages = [
    {
      role: "system",
      content: buildSystem(catalog)
    }
  ];

  for (const item of safeHistory) {
    messages.push({
      role:
        item.role === "assistant"
          ? "assistant"
          : "user",
      content: item.content.trim()
    });
  }

  messages.push({
    role: "user",
    content: String(message).trim()
  });

  const response =
    await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 1200
      },
      {
        headers: {
          Authorization:
            `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type":
            "application/json"
        },
        timeout: 30000
      }
    );

  const reply =
    response?.data?.choices?.[0]?.message
      ?.content
      ?.trim();

  if (!reply) {
    throw new Error(
      "GroqCloud returned an empty response."
    );
  }

  return reply;
}

// --------------------------------------------------
// AI CHAT
// --------------------------------------------------

app.post("/api/ai/chat", async (req, res) => {
  const {
    message = "",
    history = [],
    catalog = [],
    image = null
  } = req.body || {};

  if (!message && !image) {
    return res.status(400).json({
      success: false,
      error:
        "Message or image is required."
    });
  }

  if (!consumeAiSlot()) {
    return res.status(429).json({
      success: false,
      code: "DAILY_LIMIT",
      error:
        `Today's SmartPick AI limit of ${DAILY_AI_LIMIT} messages has been reached. ` +
        "Please try again tomorrow."
    });
  }

  // ------------------------------------------------
  // IMAGE / TEXT PREPARATION
  // ------------------------------------------------

  const safeHistory =
    Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (
                item.role === "user" ||
                item.role === "assistant"
              ) &&
              typeof item.content ===
                "string" &&
              item.content.trim()
          )
          .slice(-20)
      : [];

  const contents = [];

  for (const item of safeHistory) {
    contents.push({
      role:
        item.role === "assistant"
          ? "model"
          : "user",
      parts: [
        {
          text: item.content.trim()
        }
      ]
    });
  }

  const userParts = [];

  if (
    message &&
    String(message).trim()
  ) {
    userParts.push({
      text: String(message).trim()
    });
  }

  // ------------------------------------------------
  // IMAGE SUPPORT
  // ------------------------------------------------

  if (image) {
    const match =
      String(image).match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
      );

    if (!match) {
      return res.status(400).json({
        success: false,
        error:
          "Only base64 image data is accepted."
      });
    }

    if (
      String(image).length >
      8 * 1024 * 1024
    ) {
      return res.status(413).json({
        success: false,
        error:
          "Image is too large. Please use an image smaller than 8 MB."
      });
    }

    userParts.push({
      inlineData: {
        mimeType: match[1],
        data: match[2]
      }
    });
  }

  if (!userParts.length) {
    return res.status(400).json({
      success: false,
      error:
        "A text message or image is required."
    });
  }

  contents.push({
    role: "user",
    parts: userParts
  });

  // ------------------------------------------------
  // GEMINI
  // ------------------------------------------------

  try {
    if (!gemini) {
      throw new Error(
        "GEMINI_API_KEY is not configured on the server."
      );
    }

    const response =
      await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction:
            buildSystem(catalog),

          thinkingConfig: {
            thinkingLevel: "low"
          },

          maxOutputTokens: 1200
        }
      });

    const reply =
      typeof response?.text ===
      "string"
        ? response.text.trim()
        : "";

    if (!reply) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    console.log(
      "AI response provider: Gemini"
    );

    return res.json({
      success: true,
      reply,
      provider: "gemini"
    });

  } catch (error) {
    const geminiError =
      getErrorMessage(error);

    console.error(
      "Gemini chat error:",
      geminiError
    );

    // ------------------------------------------------
    // GROQCLOUD FALLBACK
    //
    // IMPORTANT:
    // Only normal TEXT chat gets fallback.
    // Images are NOT sent to Groq fallback.
    // ------------------------------------------------

    const canUseGroqFallback =
      !image &&
      Boolean(
        message &&
        String(message).trim()
      ) &&
      Boolean(
        process.env.GROQ_API_KEY
      ) &&
      isGeminiTemporaryFailure(error);

    if (canUseGroqFallback) {
      try {
        console.log(
          "Gemini temporary failure detected."
        );

        console.log(
          "Attempting GroqCloud text fallback..."
        );

        const groqReply =
          await askGroqFallback({
            message,
            history,
            catalog
          });

        console.log(
          "AI response provider: GroqCloud fallback"
        );

        return res.json({
          success: true,
          reply: groqReply,
          provider: "groq-fallback"
        });

      } catch (groqError) {
        const groqMessage =
          getErrorMessage(groqError);

        console.error(
          "GroqCloud fallback error:",
          groqMessage
        );

        return res.status(503).json({
          success: false,
          code:
            "AI_PROVIDERS_UNAVAILABLE",
          error:
            "Gemini is temporarily unavailable and the GroqCloud fallback also failed.",
          geminiError,
          groqError: groqMessage
        });
      }
    }

    // ------------------------------------------------
    // NON-FALLBACK CASES
    // ------------------------------------------------

    let status = 500;

    const lower =
      geminiError.toLowerCase();

    if (
      lower.includes("quota") ||
      lower.includes("rate") ||
      lower.includes(
        "resource_exhausted"
      ) ||
      lower.includes("429")
    ) {
      status = 429;
    }

    if (
      lower.includes("api key") ||
      lower.includes(
        "authentication"
      ) ||
      lower.includes(
        "permission"
      ) ||
      lower.includes(
        "unauthorized"
      )
    ) {
      status = 401;
    }

    return res.status(status).json({
      success: false,
      error: geminiError
    });
  }
});

// --------------------------------------------------
// VOICE TRANSCRIPTION
// --------------------------------------------------

app.post(
  "/api/ai/transcribe",
  async (req, res) => {
    try {
      if (!gemini) {
        return res.status(500).json({
          success: false,
          error:
            "GEMINI_API_KEY is not configured on the server."
        });
      }

      const {
        audioBase64,
        mimeType = "audio/webm"
      } = req.body || {};

      if (!audioBase64) {
        return res.status(400).json({
          success: false,
          error:
            "Audio data is required."
        });
      }

      const buffer =
        Buffer.from(
          audioBase64,
          "base64"
        );

      if (
        buffer.length >
        15 * 1024 * 1024
      ) {
        return res.status(413).json({
          success: false,
          error:
            "Voice recording is too large."
        });
      }

      if (!consumeAiSlot()) {
        return res.status(429).json({
          success: false,
          code: "DAILY_LIMIT",
          error:
            `Today's SmartPick AI limit of ${DAILY_AI_LIMIT} messages has been reached.`
        });
      }

      const response =
        await gemini.models.generateContent({
          model: GEMINI_MODEL,

          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    "Transcribe this voice recording exactly. " +
                    "Return only the spoken words. " +
                    "Detect the language automatically, including Hindi, Bengali, English and Hinglish."
                },
                {
                  inlineData: {
                    mimeType:
                      String(
                        mimeType
                      ).split(";")[0],
                    data: audioBase64
                  }
                }
              ]
            }
          ],

          config: {
            thinkingConfig: {
              thinkingLevel: "low"
            },
            maxOutputTokens: 1200
          }
        });

      const text =
        typeof response?.text ===
        "string"
          ? response.text.trim()
          : "";

      if (!text) {
        return res.status(502).json({
          success: false,
          error:
            "Gemini returned an empty transcription."
        });
      }

      return res.json({
        success: true,
        text
      });

    } catch (error) {
      const message =
        getErrorMessage(error);

      console.error(
        "Gemini transcription error:",
        message
      );

      return res.status(500).json({
        success: false,
        error: message
      });
    }
  }
);

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `SmartPick AI Backend listening on port ${PORT}`
    );

    console.log(
      `Gemini model: ${GEMINI_MODEL}`
    );

    console.log(
      `Groq model: ${GROQ_MODEL}`
    );

    console.log(
      `Gemini API key configured: ${Boolean(
        process.env.GEMINI_API_KEY
      )}`
    );

    console.log(
      `GroqCloud API key configured: ${Boolean(
        process.env.GROQ_API_KEY
      )}`
    );

    console.log(
      `Cuelinks API key configured: ${Boolean(
        process.env.CUELINKS_API_KEY
      )}`
    );
  }
);
