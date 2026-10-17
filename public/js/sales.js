/* Manual sales workspace: no timers, scheduled sends or workflow execution. */
const KlyoSales = (() => {
  const g = id => document.getElementById(id);
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let views = [], templates = [], activeDeal = null, nameAction;
  const labels = {
    en: { allTime:'All-time workspace summary', helpGuide:'Help & guide', writingAssistant:'Writing assistant (optional)', salesGroup:'Sales', workGroup:'Work', workspaceGroup:'Workspace', contactsTitle:'Contacts', contactsDescription:'Contact details, companies and relationship history.', overview:'Overview', overviewSub:'Sales results and the work that needs your attention.', attention:'Attention', allActivity:'All activity', overdue:'Overdue', today:'Due today', noNext:'No next step', stale:'7+ days in stage', allViews:'Saved views', saveView:'Save view', deleteView:'Delete view', search:'Search deals', nextStep:'Next step', addStep:'Add next step', taskTitle:'What needs to happen?', dueDate:'Due date', complete:'Mark complete', history:'Stage & status history', noHistory:'No changes recorded yet.', lostReason:'Reason for losing this deal', markLost:'Mark as lost', cancel:'Cancel', save:'Save', name:'Name', noTemplates:'Choose a template', applyTemplate:'Use template', blankDraft:'Write a message', saveTemplate:'Save as template', deleteTemplate:'Delete template', placeholders:'Template fields: {first_name}, {name}, {company}, {sender}.', open:'Open deals', won:'Won value', winRate:'Win rate', noLosses:'No loss reasons recorded.', lossReasons:'Loss reasons', pipeline:'Open pipeline', stage:'Stage', deals:'Deals', value:'Value', noData:'No sales recorded yet.', created:'Deal created', noStage:'No stage', noTask:'No next step planned', day:'days in stage', taskAdded:'Next step added', taskDone:'Task completed', viewSaved:'View saved', templateSaved:'Template saved', manual:'Messages are sent only when you click Send.', nothing:'No matching deals', saveError:'Could not save. Please try again.', saveDraft:'Save draft', draftSaved:'Draft saved' },
    pl: { allTime:'Podsumowanie całego okresu', helpGuide:'Pomoc i przewodnik', writingAssistant:'Asystent pisania (opcjonalnie)', salesGroup:'Sprzedaż', workGroup:'Praca', workspaceGroup:'Obszar roboczy', contactsTitle:'Kontakty', contactsDescription:'Dane kontaktowe, firmy i historia relacji.', overview:'Przegląd', overviewSub:'Wyniki sprzedaży i sprawy, które wymagają uwagi.', attention:'Do sprawdzenia', allActivity:'Wszystkie działania', overdue:'Zaległe', today:'Na dzisiaj', noNext:'Bez następnego kroku', stale:'7+ dni w etapie', allViews:'Zapisane widoki', saveView:'Zapisz widok', deleteView:'Usuń widok', search:'Szukaj deala', nextStep:'Następny krok', addStep:'Dodaj następny krok', taskTitle:'Co trzeba zrobić?', dueDate:'Termin', complete:'Oznacz jako wykonane', history:'Historia etapów i statusów', noHistory:'Nie zarejestrowano jeszcze zmian.', lostReason:'Powód przegranej', markLost:'Oznacz jako przegrany', cancel:'Anuluj', save:'Zapisz', name:'Nazwa', noTemplates:'Wybierz szablon', applyTemplate:'Użyj szablonu', blankDraft:'Napisz wiadomość', saveTemplate:'Zapisz jako szablon', deleteTemplate:'Usuń szablon', placeholders:'Pola szablonu: {first_name}, {name}, {company}, {sender}.', open:'Otwarte deale', won:'Wartość wygranych', winRate:'Skuteczność', noLosses:'Brak zapisanych powodów przegranej.', lossReasons:'Powody przegranej', pipeline:'Otwarty lejek', stage:'Etap', deals:'Deale', value:'Wartość', noData:'Brak zarejestrowanej sprzedaży.', created:'Utworzono deal', noStage:'Bez etapu', noTask:'Brak zaplanowanego kroku', day:'dni w etapie', taskAdded:'Dodano następny krok', taskDone:'Zadanie wykonane', viewSaved:'Zapisano widok', templateSaved:'Zapisano szablon', manual:'Wiadomość zostanie wysłana dopiero po kliknięciu Wyślij.', nothing:'Brak pasujących dealów', saveError:'Nie udało się zapisać. Spróbuj ponownie.', saveDraft:'Zapisz szkic', draftSaved:'Zapisano szkic' }
  };
  const l = key => (labels[KlyoI18n.getLang()] || labels.en)[key] || labels.en[key] || key;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const date = value => value ? String(value).slice(0,10) : '';
  const editor = () => API.getUser()?.role !== 'viewer';
  const daysInStage = d => d.stage_entered_at ? Math.max(0,Math.floor((Date.now()-new Date(d.stage_entered_at).getTime())/86400000)) : null;
  function localize() {
    if(typeof KlyoPipelines!=='undefined')KlyoPipelines.localize();
    document.querySelectorAll('[data-sales-label]').forEach(el => { el.textContent = l(el.dataset.salesLabel); });
    g('dealQuickSearch').placeholder=l('search');
    g('nextStepTitle').placeholder=l('taskTitle');
    for(const id of ['nextStepSubmit','nextStepComplete','writeManualBtn','applyTemplateBtn','saveEmailTemplateBtn','saveManualDraftBtn','deleteEmailTemplateBtn']) g(id).disabled=!editor();
  }
  function filterDeals(list) {
    const attention=g('dealAttentionFilter').value, search=g('dealQuickSearch').value.trim().toLowerCase();
    const filtered=list.filter(d=>{
      if(search && ![d.title,d.contact_name,d.company_name,d.assigned_name].some(value=>String(value||'').toLowerCase().includes(search))) return false;
      if(!attention) return true;
      if(d.status!=='open') return false;
      if(attention==='no_next') return !d.next_task_id;
      if(attention==='today') return date(d.next_task_due)===today();
      if(attention==='overdue') return Number(d.overdue_tasks)>0 || (date(d.next_task_due) && date(d.next_task_due)<today());
      return daysInStage(d)>=7;
    });
    g('dealMatchCount').textContent=filtered.length ? `${filtered.length}` : l('nothing');
    return filtered;
  }
  function cardDetails(d) {
    const age=daysInStage(d);
    if(d.status!=='open') return d.lost_reason ? `<div class="deal-next-step">${h(d.lost_reason)}</div>` : '';
    const overdue=Number(d.overdue_tasks)>0 || (date(d.next_task_due) && date(d.next_task_due)<today());
    return `<div class="deal-card-meta">${Number(d.probability||0)}% · ${h(KlyoI18n.getLang()==='pl'?"Ważona":KlyoCopy.text("Weighted"))}: ${h(fmtMoney(d.weighted_value??Number(d.value||0)*Number(d.probability||0)/100,d.currency,2))}</div><div class="deal-next-step ${overdue?'is-overdue':''}">${d.next_task_id?`${date(d.next_task_due)?`<span>${h(date(d.next_task_due))}</span>`:''}${h(d.next_task_title)}`:`<span class="muted">${l('noTask')}</span>`}</div>
      ${(d.assigned_name || age!==null)?`<div class="deal-card-foot"><span>${h(d.assigned_name||'')}</span><span>${age===null?'':`${age} ${l('day')}`}</span></div>`:''}`;
  }
  async function loadViews() {
    const result=await API.get('/sales/views'); views=result.views;
    const selected=g('savedDealView').value;
    g('savedDealView').innerHTML=`<option value="">${l('allViews')}</option>`+views.map(v=>`<option value="${v.id}">${h(v.name)}</option>`).join('');
    if(views.some(v=>String(v.id)===selected)) g('savedDealView').value=selected;
  }
  async function loadTemplates() {
    templates=(await API.get('/sales/templates')).templates;
    const selected=g('emailTemplateSelect').value;
    g('emailTemplateSelect').innerHTML=`<option value="">${l('noTemplates')}</option>`+templates.map(v=>`<option value="${v.id}">${h(v.name)}</option>`).join('');
    if(templates.some(v=>String(v.id)===selected))g('emailTemplateSelect').value=selected;
  }
  function currentFilters() { return {pipeline_id:KlyoPipelines.selected(),stage_id:els.dealStageFilter.value,assigned_to:els.dealAssigneeFilter.value,status:els.dealStatusFilter.value,attention:g('dealAttentionFilter').value,search:g('dealQuickSearch').value}; }
  function nameModal(action,title) {
    nameAction=action; g('salesNameTitle').textContent=title;g('salesNameInput').value='';g('salesNameError').textContent='';g('salesNameOverlay').classList.remove('hidden');g('salesNameInput').focus();
  }
  async function draft(template) {
    if(!currentPanelContactId)return;
    const contact=currentPanelContact || {};
    const tokens={first_name:contact.first_name||contact.full_name?.split(' ')[0]||'', name:contact.full_name||'',company:contact.company_name||contact.company||'',sender:API.getUser()?.name||''};
    const fill=value=>String(value||'').replace(/\{(first_name|name|company|sender)\}/g,(_,key)=>tokens[key]);
    const result=await API.post('/offers',{contact_id:currentPanelContactId,subject:fill(template?.subject),body:fill(template?.body)});
    currentDraftOfferId=result.offer.id;els.draftSubject.value=result.offer.subject;els.draftBody.value=result.offer.body;els.draftBox.classList.add('show');els.draftSubject.focus();
  }
  async function showDeal(d) {
    activeDeal=d;localize();
    g('nextStepCurrent').textContent=d.next_task_id?`${d.next_task_title}${d.next_task_due?' · '+date(d.next_task_due):''}`:l('noTask');
    g('nextStepComplete').classList.toggle('hidden',!d.next_task_id);
    g('nextStepForm').classList.toggle('hidden',d.status!=='open');
    g('nextStepTitle').value='';g('nextStepDue').value=today();g('nextStepError').textContent='';
    g('dealLossReason').textContent=d.lost_reason?`${l('lostReason')}: ${d.lost_reason}`:'';g('dealLossReason').classList.toggle('hidden',!d.lost_reason);
    g('dealStageHistory').innerHTML=`<p class="muted">${l('noHistory')}</p>`;
    try {
      const {events}=await API.get(`/deals/${d.id}/history`);
      if(activeDeal?.id!==d.id)return;
      g('dealStageHistory').innerHTML=events.length?events.map(e=>`<div class="stage-event"><div>${e.event_type==='created'?l('created'):`${h(e.from_stage||l('noStage'))} → ${h(e.to_stage||l('noStage'))}`}${e.from_pipeline&&e.to_pipeline&&e.from_pipeline!==e.to_pipeline?`<p>${h(e.from_pipeline)} → ${h(e.to_pipeline)}</p>`:''}${e.from_status!==e.to_status?` <span class="muted">· ${h(e.to_status)}</span>`:''}${e.reason?`<p>${h(e.reason)}</p>`:''}</div><time>${h(formatDateTime(e.created_at))} · ${h(e.user_name||'')}</time></div>`).join(''):`<p class="muted">${l('noHistory')}</p>`;
    } catch(error) { g('dealStageHistory').textContent=error.message; }
  }
  async function loadOverview() {
    localize();g('salesOverviewError').textContent='';
    try {
      const data=await API.get('/sales/summary');
      const count=status=>data.totals.filter(r=>r.status===status).reduce((sum,r)=>sum+Number(r.count),0);
      g('salesOpenCount').textContent=count('open');
      const closed=count('won')+count('lost');g('salesWinRate').textContent=closed?Math.round(count('won')/closed*100)+'%':'—';
      g('salesOverdueCount').textContent=data.overdue;g('salesNoNextCount').textContent=data.without_next_step;
      g('salesWonValue').innerHTML=data.totals.filter(r=>r.status==='won').map(r=>`<span>${h(fmtMoney(r.value,r.currency,2))}</span>`).join('')||'—';
      const stages=new Map();for(const stage of data.stages){if(!stages.has(stage.id))stages.set(stage.id,{...stage,count:0,amounts:[]});const item=stages.get(stage.id);item.count+=Number(stage.count);if(stage.currency)item.amounts.push(fmtMoney(stage.value,stage.currency,2));}
      g('salesStageRows').innerHTML=[...stages.values()].map(stage=>`<tr><td>${h(stage.pipeline_name?stage.pipeline_name+' / '+stage.name:stage.name)}</td><td>${stage.count}</td><td>${stage.amounts.map(h).join(KlyoCopy.html("<br>"))||'—'}</td></tr>`).join('')||`<tr><td colspan="3">${l('noData')}</td></tr>`;
      g('salesLossReasons').innerHTML=data.losses.map(reason=>`<div class="loss-reason-row"><span>${h(reason.reason)}</span><strong>${reason.count}</strong></div>`).join('')||`<p class="muted">${l('noLosses')}</p>`;
    }catch(error){g('salesOverviewError').textContent=error.message;}
  }
  function onView(view) {
    document.body.dataset.mobileNav='';
    g('salesOverviewView').classList.toggle('hidden',view!=='overview');localize();
    if(view==='overview')loadOverview();
    if(view==='deals')loadViews().catch(error=>toast(error.message,'error'));
  }
  function openLossModal() {g('lossReasonInput').value='';g('lossReasonError').textContent='';g('lossReasonOverlay').classList.remove('hidden');g('lossReasonInput').focus();}
  function init() {
    const menu=document.createElement('button');menu.className='btn btn-ghost mobile-menu-toggle';menu.type='button';menu.textContent=KlyoCopy.text("Menu");menu.setAttribute('aria-label','Open navigation');menu.addEventListener('click',()=>{document.body.dataset.mobileNav=document.body.dataset.mobileNav==='open'?'':'open';});document.querySelector('.topbar').prepend(menu);
    const scrim=document.createElement('button');scrim.type='button';scrim.className='mobile-nav-scrim';scrim.setAttribute('aria-label','Close navigation');scrim.addEventListener('click',()=>{document.body.dataset.mobileNav='';});document.querySelector('.shell').appendChild(scrim);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){document.body.dataset.mobileNav='';for(const id of ['salesNameOverlay','lossReasonOverlay'])g(id).classList.add('hidden');}});
    localize();loadTemplates().catch(()=>{});loadViews().catch(()=>{});
    g('dealQuickSearch').addEventListener('input',renderDealsBoard);
    g('dealAttentionFilter').addEventListener('change',renderDealsBoard);
    g('savedDealView').addEventListener('change',async()=>{
      const view=views.find(v=>String(v.id)===g('savedDealView').value);if(!view)return;
      const f=view.filters;if(f.pipeline_id)KlyoPipelines.setSelected(f.pipeline_id);els.dealAssigneeFilter.value=f.assigned_to||'';els.dealStatusFilter.value=f.status||'';g('dealAttentionFilter').value=f.attention||'';g('dealQuickSearch').value=f.search||'';await loadDeals({stage_id:f.stage_id||''});
    });
    g('saveDealViewBtn').addEventListener('click',()=>nameModal(async name=>{await API.post('/sales/views',{name,filters:currentFilters()});await loadViews();toast(l('viewSaved'));},l('saveView')));
    g('deleteDealViewBtn').addEventListener('click',async()=>{const id=g('savedDealView').value;if(!id)return;try{await API.del(`/sales/views/${id}`);await loadViews();}catch(error){toast(error.message,'error');}});
    g('salesNameForm').addEventListener('submit',async event=>{event.preventDefault();const button=g('salesNameSubmit');button.disabled=true;try{await nameAction(g('salesNameInput').value.trim());g('salesNameOverlay').classList.add('hidden');}catch(error){g('salesNameError').textContent=error.message;}finally{button.disabled=false;}});
    for(const id of ['salesName','lossReason']) {g(id+'Cancel').addEventListener('click',()=>g(id+'Overlay').classList.add('hidden'));g(id+'Overlay').addEventListener('click',event=>{if(event.target===g(id+'Overlay'))g(id+'Overlay').classList.add('hidden');});}
    g('nextStepForm').addEventListener('submit',async event=>{event.preventDefault();g('nextStepError').textContent='';const id=activeDeal.id;g('nextStepSubmit').disabled=true;try{await API.post(`/deals/${id}/next-step`,{title:g('nextStepTitle').value,due_date:g('nextStepDue').value});await loadDeals();await openDealPanel(id);toast(l('taskAdded'));}catch(error){g('nextStepError').textContent=error.message;}finally{g('nextStepSubmit').disabled=!editor();}});
    g('nextStepComplete').addEventListener('click',async()=>{try{await API.patch(`/tasks/${activeDeal.next_task_id}/status`,{status:'done'});await loadDeals();await openDealPanel(activeDeal.id);toast(l('taskDone'));}catch(error){toast(error.message,'error');}});
    g('lossReasonForm').addEventListener('submit',async event=>{event.preventDefault();const reason=g('lossReasonInput').value.trim();if(!reason)return;const button=event.submitter||g('lossReasonForm').querySelector('[data-sales-label=markLost]');button.disabled=true;g('lossReasonError').textContent='';try{const ok=await handleMarkDeal('lost',reason);if(ok)g('lossReasonOverlay').classList.add('hidden');else g('lossReasonError').textContent=l('saveError');}finally{button.disabled=false;}});
    g('saveManualDraftBtn').addEventListener('click',async()=>{if(!currentDraftOfferId)return;g('saveManualDraftBtn').disabled=true;try{await API.put(`/offers/${currentDraftOfferId}`,{subject:els.draftSubject.value,body:els.draftBody.value});toast(l('draftSaved'));}catch(error){toast(error.message,'error');}finally{g('saveManualDraftBtn').disabled=!editor();}});
    g('writeManualBtn').addEventListener('click',()=>draft().catch(error=>toast(error.message,'error')));
    g('applyTemplateBtn').addEventListener('click',()=>{const template=templates.find(t=>String(t.id)===g('emailTemplateSelect').value);if(template)draft(template).catch(error=>toast(error.message,'error'));});
    g('saveEmailTemplateBtn').addEventListener('click',()=>{if(!els.draftSubject.value.trim()||!els.draftBody.value.trim()){toast(KlyoCopy.text("Add a subject and message first."),'error');return;}nameModal(async name=>{await API.post('/sales/templates',{name,subject:els.draftSubject.value,body:els.draftBody.value});await loadTemplates();toast(l('templateSaved'));},l('saveTemplate'));});
    g('deleteEmailTemplateBtn').addEventListener('click',async()=>{const id=g('emailTemplateSelect').value;if(!id)return;try{await API.del(`/sales/templates/${id}`);await loadTemplates();}catch(error){toast(error.message,'error');}});
    window.addEventListener('klyo:language',()=>{localize();loadViews().catch(()=>{});loadTemplates().catch(()=>{});if(currentView==='overview')loadOverview();});
  }
  return {init,onView,showDeal,cardDetails,filterDeals,openLossModal};
})();
