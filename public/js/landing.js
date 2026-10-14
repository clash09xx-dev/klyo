/* Lightweight landing interactions. Preview uses sample data and never calls the CRM API. */
(() => {
  const P=KlyoPreferences, demo=document.getElementById('workspaceDemo');
  let preset='graphite',position='left',density='compact',customAccent=null,swapped=false;
  function render(){
    const palette=P.defaults(preset).palette;if(customAccent){palette.preset='custom';palette.custom={...palette.custom,...P.PRESETS[preset],accent:customAccent};}
    const t=P.tokens(palette);for(const [name,value] of Object.entries({'--demo-bg':t['--bg'],'--demo-surface':t['--surface'],'--demo-text':t['--panel-text'],'--demo-muted':t['--panel-muted'],'--demo-accent':t['--accent-1'],'--demo-on-accent':t['--on-accent'],'--demo-sidebar':t['--nav-bg'],'--demo-nav-text':t['--nav-text'],'--demo-border':t['--border-soft']}))demo.style.setProperty(name,value);
    demo.dataset.position=position;demo.dataset.density=density;document.getElementById('demoPosition').textContent=`Menu: ${position} ⇄`;document.getElementById('demoCaption').textContent=`${customAccent?'Custom accent':P.PRESETS[preset].name} · ${position==='left'?'Left':'Right'} menu · ${density==='compact'?'Compact':'Comfortable'}`;
    document.querySelectorAll('[data-demo-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.demoTheme===preset&&!customAccent)));
    document.getElementById('demoAccent').value=customAccent||P.PRESETS[preset].accent;
  }
  document.getElementById('themeGallery').innerHTML=Object.entries(P.PRESETS).map(([key,p])=>`<button type="button" class="gallery-theme" data-demo-theme="${key}" aria-pressed="false" style="--theme-bg:${p.background};--theme-panel:${p.surface};--theme-accent:${p.accent};--theme-nav:${p.sidebar};--theme-text:${P.foreground(p.surface)}"><span class="gallery-mini"><i></i><div><b></b><em></em><em></em><em></em></div></span><b>${p.name}</b><span>Try this theme ↗</span></button>`).join('');
  document.addEventListener('click',event=>{const button=event.target.closest('[data-demo-theme]');if(button){preset=button.dataset.demoTheme;customAccent=null;render();if(button.classList.contains('gallery-theme'))document.getElementById('playground').scrollIntoView({behavior:document.documentElement.dataset.motion==='off'?'auto':'smooth',block:'center'});}});
  document.getElementById('demoPosition').addEventListener('click',()=>{position=position==='left'?'right':'left';render();});
  document.getElementById('demoDensity').addEventListener('change',event=>{density=event.target.value;render();});
  document.getElementById('demoAccent').addEventListener('input',event=>{customAccent=event.target.value;render();});
  document.getElementById('demoFocus').addEventListener('click',event=>{const b=event.currentTarget;const focused=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(focused));demo.classList.toggle('demo-focused',focused);});
  document.getElementById('demoSwapColumns').addEventListener('click',()=>{swapped=!swapped;demo.querySelectorAll('.demo-table tr').forEach(row=>{row.appendChild(row.querySelector(`[data-demo-column="${swapped?'company':'stage'}"]`));});});
  const examples={pl:{instruction:'Napisz krótki email z pytaniem o termin rozmowy o nowej stronie internetowej.',subject:'Rozmowa o nowej stronie',body:'Dzień dobry,\n\nchętnie porozmawiam o planach dotyczących nowej strony internetowej. Czy znajdzie się w tym tygodniu dogodny termin na krótką rozmowę?\n\nPozdrawiam,\nJakub'},en:{instruction:'Write a short email asking when we can discuss the new website.',subject:'A quick conversation about your website',body:'Hi,\n\nI would be happy to discuss your plans for the new website. Is there a convenient time this week for a short call?\n\nBest,\nJakub'},es:{instruction:'Escribe un correo breve para preguntar cuándo podemos hablar sobre la nueva página web.',subject:'Una conversación sobre tu página web',body:'Hola,\n\nMe gustaría conocer tus planes para la nueva página web. ¿Hay algún momento esta semana que te venga bien para una breve llamada?\n\nSaludos,\nJakub'}};
  function email(language){const e=examples[language];document.getElementById('emailInstruction').textContent=e.instruction;document.getElementById('emailSubject').textContent=e.subject;document.getElementById('emailBody').textContent=e.body;document.querySelectorAll('[data-email-lang]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.emailLang===language)));const output=document.querySelector('.email-output');output.classList.remove('mail-arrive');void output.offsetWidth;output.classList.add('mail-arrive');}
  document.querySelectorAll('[data-email-lang]').forEach(b=>b.addEventListener('click',()=>email(b.dataset.emailLang)));
  const motion=document.getElementById('motionToggle'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function setMotion(on){document.documentElement.dataset.motion=on?'on':'off';motion.setAttribute('aria-pressed',String(!on));motion.innerHTML=`${on?'Ⅱ':'▶'} <span>${on?'Motion':'Paused'}</span>`;motion.title=on?'Pause animations':'Play animations';}
  let preference='on';try{preference=localStorage.getItem('klyo_landing_motion')||'on';}catch{}
  setMotion(!reduced.matches&&preference!=='off');
  motion.addEventListener('click',()=>{const on=document.documentElement.dataset.motion!=='on';preference=on?'on':'off';setMotion(on&&!reduced.matches);try{localStorage.setItem('klyo_landing_motion',preference);}catch{}});
  reduced.addEventListener('change',()=>setMotion(!reduced.matches&&preference!=='off'));
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('in-view');observer.unobserve(entry.target);}}),{threshold:.08});document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));document.documentElement.classList.add('has-reveals');}
  render();email('pl');
})();
