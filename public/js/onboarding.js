(async()=>{
  KlyoI18n.initLang(null);
  const l=(en,pl)=>KlyoI18n.getLang()==='pl'?pl:en,g=id=>document.getElementById(id);
  document.documentElement.lang=KlyoI18n.getLang();
  g('logout').textContent=l('Sign out','Wyloguj');g('logout').onclick=()=>{API.clearToken();location.href='/login';};
  g('heading').textContent=l('Your workspace starts here.','Tu zaczyna się Twoja przestrzeń.');
  g('intro').textContent=l('Choose your subscription and complete secure checkout with Stripe.','Wybierz subskrypcję i dokończ bezpieczną konfigurację w Stripe.');
  g('notice').textContent=l('7 days free. Add a payment method now; your selected monthly subscription renews automatically after the trial unless you cancel before it ends.','7 dni bez opłat. Dodaj teraz metodę płatności. Po okresie próbnym wybrana subskrypcja miesięczna odnawia się automatycznie, chyba że anulujesz ją przed jego końcem.');
  g('terms').textContent=l('Terms','Regulamin');g('privacy').textContent=l('Privacy','Prywatność');
  if(!API.token()){location.replace('/signup');return;}
  try {
    await API.get('/auth/me');
    const params=new URLSearchParams(location.search),session=params.get('session_id');
    if(session){
      g('notice').textContent=l('Confirming your subscription with Stripe…','Potwierdzanie subskrypcji w Stripe…');
      const confirm=async()=>{try{await API.post('/billing/onboarding/complete',{session_id:session});location.replace('/app');}catch(e){g('error').textContent=e.message;g('retry').hidden=false;g('retry').textContent=l('Check again','Sprawdź ponownie');g('retry').onclick=confirm;}};
      await confirm();return;
    }
    const status=await API.get('/billing/status');
    if(!status.checkout_required){location.replace('/app');return;}
    const {tiers}=await API.get('/billing/tiers');
    for(const tier of tiers){
      const card=document.createElement('article');card.className='plan';
      const title=document.createElement('h2');title.textContent=tier.label;
      const price=document.createElement('strong');price.textContent='$'+tier.price;
      const interval=document.createElement('small');interval.textContent=l('per month, after your 7-day trial','miesięcznie, po 7 dniach próbnych');
      const capacity=document.createElement('p');capacity.textContent=tier.maxSeats===null?l('Unlimited team members','Nieograniczony zespół'):tier.maxSeats+' '+l('included users','użytkowników w planie');
      const b=document.createElement('button');b.textContent=l('Start free trial','Rozpocznij okres próbny');
      b.onclick=async()=>{document.querySelectorAll('.plan button').forEach(n=>n.disabled=true);g('error').textContent='';try{const {url}=await API.post('/billing/onboarding/checkout',{tier:tier.key});location.href=url;}catch(e){g('error').textContent=e.message;document.querySelectorAll('.plan button').forEach(n=>n.disabled=false);}};
      card.append(title,price,interval,capacity,b);g('plans').append(card);
    }
  }catch(e){if(['SMS_REQUIRED','MFA_SESSION_CHANGED'].includes(e.code)){API.clearToken();location.replace('/login');return;}g('error').textContent=e.message;}
})();
