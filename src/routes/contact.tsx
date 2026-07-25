import { createFileRoute } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MK } from "@/components/landing/MarketingPageShell";
import { TalkToUsForm } from "@/components/landing/TalkToUsForm";
import { useState } from "react";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — WEBEE Builder by Webespoke AI" },
      { name: "description", content: "Talk to the Webespoke AI team about WEBEE — demos, pricing, partnerships, careers or support. We'll come back to you the same working day where possible." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [formKey, setFormKey] = useState(0);
  return (
    <MarketingPageShell
      kicker="Company"
      title="Talk to us"
      intro="Whether you want a demo, a price, a partnership conversation or help with your workspace — send us a message and the team will come back to you."
      showCta={false}
    >
      <div style={{ marginTop: 28, maxWidth: 620 }}>
        <TalkToUsForm key={formKey} onClose={() => setFormKey(k => k + 1)} sourcePage="/contact" inline />
      </div>
      <MkH2>Other ways to reach us</MkH2>
      <MkP>
        Prefer to see the platform first? Visit{" "}
        <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>
          webespokeai.com
        </a>{" "}
        to book a demo, or try Ava — our AI receptionist — directly from the homepage.
      </MkP>
    </MarketingPageShell>
  );
}
