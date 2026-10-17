# Visual workspace, sales results and advanced proposals

## Customize dashboard

Open **Settings → Customize dashboard** or **Customize workspace** in the sidebar. This enters a separate arrangement mode: record buttons and CRM actions are blocked while you organize the layout. Each available widget is bounded to the dashboard grid and your settings are saved only to your account.

Drag a widget by its header or drag a feature from the catalog onto the grid. Resize by the lower-right handle, or focus that handle and use the arrow keys. The header buttons move a widget in four directions, change its width or remove it. Removing a widget does not remove records. Add it back from the catalog. You can add reporting panels, Won/Lost results, loss reasons, value bands, open-deal aging, source results, task/company/quote lists and individual shortcuts for a new deal, contact, quote or task. Overlapping widgets are placed into free grid cells automatically.

Adjust navigation width or choose grouped sections, two-column tiles or a simple list. Open the menu controls in the same panel to show, hide or reorder modules. Sidebar modules scroll independently of the account controls. Existing palette, contact-column, density and personal settings remain available. **Save layout** persists the preview; **Cancel** or Escape restores the saved layout. **Reset dashboard** restores the default widget arrangement in the preview and still requires Save. On narrow screens widgets stack for readability while retaining the saved desktop geometry.

## Won, Lost and reporting

**Deals → Won / Lost / Results & charts** opens dedicated closed-result views. Choose the closing month and currency; the selected pipeline is respected. Click a deal to inspect it. The Results view includes actual closed results over six months, recorded loss reasons, value bands and source results. Open-deal aging explicitly covers all currently open records. Won/Lost cards also work as dashboard widgets and lead back to the results view.

These are actual CRM records and owner-defined targets, not invented industry benchmarks. Currencies remain separate. A win rate describes won deals among the closed cohort in the selected period, not conversion at every stage. Historical reports use the current saved records; they are not historical snapshots of deleted or edited data.

## Private margin controls and product groups

When composing an offer, **Show internal margins** is a visible button in the quote header. It is available only to users granted margin access. Margins start hidden each time the editor opens and never enter the customer PDF. Hide them with the same button or Escape before showing the editor to a customer.

Open **Groups & discounts**. Create groups, choose parent groups (up to four levels), assign each component and define a percentage or fixed discount for each group. Choose whether to show the group's total and whether selected components show their included prices. All components remain listed. Shown sub-group and component amounts are explicitly marked as included in their parent; they are not additional charges. The offer-wide **Only the offer total** setting suppresses all component and group prices.

Calculation order is item discount → innermost group → parent groups → whole-quote discount → optional tax. Group discounts are allocated to underlying components with exact cent rounding, preserving product references and cost calculations. A discount cannot exceed the group's remaining amount. The same normalized data is used by PDF, quote templates, margin calculations and source-quote order/invoice allocation. Group amounts are before any whole-quote discount; the quote summary shows the full discount and final total.

Example: group the motherboard, RAM and CPU/GPU sub-group inside a Computer group. Show the computer total and the CPU/GPU included subtotal, optionally disclose the CPU price, keep the RAM price hidden, and apply separate discounts at item, sub-group and computer levels. Final order edits remain separately reviewable before invoicing.
