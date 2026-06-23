// server/config/tiers.js
// ---------------------------------------------------------
// One place that defines what each paid tier includes. Change
// numbers here and the whole app (limit checks, the pricing
// modal) follows automatically. `null` means unlimited.
//
// These are starting recommendations, not locked in — see the
// README's "Pricing tiers" section for the reasoning, and adjust
// freely before you wire up real Stripe prices.
// ---------------------------------------------------------
const TIERS = {
  personal: {
    label: "Personal",
    tagline: "For solo freelancers and one-person operations",
    price: 9,
    maxSeats: 1,
    maxContacts: 200,
    maxAiDraftsPerMonth: 50,
  },
  plus: {
    label: "Plus",
    tagline: "For a small business with a few staff",
    price: 29,
    maxSeats: 5,
    maxContacts: 1000,
    maxAiDraftsPerMonth: 300,
  },
  pro: {
    label: "Pro",
    tagline: "For a growing business with a full team",
    price: 79,
    maxSeats: 20,
    maxContacts: null,
    maxAiDraftsPerMonth: 1500,
  },
  ultra: {
    label: "Ultra",
    tagline: "For agencies and multi-location businesses",
    price: 199,
    maxSeats: null,
    maxContacts: null,
    maxAiDraftsPerMonth: null,
  },
};

const TIER_ORDER = ["personal", "plus", "pro", "ultra"];

function getTier(tierKey) {
  return TIERS[tierKey] || TIERS.personal;
}

module.exports = { TIERS, TIER_ORDER, getTier };
