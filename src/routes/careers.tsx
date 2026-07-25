import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MkList, MK } from "@/components/landing/MarketingPageShell";

export const Route = createFileRoute("/careers")({
  head: () => ({
    meta: [
      { title: "Careers — WEBEE Builder by Webespoke AI" },
      { name: "description", content: "Join Webespoke AI and help build WEBEE, the complete AI voice agent platform. See how we work and register your interest." },
    ],
  }),
  component: () => (
    <MarketingPageShell
      kicker="Company"
      title="Careers at Webespoke AI"
      intro="We're a small, focused team building the AI operations layer for real businesses. If you like shipping honest software that customers rely on every day, we'd like to hear from you."
    >
      <MkH2>How we work</MkH2>
      <MkList items={[
        "Small team, high ownership — everyone ships work that reaches customers directly",
        "Evidence over hype — we build real integrations and report real results",
        "Customer-first — our roadmap is driven by what working businesses actually need",
        "Remote-friendly, UK-based",
      ]} />
      <MkH2>Open roles</MkH2>
      <MkP>
        We don't have publicly advertised openings right now, but we're always interested in
        exceptional people across engineering, AI/ML, customer success and sales.
      </MkP>
      <MkH2>Register your interest</MkH2>
      <MkP>
        Send a short introduction and what you'd want to work on through our{" "}
        <Link to="/contact" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>
          contact page
        </Link>{" "}
        — mention "Careers" in your message and we'll keep you in mind as the team grows.
      </MkP>
    </MarketingPageShell>
  ),
});
