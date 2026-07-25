import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MkList, MK } from "@/components/landing/MarketingPageShell";

export const Route = createFileRoute("/compliance")({
  head: () => ({
    meta: [
      { title: "Compliance — WEBEE Builder by Webespoke AI" },
      { name: "description", content: "How WEBEE supports UK GDPR, calling and messaging compliance, AI transparency and responsible automation." },
    ],
  }),
  component: () => (
    <MarketingPageShell
      kicker="Legal"
      title="Compliance"
      intro="WEBEE is built to help businesses use AI agents responsibly — with data protection, calling regulations and AI transparency designed into the platform."
    >
      <MkH2>Data protection</MkH2>
      <MkList items={[
        "UK GDPR-aligned processing, with Webespoke AI acting as processor for the data our customers handle in their workspaces.",
        "Data minimisation and configurable retention inside each workspace.",
        "Data subject rights supported — access, correction and deletion requests can be actioned per workspace.",
        "Sub-processors bound by data-processing agreements; international transfers only with appropriate safeguards.",
      ]} />

      <MkH2>Calling and messaging</MkH2>
      <MkList items={[
        "Customers control call recording and are responsible for the consent notices their jurisdiction requires; agents can announce recording at the start of a call.",
        "Outbound calling includes configurable daily attempt caps and scheduling controls to support responsible contact practices.",
        "WhatsApp messaging runs on approved business providers (Twilio, WATI, Meta) under their respective business messaging policies.",
        "Opt-outs and do-not-contact requests can be honoured at workspace level.",
      ]} />

      <MkH2>AI transparency and control</MkH2>
      <MkList items={[
        "Evidence-based reporting: metrics reflect real calls, messages and bookings — never fabricated results.",
        "Human-in-the-loop approvals for consequential AI actions such as deployments, campaigns and content publication.",
        "Safety gates on AI-generated content that block invented statistics, fake testimonials and unsupportable claims.",
        "Audit trails for approvals and executed actions inside each workspace.",
      ]} />

      <MkH2>Questions</MkH2>
      <MkP>
        For data-processing agreements, sub-processor lists or compliance questionnaires, contact us
        via the <Link to="/contact" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>contact page</Link>{" "}
        and mention "Compliance". See also our{" "}
        <Link to="/privacy" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>Privacy Policy</Link> and{" "}
        <Link to="/security" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>Security page</Link>.
      </MkP>
    </MarketingPageShell>
  ),
});
