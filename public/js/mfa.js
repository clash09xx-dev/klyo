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
    if (r.mfa_enrollment_required) { enrollLogin(r); return true; }
    if (!r.mfa_required) return false;
    document
      .querySelectorAll("#welcomeScreen,#loginScreen,#signupScreen")
      .forEach((n) => n.classList.add("hidden"));
    document.getElementById("mfaLogin")?.remove();
    const box = document.createElement("section");
    box.id = "mfaLogin";
    box.innerHTML = `<h1>${l("Verify your sign-in", "Potwierdź logowanie")}</h1><p>${r.sms_sent === false ? l("SMS could not be sent. Try resending the code.", "Nie udało się wysłać SMS-a. Spróbuj ponownie wysłać kod.") : l("Enter the code sent to your phone. SMS verification is required at every sign-in.", "Wpisz kod wysłany na telefon. Weryfikacja SMS jest wymagana przy każdym logowaniu.")}</p><form><div class="field"><label for="mfaCode">${l("Verification code", "Kod weryfikacyjny")}</label><input id="mfaCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" required maxlength="10" autofocus></div><p role="alert" class="form-error"></p><button class="btn btn-primary">${l("Verify and sign in", "Potwierdź i zaloguj")}</button></form><button type="button" class="btn btn-ghost" id="mfaResend">${l("Resend SMS (60 seconds)", "Wyślij ponownie (60 sekund)")}</button><a class="btn btn-ghost" href="/login">${l("Back", "Wróć")}</a>`;
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
        location.href = "/onboarding";
      } catch (e) {
        box.querySelector("[role=alert]").textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
    let cooldown=0;
    const resendButton=box.querySelector("#mfaResend");
    const tick=()=>{resendButton.disabled=cooldown>0;resendButton.textContent=cooldown>0?l(`Resend SMS (${cooldown}s)`,`Wyślij SMS ponownie (${cooldown}s)`):l("Resend SMS","Wyślij SMS ponownie");};
    if(r.sms_sent!==false)cooldown=60;tick();
    const timer=setInterval(()=>{if(!box.isConnected){clearInterval(timer);return;}if(cooldown>0)cooldown--;tick();},1000);
    box.querySelector("#mfaResend").onclick = async (e) => {
      e.target.disabled = true;
      try {
        await API.post("/mfa/resend", { challenge: r.challenge });
        cooldown=60;tick();
        box.querySelector("[role=alert]").textContent = l(
          "SMS sent.",
          "Wysłano SMS.",
        );
      } catch (e) {
        box.querySelector("[role=alert]").textContent = e.message;
      } finally {
        tick();
      }
    };
    history.replaceState({}, "", location.pathname);
    return true;
  }
  function enrollLogin(r) {
    document.querySelectorAll("#welcomeScreen,#loginScreen,#signupScreen").forEach(n=>n.classList.add("hidden"));
    document.getElementById("mfaLogin")?.remove();
    const box=document.createElement("section");box.id="mfaLogin";
    box.innerHTML=`<h1>${l("Secure your account","Zabezpiecz konto")}</h1><p>${l("Every Klyo account requires SMS verification. Add your mobile number to continue.","Każde konto Klyo wymaga weryfikacji SMS. Dodaj numer telefonu, aby kontynuować.")}</p><form><div class="field"><label for="enrollmentPhone">${l("Mobile phone with country code","Telefon z kodem kraju")}</label><input id="enrollmentPhone" name="phone" type="tel" autocomplete="tel" placeholder="+48123456789" required></div><p role="alert" class="form-error"></p><button class="btn btn-primary">${l("Send SMS code","Wyślij kod SMS")}</button></form><a href="/login" class="btn btn-ghost">${l("Back","Wróć")}</a>`;
    document.querySelector(".auth-card").append(box);
    box.querySelector("form").onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector("button");b.disabled=true;
      try{const result=await API.post("/mfa/login-enroll",{enrollment_token:r.enrollment_token,phone:e.target.elements.phone.value.trim()});login(result);}
      catch(err){box.querySelector("[role=alert]").textContent=err.message;b.disabled=false;}
    };
    history.replaceState({},"",location.pathname);
  }
  async function settings() {
    const s=await API.get("/mfa/status");
    KlyoDocumentTools.dialog(l("Sign-in security","Bezpieczeństwo logowania"),
      `<h3>${l("SMS verification is always on","Weryfikacja SMS jest zawsze włączona")}</h3><p>${l("Every sign-in requires a code sent to","Każde logowanie wymaga kodu wysłanego na")} ${esc(s.phone)}.</p><p>${l("This requirement cannot be disabled. Password recovery does not remove phone verification.","Tego zabezpieczenia nie można wyłączyć. Odzyskanie hasła nie wyłącza weryfikacji telefonu.")}</p>`);
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
