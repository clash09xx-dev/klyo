// Crawlable public product pages. Same HTML for visitors and crawlers; no account data.
const express = require("express"),
  fs = require("fs"),
  path = require("path");
const fontSources = require("../../public/fonts/sources.json");
const latinFont = fontSources.find(
  (x) => x.family === "Inter" && x.subset === "latin",
).file;
const pages = require("../content/publicPages"),
  { TIERS, TIER_ORDER } = require("../config/tiers");
const PublicLanguage = require("./publicLanguage");
const brandIcons =
  '<link rel="icon" href="/icons/klyo-labs.ico" sizes="16x16 32x32 48x48">\n<link rel="icon" href="/icons/klyo-labs-96.png" type="image/png" sizes="96x96">\n<link rel="icon" href="/icons/klyo-labs.svg" type="image/svg+xml" sizes="any">\n<link rel="apple-touch-icon" href="/icons/klyo-labs-180.png" sizes="180x180">\n<link rel="mask-icon" href="/icons/klyo-labs-mask.svg" color="#1b2027">';
const compression = require("compression");
const publicCompression = compression({
  threshold: 1024,
  filter: (req, res) =>
    !/^\/(api|app|q)(?:\/|$)/.test(req.path) && compression.filter(req, res),
});
const root = path.join(__dirname, "../../public"),
  origin = "https://klyolabs.com",
  router = express.Router();
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const labels = {
  en: {
    home: "Home",
    features: "Features",
    pricing: "Pricing",
    why: "Why Klyo",
    customization: "Make It Yours",
    quotes: "PDF quote builder",
    integrations: "Integrations",
  },
  pl: {
    home: "Strona główna",
    features: "Funkcje",
    pricing: "Cennik",
    why: "Dlaczego Klyo",
    customization: "Make It Yours",
    quotes: "Kreator ofert PDF",
    integrations: "Integracje",
  },
};
const get = (key) => pages.find((p) => p.key === key),
  url = (p, lang) => origin + p[lang];
function pricing(lang = "en") {
  const pl = lang === "pl",
    count = (n) =>
      n == null
        ? pl
          ? "Bez limitu"
          : "Unlimited"
        : new Intl.NumberFormat(pl ? "pl-PL" : "en-US").format(n);
  const taglines = pl
    ? [
        "Dla freelancerów i jednoosobowej działalności",
        "Dla małej firmy i kilku współpracowników",
        "Dla rozwijającej się firmy i większego zespołu",
        "Dla agencji i firm z wieloma lokalizacjami",
      ]
    : TIER_ORDER.map((k) => TIERS[k].tagline);
  return TIER_ORDER.map((key, i) => {
    const t = TIERS[key];
    return `<article class="price-card" data-plan="${key}"><h3>${esc(t.label)}</h3><p class="price-tagline">${esc(taglines[i])}</p><div class="price-amount"><strong>$${t.price}</strong><span>USD / ${pl ? "miesiąc" : "month"}</span></div><a class="button button-outline" href="/signup">${pl ? "Rozpocznij okres próbny" : "Start free trial"} ↗</a><ul><li><b>${count(t.maxSeats)}</b> ${pl ? (t.maxSeats === 1 ? "użytkownik" : "użytkowników") : t.maxSeats === 1 ? "user" : "users"}</li><li><b>${count(t.maxContacts)}</b> ${pl ? "kontaktów" : "contacts"}</li><li><b>${count(t.maxAiDraftsPerMonth)}</b> ${pl ? "szkiców email AI / miesiąc" : "AI email drafts / month"}</li></ul><p class="price-included">${pl ? "Szablony A4 i oferty PDF · własne cenniki<br>Lejki sprzedaży · zadania i kalendarz<br>Make It Yours · Team i Personal" : "Custom A4 PDFs · price-list imports<br>Sales pipelines · tasks and calendar<br>Make It Yours · Team and Personal"}</p></article>`;
  }).join("");
}
function languagePicker(p, lang) {
  return `<div class="seo-language" role="group" aria-label="${lang === "pl" ? "Język strony" : "Website language"}"><a href="${p.en}" lang="en" hreflang="en" ${lang === "en" ? 'aria-current="page"' : ""} aria-label="English"><img src="/images/flag-en.svg" width="24" height="16" alt=""><span class="seo-sr-only">English</span></a><a href="${p.pl}" lang="pl" hreflang="pl" ${lang === "pl" ? 'aria-current="page"' : ""} aria-label="Polski"><img src="/images/flag-pl.svg" width="24" height="16" alt=""><span class="seo-sr-only">Polski</span></a></div>`;
}
function navigation(p, lang) {
  return `<header class="site-header"><nav class="site-nav page-width" aria-label="${lang === "pl" ? "Nawigacja główna" : "Main navigation"}"><a class="wordmark" href="${get("home")[lang]}" aria-label="Klyo Labs CRM"><span class="brand-symbol"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12h4l2 7 4-14 3 9 2-5h5"/></svg></span>Klyo</a><div class="nav-center">${["features", "pricing", "why", "customization"].map((k) => `<a href="${get(k)[lang]}" ${p.key === k ? 'aria-current="page"' : ""}>${labels[lang][k]}</a>`).join("")}</div><div class="nav-actions">${languagePicker(p, lang)}<a class="login-link" href="/login">${lang === "pl" ? "Zaloguj się" : "Log in"}</a><a class="button button-lime" href="/signup">${lang === "pl" ? "Wypróbuj CRM" : "Start free trial"} ↗</a></div></nav></header>`;
}
function related(p, lang) {
  return `<aside class="seo-related page-width" aria-label="${lang === "pl" ? "Poznaj Klyo Labs" : "Explore Klyo Labs"}"><p class="eyebrow">KLYO LABS CRM</p><h2>${lang === "pl" ? "Poznaj swój kolejny warsztat pracy." : "Explore your next workspace."}</h2><nav>${pages
    .filter((x) => x.key !== p.key && x.key !== "home")
    .map((x) => `<a href="${x[lang]}">${labels[lang][x.key]} ↗</a>`)
    .join("")}</nav></aside>`;
}
function footer(lang) {
  return `<footer class="site-footer page-width"><a class="wordmark" href="${get("home")[lang]}">Klyo Labs</a><span>© 2026 Klyo Labs · CRM</span><div><a href="/privacy">${lang === "pl" ? "Prywatność" : "Privacy"}</a><a href="/terms">${lang === "pl" ? "Warunki" : "Terms"}</a><a href="mailto:clash.09xx@gmail.com">${lang === "pl" ? "Kontakt" : "Contact"}</a></div></footer>`;
}
function picture(p, lang) {
  if (!p.image) return "";
  const alt =
    lang === "pl"
      ? p.image === "a4-designer"
        ? "Kreator szablonów ofert PDF Klyo: kartka A4, automatyczne pola klienta i tabela produktów"
        : p.image === "personal-settings"
          ? "Ustawienia kolorów i układu CRM Klyo Make It Yours"
          : "Interfejs Klyo CRM z kontaktami i osobistym układem przestrzeni"
      : p.image === "a4-designer"
        ? "Klyo PDF quote template designer with an A4 canvas, client fields and pricing table"
        : "Klyo CRM interface with personal workspace settings";
  const dimensions =
    p.image === "personal-settings"
      ? [900, 986]
      : p.image === "personal-workspace"
        ? [1440, 820]
        : [1440, 1000];
  const loading =
    p.key === "quotes"
      ? 'loading="eager" fetchpriority="high"'
      : 'loading="lazy"';
  return `<figure class="seo-product-shot page-width"><picture><source type="image/webp" srcset="/images/${p.image}.webp 1x, /images/${p.image}@2x.webp 2x"><img src="/images/${p.image}.png" width="${dimensions[0]}" height="${dimensions[1]}" ${loading} decoding="async" alt="${esc(alt)}"></picture><figcaption>${lang === "pl" ? "Rzeczywisty interfejs Klyo · przykładowe dane" : "Actual Klyo interface · fictional sample data"}</figcaption></figure>`;
}
function quoteSamples(lang) {
  const pl = lang === "pl";
  return `<section class="seo-samples page-width"><p class="eyebrow">${pl ? "SPRAWDŹ GOTOWY DOKUMENT" : "SEE THE FINISHED DOCUMENT"}</p><h2>${pl ? "Otwórz przykładową ofertę PDF." : "Open a sample PDF quote."}</h2><p>${pl ? "Zobacz układ, tabelę cen i warunki w rzeczywistym pliku przed założeniem konta. Oba dokumenty są po angielsku i zawierają fikcyjne dane demonstracyjne." : "Inspect the layout, pricing table and terms in an actual file before creating an account. Both documents are in English and contain fictional demonstration data."}</p><div class="hero-actions"><a class="button button-dark" href="/examples/klyo-proposal.pdf">${pl ? "Przykładowa oferta (PDF, EN)" : "Sample proposal (PDF, EN)"} ↗</a><a class="button button-outline" href="/examples/klyo-custom-a4.pdf">${pl ? "Własny układ A4 (PDF, EN)" : "Custom A4 layout (PDF, EN)"} ↗</a></div></section>`;
}
function template(p, lang) {
  const n = lang === "pl" ? 1 : 0,
    pl = lang === "pl",
    sections = pl ? p.sections : p.sectionsEn,
    faqs = pl ? p.faqs : p.faqsEn;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/landing.css"><link rel="stylesheet" href="/css/marketing-pages.css"><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head><body class="marketing-page">${navigation(p, lang)}<main id="main-content"><section class="marketing-hero page-width"><p class="eyebrow">KLYO LABS · ${pl ? "TWÓJ CRM" : "YOUR CRM"}</p><h1>${esc(p.headings?.[n] || p.heading)}</h1><p>${esc(p.intros?.[n] || p.intro)}</p><div class="hero-actions"><a class="button button-lime" href="/signup">${pl ? "Wypróbuj przez 7 dni" : "Start a 7-day trial"} ↗</a><a class="button button-outline" href="${get("pricing")[lang]}">${pl ? "Porównaj plany" : "Compare plans"}</a></div><p class="trial-note">${pl ? "Wymagana metoda płatności · Anuluj przed odnowieniem" : "Payment method required · Cancel before renewal"}</p></section>${picture(p, lang)}${p.key === "quotes" ? quoteSamples(lang) : ""}${p.key === "pricing" || p.key === "home" ? `<section class="pricing-section page-width" id="pricing"><h2>${pl ? "Plany CRM dla jednej osoby i zespołów" : "CRM plans for individuals and teams"}</h2><div class="pricing-grid" data-server-rendered="true">${pricing(lang)}</div><p class="pricing-footnote">${pl ? "USD za przestrzeń na miesiąc. 7 dni próbnych; metoda płatności wymagana. Abonament odnawia się automatycznie — anuluj w Ustawieniach przed odnowieniem, aby uniknąć opłaty." : "USD per workspace per month. 7-day trial; payment method required. Subscription renews automatically; cancel in Settings before renewal to avoid a charge."}</p></section>` : ""}<section class="seo-sections page-width">${sections.map(([h, t, k]) => `<article><h2>${esc(h)}</h2><p>${esc(t)}</p>${k ? `<a href="${get(k)[lang]}">${labels[lang][k]} ↗</a>` : ""}</article>`).join("")}</section>${faqs ? `<section class="seo-faq page-width"><h2>${pl ? "Pytania i odpowiedzi" : "Questions and answers"}</h2>${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>` : ""}<section class="marketing-cta page-width"><h2>${pl ? "Ułóż pracę po swojemu." : "Build a workspace around your work."}</h2><a class="button button-dark" href="/signup">${pl ? "Rozpocznij 7-dniowy test" : "Start a 7-day trial"} ↗</a><p>${pl ? "Metoda płatności wymagana. Integracje wymagają konfiguracji i uprawnień dostawcy." : "Payment method required. Integrations require provider configuration and authorization."}</p></section></main>${footer(lang)}</body></html>`;
}
function structured(p, lang) {
  const n = lang === "pl" ? 1 : 0,
    home = url(get("home"), lang),
    current = url(p, lang),
    app = origin + "/#crm",
    site = origin + "/#website";
  const graph = [
    {
      "@type": "WebSite",
      "@id": site,
      url: origin + "/",
      name: "Klyo Labs",
      alternateName: ["Klyo", "Klyo CRM", "Klyo Labs CRM"],
      inLanguage: ["en", "pl"],
    },
    {
      "@type": "SoftwareApplication",
      "@id": app,
      name: "Klyo CRM",
      alternateName: "Klyo Labs CRM",
      url: origin + "/",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "CRM",
      operatingSystem: "Web",
      inLanguage: ["en", "pl"],
      description:
        "Customizable CRM for contacts, sales pipelines, PDF quotes, tasks and team or personal workspaces.",
      image: origin + "/images/klyo-labs-social.png",
      featureList: [
        "Make It Yours interface layouts",
        "Custom A4 PDF quote templates",
        "Sales pipelines and won/lost reporting",
        "Product bundles and discounts",
        "Custom customer and product fields",
        "Team and Personal workspaces",
      ],
      offers: {
        "@type": "AggregateOffer",
        lowPrice: Math.min(...TIER_ORDER.map((k) => TIERS[k].price)),
        highPrice: Math.max(...TIER_ORDER.map((k) => TIERS[k].price)),
        priceCurrency: "USD",
        offerCount: TIER_ORDER.length,
        offers: TIER_ORDER.map((k) => ({
          "@type": "Offer",
          name: TIERS[k].label + " — monthly workspace plan",
          price: TIERS[k].price,
          priceCurrency: "USD",
          url: origin + get("pricing")[lang],
        })),
      },
    },
    {
      "@type": "WebPage",
      "@id": current + "#webpage",
      url: current,
      name: p.title[n],
      description: p.description[n],
      inLanguage: lang,
      isPartOf: { "@id": site },
      about: { "@id": app },
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: origin + "/images/klyo-labs-social.png",
        width: 1200,
        height: 630,
      },
    },
  ];
  if (p.key !== "home")
    graph.push({
      "@type": "BreadcrumbList",
      "@id": current + "#breadcrumbs",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Klyo Labs", item: home },
        {
          "@type": "ListItem",
          position: 2,
          name: labels[lang][p.key],
          item: current,
        },
      ],
    });
  return { "@context": "https://schema.org", "@graph": graph };
}
function metadata(p, lang) {
  const n = lang === "pl" ? 1 : 0,
    u = url(p, lang),
    image = origin + "/images/klyo-labs-social.png";
  const verification = [
    ["GOOGLE_SITE_VERIFICATION", "google-site-verification"],
    ["BING_SITE_VERIFICATION", "msvalidate.01"],
  ]
    .map(([key, name]) =>
      /^[\w-]{4,256}$/.test(process.env[key] || "")
        ? `<meta name="${name}" content="${esc(process.env[key])}">`
        : "",
    )
    .join("");
  return `<title>${esc(p.title[n])}</title><meta name="description" content="${esc(p.description[n])}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${u}">${["en", "pl"].map((l) => `<link rel="alternate" hreflang="${l}" href="${url(p, l)}">`).join("")}<link rel="alternate" hreflang="x-default" href="${url(p, "en")}"><meta property="og:type" content="website"><meta property="og:site_name" content="Klyo Labs"><meta property="og:url" content="${u}"><meta property="og:title" content="${esc(p.title[n])}"><meta property="og:description" content="${esc(p.description[n])}"><meta property="og:locale" content="${lang === "pl" ? "pl_PL" : "en_US"}"><meta property="og:locale:alternate" content="${lang === "pl" ? "en_US" : "pl_PL"}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/png"><meta property="og:image:alt" content="Klyo Labs CRM — Make It Yours and PDF Quote Creator"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(p.title[n])}"><meta name="twitter:description" content="${esc(p.description[n])}"><meta name="twitter:image" content="${image}"><meta name="twitter:image:alt" content="Klyo Labs CRM — Make It Yours and PDF Quote Creator">${verification}<link rel="preload" href="/fonts/${latinFont}" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/css/public-fonts.css"><link rel="stylesheet" href="/css/public-seo.css"><script type="application/ld+json">${json(structured(p, lang))}</script>`;
}
function decorate(source, p, lang) {
  let html = source
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(/<meta\b[^>]*>/gi, (tag) =>
      /\b(?:name|property)\s*=\s*["'](?:description|robots|og:[^"']+|twitter:[^"']+)["']/i.test(
        tag,
      )
        ? ""
        : tag,
    )
    .replace(/<link\b[^>]*>/gi, (tag) =>
      /\brel\s*=\s*["'](?:canonical|alternate|icon|shortcut icon|apple-touch-icon|mask-icon)["']/i.test(
        tag,
      ) || /https:\/\/(?:fonts.googleapis.com|fonts.gstatic.com)/i.test(tag)
        ? ""
        : tag,
    )
    .replace(/<html\b[^>]*>/i, `<html lang="${lang}">`);
  html = html.replace(
    /<head\b[^>]*>/i,
    '$&<script defer src="/js/public-language.js"></script>',
  );
  html = html.replace(
    "</head>",
    brandIcons +
      metadata(p, lang) +
      `<script type="application/json" id="public-runtime-copy">${json(lang === "pl" ? PublicLanguage.runtime : {})}</script></head>`,
  );
  if (p.file) {
    html = html.replace(
      /(<div class="nav-actions">)/,
      "$1" + languagePicker(p, lang),
    );
    html = html
      .replace(/(<a class="wordmark" href="\/">)Klyo(<\/a>)/g, "$1Klyo Labs$2")
      .replace(/© 2026 Klyo(?! Labs)/g, "© 2026 Klyo Labs");
    html = html.replace(
      /<div class="pricing-grid" id="pricingGrid"[^>]*>[\s\S]*?<\/div>/,
      `<div class="pricing-grid" id="pricingGrid" aria-live="polite" data-server-rendered="true">${pricing(lang)}</div>`,
    );
  }
  if (p.key !== "home")
    html = html.replace(
      /<main([^>]*)>/,
      `<main$1><nav class="seo-breadcrumb page-width" aria-label="${lang === "pl" ? "Okruszki nawigacyjne" : "Breadcrumb"}"><a href="${get("home")[lang]}">Klyo Labs</a><span aria-hidden="true">/</span><span aria-current="page">${labels[lang][p.key]}</span></nav>`,
    );
  if (!/id=["']main-content["']/.test(html))
    html = html.replace(/<main(?![\w-])([^>]*)>/, '<main id="main-content"$1>');
  html = html.replace(
    /<body([^>]*)>/,
    `<body$1 data-public-page="${p.key}"><a class="seo-skip" href="#main-content">${lang === "pl" ? "Przejdź do treści" : "Skip to content"}</a>`,
  );
  const panel = related(p, lang);
  return html.includes("</main>")
    ? html.replace("</main>", panel + "</main>")
    : html.replace(/<footer\b/, panel + "<footer");
}
const rendered = new Map();
function render(p, lang) {
  const key =
    p.key +
    ":" +
    lang +
    ":" +
    (process.env.GOOGLE_SITE_VERIFICATION || "") +
    ":" +
    (process.env.BING_SITE_VERIFICATION || "");
  if (!rendered.has(key))
    rendered.set(
      key,
      decorate(
        p.file
          ? lang === "pl"
            ? PublicLanguage.localize(
                fs.readFileSync(path.join(root, p.file), "utf8"),
                pages,
              )
            : fs.readFileSync(path.join(root, p.file), "utf8")
          : template(p, lang),
        p,
        lang,
      ),
    );
  return rendered.get(key);
}
const guides = [
  "/docs/calendar-setup",
  "/docs/sharepoint-setup",
  "/docs/sms-security",
  "/docs/communications-setup",
  "/docs/sales-and-operations",
  "/docs/visual-workspace",
  "/docs/account-access",
];
const aliases = {
  "/index.html": "/",
  "/index": "/",
  "/features.html": "/features",
  "/pricing.html": "/pricing",
  "/why-klyo.html": "/why-klyo",
  "/customization": "/make-it-yours",
  "/customization.html": "/make-it-yours",
  "/privacy.html": "/privacy",
  "/terms.html": "/terms",
  "/login.html": "/login",
  "/signup.html": "/signup",
  "/app.html": "/app",
  "/onboarding.html": "/onboarding",
};
for (const guide of guides) aliases[guide + ".html"] = guide;
function headers(req, res, next) {
  if (
    /^\/(?:api|app|q)(?:\/|$|\.html$)/i.test(req.path) ||
    /^\/(?:login|signup|onboarding)(?:\.html)?\/?$/i.test(req.path)
  )
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
}
function sitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${pages.flatMap((p) => ["en", "pl"].map((lang) => `<url><loc>${url(p, lang)}</loc>${["en", "pl", "x-default"].map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${url(p, l === "x-default" ? "en" : l)}"/>`).join("")}</url>`)).join("\n")}\n<url><loc>${origin}/privacy</loc></url>\n<url><loc>${origin}/terms</loc></url>\n</urlset>\n`;
}
router.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) return next();
  if (req.hostname === "www.klyolabs.com")
    return res.redirect(301, origin + req.originalUrl);
  const lower = req.path.toLowerCase(),
    normalized = lower === "/" ? "/" : lower.replace(/\/+$/, "");
  const preferred =
    aliases[normalized] ||
    (pages.some((p) => p.en === normalized || p.pl === normalized) ||
    guides.includes(normalized) ||
    ["/privacy", "/terms"].includes(normalized)
      ? normalized
      : null);
  if (preferred && preferred !== req.path)
    return res.redirect(
      301,
      preferred +
        (req.originalUrl.includes("?")
          ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
          : ""),
    );
  const p = pages.find((p) => p.en === req.path || p.pl === req.path);
  if (!p) return next();
  const lang = p.pl === req.path ? "pl" : "en";
  if (["en", "pl"].includes(req.query.lang) && req.query.lang !== lang) {
    const q = new URLSearchParams(req.query);
    q.delete("lang");
    return res.redirect(301, p[req.query.lang] + (q.size ? "?" + q : ""));
  }
  return res
    .set({
      "Content-Language": lang,
      "Cache-Control": "public, max-age=0, must-revalidate",
    })
    .type("html")
    .send(render(p, lang));
});
router.get(guides, (req, res) =>
  res.sendFile(path.join(root, req.path + ".html")),
);
router.get("/sitemap.xml", (_, res) =>
  res
    .type("application/xml")
    .set("Cache-Control", "public, max-age=3600")
    .send(sitemap()),
);
router.get(["/privacy", "/terms"], (req, res) => {
  const legal = req.path.slice(1),
    source = fs.readFileSync(path.join(root, legal + ".html"), "utf8");
  const clean = source.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "");
  res
    .type("html")
    .send(
      clean.replace(
        "</head>",
        `<link rel="canonical" href="${origin}/${legal}"></head>`,
      ),
    );
});
function notFound(req, res) {
  const pl = req.path.startsWith("/pl/");
  res
    .status(404)
    .set("X-Robots-Tag", "noindex, follow")
    .type("html")
    .send(
      `<!doctype html><html lang="${pl ? "pl" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Klyo Labs — Page Not Found</title>${brandIcons}<link rel="stylesheet" href="/css/landing.css"><link rel="stylesheet" href="/css/public-seo.css"></head><body><main class="seo-not-found page-width"><p class="eyebrow">KLYO LABS · 404</p><h1>${pl ? "Nie ma takiej strony." : "This page could not be found."}</h1><p>${pl ? "Wybierz stronę główną lub sprawdź dostępne funkcje CRM." : "Visit the home page or explore the available CRM features."}</p><a class="button button-lime" href="${pl ? "/pl" : "/"}">${pl ? "Strona główna" : "Home"}</a> <a class="button button-outline" href="${pl ? "/pl/funkcje" : "/features"}">${pl ? "Funkcje CRM" : "CRM features"}</a></main></body></html>`,
    );
}
module.exports = {
  router,
  headers,
  notFound,
  pages,
  render,
  sitemap,
  pricing,
  compression: publicCompression,
};
