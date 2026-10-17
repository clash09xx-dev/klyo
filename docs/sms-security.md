# SMS two-step sign-in with Twilio Verify

SMS verification is optional and is enabled per account after the phone has been verified. The account setting applies to both Team and Personal and to password and Google sign-in. No existing account is enrolled automatically.

## Administrator setup

1. Open the Twilio Console and create a **Verify Service** with SMS enabled. Use its service SID beginning with `VA`, not a Messaging Service SID. Configure the countries you support, Fraud Guard and the provider's verification limits for your business.
2. Add these server-side variables in Railway: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Keep the Auth Token private; do not paste it into chat or put it in browser code. Klyo uses Twilio Verify directly and does not buy a subscription or credits. Twilio's SMS and verification charges apply to your account.
3. Keep the existing `JWT_SECRET` and `INTEGRATION_ENCRYPTION_KEY` stable. Phone numbers are encrypted using the existing integration encryption key. Changing that key requires a recovery plan for enrolled accounts as well as reconnecting integrations.
4. Redeploy, then open **Settings → Account & organization → Sign-in security · SMS 2FA**. The status should show that Twilio is configured. Use a controlled test account and phone to verify your actual service and destination permissions before rolling out to users. Automated Klyo tests use a simulated provider, not actual SMS delivery.

## User enrollment and sign-in

Enter your international phone number, such as `+48123456789`, and your current password. A Google-only account must have signed in recently (within five minutes). Request the verification SMS, enter its code, and save the ten recovery codes shown once. Keep them outside Klyo in a private location. Each recovery code works once. Enrollment invalidates older sessions; the session that completed enrollment receives a new token.

At the next password or Google sign-in, no CRM session is issued until an SMS or recovery code is accepted. A login challenge expires after five minutes and allows at most five code attempts. Resending requires a 60-second wait, preserves the expiry and attempts, and is subject to account/provider limits. Verification sends are limited per account and checks are limited separately. Failure or absence of the provider never bypasses the second step: a saved recovery code is required.

To turn SMS verification off, open the same security screen and confirm with your password (or recent Google sign-in) plus an SMS or unused recovery code. Existing recovery codes are removed and old sessions become invalid. Disable then enroll again to change your number or generate a fresh recovery-code set. There is no support-side bypass button.

The CRM does not log SMS codes, recovery codes, plaintext phone numbers or provider credentials in team audit records. The security screen only displays the phone's final four digits. Configuration is deployment-wide, while enrollment and recovery codes are account-specific.

Official references:
- [Twilio Verify API](https://www.twilio.com/docs/verify/api)
- [Start a verification](https://www.twilio.com/docs/verify/api/verification)
- [Check a verification](https://www.twilio.com/docs/verify/api/verification-check)
- [Provider rate limits](https://www.twilio.com/docs/verify/api/rate-limits-and-timeouts)
