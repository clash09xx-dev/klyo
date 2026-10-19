# Mobile workspace and business cards

At widths up to 980 px the CRM provides bottom navigation: Overview, Contacts,
Add, Deals and More. More opens the existing full navigation, including Settings.
Make It Yours visibility choices apply to the Contacts and Deals shortcuts.
The desktop interface keeps its existing navigation. Layout editing hides the HUD.

Add offers a short contact form and a business-card scanner. Take Photo uses the
phone's rear-camera capture picker; Choose Photo accepts an existing image.
The browser normalizes the photo to JPEG, strips metadata and reduces it to a
1600-pixel longest side. Reading a card explicitly sends that photo to OpenAI.
Klyo stores extracted contacts, scan IDs and image hashes, not the photo itself.

The scanner reuses `OPENAI_API_KEY` and `OPENAI_MODEL` (default `gpt-5.4-mini`).
An optional `OPENAI_VISION_MODEL` overrides only card reading. No credentials
reach the browser. A missing key produces an explicit manual-entry fallback.

`POST /api/business-cards` accepts `request_id` (UUID) and `image` (JPEG/PNG/WebP
base64 data URL, at most 4 MB). It requires authenticated SMS-verified paid access
and contact-editing permissions in the active Team or Personal workspace.
A readable person with an email or phone is saved automatically through the same
validation used by normal contacts. Ambiguous cards and workspace-required custom
fields return a draft for completion. Existing email matches, or identical names
and normalized phone numbers, return the existing contact without overwriting it.
Replaying the same scan ID returns its existing contact; concurrent creation is
serialized per workspace. An identical photo also reuses a saved contact.

Database-backed limits: six new scan requests per minute and 50 per day per user,
and 500 per rolling 30 days per workspace. Failed requests count toward limits.
Existing subscription contact limits continue to apply to new scanned contacts.

Tests: `tests/business-cards.test.js`, `tests/mobile-workspace.browser.js`.
Use a disposable `TEST_DATABASE_URL` and the established Playwright environment.
Browser tests stub extraction; the release also tested real vision on a synthetic
card without creating a production contact or sending any email/SMS.

The extraction prompt requests compact JSON and omits absent fields; parsing
still supplies empty strings for missing fields. Image resolution, high-detail
vision, ambiguity checks, permissions, quotas and duplicate protection remain
unchanged. One synthetic-card measurement fell from 2.8 s to 1.6 s; this is a
diagnostic observation, not a latency guarantee for real photos.

Public pages have a visible mobile Log in link and an accessible expanding Menu.
Phone Make It Yours interaction tests are in `tests/mobile-designer.browser.js`:
Chromium uses actual touch events; WebKit verifies pointer interaction at mobile
viewport sizes. Both cover compact controls, movement, resizing, undo/redo,
separate mobile persistence, presets, shortcuts and EN/PL landing navigation.
These browser checks do not substitute for inspection on a physical iPhone.
