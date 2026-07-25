import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MkList, MK } from "@/components/landing/MarketingPageShell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — WEBEE Builder by Webespoke AI" },
      { name: "description", content: "How Webespoke AI Ltd collects, uses, stores and protects personal data across the WEBEE platform." },
    ],
  }),
  component: () => (
    <MarketingPageShell
      kicker="Legal"
      title="Privacy Policy"
      intro="This policy explains how Webespoke AI Ltd ('Webespoke AI', 'we', 'us') collects, uses and protects personal data when you use the WEBEE platform and our websites."
      showCta={false}
    >
      <MkP><em style={{ color: MK.dim }}>Last updated: 25 July 2026</em></MkP>

      <MkH2>1. Who we are</MkH2>
      <MkP>
        Webespoke AI Ltd is the data controller for personal data collected through our websites and
        the WEBEE platform. Where our customers use WEBEE to handle their own customers' calls,
        messages and leads, the customer is the data controller and Webespoke AI acts as a data
        processor on their behalf.
      </MkP>

      <MkH2>2. Data we collect</MkH2>
      <MkList items={[
        "Account data — name, email address, company details and login credentials when you create a workspace.",
        "Contact and enquiry data — details you submit through our contact or demo forms.",
        "Communications data — call recordings, transcripts, and message content processed by AI agents you or our customers deploy, where lawfully collected by the workspace owner.",
        "Usage data — pages visited, features used, device and browser information, and diagnostic logs.",
        "Billing data — subscription and invoicing details (payment card details are handled by our payment providers, not stored by us).",
      ]} />

      <MkH2>3. How we use data</MkH2>
      <MkList items={[
        "To provide, operate and secure the WEBEE platform.",
        "To deliver AI voice and messaging services configured by workspace owners.",
        "To respond to enquiries and provide support.",
        "To send service communications, and marketing where you have consented (you can opt out at any time).",
        "To improve the platform, using aggregated and de-identified data where practical.",
        "To meet legal, accounting and regulatory obligations.",
      ]} />

      <MkH2>4. Lawful bases</MkH2>
      <MkP>
        We process personal data under UK GDPR on the bases of contract performance, legitimate
        interests (running and improving our services), consent (marketing and certain cookies) and
        legal obligation.
      </MkP>

      <MkH2>5. Sharing and sub-processors</MkH2>
      <MkP>
        We share data only with service providers needed to run the platform — including cloud
        hosting, database, telephony, AI model and email providers — under contracts that require
        them to protect it. We do not sell personal data. Data may be transferred outside the UK
        only with appropriate safeguards such as adequacy decisions or standard contractual clauses.
      </MkP>

      <MkH2>6. Retention</MkH2>
      <MkP>
        We keep personal data only as long as needed for the purposes above, then delete or
        anonymise it. Workspace owners control retention of their own customer communications inside
        their workspace; account data is retained for the life of the account plus a limited period
        for legal and accounting purposes.
      </MkP>

      <MkH2>7. Security</MkH2>
      <MkP>
        Data is encrypted in transit, access is restricted on a least-privilege basis, workspaces
        are strictly isolated from one another, and our systems are monitored for abnormal
        behaviour. See our <Link to="/security" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>Security page</Link> for more detail.
      </MkP>

      <MkH2>8. Your rights</MkH2>
      <MkP>
        You have rights of access, rectification, erasure, restriction, portability and objection,
        and the right to withdraw consent at any time. To exercise them, contact us via the{" "}
        <Link to="/contact" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>contact page</Link>.
        You can also complain to the UK Information Commissioner's Office (ico.org.uk).
      </MkP>

      <MkH2>9. Changes</MkH2>
      <MkP>
        We may update this policy from time to time. Material changes will be notified through the
        platform or by email. Continued use of the service after changes take effect constitutes
        acceptance of the updated policy.
      </MkP>
    </MarketingPageShell>
  ),
});
