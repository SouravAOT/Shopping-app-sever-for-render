const axios = require("axios");

async function convertToCuelinks(url, subid = "") {

  const apiKey = process.env.CUELINKS_API_KEY;

  if (!apiKey) {
    throw new Error("CUELINKS_API_KEY is not configured.");
  }

  const response = await axios.post(
    "https://developers.cuelinks.com/pub_api/v3/links/convert",
    {
      url,
      subid,
      shorten: false
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
}

module.exports = {
  convertToCuelinks
};
