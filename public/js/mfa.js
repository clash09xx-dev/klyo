/* Phone verification is account security, independent of Team/Personal. */
window.KlyoMFA = (() => {
  const pl = () => KlyoI18n.getLang() === "pl",
    l = (en, pol) => (pl() ? pol : en),
    esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const complete = async (r) => {
    const scope = API.scope();
    API.setToken(r.token);
    API.setScope(scope);
    if (r.user) API.setUser({ ...API.getUser(), ...r.user });
    const fresh = await API.get("/auth/me");
    API.setUser(fresh.user);
  };
  function login(r) {
    if (!r.mfa_required) return false;
    document
      .querySelectorAll("#welcomeScreen,#loginScreen,#signupScreen")
      .forEach((n) => n.classList.add("hidden"));
    document.getElementById("mfaLogin")?.remove();
    const box = document.createElement("section");
    box.id = "mfaLogin";
    box.innerHTML = `<h1>${l("Verify your sign-in", "Potwierdź logowanie")}</h1><p>${r.sms_sent === false ? l("SMS is unavailable. Use one of your recovery codes.", "SMS jest niedostępny. Użyj kodu odzyskiwania.") : l("Enter the SMS code or a one-time recovery code.", "Wpisz kod SMS albo jednorazowy kod odzyskiwania.")}</p><form><div class="field"><label for="mfaCode">${l("Verification code", "Kod weryfikacyjny")}</label><input id="mfaCode" name="code" autocomplete="one-time-code" required maxlength="40" autofocus></div><p role="alert" class="form-error"></p><button class="btn btn-primary">${l("Verify and sign in", "Potwierdź i zaloguj")}</button></form><button type="button" class="btn btn-ghost" id="mfaResend">${l("Resend SMS (60 seconds)", "Wyślij ponownie (60 sekund)")}</button><a class="btn btn-ghost" href="/login">${l("Back", "Wróć")}</a>`;
    document.querySelector(".auth-card").append(box);
    box.querySelector("input").focus();
    box.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button");
      b.disabled = true;
      try {
        const result = await API.post("/mfa/verify", {
          challenge: r.challenge,
          code: e.target.elements.code.value.trim(),
        });
        await complete(result);
        location.href = "/app";
      } catch (e) {
        box.querySelector("[role=alert]").textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
    box.querySelector("#mfaResend").onclick = async (e) => {
      e.target.disabled = true;
      try {
        await API.post("/mfa/resend", { challenge: r.challenge });
        box.querySelector("[role=alert]").textContent = l(
          "SMS sent.",
          "Wysłano SMS.",
        );
      } catch (e) {
        box.querySelector("[role=alert]").textContent = e.message;
      } finally {
        e.target.disabled = false;
      }
    };
    history.replaceState({}, "", location.pathname);
    return true;
  }
  async function settings() {
    const s = await API.get("/mfa/status"),
      { dialog } = KlyoDocumentTools;
    const d = dialog(
      l("Sign-in security", "Bezpieczeństwo logowania"),
      `<h3>${l("Two-step verification by SMS", "Weryfikacja dwuetapowa SMS")}</h3><p>${s.enabled ? l("Enabled for", "Włączono dla") + " " + esc(s.phone) : l("Not enabled yet.", "Jeszcze niewłączona.")}</p><p>${s.enabled ? esc(s.recovery_codes) + " " + l("unused recovery codes.", "niewykorzystanych kodów odzyskiwania.") : l("After confirmation, every sign-in requires a code, including Google sign-in.", "Po potwierdzeniu każde logowanie wymaga kodu, także przez Google.")}</p>${!s.configured ? `<p>${l("Ask the administrator to configure Twilio Verify.", "Administrator musi skonfigurować Twilio Verify.")} <a href="/docs/sms-security.html" target="_blank">${l("Setup guide", "Instrukcja konfiguracji")}</a></p>` : ""}<form>${!s.enabled ? `<label>${l("International phone number", "Numer telefonu z kodem kraju")}<input name="phone" type="tel" placeholder="+48123456789" pattern="\\+[1-9][0-9]{7,14}" required></label>` : ""}${API.getUser()?.has_password ? `<label>${l("Current password", "Obecne hasło")}<input name="password" type="password" autocomplete="current-password" required></label>` : `<p>${l("Google accounts must have signed in within the last five minutes.", "Konta Google muszą być zalogowane ponownie w ciągu ostatnich pięciu minut.")}</p>`}<button class="btn btn-primary" ${!s.configured && !s.enabled ? "disabled" : ""}>${s.enabled ? l("Disable with verification", "Wyłącz po weryfikacji") : l("Send verification SMS", "Wyślij SMS weryfikacyjny")}</button></form>`,
    );
    d.find("form").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button");
      b.disabled = true;
      try {
        const r = await API.post(
          s.enabled ? "/mfa/disable" : "/mfa/enroll",
          Object.fromEntries(new FormData(e.target)),
        );
        d.close();
        verifySetup(r);
      } catch (e) {
        d.error(e);
      } finally {
        b.disabled = false;
      }
    };
  }
  function verifySetup(r) {
    const d = KlyoDocumentTools.dialog(
      l("Confirm security change", "Potwierdź zmianę zabezpieczeń"),
      `<p>${l("Code sent to", "Kod wysłano do")} ${esc(r.phone)}. ${l("A recovery code can be used when disabling.", "Przy wyłączaniu można użyć kodu odzyskiwania.")}</p><form><label>${l("Code", "Kod")}<input name="code" autocomplete="one-time-code" required maxlength="40"></label><button class="btn btn-primary">${l("Confirm", "Potwierdź")}</button></form>`,
    );
    d.find("form").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button");
      b.disabled = true;
      try {
        const result = await API.post("/mfa/confirm", {
          challenge: r.challenge,
          code: e.target.elements.code.value.trim(),
        });
        await complete(result);
        d.close();
        if (result.recovery_codes) {
          const codes = result.recovery_codes;
          const a = KlyoDocumentTools.dialog(
            l("Save your recovery codes", "Zapisz kody odzyskiwania"),
            `<p>${l("Shown once. Keep these codes somewhere private outside Klyo. Each code works once when SMS is unavailable.", "Wyświetlane tylko raz. Zachowaj je prywatnie poza Klyo. Każdy działa raz, gdy SMS jest niedostępny.")}</p><pre style="user-select:all;white-space:pre-wrap">${codes.join("\n")}</pre><button class="btn btn-primary" id="downloadRecovery">${l("Download codes", "Pobierz kody")}</button>`,
          );
          a.find("#downloadRecovery").onclick = () => {
            const u = URL.createObjectURL(
              new Blob(["Klyo recovery codes\n" + codes.join("\n")], {
                type: "text/plain",
              }),
            );
            const link = document.createElement("a");
            link.href = u;
            link.download = "Klyo-recovery-codes.txt";
            link.click();
            setTimeout(() => URL.revokeObjectURL(u), 1000);
          };
        } else settings();
      } catch (e) {
        d.error(e);
      } finally {
        b.disabled = false;
      }
    };
  }
  function init() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost";
    b.id = "securitySettings";
    b.textContent = l(
      "Sign-in security · SMS 2FA",
      "Bezpieczeństwo · logowanie SMS",
    );
    b.onclick = () => settings().catch((e) => toast(e.message, "error"));
    document.getElementById("accountSettings").prepend(b);
  }
  return { login, settings, init };
})();
