import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MkList, MkCardGrid, MK } from "@/components/landing/MarketingPageShell";

export const Route = createFileRoute("/partners")({
  head: () => ({
    meta: [
      { title: "Partners — WEBEE Builder by Webespoke AI" },
      { name: "description", content: "Partner with Webespoke AI. Reseller and white-label programmes for agencies, consultancies and technology providers building on the WEBEE platform." },
    ],
  }),
  component: () => (
    <MarketingPageShell
      kicker="Company"
      title="Partner with WEBEE"
      intro="Agencies, consultancies and technology providers use WEBEE to deliver AI voice and messaging solutions to their own clients — under their brand or ours."
    >
      <MkH2>Partnership programmes</MkH2>
      <MkCardGrid cards={[
        { title: "Reseller Programme", body: "Sell WEBEE workspaces to your clients with margin on every package. You manage the relationship; we run the platform." },
        { title: "White-Label Programme", body: "Offer the full platform under your own brand, with parent/child workspace management and your own client accounts." },
        { title: "Technology Partners", body: "Integrate your product with WEBEE through our developer API and webhooks, or build joint solutions with our team." },
      ]} />
      <MkH2>What partners get</MkH2>
      <MkList items={[
        "Multi-workspace management from a single parent account",
        "Per-client packages, seats and usage controls",
        "A developer API for provisioning and reporting",
        "Onboarding support and shared technical enablement",
        "Honest, evidence-based reporting you can put in front of clients",
      ]} />
      <MkH2>Become a partner</MkH2>
      <MkP>
        Tell us about your business and the clients you serve — we'll come back to you with the
        right programme.{" "}
        <Link to="/contact" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>
          Get in touch via our contact page
        </Link>{" "}
        and mention "Partnerships" in your message.
      </MkP>
    </MarketingPageShell>
  ),
});
