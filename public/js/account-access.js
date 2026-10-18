/* Public account recovery UI. Reset tokens stay in the URL fragment, never in server logs. */
window.KlyoAccountAccess = (() => {
  const l = (en,pl) => KlyoI18n.getLang()==='pl'?pl:en;
  function screen(markup) {
    document.querySelectorAll('#welcomeScreen,#loginScreen,#signupScreen,#mfaLogin').forEach(n=>n.classList.add('hidden'));
    document.getElementById('accountRecovery')?.remove();
    const box=document.createElement('section');box.id='accountRecovery';box.innerHTML=markup;
    document.querySelector('.auth-card').append(box); return box;
  }
  function forgot() {
    const box=screen(`<h1>${l('Forgot your password?','Nie pamiętasz hasła?')}</h1><p>${l('We will email you a link to choose a new password.','Wyślemy Ci link do ustawienia nowego hasła.')}</p><form><div class="field"><label for="resetEmail">Email</label><input id="resetEmail" name="email" type="email" autocomplete="email" required maxlength="254"></div><p role="status"></p><button class="btn btn-primary">${l('Send reset link','Wyślij link resetujący')}</button></form><a class="btn btn-ghost" href="/login">${l('Back to sign in','Wróć do logowania')}</a>`);
    box.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;
      try {await API.post('/auth/forgot-password',{email:e.target.elements.email.value.trim(),language:KlyoI18n.getLang()});
        box.querySelector('[role=status]').textContent=l('If this account exists, we have sent a reset link. Check your inbox and spam folder.','Jeśli to konto istnieje, wysłaliśmy link resetujący. Sprawdź skrzynkę i spam.');
        b.textContent=l('Resend email','Wyślij email ponownie');setTimeout(()=>{if(b.isConnected)b.disabled=false;},60000);
      } catch(err){box.querySelector('[role=status]').textContent=err.message;b.disabled=false;}
    };
  }
  function reset(token) {
    const box=screen(`<h1>${l('Choose a new password','Ustaw nowe hasło')}</h1><p>${l('Your SMS verification remains enabled.','Weryfikacja SMS pozostanie włączona.')}</p><form><div class="field"><label for="newResetPassword">${l('New password','Nowe hasło')}</label><input id="newResetPassword" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><div class="field"><label for="confirmResetPassword">${l('Repeat password','Powtórz hasło')}</label><input id="confirmResetPassword" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><p role="alert"></p><button class="btn btn-primary">${l('Save new password','Zapisz nowe hasło')}</button></form><a class="btn btn-ghost" href="/login">${l('Back to sign in','Wróć do logowania')}</a>`);
    history.replaceState({},'',location.pathname);
    box.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const b=e.target.querySelector('button'),error=box.querySelector('[role=alert]');
      if(e.target.elements.password.value!==e.target.elements.confirm.value){error.textContent=l('Passwords do not match.','Hasła nie są takie same.');return;}
      b.disabled=true;
      try{await API.post('/auth/reset-password',{token,password:e.target.elements.password.value});API.clearToken();
        box.querySelector('form').remove();box.querySelector('p').textContent=l('Password updated. Sign in with your new password and SMS code.','Hasło zmienione. Zaloguj się nowym hasłem i kodem SMS.');
      }catch(err){error.textContent=err.message;b.disabled=false;}
    };
  }
  return {forgot,reset};
})();
