async function getAmazonProduct(url) {

  /*
    Amazon product data should be obtained through
    an approved Amazon API / affiliate data source.

    Do NOT scrape Amazon HTML directly.
  */

  return {
    merchant: "amazon",
    originalUrl: url,
    status: "api_not_configured",
    title: null,
    images: [],
    price: null,
    originalPrice: null,
    currency: "INR",
    rating: null,
    reviewCount: null,
    availability: null
  };
}

module.exports = {
  getAmazonProduct
};
