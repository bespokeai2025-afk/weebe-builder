import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MkList, MK } from "@/components/landing/MarketingPageShell";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — WEBEE Builder by Webespoke AI" },
      { name: "description", content: "The terms governing use of the WEBEE platform provided by Webespoke AI Ltd." },
    ],
  }),
  component: () => (
    <MarketingPageShell
      kicker="Legal"
      title="Terms of Service"
      intro="These terms govern your use of the WEBEE platform and related services provided by Webespoke AI Ltd. By creating an account or using the platform you agree to them."
      showCta={false}
    >
      <MkP><em style={{ color: MK.dim }}>Last updated: 25 July 2026</em></MkP>

      <MkH2>1. The service</MkH2>
      <MkP>
        WEBEE is a platform for designing, deploying and operating AI voice and messaging agents,
        together with analytics, CRM, campaign and AI-executive features. Features available to you
        depend on your subscription package and any usage limits that apply to it.
      </MkP>

      <MkH2>2. Accounts and workspaces</MkH2>
      <MkList items={[
        "You must provide accurate account information and keep your credentials secure.",
        "You are responsible for all activity in your workspace, including users you invite.",
        "Workspaces are isolated; you must not attempt to access data belonging to another workspace.",
      ]} />

      <MkH2>3. Acceptable use</MkH2>
      <MkP>You agree not to use the platform to:</MkP>
      <MkList items={[
        "Make unlawful, deceptive or unsolicited calls or messages, or breach telemarketing, spam or recording-consent laws applicable in your jurisdiction.",
        "Impersonate a human where disclosure of AI use is legally required, or misrepresent who is calling.",
        "Upload or process content that is illegal, infringing or harmful.",
        "Probe, disrupt or overload the platform, or attempt to extract other customers' data.",
      ]} />
      <MkP>
        You are responsible for ensuring your use of AI agents — including call recording,
        transcription and data capture — complies with the laws that apply to your business and for
        obtaining any consents required from your own customers.
      </MkP>

      <MkH2>4. Subscriptions and billing</MkH2>
      <MkList items={[
        "Fees, seats and usage allowances are set by your chosen package.",
        "Usage-based charges (such as call minutes and AI generation) are billed as consumed.",
        "Fees are non-refundable except where required by law or expressly agreed.",
        "We may suspend service for non-payment after reasonable notice.",
      ]} />

      <MkH2>5. Your data</MkH2>
      <MkP>
        You retain all rights to the data you and your customers put into your workspace. You grant
        us the licence needed to host and process it to provide the service. Our handling of
        personal data is described in the{" "}
        <Link to="/privacy" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>Privacy Policy</Link>.
      </MkP>

      <MkH2>6. AI output</MkH2>
      <MkP>
        AI-generated content — including agent speech, drafts, recommendations and analyses — is
        produced by statistical models and may contain errors. You are responsible for reviewing
        AI output before relying on it or publishing it. The platform is designed to report real,
        evidence-based results and to require approval for consequential actions.
      </MkP>

      <MkH2>7. Availability and support</MkH2>
      <MkP>
        We aim for high availability but the service is provided "as is" and we do not guarantee
        uninterrupted operation. Planned maintenance and third-party provider outages may affect
        availability. Support is provided through the contact channels published on this site.
      </MkP>

      <MkH2>8. Liability</MkH2>
      <MkP>
        Nothing in these terms excludes liability that cannot be excluded by law. Otherwise, our
        total liability arising out of the service in any 12-month period is limited to the fees you
        paid for the service in that period, and we are not liable for indirect or consequential
        losses, loss of profits or loss of data caused by events outside our reasonable control.
      </MkP>

      <MkH2>9. Termination</MkH2>
      <MkP>
        You may cancel your subscription at any time, effective at the end of the current billing
        period. We may suspend or terminate accounts that materially breach these terms. On
        termination you may export your data for a limited period before it is deleted.
      </MkP>

      <MkH2>10. General</MkH2>
      <MkP>
        These terms are governed by the laws of England and Wales and the courts of England and
        Wales have exclusive jurisdiction. We may update these terms; material changes will be
        notified in advance through the platform or by email.
      </MkP>
    </MarketingPageShell>
  ),
});
