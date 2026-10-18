# SMS two-step sign-in with Twilio Verify

SMS verification is mandatory for every account and each new sign-in, including Google. Existing accounts must enroll on their next login; no CRM token is issued before verification. It cannot be disabled. Password recovery leaves SMS enabled.

## Administrator setup

1. Open the Twilio Console and create a **Verify Service** with SMS enabled. Use its service SID beginning with `VA`, not a Messaging Service SID. Configure the countries you support, Fraud Guard and the provider's verification limits for your business.
2. Add these server-side variables in Railway: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Keep the Auth Token private; do not paste it into chat or put it in browser code. Klyo uses Twilio Verify directly and does not buy a subscription or credits. Twilio's SMS and verification charges apply to your account.
3. Keep the existing `JWT_SECRET` and `INTEGRATION_ENCRYPTION_KEY` stable. Phone numbers are encrypted using the existing integration encryption key. Changing that key requires a recovery plan for enrolled accounts as well as reconnecting integrations.
4. Redeploy, then open **Settings → Account & organization → Sign-in security · SMS 2FA**. The status should show that Twilio is configured. Use a controlled test account and phone to verify your actual service and destination permissions before rolling out to users. Automated Klyo tests use a simulated provider, not actual SMS delivery.

## User enrollment and sign-in

Enter an international phone at registration or after password/Google sign-in for an existing account. SMS is sent automatically on each subsequent sign-in. Challenges expire after five minutes and allow five attempts. Resend waits 60 seconds without extending expiry or restoring attempts. Provider failure never grants access. Recovery codes do not replace SMS.

Account email recovery uses Resend, configured with RESEND_API_KEY and RESEND_FROM_EMAIL. See /docs/account-access.html for domain verification, Stripe trial onboarding and rollout checks.
