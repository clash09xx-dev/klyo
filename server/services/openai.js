// server/services/openai.js
// ---------------------------------------------------------
// Talks to OpenAI to draft a personalized offer email for a
// contact. Only ever called from the server — the API key is
// never sent to the browser.
// ---------------------------------------------------------
const OpenAI = require("openai");

let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/**
 * Draft a subject + body for an outreach/offer email.
 * @param {object} contact - { full_name, email, company, marketing_theme, status, notes }
 * @param {string} instructions - optional free-text guidance from the user (e.g. "mention 15% discount")
 * @param {string} senderName - the signed-in user's name, used as the email sign-off
 */
async function generateOfferEmail(contact, instructions, senderName) {
  const openai = getClient();
  if (!openai) {
    throw new Error(
      "OPENAI_API_KEY is not set on the server. Add it to your .env file to enable AI drafting."
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

  const contextLines = [
    `Contact name: ${contact.full_name}`,
    contact.company ? `Company: ${contact.company}` : null,
    contact.marketing_theme ? `Segment / campaign theme: ${contact.marketing_theme}` : null,
    contact.status ? `Pipeline stage: ${contact.status}` : null,
    contact.notes ? `Internal notes about this contact: ${contact.notes}` : null,
  ].filter(Boolean).join("\n");

  const userPrompt = [
    "Write a short, warm, persuasive outreach/offer email to this client.",
    "",
    contextLines,
    "",
    instructions ? `Specific instructions from the sender: ${instructions}` : "No extra instructions were given — use good judgement based on the context above.",
    "",
    `Sign the email as: ${senderName || "the team"}.`,
    "",
    "Keep the body under 160 words, plain text (no markdown), friendly and specific rather than generic.",
    'Respond ONLY with strict JSON in this exact shape: {"subject": "...", "body": "..."} and nothing else.',
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a skilled sales copywriter who writes concise, human, non-spammy outreach emails for a small business's CRM. You always reply with valid JSON only.",
      },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The AI response could not be read. Please try generating again.");
  }

  return {
    subject: (parsed.subject || "").trim() || `A quick offer for ${contact.full_name}`,
    body: (parsed.body || "").trim(),
  };
}

module.exports = { generateOfferEmail };
