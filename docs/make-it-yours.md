# Make It Yours — whole-workspace layouts

Open **Settings → Make It Yours → Create my own layout**. The Make It Yours button in the page header opens the same editor.

Choose **Classic**, **Explorer**, **Notebook** or **Command**. Presets change interface structure, icons, typography, navigation and density while retaining the existing palette, module visibility and overview chart arrangement. Explorer has a section rail and a secondary tool list; Notebook uses a document-style page list; Command puts work sections in a top menu. Mobile uses the existing slide-out navigation.

In the designer:

- **Layout** changes navigation position (left/right/top), width, menu style, density, icons, type, panel corners, work-area width, action-header position and start page. On desktop, drag the navigation or page-actions grip onto a highlighted placement zone. Drag the menu's edge to resize it. Controls offer the same options without dragging.
- **Tools** hides modules, reorders them and moves them between sections. Rename and reorder sections. Hiding a module never deletes its data, disables its backend or changes access rights. **All tools** in the header finds hidden modules. Settings, sign-out and permission-gated Platform remain outside the customizable module list.
- **This page** selects a CRM page and arranges its existing regions. Drag a panel grip or use arrows; choose half or full width. Hide optional panels and restore them from the list. The primary record area cannot be hidden. Overview retains its existing widget canvas, magnetic/free/grid movement, tilt, charts and shortcuts under **Edit overview widgets**. Page selectors only target known, existing regions, not arbitrary HTML or scripts. Some pages have a single main record region; record forms and tables keep their business behavior.
- **Shortcuts** places new-deal/contact/quote/task/company, calendar and integrations actions in the header, above the work area or in the navigation footer. Drag a shortcut to a highlighted area or use checkboxes and a position control. Viewer accounts cannot use creation shortcuts.
- Save up to **six named personal layouts** and reload or remove them. These store structure rather than replacing the color palette or overview charts. A layout is persisted when **Save layout** succeeds. Undo/redo and Cancel remain available; a failed save retains the editor with its error.

Changes are stored against the signed-in account, and do not alter a colleague's layout or Team/Personal data boundaries. Existing color palettes, manual contrast, contact columns, custom fields, Quote Creator and PDF functionality remain available.

# Settings → Integrations

The directory lists SharePoint, Google Drive, Dropbox, Microsoft 365 inbox, Gmail sending, SMTP, Google and Outlook calendars, Apple/iCalendar file export, Apollo, Fakturownia, DHL Tracking, SMS two-step verification, Google sign-in, the optional email assistant and Klyo subscription billing.

Cards show connection/configuration state for the active space, explain private/shared/operator-managed scope and link to the relevant guide. Search or filter by Files, Email, Calendars, Sales & delivery, or Account & services.

Workspace owners configure shared storage, Apollo, Fakturownia and DHL. Existing SMTP/Gmail admin rules are preserved. Each user manages their own calendar, mailbox and SMS enrollment; Team and Personal stay separate. Provider keys are entered directly in the connection form. A saved API key is labeled **Credentials saved**, not a verified working connection. Test provider access through the corresponding tool. Operator configuration flags only expose booleans, never credentials.

Apple Calendar is a manual `.ics` export, not live iCloud synchronization. Stripe manages the Klyo subscription, not customer invoice payments. Configuring a provider does not itself issue invoices, send email, buy services or enable automatic follow-ups.
