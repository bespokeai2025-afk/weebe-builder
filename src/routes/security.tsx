import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MkList, MkCardGrid, MK } from "@/components/landing/MarketingPageShell";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security — WEBEE Builder by Webespoke AI" },
      { name: "description", content: "How the WEBEE platform protects customer data: encryption, workspace isolation, access control, approval gates and monitoring." },
    ],
  }),
  component: () => (
    <MarketingPageShell
      kicker="Legal"
      title="Security at WEBEE"
      intro="Businesses trust WEBEE with their calls, conversations and customer data. Protecting that data is engineered into the platform, not bolted on."
    >
      <MkH2>Platform security</MkH2>
      <MkCardGrid cards={[
        { title: "Encryption in transit", body: "All traffic between your browser, our servers and our providers is encrypted with TLS. Voice media streams use the providers' encrypted transport." },
        { title: "Workspace isolation", body: "Every workspace's data is segregated with row-level security enforced at the database layer — one tenant can never read another's data." },
        { title: "Access control", body: "Role-based permissions, package entitlements and per-user overrides gate every sensitive action on the server, not just in the interface." },
        { title: "Approval gates", body: "Consequential AI actions — deployments, campaigns, spending changes — require explicit human approval before they execute." },
      ]} />

      <MkH2>Operational practices</MkH2>
      <MkList items={[
        "Secrets and API credentials are stored in managed secret stores, never in source code or client bundles.",
        "Least-privilege service accounts and audited administrative access.",
        "Continuous health monitoring with automated alerting on abnormal behaviour.",
        "Third-party integrations (telephony, AI models, email) are accessed via scoped credentials that customers control per workspace.",
        "Single-use, signed, expiring authorisation flows for third-party account connections (e.g. Google).",
      ]} />

      <MkH2>Your part</MkH2>
      <MkP>
        Use strong, unique passwords, limit workspace membership to people who need it, and assign
        the least role required. Credentials for your own third-party accounts remain under your
        control and can be revoked at any time.
      </MkP>

      <MkH2>Reporting a vulnerability</MkH2>
      <MkP>
        If you believe you've found a security issue, please report it responsibly via our{" "}
        <Link to="/contact" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>contact page</Link>{" "}
        with "Security" in the message. We investigate all reports and appreciate coordinated
        disclosure.
      </MkP>
    </MarketingPageShell>
  ),
});
