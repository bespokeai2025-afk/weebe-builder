import * as React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

const SITE_NAME = "Webespoke AI Builder";
const NOTIFY_ADDR = "team@webespokeaibuilder.com";

interface PlanUpgradedProps {
  customerEmail?: string;
  previousPlan?: string;
  newPlan?: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
}

const PlanUpgradedEmail = ({
  customerEmail,
  previousPlan,
  newPlan,
  stripeSubscriptionId,
  stripeCustomerId,
}: PlanUpgradedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Customer upgraded their plan</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Plan upgrade — action may be required</Heading>
        <Text style={text}>
          A customer just upgraded their plan on <strong>{SITE_NAME}</strong>. Review the details
          below to see what new features, agents, or requirements may need provisioning for them.
        </Text>
        <Text style={row}>
          <strong>Customer:</strong> {customerEmail ?? "unknown"}
        </Text>
        <Text style={row}>
          <strong>Previous plan:</strong> {previousPlan ?? "—"}
        </Text>
        <Text style={row}>
          <strong>New plan:</strong> {newPlan ?? "—"}
        </Text>
        <Text style={row}>
          <strong>Subscription ID:</strong> {stripeSubscriptionId ?? "—"}
        </Text>
        <Text style={row}>
          <strong>Customer ID:</strong> {stripeCustomerId ?? "—"}
        </Text>
        <Text style={footer}>Internal notification sent to {NOTIFY_ADDR}</Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: PlanUpgradedEmail,
  subject: (data: Record<string, any>) =>
    `Customer upgraded${data?.newPlan ? ` → ${data.newPlan}` : ""}`,
  displayName: "Plan upgraded (internal)",
  to: NOTIFY_ADDR,
  previewData: {
    customerEmail: "jane@example.com",
    previousPlan: "Builder PAYG",
    newPlan: "Pro",
    stripeSubscriptionId: "sub_123",
    stripeCustomerId: "cus_123",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px", maxWidth: "560px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 16px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.6", margin: "0 0 18px" };
const row = { fontSize: "14px", color: "#333333", lineHeight: "1.6", margin: "0 0 6px" };
const footer = { fontSize: "12px", color: "#999999", margin: "24px 0 0" };
