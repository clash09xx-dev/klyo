process.env.DATABASE_URL ||= "postgresql://unit:unit@127.0.0.1:1/unused";
const test = require("node:test"),
  assert = require("node:assert/strict");
let C;
test("Microsoft mailbox audience and scopes match the selected account type without altering SharePoint", () => {
  C = require("../server/services/communications");
  const old = process.env.MICROSOFT_TENANT_ID;
  try {
    process.env.MICROSOFT_TENANT_ID = "organizations";
    assert.match(C.mailConfig().authority, /\/organizations$/);
    assert.match(C.mailConfig("personal").authority, /\/consumers$/);
    assert.ok(
      C.scopes("microsoft_mail").some((s) => s.endsWith("/Mail.Read.Shared")),
    );
    const personal = C.scopes("microsoft_mail", "personal");
    assert.ok(personal.some((s) => s.endsWith("/Mail.Read")));
    assert.ok(personal.includes("offline_access"));
    assert.ok(!personal.some((s) => /Shared|Write|Send/.test(s)));
    assert.match(
      require("../server/services/sharepoint").config().authority,
      /\/organizations$/,
    );
    process.env.MICROSOFT_TENANT_ID = "a1111111-1111-1111-1111-111111111111";
    assert.match(C.mailConfig().authority, /a1111111/);
    assert.match(C.mailConfig("personal").authority, /\/consumers$/);
    assert.throws(() => C.accountType("https://attacker.test"));
  } finally {
    if (old === undefined) delete process.env.MICROSOFT_TENANT_ID;
    else process.env.MICROSOFT_TENANT_ID = old;
  }
});
