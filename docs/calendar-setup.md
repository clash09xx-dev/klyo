# Calendar integrations

In **Calendar → Connect calendars**, each user connects Google Calendar, Outlook / Microsoft 365 or iCloud, chooses a calendar, and sees its events beside CRM events. Connections are private to that user in the active Team or Personal space. Personal and Team have separate connections. A connected account is never automatically shared with colleagues.

## Google Calendar

Use the existing Google OAuth web application (the same `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` used by Klyo). Enable **Google Calendar API** in Google Cloud. Keep all existing login/Gmail/Drive callback URLs and add this authorized **Web redirect URI**:

`https://klyolabs.com/api/calendar-integrations/oauth/google/callback`

The integration requests `openid` and `email`, plus `calendar.calendarlist.readonly` and `calendar.events` under `https://www.googleapis.com/auth/`. These permissions allow choosing accessible calendars and reading/writing their events. Google may require OAuth app verification for production use. In testing mode add the intended Google accounts as test users; Google's test-mode refresh-token limits still apply. Reconnect if consent expires.

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Railway. Set `APP_URL=https://klyolabs.com`. Do not expose client secrets in browser code or paste them into chat. Then open **Calendar → Connect calendars → Google Calendar → Connect**, sign in, review consent and choose a calendar. Read-only calendars can be displayed; publishing requires a writable calendar.

## Outlook / Microsoft 365

Use the existing Microsoft Entra application, preserving its SharePoint and inbox redirect URIs. Add this **Web redirect URI**:

`https://klyolabs.com/api/calendar-integrations/oauth/microsoft/callback`

Add the Microsoft Graph **delegated** permission `Calendars.ReadWrite`. Offline access enables token renewal. Organization policy may require administrator consent. No application-wide calendar permissions or mail-sending permissions are required by this integration.

Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` in Railway. The calendar authority uses `CALENDAR_MICROSOFT_TENANT_ID` when set, otherwise `MICROSOFT_TENANT_ID`, otherwise `common`. Use `organizations` or your tenant UUID for work accounts. For personal Outlook.com accounts the Entra application's supported account types must include personal Microsoft accounts, and calendar authority must use `common` or `consumers`. This calendar-specific setting does not change the existing SharePoint authority.

Connect from **Calendar → Connect calendars → Outlook / Microsoft 365**, then choose an accessible calendar. The integration uses the signed-in account's calendars, not arbitrary delegated mailboxes. Calendar policies and permissions still apply.

## How Google and Microsoft events move

- **Refresh** reads the selected provider calendars for the displayed month. Repeated reads do not create CRM records. Recurring events are displayed as instances returned by the provider. All-day end dates are exclusive; times are displayed in the user's local timezone.
- External events have a provider marker and are private. Open one and choose **Copy to Team CRM** or **Copy to Personal CRM** to copy its title, dates, location and description. Team copying explicitly makes those details visible to colleagues. Repeated copying reuses the existing CRM event.
- Create or edit a CRM event and **Save** first. Open it again → **Google / Outlook** → **Send to**. Klyo publishes an appointment without attendees. Existing CRM events are not bulk-published, and imported meetings are not silently changed.
- A link exposes **Publish CRM version** and **Pull calendar version**. These are explicit actions, not automatic two-way writes. Publishing refuses to overwrite a provider event changed since the last synchronization. Pulling replaces the CRM title, dates, description and location, while retaining CRM contact/deal links. A stale CRM revision requires reloading before either action.
- Provider meetings with attendees or recurring event series must be managed in Google or Outlook. Klyo does not send attendee invitations. Copied external meetings are read-only toward their original provider; use **Pull** to refresh their CRM copy.
- **Unlink**, deleting a CRM event, switching calendars or disconnecting the account does not delete events from the provider. Disconnecting removes Klyo's saved credentials and links; independent CRM copies remain. Reconnecting is a new link context, so review existing external appointments before publishing again.
- Failed initial publication keeps the operation ID and original payload. Retrying the same link uses a stable Google event ID or Microsoft transaction ID to avoid duplicate creation. If CRM data changed during a failed attempt, the link indicates unpublished CRM changes after recovery. Do not unlink a pending operation just to retry it.

Google/Microsoft remain the authority for their own recurring meetings, reminders, attendees and conferencing. This release does not create Google Meet/Teams conferences, manage attendee responses or run background outbound workflows.

## Apple Calendar / iCloud — two-way CalDAV

No operator Apple developer application, OAuth keys or Railway Apple secrets are needed. Each user opens **Settings → Integrations → Apple Calendar / iCloud → Connect**, enters their Apple ID email and an **app-specific password**, then chooses a calendar. In [Apple Account](https://account.apple.com/), open **Sign-In and Security → App-Specific Passwords → Generate** and name it Klyo. Apple requires two-factor authentication for this. Never enter the main Apple Account password in Klyo.

The selected iCloud calendar appears as a private overlay, including all-day dates and expanded recurring occurrences. Reading it does not share its contents with the team. Explicitly **Copy to CRM** or **Send to iCloud** to link an individual event. A writable calendar supports creating and updating ordinary appointments in either direction. There are no attendee invitations or mass imports.

Enable **Automatic two-way sync** in the connection dialog after reviewing its confirmation. Linked changes and deletions then synchronize in both directions, with background checks approximately every two minutes while the CRM subscription and membership permit access. **Sync now** runs a check immediately. The visible calendar refreshes every minute when no editor is open. This is polling, not an instant push service. In Team, colleagues can edit shared linked CRM events; these changes also reach the connected user's iCloud.

Simultaneous local and remote edits are flagged; Klyo preserves both versions until you choose one. **Pull calendar version** deliberately accepts the Apple version; **Publish CRM version** requires first reviewing/pulling a conflicting Apple revision. Read-only calendars cannot receive changes. Recurring series, moved/removed occurrences and meetings with participants are edited in Apple Calendar; the CRM copy shows a warning when it cannot safely update an occurrence. Klyo retains their original recurrence rules, attendees and alarms.

**Pause automatic sync**, **Unlink** or **Disconnect** stops further automatic writes; independent events remain. Changing the selected calendar pauses synchronization. A linked deletion propagates only during an explicitly requested sync or when automatic sync is enabled. Unrelated iCloud appointments are never deleted by CRM cleanup. Revoke the app-specific password in Apple Account to remove provider access; changing your primary Apple Account password revokes those passwords too. Reconnect in Klyo using **Update password**, reselect the calendar and deliberately re-enable sync.

Apple ID, encrypted app-specific password and discovery URLs are stored per user and active Team/Personal workspace. Status APIs do not expose credentials. Only fixed HTTPS Apple CalDAV hosts are contacted; redirects, event paths, response sizes and timeouts are checked.

## Other calendar apps / offline export

Use **Export CRM .ics** to download CRM events from the currently displayed month. Import the file in Apple Calendar, Outlook or another iCalendar-compatible app. The file contains CRM events only, including intentionally shared CRM copies; it does not include your other private provider events. Importing the same file repeatedly may duplicate entries depending on the calendar application. The .ics export is independent of the live iCloud connection; it is not a public subscription URL.

## Secrets and testing

Use the stable server-only `INTEGRATION_ENCRYPTION_KEY` already configured for Klyo integrations. Calendar credentials are encrypted in PostgreSQL; status endpoints never return tokens. Rotating the encryption secret requires reconnecting accounts. Do not connect a private calendar if you are not authorized to copy its data into the team's CRM.

Provider adapters and user workflows are tested against simulated provider responses and an isolated database. Actual OAuth acceptance, tenant consent and account-specific calendar access require the owner's configured Google/Microsoft application and real account authorization. A missing configuration appears as unavailable in the connection dialog, not as a successful connection.

Official documentation:

- [Google calendar authorization](https://developers.google.com/workspace/calendar/api/auth)
- [Google calendar list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Google event listing and recurrence expansion](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Google event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Outlook calendars](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0)
- [Outlook calendar view](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0)
- [Microsoft event creation and transaction IDs](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0)

- [Apple app-specific passwords](https://support.apple.com/en-us/102654)
