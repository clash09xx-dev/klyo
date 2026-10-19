const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  { request } = require("http");
const Site = require("../server/services/publicSite"),
  { TIERS, TIER_ORDER } = require("../server/config/tiers");
function bodyText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}
function raw(base, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = request(base + route, { headers }, (res) => {
      const chunks = [];
      res.on("data", (x) => chunks.push(x));
      res.on("end", () =>
        resolve({
          headers: res.headers,
          status: res.statusCode,
          body: Buffer.concat(chunks),
        }),
      );
    });
    r.on("error", reject);
    r.end();
  });
}
test("public SEO exposes complete canonical HTML and prices without JavaScript", async (t) => {
  const f = await require("./helpers/public-site-fixture")();
  try {
    const titles = new Set();
    for (const page of Site.pages)
      for (const lang of ["en", "pl"])
        await t.test(page[lang], async () => {
          const r = await fetch(f.base + page[lang]);
          assert.equal(r.status, 200);
          const html = await r.text();
          assert.match(html, new RegExp('<html lang="' + lang + '">'));
          assert.equal(r.headers.get("content-language"), lang);
          assert.equal((html.match(/<h1\b/g) || []).length, 1);
          assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
          assert.ok(
            html.includes(
              'rel="canonical" href="https://klyolabs.com' + page[lang] + '"',
            ),
          );
          for (const l of ["en", "pl"])
            assert.ok(
              html.includes(
                'hreflang="' +
                  l +
                  '" href="https://klyolabs.com' +
                  page[l] +
                  '"',
              ),
            );
          const title = html.match(/<title>([^<]+)<\/title>/)[1];
          assert.ok(!titles.has(lang + ":" + title), "unique title");
          titles.add(lang + ":" + title);
          assert.match(title, /^Klyo Labs — /);
          assert.equal(title, page.title[0].replaceAll("&", "&amp;"));
          assert.match(html, /href="\/icons\/klyo-labs.svg"/);
          assert.match(html, /href="\/icons\/klyo-labs.ico"/);
          assert.doesNotMatch(html, /klyo-2/);
          assert.equal((html.match(/name="description"/g) || []).length, 1);
          assert.doesNotMatch(html, /noindex/);
          const data = JSON.parse(
            html.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
          );
          assert.equal(
            data["@graph"].find((x) => x["@type"] === "WebSite").name,
            "Klyo Labs",
          );
          assert.equal(
            data["@graph"].find((x) => x["@type"] === "WebPage").url,
            "https://klyolabs.com" + page[lang],
          );
          const app = data["@graph"].find(
            (x) => x["@type"] === "SoftwareApplication",
          );
          assert.equal(app.offers.lowPrice, TIERS.personal.price);
          assert.equal(app.offers.offerCount, 4);
          assert.ok(
            !data["@graph"].some((x) => x.aggregateRating || x.review),
            "no fabricated reviews",
          );
          assert.ok(bodyText(html).length > 1500, "substantive public copy");
          if (page.key === "home" || page.key === "pricing")
            for (const key of TIER_ORDER)
              assert.ok(
                html.includes("<strong>$" + TIERS[key].price + "</strong>"),
              );
          if (lang === "pl")
            assert.match(bodyText(html), /metoda płatności|Metoda płatności/);
          for (const image of [
            ...html.matchAll(/(?:src|srcset)="(\/images\/[^" ,]+)/g),
          ]) {
            const resource = await fetch(f.base + image[1]);
            assert.equal(resource.status, 200, image[1]);
          }
        });
    await t.test(
      "sitemap contains all preferred English/Polish routes and no private URLs",
      async () => {
        const r = await fetch(f.base + "/sitemap.xml"),
          xml = await r.text();
        assert.equal(r.status, 200);
        assert.match(r.headers.get("content-type"), /xml/);
        assert.equal(
          xml,
          fs.readFileSync(
            path.join(__dirname, "../public/sitemap.xml"),
            "utf8",
          ),
        );
        assert.equal((xml.match(/<loc>/g) || []).length, 16);
        for (const m of xml.matchAll(
          /<loc>https:\/\/klyolabs\.com([^<]*)<\/loc>/g,
        )) {
          const r = await fetch(f.base + m[1], { redirect: "manual" });
          assert.equal(r.status, 200, m[1]);
        }
        assert.doesNotMatch(
          xml,
          /<loc>[^<]*(?:\/app|\/api|\/q\/|\/login|\/signup|\.html)/,
        );
      },
    );
    await t.test(
      "aliases permanently redirect; unknown pages return 404 and do not become login pages",
      async () => {
        for (const [from, to] of [
          ["/index.html", "/"],
          ["/features.html", "/features"],
          ["/customization", "/make-it-yours"],
          ["/pl/", "/pl"],
          ["/FEATURES/", "/features"],
          ["/pricing?lang=pl", "/pl/cennik"],
        ]) {
          const r = await fetch(f.base + from, { redirect: "manual" });
          assert.equal(r.status, 301, from);
          assert.equal(r.headers.get("location"), to);
        }
        const r = await fetch(f.base + "/missing-for-seo", {
          redirect: "manual",
        });
        assert.equal(r.status, 404);
        assert.equal(r.headers.get("location"), null);
        assert.match(r.headers.get("x-robots-tag"), /noindex/);
        const www = await raw(f.base, "/features?utm_source=example", {
          Host: "www.klyolabs.com",
        });
        assert.equal(www.status, 301);
        assert.equal(
          www.headers.location,
          "https://klyolabs.com/features?utm_source=example",
        );
      },
    );
    await t.test(
      "private/auth/quote pages are excluded while CSS, JS and public prices remain crawlable",
      async () => {
        for (const route of [
          "/login",
          "/signup",
          "/onboarding",
          "/app",
          "/q/fixture",
          "/api/billing/tiers",
        ]) {
          const r = await fetch(f.base + route);
          assert.match(r.headers.get("x-robots-tag"), /noindex/, route);
        }
        for (const route of [
          "/css/landing.css",
          "/js/landing.js",
          "/robots.txt",
        ])
          assert.equal((await fetch(f.base + route)).status, 200);
        assert.match(
          await (await fetch(f.base + "/robots.txt")).text(),
          /Sitemap: https:\/\/klyolabs.com\/sitemap.xml/,
        );
      },
    );
    await t.test(
      "large public HTML is compressed and compression does not expose account data",
      async () => {
        const r = await raw(f.base, "/", { "Accept-Encoding": "gzip" });
        assert.equal(r.status, 200);
        assert.equal(r.headers["content-encoding"], "gzip");
        assert.match(r.headers.vary, /Accept-Encoding/);
        assert.ok(r.body.length < 12000);
      },
    );
  } finally {
    await f.close();
  }
});
test("optional ownership tokens are escaped and cannot inject HTML", () => {
  const old = process.env.GOOGLE_SITE_VERIFICATION;
  try {
    process.env.GOOGLE_SITE_VERIFICATION = "valid-verification-token";
    assert.match(
      Site.render(Site.pages[0], "en"),
      /name="google-site-verification" content="valid-verification-token"/,
    );
    process.env.GOOGLE_SITE_VERIFICATION = 'bad"><script>alert(1)</script>';
    const html = Site.render(Site.pages[0], "en");
    assert.doesNotMatch(html, /alert\(1\)/);
    assert.doesNotMatch(html, /name="google-site-verification"/);
  } finally {
    if (old === undefined) delete process.env.GOOGLE_SITE_VERIFICATION;
    else process.env.GOOGLE_SITE_VERIFICATION = old;
  }
});

test("audit fixes consolidate public guide URLs and keep authentication metadata consistent", async () => {
  const f = await require("./helpers/public-site-fixture")();
  try {
    for (const name of [
      "calendar-setup",
      "sharepoint-setup",
      "sms-security",
      "communications-setup",
      "sales-and-operations",
      "visual-workspace",
      "account-access",
    ]) {
      const route = "/docs/" + name;
      const r = await fetch(f.base + route);
      assert.equal(r.status, 200, route);
      const html = await r.text();
      assert.ok(
        html.includes(
          'rel="canonical" href="https://klyolabs.com' + route + '"',
        ),
      );
      for (const alias of [route + ".html", route + "/", route.toUpperCase()]) {
        const redirect = await fetch(f.base + alias + "?ref=guide", {
          redirect: "manual",
        });
        assert.equal(redirect.status, 301, alias);
        assert.equal(redirect.headers.get("location"), route + "?ref=guide");
      }
    }
    for (const legal of ["/privacy", "/terms"])
      for (const alias of [legal + "/", legal.toUpperCase()]) {
        const r = await fetch(f.base + alias, { redirect: "manual" });
        assert.equal(r.status, 301, alias);
        assert.equal(r.headers.get("location"), legal);
      }
    const login = await fetch(f.base + "/login"),
      html = await login.text();
    assert.match(
      html,
      /<meta name="robots" content="noindex, nofollow, noarchive"/,
    );
    assert.doesNotMatch(
      html,
      /<link rel="canonical" href="https:\/\/klyolabs.com\/"/,
    );
  } finally {
    await f.close();
  }
});
test("product proof and trial disclosures are present in server HTML in both languages", async () => {
  const f = await require("./helpers/public-site-fixture")();
  try {
    for (const lang of ["en", "pl"]) {
      const pricing = await (
        await fetch(f.base + (lang === "pl" ? "/pl/cennik" : "/pricing"))
      ).text();
      assert.match(
        pricing,
        lang === "pl"
          ? /subskrypcja odnawia się automatycznie/
          : /subscription renews automatically/,
      );
      const quote = await (
        await fetch(f.base + (lang === "pl" ? "/pl/oferty-pdf" : "/pdf-quotes"))
      ).text();
      for (const name of ["klyo-proposal", "klyo-custom-a4"]) {
        assert.match(quote, new RegExp('href="/examples/' + name + '.pdf"'));
        const file = await fetch(f.base + "/examples/" + name + ".pdf");
        assert.equal(file.status, 200);
        assert.match(file.headers.get("content-type"), /pdf/);
      }
      assert.match(quote, /<img[^>]*loading="eager" fetchpriority="high"/);
      const customization = await (
        await fetch(
          f.base + (lang === "pl" ? "/pl/make-it-yours" : "/make-it-yours"),
        )
      ).text();
      assert.match(
        customization,
        /<title>Klyo Labs — Customizable CRM \| Make It Yours<\/title>/,
      );
    }
  } finally {
    await f.close();
  }
});
