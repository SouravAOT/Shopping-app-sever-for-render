const express = require("express");
const cors = require("cors");

const { convertToCuelinks } = require("./services/cuelinks");
const { getAmazonProduct } = require("./services/amazon");
const { getFlipkartProduct } = require("./services/flipkart");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "SmartPick Backend",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy"
  });
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
    console.error(error);

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
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SmartPick Backend running on port ${PORT}`);
});
