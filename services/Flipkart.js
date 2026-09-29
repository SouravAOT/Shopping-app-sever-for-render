async function getFlipkartProduct(url) {

  /*
    Flipkart product information should be obtained
    through an approved Flipkart affiliate/API/feed source.

    Do NOT scrape Flipkart HTML directly.
  */

  return {
    merchant: "flipkart",
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
  getFlipkartProduct
};
