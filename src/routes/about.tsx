import { createFileRoute } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MkCardGrid } from "@/components/landing/MarketingPageShell";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — WEBEE Builder by Webespoke AI" },
      { name: "description", content: "Webespoke AI builds WEBEE, the complete AI voice agent platform — design, deploy and manage intelligent voice and WhatsApp agents from one place." },
    ],
  }),
  component: () => (
    <MarketingPageShell
      kicker="Company"
      title="About Webespoke AI"
      intro="We build WEBEE — the platform that lets businesses design, deploy and run AI voice and messaging agents without an engineering team."
    >
      <MkH2>Our mission</MkH2>
      <MkP>
        Every missed call is a missed customer. Webespoke AI exists to make sure no business has to
        choose between growing and answering the phone. WEBEE gives companies of any size an AI
        receptionist, qualification team and operations layer that works around the clock —
        answering calls, qualifying leads, booking appointments and following up automatically.
      </MkP>
      <MkH2>What we build</MkH2>
      <MkCardGrid cards={[
        { title: "WEBEE Builder", body: "A visual flow builder for designing AI voice agents — conversation logic, knowledge bases, integrations and deployment in one canvas." },
        { title: "Voice & WhatsApp Agents", body: "Production-grade AI agents that handle inbound and outbound calls and WhatsApp conversations with natural, low-latency speech." },
        { title: "Smart Dash", body: "Live dashboards, call analytics, lead pipelines and campaign performance — the operational picture in real time." },
        { title: "AI Executives", body: "SystemMind, GrowthMind and HiveMind — AI leaders that give every workspace technical, marketing and operational intelligence." },
      ]} />
      <MkH2>How we work</MkH2>
      <MkP>
        We are a UK-based team that believes in honest software: real integrations, real results and
        evidence-based reporting. WEBEE never fakes an outcome — every metric on your dashboard is
        backed by a real call, message or booking.
      </MkP>
    </MarketingPageShell>
  ),
});
