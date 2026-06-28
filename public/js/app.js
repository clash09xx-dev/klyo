// public/js/app.js
// ---------------------------------------------------------
// All dashboard behaviour: auth guard, contacts CRUD, filters,
// the AI offer composer, and the activity timeline.
// ---------------------------------------------------------

// (Tracking is intentionally NOT fired here — logged-in dashboard users
// are not site visitors. Tracking happens on login.html for real visits.)

/* ---------- state ---------- */
let team = [];
let filters = { search: "", status: "", theme: "", owner_id: "" };
let currentPanelContactId = null;
let currentPanelContact = null;
let currentDraftOfferId = null;
let searchDebounce = null;

let companies = [];
let products = [];
let workspaceDefaultCurrency = "USD";
let allContactsCache = []; // every contact, unfiltered — used by pickers (quote builder, company panel)
let currentCompanyPanelId = null;
let currentQuoteLineItems = []; // [{ product_id, description, quantity, unit_price, discount_percent }]
let currentQuotePrefillContactId = null;
let draggedLineIndex = null;

/* ---------- dom refs ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  userAvatar: $("userAvatar"), userName: $("userName"), userRole: $("userRole"),
  signOutBtn: $("signOutBtn"),
  viewTitle: $("viewTitle"), viewSub: $("viewSub"),
  searchBoxWrap: $("searchBoxWrap"), searchInput: $("searchInput"),
  addContactBtn: $("addContactBtn"), emptyAddBtn: $("emptyAddBtn"),
  pipelineView: $("pipelineView"), teamView: $("teamView"),
  statTotal: $("statTotal"), statLeads: $("statLeads"),
  statNegotiating: $("statNegotiating"), statOffers: $("statOffers"),
  sparkTotal: $("sparkTotal"),
  filterStatus: $("filterStatus"), filterTheme: $("filterTheme"), filterOwner: $("filterOwner"),
  resultCount: $("resultCount"),
  contactsTable: $("contactsTable"), contactsBody: $("contactsBody"), emptyState: $("emptyState"),
  teamBody: $("teamBody"),

  billingBanner: $("billingBanner"), billingBannerTitle: $("billingBannerTitle"),
  billingBannerSub: $("billingBannerSub"), upgradeBtn: $("upgradeBtn"),
  inviteCard: $("inviteCard"), inviteCodeValue: $("inviteCodeValue"),
  copyInviteBtn: $("copyInviteBtn"), regenInviteBtn: $("regenInviteBtn"),

  appearanceBtn: $("appearanceBtn"), appearanceModalOverlay: $("appearanceModalOverlay"),
  closeAppearanceBtn: $("closeAppearanceBtn"), themeGrid: $("themeGrid"), replayTourBtn: $("replayTourBtn"),

  pricingModalOverlay: $("pricingModalOverlay"), closePricingBtn: $("closePricingBtn"), pricingGrid: $("pricingGrid"),

  gmailCard: $("gmailCard"), gmailDescription: $("gmailDescription"), connectGmailBtn: $("connectGmailBtn"),
  gmailConnectedChip: $("gmailConnectedChip"), gmailConnectedEmail: $("gmailConnectedEmail"), disconnectGmailBtn: $("disconnectGmailBtn"),

  tourOverlay: $("tourOverlay"), tourTitle: $("tourTitle"), tourBody: $("tourBody"), tourDots: $("tourDots"),
  tourSkipBtn: $("tourSkipBtn"), tourBackBtn: $("tourBackBtn"), tourNextBtn: $("tourNextBtn"), helpFab: $("helpFab"),

  contactModalOverlay: $("contactModalOverlay"), contactModalTitle: $("contactModalTitle"),
  contactForm: $("contactForm"), contactId: $("contactId"),
  cFirstName: $("cFirstName"), cLastName: $("cLastName"), cEmail: $("cEmail"), cPhone: $("cPhone"),
  cTheme: $("cTheme"), cStatus: $("cStatus"), cOwner: $("cOwner"),
  cNotes: $("cNotes"), contactFormError: $("contactFormError"), contactSubmitBtn: $("contactSubmitBtn"),

  panelOverlay: $("panelOverlay"), panelName: $("panelName"), panelSub: $("panelSub"),
  panelBadge: $("panelBadge"), panelEmail: $("panelEmail"), panelPhone: $("panelPhone"),
  panelCompany: $("panelCompany"), panelTheme: $("panelTheme"), panelCreated: $("panelCreated"),
  panelNotesWrap: $("panelNotesWrap"), panelNotes: $("panelNotes"),
  offerInstructions: $("offerInstructions"), generateOfferBtn: $("generateOfferBtn"),
  draftBox: $("draftBox"), draftSubject: $("draftSubject"), draftBody: $("draftBody"),
  sendOfferBtn: $("sendOfferBtn"), discardDraftBtn: $("discardDraftBtn"),
  panelQuotesList: $("panelQuotesList"), newQuoteForContactBtn: $("newQuoteForContactBtn"),
  activityLogForm: $("activityLogForm"), activityLogType: $("activityLogType"), activityLogDescription: $("activityLogDescription"),
  panelTimeline: $("panelTimeline"), panelTimelineEmpty: $("panelTimelineEmpty"),
  deleteContactBtn: $("deleteContactBtn"), editContactBtn: $("editContactBtn"),

  cCompanySelect: $("cCompanySelect"), cTitle: $("cTitle"), cDecisionMaker: $("cDecisionMaker"),
  newCompanyInlineWrap: $("newCompanyInlineWrap"), newCompanyInlineInput: $("newCompanyInlineInput"),
  createInlineCompanyBtn: $("createInlineCompanyBtn"), cancelInlineCompanyBtn: $("cancelInlineCompanyBtn"),

  toastWrap: $("toastWrap"),

  // Companies
  exportContactsBtn: $("exportContactsBtn"), exportCompaniesBtn: $("exportCompaniesBtn"),
  importContactsBtn: $("importContactsBtn"), importContactsFile: $("importContactsFile"),
  companiesView: $("companiesView"), companySearchInput: $("companySearchInput"), addCompanyBtn: $("addCompanyBtn"),
  companiesBody: $("companiesBody"), companiesEmptyState: $("companiesEmptyState"),
  companyModalOverlay: $("companyModalOverlay"), companyModalTitle: $("companyModalTitle"), companyForm: $("companyForm"),
  companyId: $("companyId"), coName: $("coName"), coIndustry: $("coIndustry"), coNotes: $("coNotes"),
  companyFormError: $("companyFormError"), companySubmitBtn: $("companySubmitBtn"), closeCompanyModalBtn: $("closeCompanyModalBtn"),
  cancelCompanyBtn: $("cancelCompanyBtn"),
  companyPanelOverlay: $("companyPanelOverlay"), companyPanelName: $("companyPanelName"), companyPanelIndustry: $("companyPanelIndustry"),
  companyPanelNotesWrap: $("companyPanelNotesWrap"), companyPanelNotes: $("companyPanelNotes"),
  companyContactsBody: $("companyContactsBody"), closeCompanyPanelBtn: $("closeCompanyPanelBtn"),
  deleteCompanyBtn: $("deleteCompanyBtn"), editCompanyBtn: $("editCompanyBtn"),

  // Products / catalog
  productsModalOverlay: $("productsModalOverlay"), closeProductsModalBtn: $("closeProductsModalBtn"),
  productsList: $("productsList"), productsCount: $("productsCount"),
  productCategoryFilter: $("productCategoryFilter"),
  newProductName: $("newProductName"), newProductPrice: $("newProductPrice"),
  newProductCategory: $("newProductCategory"),
  newProductUnit: $("newProductUnit"), newProductInterval: $("newProductInterval"), addProductBtn: $("addProductBtn"),
  productFormError: $("productFormError"), manageProductsBtn: $("manageProductsBtn"),

  // Quotes
  quotesView: $("quotesView"), quoteStatusFilter: $("quoteStatusFilter"), addQuoteBtn: $("addQuoteBtn"),
  quotesBody: $("quotesBody"), quotesEmptyState: $("quotesEmptyState"), quotesEmptyAddBtn: $("quotesEmptyAddBtn"),
  quoteModalOverlay: $("quoteModalOverlay"), quoteModalTitle: $("quoteModalTitle"), quoteForm: $("quoteForm"),
  quoteId: $("quoteId"), quoteContactSelect: $("quoteContactSelect"), quoteTitleInput: $("quoteTitleInput"),
  quoteRecipientsField: $("quoteRecipientsField"), quoteRecipientsList: $("quoteRecipientsList"),
  quoteIntroInput: $("quoteIntroInput"), quoteItemsContainer: $("quoteItemsContainer"), addLineItemBtn: $("addLineItemBtn"),
  quoteSubtotalValue: $("quoteSubtotalValue"), quoteDiscountValue: $("quoteDiscountValue"), quoteTotalValue: $("quoteTotalValue"),
  quoteFormError: $("quoteFormError"), quoteCancelBtn: $("quoteCancelBtn"), quoteSaveDraftBtn: $("quoteSaveDraftBtn"),
  quoteSendBtn: $("quoteSendBtn"), closeQuoteModalBtn: $("closeQuoteModalBtn"),
  quotePanelOverlay: $("quotePanelOverlay"), quotePanelTitle: $("quotePanelTitle"), quotePanelFor: $("quotePanelFor"),
  quotePanelBadge: $("quotePanelBadge"), quotePanelItems: $("quotePanelItems"), quotePanelTotal: $("quotePanelTotal"),
  closeQuotePanelBtn: $("closeQuotePanelBtn"), deleteQuoteBtn: $("deleteQuoteBtn"), editQuoteBtn: $("editQuoteBtn"),
  declineQuoteBtn: $("declineQuoteBtn"), acceptQuoteBtn: $("acceptQuoteBtn"), sendQuoteFromPanelBtn: $("sendQuoteFromPanelBtn"),

  quotePreviewOverlay: $("quotePreviewOverlay"), closeQuotePreviewBtn: $("closeQuotePreviewBtn"),
  quotePreviewTo: $("quotePreviewTo"), quotePreviewSubject: $("quotePreviewSubject"), quotePreviewBody: $("quotePreviewBody"),
  quotePreviewError: $("quotePreviewError"), backToEditQuoteBtn: $("backToEditQuoteBtn"), confirmSendQuoteBtn: $("confirmSendQuoteBtn"),
  billingModeToggle: $("billingModeToggle"),

  // Reminders
  remindersView: $("remindersView"), remindersBody: $("remindersBody"), remindersEmptyState: $("remindersEmptyState"),

  // Tasks
  tasksView: $("tasksView"), tasksBody: $("tasksBody"), tasksTable: $("tasksTable"),
  tasksEmptyState: $("tasksEmptyState"), addTaskBtn: $("addTaskBtn"), tasksEmptyAddBtn: $("tasksEmptyAddBtn"),
  taskAssigneeFilter: $("taskAssigneeFilter"), taskStatusFilter: $("taskStatusFilter"),
  taskPriorityFilter: $("taskPriorityFilter"), taskOverdueFilter: $("taskOverdueFilter"),
  taskModalOverlay: $("taskModalOverlay"), closeTaskModalBtn: $("closeTaskModalBtn"),
  taskForm: $("taskForm"), taskId: $("taskId"), taskTitle: $("taskTitle"),
  taskDescription: $("taskDescription"), taskAssignedSelect: $("taskAssignedSelect"),
  taskPrioritySelect: $("taskPrioritySelect"), taskDueDate: $("taskDueDate"),
  taskStatusSelect: $("taskStatusSelect"), taskContactSelect: $("taskContactSelect"),
  taskDealSelect: $("taskDealSelect"), taskFormError: $("taskFormError"),
  taskSubmitBtn: $("taskSubmitBtn"), cancelTaskBtn: $("cancelTaskBtn"), taskModalTitle: $("taskModalTitle"),

  // Deals
  dealsView: $("dealsView"), dealsBoard: $("dealsBoard"), dealsEmptyState: $("dealsEmptyState"),
  dealStageFilter: $("dealStageFilter"), dealAssigneeFilter: $("dealAssigneeFilter"), dealStatusFilter: $("dealStatusFilter"),
  addDealBtn: $("addDealBtn"), dealsEmptyAddBtn: $("dealsEmptyAddBtn"), manageStagesBtn: $("manageStagesBtn"),
  dealModalOverlay: $("dealModalOverlay"), closeDealModalBtn: $("closeDealModalBtn"), dealForm: $("dealForm"),
  dealId: $("dealId"), dealTitle: $("dealTitle"), dealContactSelect: $("dealContactSelect"),
  dealCompanySelect: $("dealCompanySelect"), dealStageSelect: $("dealStageSelect"), dealAssignedSelect: $("dealAssignedSelect"),
  dealProductSelect: $("dealProductSelect"), dealQty: $("dealQty"), dealValue: $("dealValue"),
  dealCloseDate: $("dealCloseDate"), dealNotes: $("dealNotes"), dealFormError: $("dealFormError"),
  dealSubmitBtn: $("dealSubmitBtn"), cancelDealBtn: $("cancelDealBtn"), dealModalTitle: $("dealModalTitle"),
  dealPanelOverlay: $("dealPanelOverlay"), closeDealPanelBtn: $("closeDealPanelBtn"),
  dealPanelTitle: $("dealPanelTitle"), dealPanelSub: $("dealPanelSub"), dealPanelStageBadge: $("dealPanelStageBadge"),
  dealPanelDetails: $("dealPanelDetails"), dealPanelNotes: $("dealPanelNotes"), dealPanelNotesWrap: $("dealPanelNotesWrap"),
  markDealWonBtn: $("markDealWonBtn"), markDealLostBtn: $("markDealLostBtn"), deleteDealBtn: $("deleteDealBtn"), editDealBtn: $("editDealBtn"),
  stagesModalOverlay: $("stagesModalOverlay"), closeStagesModalBtn: $("closeStagesModalBtn"),
  stagesList: $("stagesList"), newStageName: $("newStageName"), newStageColor: $("newStageColor"),
  addStageBtn: $("addStageBtn"), stagesFormError: $("stagesFormError"),

  // History
  historyView: $("historyView"), historyTimeline: $("historyTimeline"), historyEmptyState: $("historyEmptyState"),
  historyUserFilter: $("historyUserFilter"), historyTypeFilter: $("historyTypeFilter"),
  historyCount: $("historyCount"), historyLoadMoreWrap: $("historyLoadMoreWrap"), historyLoadMoreBtn: $("historyLoadMoreBtn"),

  // Performance
  performanceCard: $("performanceCard"), performanceBody: $("performanceBody"),
  grantModalOverlay: $("grantModalOverlay"), closeGrantModalBtn: $("closeGrantModalBtn"),
  grantWorkspaceName: $("grantWorkspaceName"), grantTierSelect: $("grantTierSelect"), grantDurationSelect: $("grantDurationSelect"),
  grantFormError: $("grantFormError"), cancelGrantBtn: $("cancelGrantBtn"), confirmGrantBtn: $("confirmGrantBtn"),

  // Platform (developer) dashboard
  platformNavItem: $("platformNavItem"), platformView: $("platformView"),
  platTotalWorkspaces: $("platTotalWorkspaces"), platActive: $("platActive"), platTrial: $("platTrial"), platMrr: $("platMrr"),
  platSecondaryStats: $("platSecondaryStats"), platWorkspacesBody: $("platWorkspacesBody"), platUsersBody: $("platUsersBody"),
  platViewsToday: $("platViewsToday"), platViews7d: $("platViews7d"), platViews30d: $("platViews30d"), platViewsTotal: $("platViewsTotal"),

  // Profile / password settings
  profileNameInput: $("profileNameInput"), profileEmailDisplay: $("profileEmailDisplay"),
  profileNameError: $("profileNameError"), saveProfileNameBtn: $("saveProfileNameBtn"),
  googleOnlyNotice: $("googleOnlyNotice"), currentPasswordField: $("currentPasswordField"),
  currentPasswordInput: $("currentPasswordInput"), newPasswordInput: $("newPasswordInput"), newPasswordLabel: $("newPasswordLabel"),
  passwordError: $("passwordError"), savePasswordBtn: $("savePasswordBtn"),
  settingsCurrentPlan: $("settingsCurrentPlan"), settingsUpgradeBtn: $("settingsUpgradeBtn"),
  settingsPlanDetail: $("settingsPlanDetail"), settingsCancelBtn: $("settingsCancelBtn"), settingsResumeBtn: $("settingsResumeBtn"),
  joinInviteCodeInput: $("joinInviteCodeInput"), joinWorkspaceBtn: $("joinWorkspaceBtn"), joinWorkspaceError: $("joinWorkspaceError"),
  currencySettingsSection: $("currencySettingsSection"), workspaceCurrencySelect: $("workspaceCurrencySelect"),
  currencyError: $("currencyError"), saveCurrencyBtn: $("saveCurrencyBtn"),
  aiContextSection: $("aiContextSection"), aiContextInput: $("aiContextInput"),
  aiContextError: $("aiContextError"), saveAiContextBtn: $("saveAiContextBtn"),
  appLangPicker: $("appLangPicker"),
};

const SEND_BTN_HTML = els.sendOfferBtn.innerHTML;

/* ---------- small helpers ---------- */
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function toJsDate(s) {
  if (!s) return new Date();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(" ", "T") + "Z");
  return new Date(s);
}
function formatDate(s) { return toJsDate(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function formatDateTime(s) { return toJsDate(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function stageColorVar(status) {
  return { lead: "var(--lead)", contacted: "var(--contacted)", negotiating: "var(--negotiating)", customer: "var(--customer)", lost: "var(--lost)" }[status] || "var(--lead)";
}
function badgeHtml(status) {
  const label = (window.KlyoI18n ? window.KlyoI18n.t("ui.stage_" + status) : null) || capitalize(status);
  return `<span class="badge ${status}"><span class="ping"></span>${label}</span>`;
}
function toast(message, type = "success", action) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;

  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);

  if (action) {
    const btn = document.createElement("button");
    btn.className = "btn btn-sm btn-primary";
    btn.style.marginLeft = "auto";
    btn.style.flexShrink = "0";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      el.remove();
    });
    el.appendChild(btn);
  }

  els.toastWrap.appendChild(el);
  setTimeout(() => el.remove(), action ? 9000 : 4200);
}

// Limit-exceeded errors get an inline "Upgrade" action right on the toast,
// instead of just a flat error message — this is the moment someone's
// actually motivated to upgrade, so make it one click away.
function showLimitOrError(err, fallbackEl) {
  if (err.code === "LIMIT_EXCEEDED") {
    toast(err.message, "error", { label: "Upgrade", onClick: openPricingModal });
  } else if (fallbackEl) {
    fallbackEl.textContent = err.message;
  } else {
    toast(err.message, "error");
  }
}

/* ---------- auth guard + boot ---------- */
(async function init() {
  if (!API.token()) { window.location.href = "/login.html"; return; }

  try {
    const { user } = await API.get("/auth/me");
    API.setUser(user);
    els.userAvatar.textContent = initials(user.name);
    els.userName.textContent = user.name;
    els.userRole.textContent = user.role;
    applyTheme(user.theme || "signal");
    els.platformNavItem.classList.toggle("hidden", !user.is_platform_admin);
    // Apply saved language (server preference takes priority)
    KlyoI18n.initLang(user.language || null);
    KlyoI18n.applyTranslations();
    if (els.appLangPicker) els.appLangPicker.value = KlyoI18n.getLang();
  } catch {
    API.clearToken();
    window.location.href = "/login.html";
    return;
  }

  wireEvents();

  await Promise.all([loadTeam(), loadThemes(), loadWorkspace(), loadBillingStatus(), loadCompanies(), loadProducts(), loadWorkspaceCurrency()]);
  try {
    await Promise.all([loadStats(), loadContacts()]);
  } catch {
    // Most likely a lapsed trial/subscription — loadBillingStatus() above
    // already put up a clear banner explaining that, so just leave the
    // dashboard empty rather than breaking the rest of the page.
  }

  handleGmailRedirectParam();
  if (!API.getUser().has_seen_onboarding) startTour();
})();

function handleGmailRedirectParam() {
  const params = new URLSearchParams(window.location.search);
  const gmailResult = params.get("gmail");
  if (!gmailResult) return;

  if (gmailResult === "connected") toast("Gmail connected — offers will send from that address.");
  else if (gmailResult === "cancelled") toast("Gmail connection cancelled.", "error");
  else if (gmailResult === "error") toast("Couldn't connect Gmail — please try again.", "error");

  params.delete("gmail");
  const newUrl = window.location.pathname + (params.toString() ? `?${params}` : "");
  window.history.replaceState({}, "", newUrl);
}

/* ---------- workspace + billing ---------- */
async function loadWorkspace() {
  const { workspace } = await API.get("/auth/workspace");
  const user = API.getUser();
  if (user && user.role === "admin" && workspace.invite_code) {
    els.inviteCard.classList.remove("hidden");
    els.inviteCodeValue.textContent = workspace.invite_code;
  } else {
    els.inviteCard.classList.add("hidden");
  }
}

async function loadGmailStatus() {
  const user = API.getUser();
  if (!user || user.role !== "admin") {
    els.gmailCard.classList.add("hidden");
    return;
  }
  els.gmailCard.classList.remove("hidden");

  try {
    const status = await API.get("/integrations/gmail/status");
    if (!status.configured) {
      els.gmailDescription.textContent =
        "Gmail sign-in isn't set up on this server yet — ask whoever's hosting Klyo to add Google API credentials.";
      els.connectGmailBtn.classList.add("hidden");
      els.gmailConnectedChip.classList.add("hidden");
      return;
    }
    els.gmailDescription.textContent = "Connect your Gmail account so offers send from your real address — no shared password involved.";
    if (status.connected) {
      els.connectGmailBtn.classList.add("hidden");
      els.gmailConnectedChip.classList.remove("hidden");
      els.gmailConnectedEmail.textContent = status.email;
    } else {
      els.connectGmailBtn.classList.remove("hidden");
      els.gmailConnectedChip.classList.add("hidden");
    }
  } catch {
    els.gmailCard.classList.add("hidden");
  }
}

async function handleConnectGmail() {
  els.connectGmailBtn.disabled = true;
  try {
    const { url } = await API.post("/integrations/gmail/connect", {});
    window.location.href = url;
  } catch (err) {
    toast(err.message, "error");
    els.connectGmailBtn.disabled = false;
  }
}

async function handleDisconnectGmail() {
  if (!confirm("Disconnect Gmail? Offers will fall back to the server's default email sending.")) return;
  try {
    await API.post("/integrations/gmail/disconnect", {});
    toast("Gmail disconnected");
    loadGmailStatus();
  } catch (err) {
    toast(err.message, "error");
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.max(0, Math.ceil((new Date(dateStr) - new Date()) / 86400000));
}

async function loadBillingStatus() {
  try {
    const status = await API.get("/billing/status");
    if (status.is_comped) {
      els.billingBanner.classList.add("hidden");
      return;
    }
    if (status.plan === "active") {
      if (status.cancel_at_period_end && status.current_period_end) {
        const daysLeft = daysUntil(status.current_period_end);
        els.billingBannerTitle.textContent = "Your plan won't renew";
        els.billingBannerSub.textContent = `Access continues for ${daysLeft} more day${daysLeft === 1 ? "" : "s"}, until ${formatDate(status.current_period_end)}.`;
        els.upgradeBtn.textContent = "Resume plan";
        els.upgradeBtn.dataset.action = "resume";
        els.billingBanner.classList.remove("hidden");
      } else {
        els.billingBanner.classList.add("hidden");
      }
      return;
    }
    els.upgradeBtn.textContent = "Upgrade now";
    els.upgradeBtn.dataset.action = "upgrade";
    if (status.plan === "trial" && status.trial_ends_at) {
      const daysLeft = daysUntil(status.trial_ends_at);
      els.billingBannerTitle.textContent = daysLeft > 0 ? "Your free trial is active" : "Your free trial has ended";
      els.billingBannerSub.textContent =
        daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left — upgrade any time to keep things running.` : "Upgrade now to keep using Klyo.";
      els.billingBanner.classList.remove("hidden");
      return;
    }
    els.billingBannerTitle.textContent = "Your subscription needs attention";
    els.billingBannerSub.textContent = "Upgrade to restore full access.";
    els.billingBanner.classList.remove("hidden");
  } catch {
    // If billing status can't be fetched, fail quietly rather than blocking the dashboard.
  }
}

function handleUpgradeClick() {
  if (els.upgradeBtn.dataset.action === "resume") {
    handleResumeSubscription(els.upgradeBtn);
  } else {
    openPricingModal();
  }
}

async function handleCopyInvite() {
  try {
    await navigator.clipboard.writeText(els.inviteCodeValue.textContent.trim());
    toast("Invite code copied");
  } catch {
    toast("Could not copy automatically — select and copy it manually.", "error");
  }
}

async function handleRegenInvite() {
  if (!confirm("Regenerate the invite code? The old code will stop working.")) return;
  try {
    const { invite_code } = await API.post("/auth/workspace/regenerate-invite", {});
    els.inviteCodeValue.textContent = invite_code;
    toast("New invite code generated");
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------- theme picker ---------- */
function applyTheme(themeKey) {
  document.documentElement.setAttribute("data-theme", themeKey === "signal" ? "" : themeKey);
  els.themeGrid.querySelectorAll(".theme-swatch").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeKey === themeKey);
  });
}

function openAppearanceModal() {
  const user = API.getUser();
  els.profileNameInput.value = user.name || "";
  els.profileEmailDisplay.textContent = user.email || "—";
  els.profileNameError.textContent = "";
  els.passwordError.textContent = "";
  els.currentPasswordInput.value = "";
  els.newPasswordInput.value = "";
  els.googleOnlyNotice.classList.toggle("hidden", Boolean(user.has_password));
  els.currentPasswordField.classList.toggle("hidden", !user.has_password);
  els.newPasswordLabel.textContent = user.has_password ? "New password" : "Set a password";
  updateSettingsPlanDisplay();
  loadGmailStatus();
  loadCurrencySettings();
  loadAiContext();
  els.appearanceModalOverlay.classList.remove("hidden");
}
function closeAppearanceModal() {
  els.appearanceModalOverlay.classList.add("hidden");
}

async function updateSettingsPlanDisplay() {
  els.settingsCurrentPlan.textContent = "—";
  els.settingsPlanDetail.textContent = "";
  els.settingsCancelBtn.classList.add("hidden");
  els.settingsResumeBtn.classList.add("hidden");

  try {
    const [status, { tiers }] = await Promise.all([API.get("/billing/status"), API.get("/billing/tiers")]);
    const tierInfo = tiers.find((t) => t.key === status.tier);
    const tierLabel = tierInfo ? tierInfo.label : status.tier;

    if (status.is_comped) {
      els.settingsCurrentPlan.textContent = `${tierLabel} — comped (free)`;
    } else if (status.plan === "active") {
      const daysLeft = daysUntil(status.current_period_end);
      if (status.billing_mode === "one_time") {
        els.settingsCurrentPlan.textContent = `${tierLabel} — one-time purchase`;
        els.settingsPlanDetail.textContent =
          daysLeft != null ? `Access until ${formatDate(status.current_period_end)} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left). Doesn't renew — buy again any time to extend.` : "";
      } else if (status.cancel_at_period_end) {
        els.settingsCurrentPlan.textContent = `${tierLabel} — cancelling`;
        els.settingsPlanDetail.textContent =
          daysLeft != null ? `Access continues until ${formatDate(status.current_period_end)} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left), then it won't renew.` : "";
        els.settingsResumeBtn.classList.remove("hidden");
      } else {
        els.settingsCurrentPlan.textContent = `${tierLabel} — active`;
        els.settingsPlanDetail.textContent =
          daysLeft != null ? `Renews on ${formatDate(status.current_period_end)} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left).` : "";
        if (status.has_subscription) els.settingsCancelBtn.classList.remove("hidden");
      }
    } else if (status.plan === "trial") {
      const daysLeft = daysUntil(status.trial_ends_at);
      els.settingsCurrentPlan.textContent = "Free trial";
      els.settingsPlanDetail.textContent = daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left.` : "";
    } else {
      els.settingsCurrentPlan.textContent = `${tierLabel} (${status.plan})`;
    }
  } catch {
    els.settingsCurrentPlan.textContent = "Unavailable";
  }
}

async function handleSaveProfileName() {
  els.profileNameError.textContent = "";
  const name = els.profileNameInput.value.trim();
  if (!name) { els.profileNameError.textContent = "Name can't be empty."; return; }

  els.saveProfileNameBtn.disabled = true;
  try {
    await API.put("/auth/profile", { name });
    const user = API.getUser();
    user.name = name;
    API.setUser(user);
    els.userName.textContent = name;
    els.userAvatar.textContent = initials(name);
    toast("Name updated");
  } catch (err) {
    els.profileNameError.textContent = err.message;
  } finally {
    els.saveProfileNameBtn.disabled = false;
  }
}

async function loadWorkspaceCurrency() {
  try {
    const { workspace } = await API.get("/auth/workspace/settings");
    workspaceDefaultCurrency = workspace.default_currency || "USD";
  } catch { /* silent */ }
}

async function loadCurrencySettings() {
  const user = API.getUser();
  if (!user || user.role !== "admin") {
    els.currencySettingsSection.classList.add("hidden");
    return;
  }
  els.currencySettingsSection.classList.remove("hidden");
  try {
    const { workspace } = await API.get("/auth/workspace/settings");
    workspaceDefaultCurrency = workspace.default_currency || "USD";
    els.workspaceCurrencySelect.value = workspaceDefaultCurrency;
  } catch { /* silent */ }
}

async function handleSaveCurrency() {
  els.currencyError.textContent = "";
  const currency = els.workspaceCurrencySelect.value;
  els.saveCurrencyBtn.disabled = true;
  try {
    await API.put("/auth/workspace/currency", { currency });
    toast(`Default currency set to ${currency}`);
  } catch (err) {
    els.currencyError.textContent = err.message;
  } finally {
    els.saveCurrencyBtn.disabled = false;
  }
}

async function loadAiContext() {
  const user = API.getUser();
  const isAdmin = user?.role === "admin";
  els.aiContextSection.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;
  try {
    const { ai_context } = await API.get("/auth/workspace/ai-context");
    els.aiContextInput.value = ai_context || "";
    els.aiContextError.textContent = "";
  } catch { /* non-critical */ }
}

async function handleSaveAiContext() {
  els.aiContextError.textContent = "";
  els.saveAiContextBtn.disabled = true;
  try {
    await API.put("/auth/workspace/ai-context", { ai_context: els.aiContextInput.value.trim() });
    toast("AI context saved");
  } catch (err) {
    els.aiContextError.textContent = err.message;
  } finally {
    els.saveAiContextBtn.disabled = false;
  }
}

async function handleJoinWorkspace() {
  els.joinWorkspaceError.textContent = "";
  const code = els.joinInviteCodeInput.value.trim().toUpperCase();
  if (!code) { els.joinWorkspaceError.textContent = "Enter an invite code."; return; }

  if (!confirm("Joining a new workspace will switch you out of your current one. Continue?")) return;

  els.joinWorkspaceBtn.disabled = true;
  try {
    const { token, user, workspace_name } = await API.post("/auth/join", { invite_code: code });
    API.setToken(token);
    API.setUser(user);
    toast(`Switched to workspace "${workspace_name}" — reloading…`);
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    els.joinWorkspaceError.textContent = err.message;
    els.joinWorkspaceBtn.disabled = false;
  }
}

async function handleSavePassword() {
  els.passwordError.textContent = "";
  const user = API.getUser();
  const newPassword = els.newPasswordInput.value;
  if (newPassword.length < 6) { els.passwordError.textContent = "New password must be at least 6 characters."; return; }

  els.savePasswordBtn.disabled = true;
  try {
    await API.put("/auth/password", {
      current_password: els.currentPasswordInput.value,
      new_password: newPassword,
    });
    user.has_password = true;
    API.setUser(user);
    els.currentPasswordInput.value = "";
    els.newPasswordInput.value = "";
    els.googleOnlyNotice.classList.add("hidden");
    els.currentPasswordField.classList.remove("hidden");
    els.newPasswordLabel.textContent = "New password";
    toast("Password updated");
  } catch (err) {
    els.passwordError.textContent = err.message;
  } finally {
    els.savePasswordBtn.disabled = false;
  }
}

/* ---------- platform (developer) dashboard ---------- */
async function loadPlatformDashboard() {
  try {
    const [overview, { workspaces }, { users: platformUsers }, views] = await Promise.all([
      API.get("/platform/overview"),
      API.get("/platform/workspaces"),
      API.get("/platform/users"),
      API.get("/platform/page-views"),
    ]);

    els.platViewsToday.textContent = views.today;
    els.platViews7d.textContent = views.last_7_days;
    els.platViews30d.textContent = views.last_30_days;
    els.platViewsTotal.textContent = views.all_time;

    els.platTotalWorkspaces.textContent = overview.workspaces.total;
    els.platActive.textContent = overview.workspaces.active;
    els.platTrial.textContent = overview.workspaces.trial;
    els.platMrr.textContent = `$${overview.estimated_mrr.toLocaleString()}`;
    els.platSecondaryStats.textContent =
      `${overview.total_users} total users · ${overview.total_contacts} contacts tracked · ${overview.quotes_sent} quotes sent · ` +
      `${overview.offers_sent} AI offers sent · ${overview.signups_7d} new workspaces this week · ${overview.workspaces.comped} comped`;

    els.platWorkspacesBody.innerHTML = workspaces
      .map(
        (w) => `
      <tr>
        <td class="name-cell" style="--stage-color:var(--accent-1)">${escapeHtml(w.name)}</td>
        <td><span class="quote-status-badge ${w.plan === "active" ? "accepted" : w.plan === "trial" ? "sent" : "declined"}">${w.is_comped ? "comped" : w.plan}</span>${w.is_comped && w.comped_until ? `<div class="muted" style="font-size:10.5px; margin-top:3px;">until ${formatDate(w.comped_until)}</div>` : ""}</td>
        <td class="muted">${escapeHtml(w.tier)}</td>
        <td>${w.user_count}</td>
        <td>${w.contact_count}</td>
        <td class="mono muted">${formatDate(w.created_at)}</td>
        <td>
          ${
            w.is_comped
              ? `<button class="btn btn-sm btn-ghost" data-revoke="${w.id}">Revoke</button>`
              : `<button class="btn btn-sm" data-grant="${w.id}" data-name="${escapeHtml(w.name)}">Grant</button>`
          }
        </td>
      </tr>`
      )
      .join("");

    els.platWorkspacesBody.querySelectorAll("[data-grant]").forEach((btn) => {
      btn.addEventListener("click", () => openGrantModal(btn.dataset.grant, btn.dataset.name));
    });
    els.platWorkspacesBody.querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.addEventListener("click", () => handleRevokeGrant(btn.dataset.revoke, btn));
    });

    els.platUsersBody.innerHTML = platformUsers
      .map(
        (u) => `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td class="mono">${escapeHtml(u.email)}</td>
        <td class="muted">${escapeHtml(u.workspace_name)}</td>
        <td class="muted">${escapeHtml(u.role)}</td>
        <td class="muted">${u.via_google ? "Google" : "Password"}</td>
        <td class="mono muted">${formatDate(u.created_at)}</td>
      </tr>`
      )
      .join("");
  } catch (err) {
    toast(err.message, "error");
  }
}

let grantTargetWorkspaceId = null;

function openGrantModal(workspaceId, workspaceName) {
  grantTargetWorkspaceId = workspaceId;
  els.grantWorkspaceName.textContent = workspaceName;
  els.grantFormError.textContent = "";
  els.grantTierSelect.value = "ultra";
  els.grantDurationSelect.value = "forever";
  els.grantModalOverlay.classList.remove("hidden");
}
function closeGrantModal() {
  els.grantModalOverlay.classList.add("hidden");
  grantTargetWorkspaceId = null;
}

async function handleConfirmGrant() {
  if (!grantTargetWorkspaceId) return;
  els.grantFormError.textContent = "";
  els.confirmGrantBtn.disabled = true;
  try {
    await API.post(`/platform/workspaces/${grantTargetWorkspaceId}/grant`, {
      tier: els.grantTierSelect.value,
      duration: els.grantDurationSelect.value,
    });
    toast("Access granted");
    closeGrantModal();
    loadPlatformDashboard();
  } catch (err) {
    els.grantFormError.textContent = err.message;
  } finally {
    els.confirmGrantBtn.disabled = false;
  }
}

async function handleRevokeGrant(workspaceId, btn) {
  if (!confirm("Revoke this workspace's free access? They'll go back to needing a real subscription.")) return;
  btn.disabled = true;
  try {
    await API.post(`/platform/workspaces/${workspaceId}/revoke`, {});
    toast("Access revoked");
    loadPlatformDashboard();
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
  }
}

async function handlePickTheme(themeKey) {
  applyTheme(themeKey);
  const user = API.getUser();
  if (user) {
    user.theme = themeKey;
    API.setUser(user);
  }
  try {
    await API.put("/auth/theme", { theme: themeKey });
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------- pricing / upgrade modal ---------- */
let pricingBillingMode = "subscription";
let pricingCache = null;

async function openPricingModal() {
  els.pricingModalOverlay.classList.remove("hidden");
  els.pricingGrid.innerHTML = '<p class="muted">Loading plans…</p>';
  try {
    const [{ tiers }, status] = await Promise.all([API.get("/billing/tiers"), API.get("/billing/status")]);
    pricingCache = { tiers, status };
    renderPricingGrid();
  } catch (err) {
    els.pricingGrid.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

function renderPricingGrid() {
  if (!pricingCache) return;
  const { tiers, status } = pricingCache;
  const oneTime = pricingBillingMode === "one_time";

  els.billingModeToggle.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("btn-primary", b.dataset.mode === pricingBillingMode);
    b.classList.toggle("btn-ghost", b.dataset.mode !== pricingBillingMode);
  });

  els.pricingGrid.innerHTML = tiers
    .map((t) => {
      const isCurrent = status.plan === "active" && status.tier === t.key && (oneTime ? status.billing_mode === "one_time" : status.billing_mode !== "one_time");
      const features = [
        t.maxSeats == null ? "Unlimited team members" : `Up to ${t.maxSeats} team member${t.maxSeats === 1 ? "" : "s"}`,
        t.maxContacts == null ? "Unlimited contacts" : `Up to ${t.maxContacts.toLocaleString()} contacts`,
        t.maxAiDraftsPerMonth == null ? "Unlimited AI drafts" : `${t.maxAiDraftsPerMonth.toLocaleString()} AI drafts / month`,
      ];
      return `
        <div class="tier-card ${isCurrent ? "current" : ""}">
          <h3>${escapeHtml(t.label)}</h3>
          <div class="tier-price">$${t.price}<span> ${oneTime ? "one-time" : "/ month"}</span></div>
          <div class="tier-tagline">${escapeHtml(t.tagline)}${oneTime ? " — one month of access, doesn't renew." : ""}</div>
          <ul>
            ${features
              .map(
                (f) =>
                  `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>${escapeHtml(f)}</li>`
              )
              .join("")}
          </ul>
          <button class="btn ${isCurrent ? "btn-ghost" : "btn-primary"} btn-sm" data-tier="${t.key}" ${isCurrent ? "disabled" : ""}>
            ${isCurrent ? "Current plan" : oneTime ? `Buy 1 month of ${escapeHtml(t.label)}` : `Subscribe to ${escapeHtml(t.label)}`}
          </button>
        </div>`;
    })
    .join("");

  els.pricingGrid.querySelectorAll("[data-tier]").forEach((btn) => {
    btn.addEventListener("click", () => handleChooseTier(btn.dataset.tier, btn));
  });
}

function closePricingModal() {
  els.pricingModalOverlay.classList.add("hidden");
}

async function handleChooseTier(tierKey, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Redirecting…";
  try {
    const { url } = await API.post("/billing/checkout", { tier: tierKey, billing_mode: pricingBillingMode });
    window.location.href = url;
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function handleCancelSubscription() {
  if (!confirm("Cancel your subscription? You'll keep access until the end of your current billing period — it just won't renew after that.")) return;
  try {
    const { current_period_end } = await API.post("/billing/cancel", {});
    toast(`Cancelled — access continues until ${formatDate(current_period_end)}.`);
    updateSettingsPlanDisplay();
    loadBillingStatus();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function handleResumeSubscription(btn) {
  const original = btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Resuming…"; }
  try {
    await API.post("/billing/resume", {});
    toast("Subscription resumed — it'll renew as normal.");
    updateSettingsPlanDisplay();
    loadBillingStatus();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

/* ---------- onboarding tour ---------- */
// Each step points at a real element on the dashboard — the tooltip
// floats next to it and a spotlight (a giant box-shadow trick, no extra
// markup needed) dims everything else so the eye goes straight there.
const TOUR_STEPS = [
  {
    target: ".brand",
    title: "Welcome to Klyo",
    body: "A quick tour through everything. Skip any time, and replay this later from the \u2039?\u203a button in the corner.",
  },
  {
    target: "#pipelineView .stat-grid",
    title: "Your pipeline at a glance",
    body: "These update live as contacts move through your stages. The table below lists everyone — click any row to open it.",
  },
  {
    target: "#addContactBtn",
    title: "Adding a contact",
    body: "Name, phone, email, company — and an \u201cOwner\u201d field, which is just whichever teammate is responsible for following up. If it's only you, that's always you.",
  },
  {
    target: '.nav-item[data-view="companies"]',
    title: "Companies",
    body: "Link contacts to a company and mark who's actually a decision-maker (owner, supervisor, whoever signs off). Quotes can then be addressed to exactly the right people.",
  },
  {
    target: '.nav-item[data-view="quotes"]',
    title: "Building a quote",
    body: "A tailored, line-item offer instead of a generic email — products, quantities, per-line discounts, drag to reorder. You'll always see a preview before anything actually sends.",
  },
  {
    target: '.nav-item[data-view="reminders"]',
    title: "Automatic follow-ups",
    body: "Mark a product as needing service every so often, and once a quote for it is accepted, Klyo tracks when it's due again — this tab surfaces it automatically.",
  },
  {
    target: "#offersStatCard",
    title: "AI-drafted offers",
    body: "For quicker outreach: open any contact, jot a key point or two if you like, then hit \u201cGenerate with AI.\u201d Review the draft, edit anything, and send it for real.",
  },
  {
    target: "#appearanceBtn",
    title: "Your settings",
    body: "Update your name or password, and pick a color theme just for you \u2014 it won't change anything for your teammates.",
  },
  {
    target: '.nav-item[data-view="team"]',
    title: "Your team",
    body: "Invite teammates with a code, connect Gmail so offers send from your real address, and — if you're an admin — see everyone's performance under Performance.",
  },
  {
    target: "#helpFab",
    title: "You're set",
    body: "Come back here any time you want this tour again.",
  },
];
let tourStep = 0;
let tourSpotlightEl = null;

function clearSpotlight() {
  if (tourSpotlightEl) {
    tourSpotlightEl.classList.remove("tour-spotlight");
    tourSpotlightEl = null;
  }
}

function startTour() {
  switchView("pipeline"); // guarantees every step's target is actually visible
  tourStep = 0;
  els.tourOverlay.classList.remove("hidden");
  renderTourStep();
}

function renderTourStep() {
  const step = TOUR_STEPS[tourStep];
  els.tourTitle.textContent = step.title;
  els.tourBody.textContent = step.body;
  els.tourDots.innerHTML = TOUR_STEPS.map((_, i) => `<span class="tour-dot ${i === tourStep ? "active" : ""}"></span>`).join("");
  els.tourBackBtn.classList.toggle("hidden", tourStep === 0);
  els.tourNextBtn.textContent = tourStep === TOUR_STEPS.length - 1 ? "Got it" : "Next";

  clearSpotlight();
  const card = document.getElementById("tourModal");
  const target = step.target ? document.querySelector(step.target) : null;

  if (!target) {
    // No anchor available — fall back to a simple centered tooltip.
    card.style.position = "";
    card.style.top = "";
    card.style.left = "";
    return;
  }

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("tour-spotlight");
  tourSpotlightEl = target;

  // Give scrollIntoView a moment to settle before measuring position.
  requestAnimationFrame(() => requestAnimationFrame(() => positionTourCard(target, card)));
}

function positionTourCard(target, card) {
  const margin = 16;
  const targetRect = target.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();

  let top;
  if (targetRect.bottom + margin + cardRect.height < window.innerHeight) {
    top = targetRect.bottom + margin;
  } else if (targetRect.top - margin - cardRect.height > 0) {
    top = targetRect.top - margin - cardRect.height;
  } else {
    top = Math.max(margin, (window.innerHeight - cardRect.height) / 2);
  }

  let left = targetRect.left;
  left = Math.min(left, window.innerWidth - cardRect.width - margin);
  left = Math.max(left, margin);

  card.style.position = "fixed";
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

async function finishTour() {
  els.tourOverlay.classList.add("hidden");
  clearSpotlight();
  const user = API.getUser();
  if (user && !user.has_seen_onboarding) {
    user.has_seen_onboarding = true;
    API.setUser(user);
    try {
      await API.post("/auth/onboarding/complete", {});
    } catch {
      // Not worth bothering the user about — worst case the tour just reappears next login.
    }
  }
}

function handleTourNext() {
  if (tourStep === TOUR_STEPS.length - 1) {
    finishTour();
  } else {
    tourStep += 1;
    renderTourStep();
  }
}
function handleTourBack() {
  if (tourStep > 0) {
    tourStep -= 1;
    renderTourStep();
  }
}

/* ---------- data loaders ---------- */
async function loadTeam() {
  const { team: t } = await API.get("/auth/team");
  team = t;
  populateOwnerOptions(els.filterOwner, { placeholder: t("ui.all_owners") });
  // Populate history + deals user filters
  els.historyUserFilter.innerHTML =
    '<option value="">All team members</option>' +
    team.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  els.dealAssigneeFilter.innerHTML =
    '<option value="">All owners</option>' +
    team.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  els.taskAssigneeFilter.innerHTML =
    '<option value="">All members</option>' +
    team.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  const me = API.getUser();
  const isAdmin = me?.role === "admin";

  els.teamBody.innerHTML = team.map((u) => {
    const isSelf = u.id === me?.id;
    const roleCell = isAdmin && !isSelf
      ? `<select class="team-role-select" data-user-id="${u.id}" style="font-size:12.5px; padding:4px 6px;">
           <option value="viewer"  ${u.role === "viewer"  ? "selected" : ""}>Viewer</option>
           <option value="editor"  ${u.role === "editor"  ? "selected" : ""}>Editor</option>
           <option value="member"  ${u.role === "member"  ? "selected" : ""}>Member</option>
           <option value="admin"   ${u.role === "admin"   ? "selected" : ""}>Admin</option>
         </select>`
      : `<span>${capitalize(u.role)}${isSelf ? " (you)" : ""}</span>`;
    const removeBtn = isAdmin && !isSelf
      ? `<button class="line-remove-btn team-remove-btn" data-user-id="${u.id}" title="Remove from workspace">×</button>`
      : "";
    return `<tr><td>${escapeHtml(u.name)}</td><td class="mono" style="font-size:12.5px;">${escapeHtml(u.email)}</td><td>${roleCell}</td><td>${removeBtn}</td></tr>`;
  }).join("");

  // Wire role selects
  els.teamBody.querySelectorAll(".team-role-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      try {
        await API.put(`/auth/team/${sel.dataset.userId}/role`, { role: sel.value });
        toast("Role updated");
      } catch (err) { toast(err.message, "error"); sel.value = team.find(u => u.id == sel.dataset.userId)?.role || "member"; }
    });
  });

  // Wire remove buttons
  els.teamBody.querySelectorAll(".team-remove-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const u = team.find(x => String(x.id) === btn.dataset.userId);
      if (!u || !confirm(`Remove ${u.name} from this workspace?`)) return;
      try {
        await API.del(`/auth/team/${btn.dataset.userId}`);
        toast(`${u.name} removed`);
        await loadTeam();
      } catch (err) { toast(err.message, "error"); }
    });
  });
}

async function loadThemes() {
  const { themes } = await API.get("/contacts/themes");
  const current = els.filterTheme.value;
  els.filterTheme.innerHTML =
    `<option value="">${t("ui.all_themes")}</option>` + themes.map((th) => `<option value="${escapeHtml(th)}">${escapeHtml(th)}</option>`).join("");
  if (themes.includes(current)) els.filterTheme.value = current;
}

async function loadStats() {
  const s = await API.get("/stats");
  els.statTotal.textContent = s.total;
  els.statLeads.textContent = s.leads;
  els.statNegotiating.textContent = s.negotiating;
  els.statOffers.textContent = s.offersSent;
  renderSparkline(els.sparkTotal, s.series);
}

function renderSparkline(svg, series) {
  const w = 90, h = 28;
  const max = Math.max(1, ...series);
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * (w - 4) + 2;
      const y = h - 4 - (v / max) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  svg.innerHTML = `
    <defs><linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#4fd8ff"/><stop offset="100%" stop-color="#8b6bff"/>
    </linearGradient></defs>
    <polyline points="${points}" fill="none" stroke="url(#sparkGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  `;
}

function buildQuery(f) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString();
}

async function loadContacts() {
  const qs = buildQuery(filters);
  const { contacts } = await API.get(`/contacts${qs ? "?" + qs : ""}`);
  renderContacts(contacts);
  loadAllContactsCache(); // keep pickers (quote builder, company panel) fresh too
}

async function loadAllContactsCache() {
  try {
    const { contacts } = await API.get("/contacts");
    allContactsCache = contacts;
  } catch {
    // non-critical — pickers just won't have fresh data until next successful load
  }
}

function renderContacts(contacts) {
  els.resultCount.textContent = `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`;
  els.emptyState.classList.toggle("hidden", contacts.length !== 0);
  els.contactsTable.classList.toggle("hidden", contacts.length === 0);

  els.contactsBody.innerHTML = contacts
    .map(
      (c) => `
    <tr data-id="${c.id}" style="--stage-color:${stageColorVar(c.status)}">
      <td class="name-cell">${escapeHtml(c.full_name)}</td>
      <td>
        <div class="mono">${escapeHtml(c.email || "—")}</div>
        <div class="mono muted">${escapeHtml(c.phone || "—")}</div>
      </td>
      <td>${escapeHtml(c.company_name || "—")}</td>
      <td>${escapeHtml(c.marketing_theme || "—")}</td>
      <td>${badgeHtml(c.status)}</td>
      <td>${escapeHtml(c.owner_name || "—")}</td>
    </tr>`
    )
    .join("");
}

function populateOwnerOptions(selectEl, { placeholder, selected }) {
  selectEl.innerHTML =
    `<option value="">${placeholder}</option>` + team.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  if (selected !== undefined && selected !== null) selectEl.value = String(selected);
}

/* ---------- view switching ---------- */
function getViewCopy(view) {
  const map = {
    pipeline:  { title: t("nav.pipeline"),  sub: t("view_sub.pipeline") },
    companies: { title: t("nav.companies"), sub: t("view_sub.companies") },
    quotes:    { title: t("nav.quotes"),    sub: t("view_sub.quotes") },
    reminders: { title: t("nav.reminders"),  sub: t("view_sub.reminders") },
    tasks:     { title: t("nav.tasks"),     sub: t("view_sub.tasks") },
    deals:     { title: t("nav.deals"),     sub: t("view_sub.deals") },
    history:   { title: t("nav.history"),   sub: t("view_sub.history") },
    team:      { title: t("nav.team"),      sub: t("view_sub.team") },
    platform:  { title: t("nav.platform"),   sub: t("view_sub.platform") },
  };
  return map[view] || map.pipeline;
}
let currentView = "pipeline";

function switchView(view) {
  document.querySelectorAll(".nav-item[data-view]").forEach((i) => i.classList.toggle("active", i.dataset.view === view));
  els.pipelineView.classList.toggle("hidden", view !== "pipeline");
  els.companiesView.classList.toggle("hidden", view !== "companies");
  els.quotesView.classList.toggle("hidden", view !== "quotes");
  els.remindersView.classList.toggle("hidden", view !== "reminders");
  els.tasksView.classList.toggle("hidden", view !== "tasks");
  els.dealsView.classList.toggle("hidden", view !== "deals");
  els.historyView.classList.toggle("hidden", view !== "history");
  els.teamView.classList.toggle("hidden", view !== "team");
  els.platformView.classList.toggle("hidden", view !== "platform");
  els.searchBoxWrap.style.display = view === "pipeline" ? "" : "none";
  els.addContactBtn.style.display = view === "pipeline" ? "" : "none";

  currentView = view;
  const copy = getViewCopy(view);
  els.viewTitle.textContent = copy.title;
  els.viewSub.textContent = copy.sub;

  if (view === "companies") loadCompanies();
  if (view === "quotes") loadQuotes();
  if (view === "reminders") loadReminders();
  if (view === "team") loadPerformance();
  if (view === "tasks") loadTasks();
  if (view === "deals") loadDeals();
  if (view === "history") loadHistory(true);
  if (view === "platform") loadPlatformDashboard();
}

/* ---------- contact modal ---------- */
function openContactModal(contact) {
  els.contactFormError.textContent = "";
  populateOwnerOptions(els.cOwner, { placeholder: t("common.unassigned"), selected: contact ? contact.owner_id : API.getUser()?.id });
  populateCompanySelect();

  if (contact) {
    els.contactModalTitle.textContent = t("modal.edit_contact");
    els.contactSubmitBtn.textContent = t("modal.save_changes");
    els.contactId.value = contact.id;
    els.cFirstName.value = contact.first_name || (contact.full_name ? contact.full_name.split(" ")[0] : "");
    els.cLastName.value = contact.last_name || (contact.full_name && contact.full_name.includes(" ") ? contact.full_name.split(" ").slice(1).join(" ") : "");
    els.cEmail.value = contact.email || "";
    els.cPhone.value = contact.phone || "";
    els.cCompanySelect.value = contact.company_id || "";
    els.cTitle.value = contact.title || "";
    els.cDecisionMaker.checked = Boolean(contact.is_decision_maker);
    els.cTheme.value = contact.marketing_theme || "";
    els.cStatus.value = contact.status || "lead";
    els.cNotes.value = contact.notes || "";
  } else {
    els.contactModalTitle.textContent = t("modal.add_contact");
    els.contactSubmitBtn.textContent = t("modal.add_contact");
    els.contactForm.reset();
    els.contactId.value = "";
    els.cStatus.value = "lead";
  }
  els.contactModalOverlay.classList.remove("hidden");
}
function closeContactModal() { els.contactModalOverlay.classList.add("hidden"); }

async function handleContactSubmit(e) {
  e.preventDefault();
  els.contactFormError.textContent = "";

  const firstName = els.cFirstName.value.trim();
  const lastName = els.cLastName.value.trim();
  if (!firstName) { els.contactFormError.textContent = "First name is required."; return; }

  const payload = {
    first_name: firstName,
    last_name: lastName || null,
    full_name: [firstName, lastName].filter(Boolean).join(" "),
    email: els.cEmail.value.trim(),
    phone: els.cPhone.value.trim(),
    company_id: els.cCompanySelect.value ? Number(els.cCompanySelect.value) : null,
    title: els.cTitle.value.trim(),
    is_decision_maker: els.cDecisionMaker.checked,
    marketing_theme: els.cTheme.value.trim(),
    status: els.cStatus.value,
    notes: els.cNotes.value.trim(),
    owner_id: els.cOwner.value ? Number(els.cOwner.value) : null,
  };

  const id = els.contactId.value;
  els.contactSubmitBtn.disabled = true;
  try {
    if (id) await API.put(`/contacts/${id}`, payload);
    else await API.post("/contacts", payload);

    closeContactModal();
    toast(id ? "Contact updated" : "Contact added");
    await Promise.all([loadContacts(), loadStats(), loadThemes()]);
    if (id && currentPanelContactId === Number(id)) openPanel(id);
  } catch (err) {
    showLimitOrError(err, els.contactFormError);
  } finally {
    els.contactSubmitBtn.disabled = false;
  }
}

/* ---------- contact detail panel + AI composer ---------- */
async function openPanel(id) {
  const { contact, activity, offers, quotes } = await API.get(`/contacts/${id}`);
  currentPanelContactId = contact.id;
  currentPanelContact = contact;

  els.panelName.textContent = contact.full_name;
  els.panelSub.textContent = [contact.company_name, contact.owner_name ? `Owner: ${contact.owner_name}` : null].filter(Boolean).join(" · ") || "No company on file";
  els.panelBadge.innerHTML = badgeHtml(contact.status);
  els.panelEmail.textContent = contact.email || "—";
  els.panelPhone.textContent = contact.phone || "—";
  els.panelCompany.textContent = contact.company_name
    ? `${contact.company_name}${contact.title ? ` (${contact.title})` : ""}${contact.is_decision_maker ? " ★" : ""}`
    : "—";
  els.panelTheme.textContent = contact.marketing_theme || "—";
  els.panelCreated.textContent = formatDate(contact.created_at);

  if (contact.notes) {
    els.panelNotesWrap.classList.remove("hidden");
    els.panelNotes.textContent = contact.notes;
  } else {
    els.panelNotesWrap.classList.add("hidden");
  }

  renderPanelQuotes(quotes || []);

  els.offerInstructions.value = "";
  const latestDraft = offers.find((o) => o.status === "draft");
  if (latestDraft) {
    els.draftSubject.value = latestDraft.subject;
    els.draftBody.value = latestDraft.body;
    els.draftBox.classList.add("show");
    currentDraftOfferId = latestDraft.id;
  } else {
    els.draftSubject.value = "";
    els.draftBody.value = "";
    els.draftBox.classList.remove("show");
    currentDraftOfferId = null;
  }
  els.generateOfferBtn.disabled = false;
  els.generateOfferBtn.classList.remove("loading");
  els.generateOfferBtn.textContent = "Generate with AI";

  loadContactTimeline(id);
  els.panelOverlay.classList.remove("hidden");
}

function renderPanelQuotes(quotes) {
  els.panelQuotesList.innerHTML = quotes.length
    ? quotes
        .map(
          (q) => `
    <div class="detail-item" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" data-quote-id="${q.id}">
      <span>${escapeHtml(q.title)}</span>
      <span style="display:flex; align-items:center; gap:8px;">
        <span class="mono">$${Number(q.total).toFixed(2)}</span>
        <span class="quote-status-badge ${q.status}">${q.status}</span>
      </span>
    </div>`
        )
        .join("")
    : '<p class="muted" style="font-size:13px;">No quotes for this contact yet.</p>';

  els.panelQuotesList.querySelectorAll("[data-quote-id]").forEach((row) => {
    row.addEventListener("click", () => openQuotePanel(row.dataset.quoteId));
  });
}

function closePanel() {
  els.panelOverlay.classList.add("hidden");
  currentPanelContactId = null;
  currentPanelContact = null;
  currentDraftOfferId = null;
}

async function loadContactTimeline(contactId) {
  els.panelTimeline.innerHTML = '<p class="muted" style="font-size:12.5px; padding:8px 0;">Loading…</p>';
  try {
    const { events } = await API.get(`/contacts/${contactId}/timeline`);
    renderTimeline(events);
  } catch {
    renderTimeline([]);
  }
}

function timelineIcon(kind, type) {
  if (kind === "offer")    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
  if (kind === "quote")    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>`;
  if (kind === "deal")     return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2l3 6.5L22 9.3l-5 4.9 1.2 6.8L12 17.8l-6.2 3.2L7 14.2 2 9.3l7-.8z"/></svg>`;
  if (type === "call_logged")    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 16.9v3a2 2 0 01-2.18 2A19.8 19.8 0 013.1 4.18 2 2 0 015.09 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L9.09 9.91a16 16 0 006.99 7l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.9z"/></svg>`;
  if (type === "meeting_logged") return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;
}

function timelineLabel(ev) {
  if (ev.kind === "offer") {
    const status = ev.status === "sent" ? "Offer sent" : ev.status === "draft" ? "Offer drafted" : `Offer (${ev.status})`;
    return `${status}${ev.subject ? ` — <em>${escapeHtml(ev.subject)}</em>` : ""}`;
  }
  if (ev.kind === "quote") {
    const status = ev.status === "sent" ? "Quote sent" : ev.status === "accepted" ? "Quote accepted ✓" : ev.status === "declined" ? "Quote declined" : `Quote (${ev.status})`;
    const val = ev.total ? ` · ${ev.currency || ""} ${Number(ev.total).toFixed(2)}` : "";
    return `${status}${ev.title ? ` — <em>${escapeHtml(ev.title)}</em>` : ""}${val}`;
  }
  if (ev.kind === "deal") {
    return `Deal created — <em>${escapeHtml(ev.title)}</em>${ev.value ? ` · ${ev.currency || ""} ${Number(ev.value).toFixed(0)}` : ""}`;
  }
  return escapeHtml(ev.description || "");
}

function renderTimeline(events) {
  const panelEmpty = document.getElementById("panelTimelineEmpty");
  if (!events.length) {
    els.panelTimeline.innerHTML = "";
    if (panelEmpty) panelEmpty.classList.remove("hidden");
    return;
  }
  if (panelEmpty) panelEmpty.classList.add("hidden");
  els.panelTimeline.innerHTML = events.map(ev => {
    const actor = ev.actor ? `<span class="muted" style="font-size:11px; margin-left:4px;">by ${escapeHtml(ev.actor)}</span>` : "";
    return `<div class="timeline-item">
      <div class="timeline-dot" style="display:flex; align-items:center; justify-content:center; color:var(--accent-1);">${timelineIcon(ev.kind, ev.type)}</div>
      <div class="timeline-body">
        <p>${timelineLabel(ev)}${actor}</p>
        <time>${formatDateTime(ev.date)}</time>
      </div>
    </div>`;
  }).join("");
}

function prependTimelineEntry(text) {
  const panelEmpty = document.getElementById("panelTimelineEmpty");
  if (panelEmpty) panelEmpty.classList.add("hidden");
  const div = document.createElement("div");
  div.className = "timeline-item";
  div.innerHTML = `<div class="timeline-dot"></div><div class="timeline-body"><p>${escapeHtml(text)}</p><time>${formatDateTime(new Date().toISOString())}</time></div>`;
  els.panelTimeline.prepend(div);
}

async function handleGenerateOffer() {
  if (!currentPanelContactId) return;
  els.generateOfferBtn.disabled = true;
  els.generateOfferBtn.classList.add("loading");
  els.generateOfferBtn.textContent = "Generating…";
  try {
    const { offer } = await API.post(`/contacts/${currentPanelContactId}/offers/generate`, {
      instructions: els.offerInstructions.value.trim(),
    });
    els.draftSubject.value = offer.subject;
    els.draftBody.value = offer.body;
    els.draftBox.classList.add("show");
    currentDraftOfferId = offer.id;
    prependTimelineEntry(`${API.getUser().name} drafted an offer with AI.`);
    toast("Draft ready — review before sending.");
  } catch (err) {
    showLimitOrError(err);
  } finally {
    els.generateOfferBtn.disabled = false;
    els.generateOfferBtn.classList.remove("loading");
    els.generateOfferBtn.textContent = "Generate with AI";
  }
}

async function handleSendOffer() {
  if (!currentDraftOfferId) { toast("Generate a draft first.", "error"); return; }
  if (!currentPanelContact?.email) { toast("This contact has no email address on file.", "error"); return; }

  els.sendOfferBtn.disabled = true;
  els.sendOfferBtn.textContent = "Sending…";
  try {
    const { offer } = await API.post(`/offers/${currentDraftOfferId}/send`, {
      subject: els.draftSubject.value,
      body: els.draftBody.value,
    });
    toast(`Offer sent to ${currentPanelContact.email}`);
    els.draftBox.classList.remove("show");
    currentDraftOfferId = null;
    if (currentPanelContactId) loadContactTimeline(currentPanelContactId);
    loadStats();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    els.sendOfferBtn.disabled = false;
    els.sendOfferBtn.innerHTML = SEND_BTN_HTML;
  }
}

function handleDiscardDraft() {
  els.draftBox.classList.remove("show");
  els.draftSubject.value = "";
  els.draftBody.value = "";
  currentDraftOfferId = null;
}

async function handleDeleteContact() {
  if (!currentPanelContact) return;
  if (!confirm(`Delete ${currentPanelContact.full_name}? This can't be undone.`)) return;
  try {
    await API.del(`/contacts/${currentPanelContact.id}`);
    closePanel();
    toast("Contact deleted");
    await Promise.all([loadContacts(), loadStats(), loadThemes()]);
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------- wire everything up ---------- */
/* ---------- companies ---------- */
async function loadCompanies() {
  const search = els.companySearchInput ? els.companySearchInput.value.trim() : "";
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const { companies: list } = await API.get(`/companies${qs}`);
  companies = list;
  renderCompaniesTable(list);
  populateCompanySelect();
}

function renderCompaniesTable(list) {
  els.companiesEmptyState.classList.toggle("hidden", list.length !== 0);
  els.companiesBody.innerHTML = list
    .map(
      (c) => `
    <tr data-id="${c.id}">
      <td class="name-cell" style="--stage-color:var(--accent-1)">${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.industry || "—")}</td>
      <td>${c.contact_count} ${t("nav.contacts").toLowerCase()}</td>
    </tr>`
    )
    .join("");
}

function populateCompanySelect() {
  if (!els.cCompanySelect) return;
  const current = els.cCompanySelect.value;
  els.cCompanySelect.innerHTML =
    `<option value="">${t("common.none")}</option>` +
    companies.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") +
    '<option value="__new__">+ New company…</option>';
  if (current) els.cCompanySelect.value = current;
}

function openCompanyModal(company) {
  els.companyFormError.textContent = "";
  if (company) {
    els.companyModalTitle.textContent = t("modal.edit_company");
    els.companySubmitBtn.textContent = t("modal.save_changes");
    els.companyId.value = company.id;
    els.coName.value = company.name || "";
    els.coIndustry.value = company.industry || "";
    els.coNotes.value = company.notes || "";
  } else {
    els.companyModalTitle.textContent = t("modal.add_company");
    els.companySubmitBtn.textContent = t("modal.add_company");
    els.companyForm.reset();
    els.companyId.value = "";
  }
  els.companyModalOverlay.classList.remove("hidden");
}
function closeCompanyModal() { els.companyModalOverlay.classList.add("hidden"); }

async function handleCompanySubmit(e) {
  e.preventDefault();
  els.companyFormError.textContent = "";
  const payload = { name: els.coName.value.trim(), industry: els.coIndustry.value.trim(), notes: els.coNotes.value.trim() };
  if (!payload.name) { els.companyFormError.textContent = "Company name is required."; return; }

  const id = els.companyId.value;
  els.companySubmitBtn.disabled = true;
  try {
    if (id) await API.put(`/companies/${id}`, payload);
    else await API.post("/companies", payload);
    closeCompanyModal();
    toast(id ? "Company updated" : "Company added");
    await loadCompanies();
    if (id && currentCompanyPanelId === Number(id)) openCompanyPanel(id);
  } catch (err) {
    els.companyFormError.textContent = err.message;
  } finally {
    els.companySubmitBtn.disabled = false;
  }
}

async function openCompanyPanel(id) {
  const { company, contacts: people } = await API.get(`/companies/${id}`);
  currentCompanyPanelId = company.id;
  els.companyPanelName.textContent = company.name;
  els.companyPanelIndustry.textContent = company.industry || "No industry set";
  if (company.notes) {
    els.companyPanelNotesWrap.classList.remove("hidden");
    els.companyPanelNotes.textContent = company.notes;
  } else {
    els.companyPanelNotesWrap.classList.add("hidden");
  }
  els.companyContactsBody.innerHTML = people.length
    ? people
        .map(
          (p) => `<tr><td>${escapeHtml(p.full_name)}</td><td>${escapeHtml(p.title || "—")}</td><td>${p.is_decision_maker ? "✓" : ""}</td></tr>`
        )
        .join("")
    : '<tr><td colspan="3" class="muted">No contacts linked to this company yet.</td></tr>';
  els.companyPanelOverlay.classList.remove("hidden");
}
function closeCompanyPanel() { els.companyPanelOverlay.classList.add("hidden"); currentCompanyPanelId = null; }

async function handleDeleteCompany() {
  if (!currentCompanyPanelId) return;
  if (!confirm("Delete this company? Linked contacts stay, they just lose the company link.")) return;
  try {
    await API.del(`/companies/${currentCompanyPanelId}`);
    closeCompanyPanel();
    toast("Company deleted");
    loadCompanies();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------- products / catalog ---------- */
async function loadProducts() {
  const { products: list } = await API.get("/products");
  products = list;
  if (!els.productsModalOverlay.classList.contains("hidden")) renderProductsList();
}

function renderProductsList() {
  const filterText = (els.productCategoryFilter?.value || "").toLowerCase().trim();
  const visible = filterText
    ? products.filter(p => (p.category || "").toLowerCase().includes(filterText) || p.name.toLowerCase().includes(filterText))
    : products;

  if (els.productsCount) els.productsCount.textContent = `${visible.length} item${visible.length === 1 ? "" : "s"}`;

  els.productsList.innerHTML = visible.length
    ? visible.map(p => `
    <div class="product-row">
      <span style="font-weight:500;">${escapeHtml(p.name)}${p.description ? `<div class="muted" style="font-size:11px;">${escapeHtml(p.description)}</div>` : ""}</span>
      <span class="mono" style="font-size:12.5px;">$${Number(p.unit_price).toFixed(2)}</span>
      <span class="muted" style="font-size:12px;">${escapeHtml(p.unit_label)}</span>
      <span class="muted" style="font-size:12px;">${p.service_interval_months ? `every ${p.service_interval_months}mo` : "—"}</span>
      <span>${p.category ? `<span class="product-cat-badge">${escapeHtml(p.category)}</span>` : ""}</span>
      <button class="line-remove-btn" data-dup-id="${p.id}" title="Duplicate" style="font-size:15px; opacity:.6;">⎘</button>
      <button class="line-remove-btn" data-product-id="${p.id}" title="Delete">×</button>
    </div>`).join("")
    : '<p class="muted" style="font-size:13px;">No products yet — add your first one below.</p>';

  els.productsList.querySelectorAll("[data-product-id]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteProduct(btn.dataset.productId));
  });
  els.productsList.querySelectorAll("[data-dup-id]").forEach((btn) => {
    btn.addEventListener("click", () => handleDuplicateProduct(btn.dataset.dupId));
  });
}

function openProductsModal() {
  els.productsModalOverlay.classList.remove("hidden");
  renderProductsList();
}
function closeProductsModal() { els.productsModalOverlay.classList.add("hidden"); }

async function handleAddProduct() {
  els.productFormError.textContent = "";
  const name = els.newProductName.value.trim();
  if (!name) { els.productFormError.textContent = "Give the product a name."; return; }

  try {
    await API.post("/products", {
      name,
      unit_price: els.newProductPrice.value,
      unit_label: els.newProductUnit.value.trim() || "unit",
      service_interval_months: els.newProductInterval.value || null,
      category: els.newProductCategory?.value.trim() || null,
    });
    els.newProductName.value = "";
    els.newProductPrice.value = "";
    els.newProductUnit.value = "";
    els.newProductInterval.value = "";
    if (els.newProductCategory) els.newProductCategory.value = "";
    await loadProducts();
    renderProductsList();
    populateLineItemProductOptions();
    toast("Product added");
  } catch (err) {
    els.productFormError.textContent = err.message;
  }
}

async function handleDuplicateProduct(id) {
  try {
    await API.post(`/products/${id}/duplicate`, {});
    await loadProducts();
    renderProductsList();
    populateLineItemProductOptions();
    toast("Product duplicated");
  } catch (err) { toast(err.message, "error"); }
}

async function handleDeleteProduct(id) {
  if (!confirm("Delete this product from the catalog?")) return;
  try {
    await API.del(`/products/${id}`);
    await loadProducts();
    renderProductsList();
    populateLineItemProductOptions();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------- quote builder ---------- */
function openQuoteModal(prefill) {
  els.quoteFormError.textContent = "";
  els.quoteId.value = "";
  els.quoteModalTitle.textContent = t("modal.new_quote");
  els.quoteSendBtn.textContent = t("panel.save_preview");
  currentQuoteLineItems = [];
  currentQuotePrefillContactId = prefill?.contactId || null;

  populateQuoteContactSelect();
  if (currentQuotePrefillContactId) {
    els.quoteContactSelect.value = String(currentQuotePrefillContactId);
    els.quoteContactSelect.disabled = true;
  } else {
    els.quoteContactSelect.disabled = false;
  }
  els.quoteTitleInput.value = "";
  els.quoteIntroInput.value = "";
  handleQuoteContactChange();

  if (prefill?.lineItem) {
    currentQuoteLineItems = [{ ...prefill.lineItem }];
  } else {
    currentQuoteLineItems = [{ product_id: "", description: "", quantity: 1, unit_price: 0, discount_percent: 0 }];
  }
  renderQuoteLineItems();
  els.quoteModalOverlay.classList.remove("hidden");
}
function closeQuoteModal() { els.quoteModalOverlay.classList.add("hidden"); }

function populateQuoteContactSelect() {
  els.quoteContactSelect.innerHTML =
    '<option value="">Choose a contact…</option>' +
    allContactsCache.map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)}${c.company_name ? ` (${escapeHtml(c.company_name)})` : ""}</option>`).join("");
}

function handleQuoteContactChange() {
  const contactId = Number(els.quoteContactSelect.value) || null;
  const contact = allContactsCache.find((c) => c.id === contactId);

  if (!contact || !contact.company_id) {
    els.quoteRecipientsField.classList.add("hidden");
    els.quoteRecipientsList.innerHTML = "";
    return;
  }

  const colleagues = allContactsCache.filter((c) => c.company_id === contact.company_id);
  if (colleagues.length <= 1) {
    els.quoteRecipientsField.classList.add("hidden");
    els.quoteRecipientsList.innerHTML = "";
    return;
  }

  els.quoteRecipientsField.classList.remove("hidden");
  els.quoteRecipientsList.innerHTML = colleagues
    .map(
      (c) => `
    <label class="recipient-option">
      <input type="checkbox" value="${c.id}" ${c.id === contactId || c.is_decision_maker ? "checked" : ""} style="width:auto;" />
      ${escapeHtml(c.full_name)}${c.title ? ` — ${escapeHtml(c.title)}` : ""}
      ${c.is_decision_maker ? '<span class="badge customer" style="transform:scale(0.8);">Decision-maker</span>' : ""}
    </label>`
    )
    .join("");
}

function populateLineItemProductOptions() {
  els.quoteItemsContainer.querySelectorAll(".line-product-select").forEach((select) => {
    const current = select.value;
    select.innerHTML =
      '<option value="">Custom item</option>' + products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    if (current) select.value = current;
  });
}

function renderQuoteLineItems() {
  els.quoteItemsContainer.innerHTML = "";
  currentQuoteLineItems.forEach((item, index) => {
    els.quoteItemsContainer.appendChild(buildLineItemRow(item, index));
  });
  recomputeQuoteTotals();
}

function buildLineItemRow(item, index) {
  const row = document.createElement("div");
  row.className = "quote-line-row";
  row.draggable = true;
  row.dataset.index = index;

  row.innerHTML = `
    <span class="drag-handle">⠿</span>
    <select class="line-product-select">
      <option value="">Custom item</option>
      ${products.map((p) => `<option value="${p.id}" ${String(p.id) === String(item.product_id) ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
    </select>
    <input class="line-desc-input" type="text" placeholder="Description" value="${escapeHtml(item.description || "")}" />
    <input class="line-qty-input" type="number" min="0" step="1" value="${item.quantity ?? 1}" />
    <input class="line-price-input" type="number" min="0" step="0.01" value="${item.unit_price ?? 0}" />
    <input class="line-discount-input" type="number" min="0" max="100" step="1" value="${item.discount_percent ?? 0}" />
    <span class="line-total-display mono">$0.00</span>
    <button type="button" class="line-remove-btn" title="Remove">×</button>
  `;

  const productSelect = row.querySelector(".line-product-select");
  const descInput = row.querySelector(".line-desc-input");
  const qtyInput = row.querySelector(".line-qty-input");
  const priceInput = row.querySelector(".line-price-input");
  const discountInput = row.querySelector(".line-discount-input");

  productSelect.addEventListener("change", () => {
    const product = products.find((p) => String(p.id) === productSelect.value);
    currentQuoteLineItems[index].product_id = productSelect.value || null;
    if (product) {
      currentQuoteLineItems[index].description = product.name;
      currentQuoteLineItems[index].unit_price = Number(product.unit_price);
      descInput.value = product.name;
      priceInput.value = product.unit_price;
    }
    recomputeQuoteTotals();
  });
  descInput.addEventListener("input", () => { currentQuoteLineItems[index].description = descInput.value; });
  qtyInput.addEventListener("input", () => { currentQuoteLineItems[index].quantity = qtyInput.value; recomputeQuoteTotals(); });
  priceInput.addEventListener("input", () => { currentQuoteLineItems[index].unit_price = priceInput.value; recomputeQuoteTotals(); });
  discountInput.addEventListener("input", () => { currentQuoteLineItems[index].discount_percent = discountInput.value; recomputeQuoteTotals(); });
  row.querySelector(".line-remove-btn").addEventListener("click", () => {
    currentQuoteLineItems.splice(index, 1);
    if (!currentQuoteLineItems.length) currentQuoteLineItems.push({ product_id: "", description: "", quantity: 1, unit_price: 0, discount_percent: 0 });
    renderQuoteLineItems();
  });

  row.addEventListener("dragstart", () => { draggedLineIndex = index; row.classList.add("dragging"); });
  row.addEventListener("dragend", () => { row.classList.remove("dragging"); });
  row.addEventListener("dragover", (e) => e.preventDefault());
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    if (draggedLineIndex === null || draggedLineIndex === index) return;
    const [moved] = currentQuoteLineItems.splice(draggedLineIndex, 1);
    currentQuoteLineItems.splice(index, 0, moved);
    draggedLineIndex = null;
    renderQuoteLineItems();
  });

  return row;
}

function recomputeQuoteTotals() {
  let subtotal = 0;
  let total = 0;
  els.quoteItemsContainer.querySelectorAll(".quote-line-row").forEach((row, index) => {
    const item = currentQuoteLineItems[index];
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const discount = Math.min(100, Math.max(0, Number(item.discount_percent) || 0));
    const gross = qty * price;
    const lineTotal = gross * (1 - discount / 100);
    subtotal += gross;
    total += lineTotal;
    row.querySelector(".line-total-display").textContent = `$${lineTotal.toFixed(2)}`;
  });
  els.quoteSubtotalValue.textContent = `$${subtotal.toFixed(2)}`;
  els.quoteDiscountValue.textContent = `−$${(subtotal - total).toFixed(2)}`;
  els.quoteTotalValue.textContent = `$${total.toFixed(2)}`;
}

function collectQuoteRecipientIds() {
  return Array.from(els.quoteRecipientsList.querySelectorAll("input:checked")).map((i) => Number(i.value));
}

let quotePendingSendId = null;

async function saveQuote(alsoSend) {
  els.quoteFormError.textContent = "";
  const contactId = Number(els.quoteContactSelect.value) || currentQuotePrefillContactId;
  if (!contactId) { els.quoteFormError.textContent = "Pick who this quote is for."; return; }
  if (!currentQuoteLineItems.length) { els.quoteFormError.textContent = "Add at least one line item."; return; }

  const contact = allContactsCache.find((c) => c.id === contactId);
  const payload = {
    contact_id: contactId,
    company_id: contact?.company_id || null,
    title: els.quoteTitleInput.value.trim() || "Quote",
    intro_message: els.quoteIntroInput.value.trim(),
    currency: workspaceDefaultCurrency,
    line_items: currentQuoteLineItems,
    recipient_ids: els.quoteRecipientsField.classList.contains("hidden") ? [] : collectQuoteRecipientIds(),
  };

  const id = els.quoteId.value;
  els.quoteSendBtn.disabled = true;
  els.quoteSaveDraftBtn.disabled = true;
  try {
    let quoteId = id;
    if (id) {
      await API.put(`/quotes/${id}`, payload);
    } else {
      const created = await API.post("/quotes", payload);
      quoteId = created.quote.id;
    }

    if (alsoSend) {
      await openQuoteSendPreview(quoteId);
    } else {
      closeQuoteModal();
      toast("Draft saved");
    }
    loadQuotes();
    if (currentPanelContactId === contactId) openPanel(contactId);
  } catch (err) {
    els.quoteFormError.textContent = err.message;
  } finally {
    els.quoteSendBtn.disabled = false;
    els.quoteSaveDraftBtn.disabled = false;
  }
}

/* ---------- quote send preview — nothing sends until confirmed here ---------- */
async function openQuoteSendPreview(quoteId) {
  els.quotePreviewError.textContent = "";
  try {
    const email = await API.get(`/quotes/${quoteId}/preview`);
    quotePendingSendId = quoteId;
    els.quotePreviewTo.textContent = email.toNames && email.toNames.length ? `${email.toNames.join(", ")} (${email.to.join(", ")})` : email.to.join(", ");
    els.quotePreviewSubject.value = email.subject;
    els.quotePreviewBody.value = email.body;
    closeQuoteModal();
    els.quotePreviewOverlay.classList.remove("hidden");
  } catch (err) {
    toast(err.message, "error");
  }
}
function closeQuotePreview() { els.quotePreviewOverlay.classList.add("hidden"); quotePendingSendId = null; }

function backToEditFromPreview() {
  closeQuotePreview();
  els.quoteModalOverlay.classList.remove("hidden");
}

async function confirmSendQuote() {
  if (!quotePendingSendId) return;
  els.quotePreviewError.textContent = "";
  els.confirmSendQuoteBtn.disabled = true;
  try {
    await API.post(`/quotes/${quotePendingSendId}/send`, {
      subject: els.quotePreviewSubject.value,
      body: els.quotePreviewBody.value,
    });
    closeQuotePreview();
    toast("Quote sent");
    loadQuotes();
  } catch (err) {
    els.quotePreviewError.textContent = err.message;
  } finally {
    els.confirmSendQuoteBtn.disabled = false;
  }
}

/* ---------- quotes list + detail panel ---------- */
async function loadQuotes() {
  const status = els.quoteStatusFilter.value;
  const qs = status ? `?status=${status}` : "";
  const { quotes } = await API.get(`/quotes${qs}`);
  renderQuotesTable(quotes);
}

function renderQuotesTable(quotes) {
  els.quotesEmptyState.classList.toggle("hidden", quotes.length !== 0);
  els.quotesBody.innerHTML = quotes
    .map(
      (q) => `
    <tr data-id="${q.id}">
      <td class="name-cell" style="--stage-color:var(--accent-1)">${escapeHtml(q.title)}</td>
      <td>${escapeHtml(q.contact_name)}${q.company_name ? ` <span class="muted">· ${escapeHtml(q.company_name)}</span>` : ""}</td>
      <td class="mono">$${Number(q.total).toFixed(2)}</td>
      <td><span class="quote-status-badge ${q.status}">${t("ui.status_" + q.status) || q.status}</span></td>
      <td class="muted mono">${formatDate(q.updated_at)}</td>
    </tr>`
    )
    .join("");
}

async function openQuotePanel(id) {
  const { quote, lineItems } = await API.get(`/quotes/${id}`);
  els.quotePanelTitle.textContent = quote.title;
  els.quotePanelFor.textContent = quote.company_name ? `${quote.contact_name} · ${quote.company_name}` : quote.contact_name;
  els.quotePanelBadge.innerHTML = `<span class="quote-status-badge ${quote.status}">${t("ui.status_" + quote.status) || quote.status}</span>`;
  els.quotePanelItems.innerHTML = lineItems
    .map((i) => `<div style="display:flex; justify-content:space-between;"><span>${escapeHtml(i.description)} <span class="muted">x${i.quantity}</span></span><span class="mono">$${Number(i.line_total).toFixed(2)}</span></div>`)
    .join("");
  els.quotePanelTotal.textContent = `$${Number(quote.total).toFixed(2)}`;
  els.quotePanelOverlay.dataset.quoteId = quote.id;

  // Print / PDF link
  const printLink = document.getElementById("quotePrintLink");
  if (printLink) {
    printLink.href = quote.public_token ? `/q/${quote.public_token}` : "#";
    printLink.style.display = quote.public_token ? "" : "none";
  }

  const isDraft = quote.status === "draft";
  const isSent = quote.status === "sent";
  els.editQuoteBtn.classList.toggle("hidden", !isDraft);
  els.sendQuoteFromPanelBtn.classList.toggle("hidden", !isDraft);
  els.acceptQuoteBtn.classList.toggle("hidden", !isSent);
  els.declineQuoteBtn.classList.toggle("hidden", !isSent);

  els.quotePanelOverlay.classList.remove("hidden");
}
function closeQuotePanel() { els.quotePanelOverlay.classList.add("hidden"); }

async function handleSendQuoteFromPanel() {
  const id = els.quotePanelOverlay.dataset.quoteId;
  closeQuotePanel();
  await openQuoteSendPreview(id);
}
async function handleAcceptQuote() {
  const id = els.quotePanelOverlay.dataset.quoteId;
  try {
    await API.post(`/quotes/${id}/accept`, {});
    toast("Quote marked accepted — purchase recorded for future reminders.");
    closeQuotePanel();
    loadQuotes();
  } catch (err) {
    toast(err.message, "error");
  }
}
async function handleDeclineQuote() {
  const id = els.quotePanelOverlay.dataset.quoteId;
  try {
    await API.post(`/quotes/${id}/decline`, {});
    toast("Quote marked declined");
    closeQuotePanel();
    loadQuotes();
  } catch (err) {
    toast(err.message, "error");
  }
}
async function handleDeleteQuote() {
  const id = els.quotePanelOverlay.dataset.quoteId;
  if (!confirm("Delete this quote?")) return;
  try {
    await API.del(`/quotes/${id}`);
    toast("Quote deleted");
    closeQuotePanel();
    loadQuotes();
  } catch (err) {
    toast(err.message, "error");
  }
}
async function handleEditQuoteFromPanel() {
  const id = els.quotePanelOverlay.dataset.quoteId;
  const { quote, lineItems, recipients } = await API.get(`/quotes/${id}`);
  closeQuotePanel();

  els.quoteFormError.textContent = "";
  els.quoteId.value = quote.id;
  els.quoteModalTitle.textContent = t("modal.edit_quote");
  els.quoteSendBtn.textContent = t("panel.save_preview");
  currentQuotePrefillContactId = quote.contact_id;
  populateQuoteContactSelect();
  els.quoteContactSelect.value = String(quote.contact_id);
  els.quoteContactSelect.disabled = true;
  els.quoteTitleInput.value = quote.title;
  els.quoteIntroInput.value = quote.intro_message || "";
  handleQuoteContactChange();
  // handleQuoteContactChange() above pre-checks decision-makers as a sensible
  // default for a brand-new quote — but this is an existing quote, so clear
  // that guess first and apply exactly what was actually saved.
  els.quoteRecipientsList.querySelectorAll("input").forEach((box) => { box.checked = false; });
  recipients.forEach((r) => {
    const box = els.quoteRecipientsList.querySelector(`input[value="${r.id}"]`);
    if (box) box.checked = true;
  });
  currentQuoteLineItems = lineItems.map((i) => ({
    product_id: i.product_id, description: i.description, quantity: i.quantity, unit_price: i.unit_price, discount_percent: i.discount_percent,
  }));
  renderQuoteLineItems();
  els.quoteModalOverlay.classList.remove("hidden");
}

/* ---------- reminders ---------- */
async function loadReminders() {
  const { reminders } = await API.get("/reminders/due");
  els.remindersEmptyState.classList.toggle("hidden", reminders.length !== 0);
  els.remindersBody.innerHTML = reminders
    .map(
      (r) => `
    <tr>
      <td class="name-cell" style="--stage-color:var(--negotiating)">${escapeHtml(r.contact_name)}</td>
      <td>${escapeHtml(r.product_name || r.description)}</td>
      <td class="mono muted">${formatDate(r.purchased_at)}</td>
      <td class="mono">${formatDate(r.next_service_due_at)}</td>
      <td style="display:flex; gap:6px;">
        <button class="btn btn-sm" data-send-reminder="${r.id}">${t("common.send")}</button>
        <button class="btn btn-sm btn-ghost" data-quote-for-reminder="${r.contact_id}" data-product="${r.product_id || ""}" data-desc="${escapeHtml(r.product_name || r.description)}">${t("ui.build_quote")}</button>
      </td>
    </tr>`
    )
    .join("");

  els.remindersBody.querySelectorAll("[data-send-reminder]").forEach((btn) => {
    btn.addEventListener("click", () => handleSendReminder(btn.dataset.sendReminder, btn));
  });
  els.remindersBody.querySelectorAll("[data-quote-for-reminder]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openQuoteModal({
        contactId: Number(btn.dataset.quoteForReminder),
        lineItem: { product_id: btn.dataset.product || "", description: btn.dataset.desc, quantity: 1, unit_price: 0, discount_percent: 0 },
      });
      populateLineItemProductOptions();
    });
  });
}

async function handleSendReminder(purchaseId, btn) {
  btn.disabled = true;
  btn.textContent = t("common.loading");
  try {
    await API.post(`/reminders/${purchaseId}/send`, {});
    toast(t("common.send") + " ✓");
    loadReminders();
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
    btn.textContent = t("common.send");
  }
}

/* ---------- team performance ---------- */
/* ---------- history view ---------- */
let historyOffset = 0;
const HISTORY_PAGE = 50;

function activityTypeLabel(type) {
  const map = {
    contact_created: "ui.activity_contact_created",
    contact_updated: "ui.activity_contact_updated",
    status_change:   "ui.activity_status_change",
    offer_drafted:   "ui.activity_offer_drafted",
    offer_sent:      "ui.activity_offer_drafted",
    call_logged:     "ui.activity_call_logged",
    meeting_logged:  "ui.activity_meeting_logged",
    note_logged:     "ui.activity_note_logged",
  };
  return map[type] ? t(map[type]) : type;
}

async function loadHistory(reset = false) {
  if (reset) {
    historyOffset = 0;
    els.historyTimeline.innerHTML = "";
  }

  const user_id = els.historyUserFilter.value;
  const type = els.historyTypeFilter.value;
  const params = new URLSearchParams({ limit: HISTORY_PAGE, offset: historyOffset });
  if (user_id) params.set("user_id", user_id);
  if (type) params.set("type", type);

  try {
    const { entries, total } = await API.get(`/history?${params}`);

    if (reset && entries.length === 0) {
      els.historyEmptyState.classList.remove("hidden");
      els.historyLoadMoreWrap.style.display = "none";
      els.historyCount.textContent = "";
      return;
    }
    els.historyEmptyState.classList.add("hidden");

    const fragment = entries.map((e) => `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap;">
            <div>
              <span class="label" style="font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-faint);">${escapeHtml(activityTypeLabel(e.type))}</span>
              ${e.contact_name ? `<span class="muted" style="font-size:12px; margin-left:8px;">· <a href="#" style="color:var(--text-dim)" data-open-contact="${e.contact_id}">${escapeHtml(e.contact_name)}</a></span>` : ""}
            </div>
            <span class="mono muted" style="font-size:11.5px; white-space:nowrap;">${formatDateTime(e.created_at)}</span>
          </div>
          <div style="font-size:13px; margin-top:3px;">${escapeHtml(e.description)}</div>
          ${e.user_name ? `<div class="muted" style="font-size:11.5px; margin-top:2px;">${escapeHtml(e.user_name)}</div>` : ""}
        </div>
      </div>`).join("");
    els.historyTimeline.insertAdjacentHTML("beforeend", fragment);

    // Wire contact links
    els.historyTimeline.querySelectorAll("[data-open-contact]").forEach((a) => {
      a.addEventListener("click", (ev) => { ev.preventDefault(); openPanel(a.dataset.openContact); });
    });

    historyOffset += entries.length;
    els.historyCount.textContent = `${Math.min(historyOffset, total)} of ${total} entries`;
    const hasMore = historyOffset < total;
    els.historyLoadMoreWrap.style.display = hasMore ? "" : "none";
  } catch (err) {
    toast(err.message, "error");
  }
}

async function loadPerformance() {
  const user = API.getUser();
  if (!user || user.role !== "admin") {
    els.performanceCard.classList.add("hidden");
    return;
  }
  try {
    const { team: rows } = await API.get("/team-stats");
    els.performanceCard.classList.remove("hidden");
    els.performanceBody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.user_name)}</td>
        <td>${r.leads_generated}</td>
        <td>${r.offers_created}</td>
        <td>${r.quotes_created}</td>
        <td>${r.quotes_accepted}</td>
        <td>${r.calls_logged}</td>
        <td>${r.meetings_logged}</td>
        <td>${r.clients_contacted}</td>
      </tr>`
      )
      .join("");
  } catch {
    els.performanceCard.classList.add("hidden");
  }
}

/* ---------- manual activity logging ---------- */
async function handleActivityLogSubmit(e) {
  e.preventDefault();
  if (!currentPanelContactId) return;
  const description = els.activityLogDescription.value.trim();
  if (!description) return;

  try {
    await API.post(`/contacts/${currentPanelContactId}/activity`, { type: els.activityLogType.value, description });
    els.activityLogDescription.value = "";
    loadContactTimeline(currentPanelContactId);
    toast("Logged");
  } catch (err) {
    toast(err.message, "error");
  }
}

function wireEvents() {
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.addEventListener("click", (e) => { e.preventDefault(); switchView(item.dataset.view); });
  });

  els.signOutBtn.addEventListener("click", (e) => {
    e.preventDefault();
    API.clearToken();
    window.location.href = "/login.html";
  });

  els.upgradeBtn.addEventListener("click", handleUpgradeClick);

  // History filters
  els.historyUserFilter.addEventListener("change", () => loadHistory(true));
  els.historyTypeFilter.addEventListener("change", () => loadHistory(true));
  els.historyLoadMoreBtn.addEventListener("click", () => loadHistory(false));

  els.copyInviteBtn.addEventListener("click", handleCopyInvite);
  els.regenInviteBtn.addEventListener("click", handleRegenInvite);

  els.searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { filters.search = els.searchInput.value.trim(); loadContacts(); }, 280);
  });
  els.filterStatus.addEventListener("change", () => { filters.status = els.filterStatus.value; loadContacts(); });
  els.filterTheme.addEventListener("change", () => { filters.theme = els.filterTheme.value; loadContacts(); });
  els.filterOwner.addEventListener("change", () => { filters.owner_id = els.filterOwner.value; loadContacts(); });

  els.addContactBtn.addEventListener("click", () => openContactModal(null));
  els.exportContactsBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = `/api/contacts/export`;
    link.setAttribute("download", "contacts.csv");
    // Attach auth header via a fetch-then-blob approach
    fetch("/api/contacts/export", { headers: { Authorization: `Bearer ${API.token()}` } })
      .then((r) => r.blob())
      .then((blob) => {
        link.href = URL.createObjectURL(blob);
        link.click();
      })
      .catch(() => toast("Export failed", "error"));
  });
  els.exportCompaniesBtn.addEventListener("click", () => {
    fetch("/api/companies/export", { headers: { Authorization: `Bearer ${API.token()}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", "companies.csv");
        link.click();
      })
      .catch(() => toast("Export failed", "error"));
  });
  // CSV import
  els.importContactsBtn.addEventListener("click", () => els.importContactsFile.click());
  els.importContactsFile.addEventListener("change", async () => {
    const file = els.importContactsFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await API.post("/contacts/import", { csv: text });
      toast(`Imported ${res.imported} contact${res.imported === 1 ? "" : "s"}${res.skipped ? `, ${res.skipped} skipped` : ""}`);
      if (res.errors?.length) console.warn("Import row errors:", res.errors);
      await loadContacts();
      await loadStats();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      els.importContactsFile.value = "";
    }
  });

  els.emptyAddBtn.addEventListener("click", () => openContactModal(null));
  document.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", closeContactModal));
  els.contactModalOverlay.addEventListener("click", (e) => { if (e.target === els.contactModalOverlay) closeContactModal(); });
  els.contactForm.addEventListener("submit", handleContactSubmit);

  els.contactsBody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (tr) openPanel(tr.dataset.id);
  });

  document.querySelectorAll("[data-close-panel]").forEach((b) => b.addEventListener("click", closePanel));
  els.panelOverlay.addEventListener("click", (e) => { if (e.target === els.panelOverlay) closePanel(); });

  // Inline company creation from contact modal
  els.cCompanySelect.addEventListener("change", () => {
    if (els.cCompanySelect.value === "__new__") {
      els.newCompanyInlineWrap.classList.remove("hidden");
      els.newCompanyInlineInput.focus();
    } else {
      els.newCompanyInlineWrap.classList.add("hidden");
    }
  });
  els.cancelInlineCompanyBtn.addEventListener("click", () => {
    els.newCompanyInlineWrap.classList.add("hidden");
    els.cCompanySelect.value = "";
  });
  els.createInlineCompanyBtn.addEventListener("click", async () => {
    const name = els.newCompanyInlineInput.value.trim();
    if (!name) return;
    els.createInlineCompanyBtn.disabled = true;
    try {
      const { company } = await API.post("/companies", { name });
      companies.push(company);
      populateCompanySelect();
      els.cCompanySelect.value = company.id;
      els.newCompanyInlineWrap.classList.add("hidden");
      els.newCompanyInlineInput.value = "";
      toast(`Company "${name}" created`);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      els.createInlineCompanyBtn.disabled = false;
    }
  });

  els.generateOfferBtn.addEventListener("click", handleGenerateOffer);
  els.sendOfferBtn.addEventListener("click", handleSendOffer);
  els.discardDraftBtn.addEventListener("click", handleDiscardDraft);
  els.deleteContactBtn.addEventListener("click", handleDeleteContact);
  els.editContactBtn.addEventListener("click", () => {
    const contact = currentPanelContact;
    closePanel();
    openContactModal(contact);
  });

  els.appearanceBtn.addEventListener("click", (e) => { e.preventDefault(); openAppearanceModal(); });
  els.closeAppearanceBtn.addEventListener("click", closeAppearanceModal);
  els.appearanceModalOverlay.addEventListener("click", (e) => { if (e.target === els.appearanceModalOverlay) closeAppearanceModal(); });
  els.themeGrid.querySelectorAll(".theme-swatch").forEach((btn) => {
    btn.addEventListener("click", () => handlePickTheme(btn.dataset.themeKey));
  });
  els.replayTourBtn.addEventListener("click", () => {
    closeAppearanceModal();
    startTour();
  });
  els.saveProfileNameBtn.addEventListener("click", handleSaveProfileName);
  els.savePasswordBtn.addEventListener("click", handleSavePassword);
  els.saveCurrencyBtn.addEventListener("click", handleSaveCurrency);
  els.saveAiContextBtn.addEventListener("click", handleSaveAiContext);
  els.appLangPicker.addEventListener("change", () => {
    KlyoI18n.setLang(els.appLangPicker.value);
    KlyoI18n.applyTranslations();
    switchView(currentView);
    // Re-render the active view so dynamic content gets translated
    if      (currentView === "pipeline")   { loadContacts(); loadThemes(); }
    else if (currentView === "companies")  loadCompanies();
    else if (currentView === "quotes")     loadQuotes();
    else if (currentView === "reminders")  loadReminders();
    else if (currentView === "tasks")      loadTasks();
    else if (currentView === "deals")      loadDeals();
    else if (currentView === "history")    loadHistory();
    else if (currentView === "team")       loadTeam();
    toast(KlyoI18n.t("settings.language") + " → " + KlyoI18n.LANG_NAMES[KlyoI18n.getLang()]);
  });
  els.joinWorkspaceBtn.addEventListener("click", handleJoinWorkspace);
  els.settingsUpgradeBtn.addEventListener("click", () => {
    closeAppearanceModal();
    openPricingModal();
  });
  els.settingsCancelBtn.addEventListener("click", handleCancelSubscription);
  els.settingsResumeBtn.addEventListener("click", () => handleResumeSubscription(els.settingsResumeBtn));
  els.billingModeToggle.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      pricingBillingMode = b.dataset.mode;
      renderPricingGrid();
    });
  });

  els.closePricingBtn.addEventListener("click", closePricingModal);
  els.pricingModalOverlay.addEventListener("click", (e) => { if (e.target === els.pricingModalOverlay) closePricingModal(); });

  els.connectGmailBtn.addEventListener("click", handleConnectGmail);
  els.disconnectGmailBtn.addEventListener("click", handleDisconnectGmail);

  els.helpFab.addEventListener("click", startTour);
  els.closeGrantModalBtn.addEventListener("click", closeGrantModal);
  els.cancelGrantBtn.addEventListener("click", closeGrantModal);
  els.grantModalOverlay.addEventListener("click", (e) => { if (e.target === els.grantModalOverlay) closeGrantModal(); });
  els.confirmGrantBtn.addEventListener("click", handleConfirmGrant);
  els.tourNextBtn.addEventListener("click", handleTourNext);
  els.tourBackBtn.addEventListener("click", handleTourBack);
  els.tourSkipBtn.addEventListener("click", finishTour);

  // Companies
  els.companySearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadCompanies, 280);
  });
  els.addCompanyBtn.addEventListener("click", () => openCompanyModal(null));
  els.closeCompanyModalBtn.addEventListener("click", closeCompanyModal);
  els.cancelCompanyBtn.addEventListener("click", closeCompanyModal);
  els.companyModalOverlay.addEventListener("click", (e) => { if (e.target === els.companyModalOverlay) closeCompanyModal(); });
  els.companyForm.addEventListener("submit", handleCompanySubmit);
  els.companiesBody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (tr) openCompanyPanel(tr.dataset.id);
  });
  els.closeCompanyPanelBtn.addEventListener("click", closeCompanyPanel);
  els.companyPanelOverlay.addEventListener("click", (e) => { if (e.target === els.companyPanelOverlay) closeCompanyPanel(); });
  els.deleteCompanyBtn.addEventListener("click", handleDeleteCompany);
  els.editCompanyBtn.addEventListener("click", () => {
    const company = companies.find((c) => c.id === currentCompanyPanelId);
    closeCompanyPanel();
    openCompanyModal(company);
  });

  // Products / catalog
  els.manageProductsBtn.addEventListener("click", openProductsModal);
  els.closeProductsModalBtn.addEventListener("click", closeProductsModal);
  els.productsModalOverlay.addEventListener("click", (e) => { if (e.target === els.productsModalOverlay) closeProductsModal(); });
  els.addProductBtn.addEventListener("click", handleAddProduct);
  if (els.productCategoryFilter) els.productCategoryFilter.addEventListener("input", renderProductsList);

  // Quotes
  els.addQuoteBtn.addEventListener("click", () => { openQuoteModal(null); populateLineItemProductOptions(); });
  els.quotesEmptyAddBtn.addEventListener("click", () => { openQuoteModal(null); populateLineItemProductOptions(); });
  els.quoteStatusFilter.addEventListener("change", loadQuotes);
  els.closeQuoteModalBtn.addEventListener("click", closeQuoteModal);
  els.quoteCancelBtn.addEventListener("click", closeQuoteModal);
  els.quoteModalOverlay.addEventListener("click", (e) => { if (e.target === els.quoteModalOverlay) closeQuoteModal(); });
  els.quoteContactSelect.addEventListener("change", handleQuoteContactChange);
  els.addLineItemBtn.addEventListener("click", () => {
    currentQuoteLineItems.push({ product_id: "", description: "", quantity: 1, unit_price: 0, discount_percent: 0 });
    renderQuoteLineItems();
  });
  els.quoteSaveDraftBtn.addEventListener("click", () => saveQuote(false));
  els.quoteForm.addEventListener("submit", (e) => { e.preventDefault(); saveQuote(true); });
  els.quotesBody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (tr) openQuotePanel(tr.dataset.id);
  });
  els.closeQuotePanelBtn.addEventListener("click", closeQuotePanel);
  els.quotePanelOverlay.addEventListener("click", (e) => { if (e.target === els.quotePanelOverlay) closeQuotePanel(); });
  els.sendQuoteFromPanelBtn.addEventListener("click", handleSendQuoteFromPanel);
  els.acceptQuoteBtn.addEventListener("click", handleAcceptQuote);
  els.declineQuoteBtn.addEventListener("click", handleDeclineQuote);
  els.deleteQuoteBtn.addEventListener("click", handleDeleteQuote);
  els.editQuoteBtn.addEventListener("click", handleEditQuoteFromPanel);

  // Contact panel additions: quotes + manual activity logging
  els.newQuoteForContactBtn.addEventListener("click", () => {
    openQuoteModal({ contactId: currentPanelContactId });
    populateLineItemProductOptions();
  });
  els.activityLogForm.addEventListener("submit", handleActivityLogSubmit);

  els.closeQuotePreviewBtn.addEventListener("click", closeQuotePreview);
  els.quotePreviewOverlay.addEventListener("click", (e) => { if (e.target === els.quotePreviewOverlay) closeQuotePreview(); });
  els.backToEditQuoteBtn.addEventListener("click", backToEditFromPreview);
  els.confirmSendQuoteBtn.addEventListener("click", confirmSendQuote);
}

/* ============================================================
   DEALS — pipeline board + stage management
   ============================================================ */

let dealsCache = [];          // flat list from last fetch
let dealsStagesCache = [];    // pipeline stages from last fetch
let currentDealPanelId = null;

// ---- data loaders ----

async function loadDeals() {
  try {
    const stageRes = await API.get("/deals/stages");
    dealsStagesCache = stageRes.stages || [];

    const statusVal = els.dealStatusFilter.value;
    const stageVal  = els.dealStageFilter.value;
    const ownerVal  = els.dealAssigneeFilter.value;
    let url = "/deals?";
    if (stageVal)  url += `stage_id=${stageVal}&`;
    if (ownerVal)  url += `assigned_to=${ownerVal}&`;
    if (statusVal) url += `status=${statusVal}&`;

    const res = await API.get(url);
    dealsCache = res.deals || [];

    renderDealsBoard();
    refreshDealStageFilter();
  } catch (err) {
    toast(err.message, "error");
  }
}

function refreshDealStageFilter() {
  const cur = els.dealStageFilter.value;
  els.dealStageFilter.innerHTML = '<option value="">All stages</option>';
  dealsStagesCache.forEach(s => {
    const o = document.createElement("option");
    o.value = s.id; o.textContent = s.name;
    if (String(s.id) === cur) o.selected = true;
    els.dealStageFilter.appendChild(o);
  });
}

// ---- board rendering ----

function renderDealsBoard() {
  els.dealsBoard.innerHTML = "";

  const stageVal  = els.dealStageFilter.value;
  const ownerVal  = els.dealAssigneeFilter.value;
  const statusVal = els.dealStatusFilter.value;

  // Build visible stage list (respect filter)
  let visibleStages = dealsStagesCache.filter(s => !stageVal || String(s.id) === stageVal);

  // Also include an "Unsorted" bucket for deals with no stage
  const hasUnsorted = dealsCache.some(d => !d.stage_id && (!stageVal));
  if (!stageVal && hasUnsorted) {
    visibleStages = [...visibleStages, { id: null, name: t("deals.unsorted") || "Unsorted", color: "#9ca3af" }];
  }

  const totalDeals = dealsCache.length;
  els.dealsEmptyState.classList.toggle("hidden", totalDeals > 0 || dealsStagesCache.length > 0);
  els.dealsBoard.style.display = (totalDeals === 0 && dealsStagesCache.length === 0) ? "none" : "";

  visibleStages.forEach(stage => {
    const stageDeals = dealsCache.filter(d => {
      if (stage.id === null) return !d.stage_id;
      return String(d.stage_id) === String(stage.id);
    });

    const col = document.createElement("div");
    col.className = "deals-column";
    col.dataset.stageId = stage.id ?? "";

    const totalVal = stageDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

    col.innerHTML = `
      <div class="deals-column-head">
        <div class="deals-column-dot" style="background:${stage.color}"></div>
        <div class="deals-column-name">${escHtml(stage.name)}</div>
        <div class="deals-column-count">${stageDeals.length}</div>
      </div>
      <div class="deals-column-body">
        ${stageDeals.map(d => dealCardHTML(d)).join("")}
        ${totalVal > 0 ? `<div style="font-size:11px; color:var(--text-faint); text-align:center; padding:4px 0; border-top:1px solid var(--border-soft); margin-top:4px;">${fmtMoney(totalVal, workspaceDefaultCurrency)}</div>` : ""}
      </div>
    `;

    // Click on card → open panel
    col.querySelectorAll(".deal-card").forEach(card => {
      card.addEventListener("click", () => openDealPanel(card.dataset.id));
    });

    els.dealsBoard.appendChild(col);
  });

  // If no stages at all show empty state
  if (visibleStages.length === 0) {
    els.dealsEmptyState.classList.remove("hidden");
  }
}

function dealCardHTML(d) {
  const cls = d.status === "won" ? " won" : d.status === "lost" ? " lost" : "";
  const sub = [d.contact_name, d.company_name].filter(Boolean).join(" · ");
  const valStr = d.value ? `<div class="deal-card-value">${fmtMoney(d.value, d.currency)}</div>` : "";
  return `<div class="deal-card${cls}" data-id="${d.id}">
    <div class="deal-card-title">${escHtml(d.title)}</div>
    ${sub ? `<div class="deal-card-meta">${escHtml(sub)}</div>` : ""}
    ${valStr}
  </div>`;
}

function fmtMoney(val, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", minimumFractionDigits: 0 }).format(val);
  } catch { return `${currency || ""} ${val}`; }
}

function escHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ---- deal modal ----

function openDealModal(deal) {
  els.dealId.value = deal?.id || "";
  els.dealModalTitle.textContent = deal ? t("modal.edit_deal") : t("modal.add_deal");
  els.dealSubmitBtn.textContent  = deal ? t("modal.save_changes") : t("modal.add_deal");
  els.dealTitle.value      = deal?.title || "";
  els.dealQty.value        = deal?.quantity ?? 1;
  els.dealValue.value      = deal?.value || "";
  els.dealCloseDate.value  = deal?.expected_close_date ? deal.expected_close_date.slice(0,10) : "";
  els.dealNotes.value      = deal?.notes || "";
  els.dealFormError.textContent = "";

  // Populate stage select
  els.dealStageSelect.innerHTML = '<option value="">No stage</option>';
  dealsStagesCache.forEach(s => {
    const o = document.createElement("option");
    o.value = s.id; o.textContent = s.name;
    if (deal && String(deal.stage_id) === String(s.id)) o.selected = true;
    els.dealStageSelect.appendChild(o);
  });

  // Populate assigned select from team
  els.dealAssignedSelect.innerHTML = '<option value="">Unassigned</option>';
  team.forEach(u => {
    const o = document.createElement("option");
    o.value = u.id; o.textContent = u.name;
    if (deal && String(deal.assigned_to) === String(u.id)) o.selected = true;
    els.dealAssignedSelect.appendChild(o);
  });

  // Contacts — use allContactsCache (loaded on boot)
  els.dealContactSelect.innerHTML = '<option value="">No contact</option>';
  allContactsCache.forEach(c => {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.full_name;
    if (deal && String(deal.contact_id) === String(c.id)) o.selected = true;
    els.dealContactSelect.appendChild(o);
  });

  // Companies
  els.dealCompanySelect.innerHTML = '<option value="">No company</option>';
  companies.forEach(co => {
    const o = document.createElement("option");
    o.value = co.id; o.textContent = co.name;
    if (deal && String(deal.company_id) === String(co.id)) o.selected = true;
    els.dealCompanySelect.appendChild(o);
  });

  // Products
  els.dealProductSelect.innerHTML = '<option value="">No product</option>';
  products.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.name;
    if (deal && String(deal.product_id) === String(p.id)) o.selected = true;
    els.dealProductSelect.appendChild(o);
  });

  els.dealModalOverlay.classList.remove("hidden");
  els.dealTitle.focus();
}

function closeDealModal() {
  els.dealModalOverlay.classList.add("hidden");
}

async function handleDealSubmit(e) {
  e.preventDefault();
  els.dealFormError.textContent = "";
  const id = els.dealId.value;
  const body = {
    title:               els.dealTitle.value.trim(),
    contact_id:          els.dealContactSelect.value || null,
    company_id:          els.dealCompanySelect.value || null,
    product_id:          els.dealProductSelect.value || null,
    stage_id:            els.dealStageSelect.value || null,
    assigned_to:         els.dealAssignedSelect.value || null,
    value:               els.dealValue.value || null,
    currency:            workspaceDefaultCurrency || "USD",
    quantity:            els.dealQty.value || 1,
    expected_close_date: els.dealCloseDate.value || null,
    notes:               els.dealNotes.value.trim() || null,
  };
  try {
    if (id) {
      await API.put(`/deals/${id}`, body);
    } else {
      await API.post("/deals", body);
    }
    closeDealModal();
    await loadDeals();
    toast(id ? "Deal updated" : "Deal added");
  } catch (err) {
    els.dealFormError.textContent = err.message;
  }
}

// ---- deal detail panel ----

async function openDealPanel(dealId) {
  try {
    const res = await API.get(`/deals/${dealId}`);
    const d = res.deal;
    currentDealPanelId = d.id;

    els.dealPanelTitle.textContent = d.title;
    const sub = [d.contact_name, d.company_name].filter(Boolean).join(" · ") || "—";
    els.dealPanelSub.textContent = sub;

    // Stage badge
    if (d.stage_name) {
      els.dealPanelStageBadge.innerHTML = `<span class="status-badge" style="background:${d.stage_color}22; color:${d.stage_color}; border:1px solid ${d.stage_color}44;">${escHtml(d.stage_name)}</span>`;
    } else {
      els.dealPanelStageBadge.innerHTML = "";
    }

    // Detail grid
    const rows = [
      d.value        ? ["Value",    fmtMoney(d.value, d.currency)] : null,
      d.assigned_name ? ["Owner",   escHtml(d.assigned_name)] : null,
      d.expected_close_date ? ["Close",  new Date(d.expected_close_date).toLocaleDateString()] : null,
      d.product_name  ? ["Product", escHtml(d.product_name)] : null,
      d.quantity != null ? ["Qty",  escHtml(d.quantity)] : null,
      ["Status",  `<span class="status-badge status-${d.status}">${d.status.charAt(0).toUpperCase()+d.status.slice(1)}</span>`],
    ].filter(Boolean);

    els.dealPanelDetails.innerHTML = rows.map(([k,v]) =>
      `<div class="detail-row"><span class="detail-label">${k}</span><span class="detail-value">${v}</span></div>`
    ).join("");

    if (d.notes) {
      els.dealPanelNotesWrap.classList.remove("hidden");
      els.dealPanelNotes.textContent = d.notes;
    } else {
      els.dealPanelNotesWrap.classList.add("hidden");
    }

    els.markDealWonBtn.style.display  = d.status === "won"  ? "none" : "";
    els.markDealLostBtn.style.display = d.status === "lost" ? "none" : "";

    els.dealPanelOverlay.classList.remove("hidden");
  } catch (err) {
    toast(err.message, "error");
  }
}

function closeDealPanel() {
  els.dealPanelOverlay.classList.add("hidden");
  currentDealPanelId = null;
}

async function handleMarkDeal(status) {
  if (!currentDealPanelId) return;
  try {
    const d = dealsCache.find(x => String(x.id) === String(currentDealPanelId));
    if (!d) return;
    await API.put(`/deals/${currentDealPanelId}`, { ...d, status });
    closeDealPanel();
    await loadDeals();
    toast(status === "won" ? "Deal marked won 🎉" : "Deal marked lost");
  } catch (err) { toast(err.message, "error"); }
}

async function handleDeleteDeal() {
  if (!currentDealPanelId || !confirm("Delete this deal?")) return;
  try {
    await API.del(`/deals/${currentDealPanelId}`);
    closeDealPanel();
    await loadDeals();
    toast("Deal deleted");
  } catch (err) { toast(err.message, "error"); }
}

function handleEditDealFromPanel() {
  const d = dealsCache.find(x => String(x.id) === String(currentDealPanelId));
  if (!d) return;
  closeDealPanel();
  openDealModal(d);
}

// ---- stage management modal ----

async function openStagesModal() {
  await loadDeals(); // refresh cache
  renderStagesList();
  els.stagesModalOverlay.classList.remove("hidden");
}

function closeStagesModal() {
  els.stagesModalOverlay.classList.add("hidden");
}

function renderStagesList() {
  els.stagesList.innerHTML = "";
  dealsStagesCache.forEach(s => {
    const row = document.createElement("div");
    row.className = "stage-manage-row";
    row.dataset.stageId = s.id;
    row.innerHTML = `
      <div class="stage-dot-edit" style="background:${s.color}"></div>
      <span class="stage-name">${escHtml(s.name)}</span>
      <button class="btn btn-danger btn-sm" data-delete-stage="${s.id}" title="Delete stage">×</button>
    `;
    row.querySelector("[data-delete-stage]").addEventListener("click", async () => {
      if (!confirm(`Delete stage "${s.name}"? Deals in this stage will become unsorted.`)) return;
      try {
        await API.del(`/deals/stages/${s.id}`);
        await loadDeals();
        renderStagesList();
        toast("Stage deleted");
      } catch (err) { toast(err.message, "error"); }
    });
    els.stagesList.appendChild(row);
  });
}

async function handleAddStage() {
  const name = els.newStageName.value.trim();
  if (!name) { els.stagesFormError.textContent = "Enter a stage name."; return; }
  els.stagesFormError.textContent = "";
  try {
    await API.post("/deals/stages", { name, color: els.newStageColor.value });
    els.newStageName.value = "";
    await loadDeals();
    renderStagesList();
    toast("Stage added");
  } catch (err) { els.stagesFormError.textContent = err.message; }
}

// ---- wire deals events ----
(function wireDealEvents() {
  els.addDealBtn.addEventListener("click", () => openDealModal(null));
  els.dealsEmptyAddBtn.addEventListener("click", () => openDealModal(null));
  els.cancelDealBtn.addEventListener("click", closeDealModal);
  els.closeDealModalBtn.addEventListener("click", closeDealModal);
  els.dealModalOverlay.addEventListener("click", e => { if (e.target === els.dealModalOverlay) closeDealModal(); });
  els.dealForm.addEventListener("submit", handleDealSubmit);

  els.closeDealPanelBtn.addEventListener("click", closeDealPanel);
  els.dealPanelOverlay.addEventListener("click", e => { if (e.target === els.dealPanelOverlay) closeDealPanel(); });
  els.markDealWonBtn.addEventListener("click", () => handleMarkDeal("won"));
  els.markDealLostBtn.addEventListener("click", () => handleMarkDeal("lost"));
  els.deleteDealBtn.addEventListener("click", handleDeleteDeal);
  els.editDealBtn.addEventListener("click", handleEditDealFromPanel);

  els.manageStagesBtn.addEventListener("click", openStagesModal);
  els.closeStagesModalBtn.addEventListener("click", closeStagesModal);
  els.stagesModalOverlay.addEventListener("click", e => { if (e.target === els.stagesModalOverlay) closeStagesModal(); });
  els.addStageBtn.addEventListener("click", handleAddStage);
  els.newStageName.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); handleAddStage(); } });

  els.dealStageFilter.addEventListener("change", loadDeals);
  els.dealAssigneeFilter.addEventListener("change", loadDeals);
  els.dealStatusFilter.addEventListener("change", loadDeals);
})();

/* ============================================================
   TASKS — list + assignment
   ============================================================ */

let tasksCache = [];

async function loadTasks() {
  const assignee = els.taskAssigneeFilter.value;
  const status   = els.taskStatusFilter.value;
  const priority = els.taskPriorityFilter.value;
  const overdue  = els.taskOverdueFilter.checked ? "1" : "";

  let url = "/tasks?";
  if (assignee) url += `assigned_to=${assignee}&`;
  if (status)   url += `status=${status}&`;
  if (priority) url += `priority=${priority}&`;
  if (overdue)  url += `overdue=1&`;

  try {
    const res = await API.get(url);
    tasksCache = res.tasks || [];
    renderTasksTable();
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderTasksTable() {
  const today = new Date().toISOString().slice(0, 10);

  els.tasksEmptyState.classList.toggle("hidden", tasksCache.length > 0);
  els.tasksTable.classList.toggle("hidden", tasksCache.length === 0);

  els.tasksBody.innerHTML = tasksCache.map(t => {
    const done = t.status === "done";
    const overdue = t.due_date && t.due_date.slice(0,10) < today && !done;
    const dueLbl = t.due_date
      ? `<span class="${overdue ? "due-overdue" : ""}">${new Date(t.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>`
      : '<span class="muted">—</span>';
    const linked = [t.contact_name, t.deal_title].filter(Boolean).join(" · ") || "—";
    return `<tr class="${done ? "task-row-done" : ""}" data-task-id="${t.id}">
      <td style="text-align:center;">
        <input type="checkbox" class="task-checkbox" data-id="${t.id}" ${done ? "checked" : ""} title="Toggle done" />
      </td>
      <td>
        <div style="font-weight:600; font-size:13px;">${escHtml(t.title)}</div>
        ${t.description ? `<div class="muted" style="font-size:11.5px;">${escHtml(t.description)}</div>` : ""}
      </td>
      <td>${t.assigned_name ? escHtml(t.assigned_name) : `<span class="muted">${window.t("common.unassigned")}</span>`}</td>
      <td class="muted" style="font-size:12px;">${escHtml(linked)}</td>
      <td>${dueLbl}</td>
      <td><span class="priority-badge priority-${t.priority}">${window.t("tasks.priority_" + t.priority) || t.priority}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm task-edit-btn" data-id="${t.id}" title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </td>
    </tr>`;
  }).join("");

  // Checkbox toggles
  els.tasksBody.querySelectorAll(".task-checkbox").forEach(cb => {
    cb.addEventListener("change", async () => {
      const newStatus = cb.checked ? "done" : "todo";
      try {
        await API.patch(`/tasks/${cb.dataset.id}/status`, { status: newStatus });
        await loadTasks();
      } catch (err) { toast(err.message, "error"); }
    });
  });

  // Edit buttons
  els.tasksBody.querySelectorAll(".task-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = tasksCache.find(x => String(x.id) === btn.dataset.id);
      if (t) openTaskModal(t);
    });
  });
}

function openTaskModal(task) {
  els.taskId.value            = task?.id || "";
  els.taskModalTitle.textContent = task ? t("modal.edit_task") : t("modal.add_task");
  els.taskSubmitBtn.textContent  = task ? t("modal.save_changes") : t("modal.add_task");
  els.taskTitle.value         = task?.title || "";
  els.taskDescription.value   = task?.description || "";
  els.taskDueDate.value       = task?.due_date ? task.due_date.slice(0,10) : "";
  els.taskPrioritySelect.value = task?.priority || "medium";
  els.taskStatusSelect.value  = task?.status || "todo";
  els.taskFormError.textContent = "";

  // Assignees from team
  els.taskAssignedSelect.innerHTML = `<option value="">${t("common.unassigned")}</option>`;
  team.forEach(u => {
    const o = document.createElement("option");
    o.value = u.id; o.textContent = u.name;
    if (task && String(task.assigned_to) === String(u.id)) o.selected = true;
    els.taskAssignedSelect.appendChild(o);
  });

  // Contacts
  els.taskContactSelect.innerHTML = `<option value="">${t("common.none")}</option>`;
  allContactsCache.forEach(c => {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.full_name;
    if (task && String(task.contact_id) === String(c.id)) o.selected = true;
    els.taskContactSelect.appendChild(o);
  });

  // Deals
  els.taskDealSelect.innerHTML = `<option value="">${t("common.none")}</option>`;
  dealsCache.forEach(d => {
    const o = document.createElement("option");
    o.value = d.id; o.textContent = d.title;
    if (task && String(task.deal_id) === String(d.id)) o.selected = true;
    els.taskDealSelect.appendChild(o);
  });

  els.taskModalOverlay.classList.remove("hidden");
  els.taskTitle.focus();
}

function closeTaskModal() {
  els.taskModalOverlay.classList.add("hidden");
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  els.taskFormError.textContent = "";
  const id = els.taskId.value;
  const body = {
    title:       els.taskTitle.value.trim(),
    description: els.taskDescription.value.trim() || null,
    assigned_to: els.taskAssignedSelect.value || null,
    due_date:    els.taskDueDate.value || null,
    priority:    els.taskPrioritySelect.value,
    status:      els.taskStatusSelect.value,
    contact_id:  els.taskContactSelect.value || null,
    deal_id:     els.taskDealSelect.value || null,
  };
  try {
    if (id) {
      await API.put(`/tasks/${id}`, body);
    } else {
      await API.post("/tasks", body);
    }
    closeTaskModal();
    await loadTasks();
    toast(id ? "Task updated" : "Task created");
  } catch (err) {
    els.taskFormError.textContent = err.message;
  }
}

// ---- wire task events ----
(function wireTaskEvents() {
  els.addTaskBtn.addEventListener("click", () => openTaskModal(null));
  els.tasksEmptyAddBtn.addEventListener("click", () => openTaskModal(null));
  els.closeTaskModalBtn.addEventListener("click", closeTaskModal);
  els.cancelTaskBtn.addEventListener("click", closeTaskModal);
  els.taskModalOverlay.addEventListener("click", e => { if (e.target === els.taskModalOverlay) closeTaskModal(); });
  els.taskForm.addEventListener("submit", handleTaskSubmit);

  els.taskAssigneeFilter.addEventListener("change", loadTasks);
  els.taskStatusFilter.addEventListener("change", loadTasks);
  els.taskPriorityFilter.addEventListener("change", loadTasks);
  els.taskOverdueFilter.addEventListener("change", loadTasks);
})();
