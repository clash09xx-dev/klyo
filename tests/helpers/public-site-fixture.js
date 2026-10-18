const express = require("express"),
  path = require("path");
module.exports = async () => {
  const app = express(),
    S = require("../../server/services/publicSite");
  app.use(S.headers);
  app.use(S.compression);
  app.use(S.router);
  app.get("/api/billing/tiers", (_, res) => {
    const { TIERS, TIER_ORDER } = require("../../server/config/tiers");
    res.json({ tiers: TIER_ORDER.map((key) => ({ key, ...TIERS[key] })) });
  });
  for (const route of ["/login", "/signup", "/app", "/onboarding"])
    app.get(route, (_, res) =>
      res.sendFile(
        path.join(
          __dirname,
          "../../public",
          route === "/signup" ? "login.html" : route.slice(1) + ".html",
        ),
      ),
    );
  app.get("/q/fixture", (_, res) => res.send("Fictional private quote"));
  app.use(express.static(path.join(__dirname, "../../public")));
  app.use(S.notFound);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    base: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((r) => server.close(r)),
  };
};
