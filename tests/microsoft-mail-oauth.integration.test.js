const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "Microsoft OAuth binds account type to single-use state and refreshes personal tokens without organization scopes",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    // Load the isolated database fixture before importing services in this process.
    const f = await require("./helpers/calendar-fixture")(),
      C = require("../server/services/communications"),
      { ConfidentialClientApplication: CCA } = require("@azure/msal-node");
    const originalAuthorize = C.authorize,
      originalExchange = C.exchange,
      originalGraph = C.graph;
    const exchanges = [];
    try {
      C.authorize = async (p, state, verifier, type) =>
        "https://login.microsoftonline.com/" +
        (type === "personal" ? "consumers" : "organizations") +
        "/oauth2/v2.0/authorize?state=" +
        state;
      C.exchange = async (p, code, verifier, type) => {
        exchanges.push({ p, code, verifier, type });
        return {
          account_id: type + "-account",
          account_name: "owner@outlook.test",
          account_type: type,
          credentials: f.S.encrypt("fixture-cache"),
        };
      };
      for (const type of ["organization", "personal"]) {
        const start = await f.req(
          "/communications/connect/microsoft_mail",
          "POST",
          { account_type: type },
        );
        assert.equal(start.status, 200);
        const state = new URL(start.data.url).searchParams.get("state");
        const pending = (
          await f.db.query("SELECT * FROM communication_oauth WHERE id=$1", [
            state,
          ])
        ).rows[0];
        assert.equal(pending.account_type, type);
        const cookie = start.headers.get("set-cookie").split(";")[0];
        const callback =
          "/communications/oauth/microsoft_mail/callback?state=" +
          state +
          "&code=fixture-code&account_type=personal";
        const rejected = await f.req(callback);
        assert.match(rejected.headers.get("location"), /integration=error/);
        assert.equal(exchanges.length, type === "organization" ? 0 : 1);
        const result = await f.req(callback, "GET", undefined, 0, "team", {
          Cookie: cookie,
        });
        assert.match(result.headers.get("location"), /integration=connected/);
        assert.equal(
          exchanges.at(-1).type,
          type,
          "callback query cannot override stored selection",
        );
        assert.equal(exchanges.at(-1).verifier, f.S.decrypt(pending.verifier));
        const replay = await f.req(callback, "GET", undefined, 0, "team", {
          Cookie: cookie,
        });
        assert.match(replay.headers.get("location"), /integration=cancelled/);
      }
      const invalid = await f.req(
        "/communications/connect/microsoft_mail",
        "POST",
        { account_type: "invalid" },
      );
      assert.equal(invalid.status, 400);
      const status = await f.req("/communications/status");
      const row = status.data.connections.find(
        (c) => c.provider === "microsoft_mail",
      );
      assert.equal(row.account_type, "personal");
      assert.equal(row.credentials, undefined);
      let sharedCalled = false;
      C.graph = async () => {
        sharedCalled = true;
        throw Error("must not call shared Microsoft API");
      };
      assert.equal(
        (
          await f.req("/communications/mail/" + row.id + "/shared", "POST", {
            mailbox: "shared@outlook.test",
          })
        ).status,
        400,
      );
      assert.equal(sharedCalled, false);
      const conn = (
        await f.db.query(
          "SELECT * FROM communication_connections WHERE id=$1",
          [row.id],
        )
      ).rows[0];
      let silent;
      t.mock.method(CCA.prototype, "getTokenCache", () => ({
        deserialize() {},
        serialize() {
          return "refreshed-cache";
        },
        async getAccountByHomeId() {
          return { homeAccountId: conn.account_id };
        },
      }));
      t.mock.method(CCA.prototype, "acquireTokenSilent", async (req) => {
        silent = req;
        return { accessToken: "fixture-access-token" };
      });
      assert.equal(await C.token(conn), "fixture-access-token");
      assert.deepEqual(silent.scopes, C.scopes("microsoft_mail", "personal"));
      assert.equal(
        f.S.decrypt(
          (
            await f.db.query(
              "SELECT credentials FROM communication_connections WHERE id=$1",
              [row.id],
            )
          ).rows[0].credentials,
        ),
        "refreshed-cache",
      );
    } finally {
      C.authorize = originalAuthorize;
      C.exchange = originalExchange;
      C.graph = originalGraph;
      await f.close();
    }
  },
);
