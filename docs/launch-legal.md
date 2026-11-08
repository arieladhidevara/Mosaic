# Launch/legal protection status — 2026-11-08

Source: `arieladhidevara/Mosaic` (production deploys from main).

## Implemented
- MIT LICENSE replaced with a proprietary, all-rights-reserved notice. Earlier MIT grants remain effective for the versions that received them.
- README updated to reflect proprietary licensing. Changing the repository's **visibility** requires GitHub repository administrator action: Settings → Danger Zone → Change repository visibility → Private.
- Public `/privacy` and `/terms` pages linked from the homepage and Help dialog.
- Response headers: nosniff, deny framing, referrer policy, and deny unnecessary browser device permissions.
- Sanitized diagnostic event `[mozAI:generation_failed]` on failed image generation, without user content or credentials.

## To verify before inviting users
- Test links, headers, and AI error handling in production.
- Check Privacy Policy against data flows, actual provider agreement, retention, and jurisdiction; request qualified legal review.
- Publish a dedicated monitored support/privacy email and replace the beta-only invitation reply contact wording.
- Use a shared, account-aware server-side rate-limit or Vercel Firewall rule after testing for false positives. No in-memory process-global limiter is assumed to protect serverless concurrency.
- Enable leaked-password protection and review current Supabase security advisors.
- Verify that the GitHub repository is private after changing it; public forks and previously accessed versions will not become private.
- Confirm Vercel's Git integration still deploys the private repository, and monitor production logs for errors.
- Decide whether independent invite-only testers may upload client-confidential material; do not promise provider zero retention or training opt-outs without specific applicable terms.

## Important IP clarification
Changing the root license notice affects current and future source distributions controlled by the rights holder. It **does not revoke** past grants for copies obtained under MIT and does not convert public forks to private. Third-party assets and dependencies retain their own rights. Public web-delivered front-end code remains technically inspectable in a browser even when GitHub is private.
