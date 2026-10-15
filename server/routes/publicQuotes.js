// Explicit capability links, matching the existing /q/:token share behavior.
const router = require("express").Router();
const { getPublicQuote } = require("../services/quoteStore");
const { generateQuotePdf, safeName } = require("../services/quotePdf");
const { renderQuoteHTML } = require("../services/quoteRenderer");
router.get("/:token/pdf", async (req, res) => {
  try {
    const full = await getPublicQuote(req.params.token);
    if (!full) return res.status(404).send("Quote not found.");
    const pdf = await generateQuotePdf(full.quote, full.lineItems);
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName(full.quote)}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
        "X-Content-Type-Options": "nosniff",
      })
      .send(pdf);
  } catch (error) {
    console.error("Quote PDF failed:", error.message);
    res.status(500).send("Could not prepare this PDF.");
  }
});
router.get("/:token", async (req, res) => {
  try {
    const full = await getPublicQuote(req.params.token);
    if (!full) return res.status(404).send("Quote not found.");
    res
      .set({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      })
      .send(
        renderQuoteHTML(
          { ...full.quote, line_items: full.lineItems },
          req.query.print === "1",
        ),
      );
  } catch (error) {
    console.error("Quote view failed:", error.message);
    res.status(500).send("Could not open this quote.");
  }
});
module.exports = router;
