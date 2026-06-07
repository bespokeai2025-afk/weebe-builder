import * as React from 'react'
import {
  Body, Container, Head, Heading, Html, Preview, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Webespoke AI Builder'

interface WelcomePurchaseProps {
  planName?: string
}

const WelcomePurchaseEmail = ({ planName }: WelcomePurchaseProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to {SITE_NAME} — your dashboard link is on the way</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Welcome aboard! 🎉</Heading>
        <Text style={text}>
          Thanks for purchasing {planName ? <strong>{planName}</strong> : 'your plan'} with{' '}
          <strong>{SITE_NAME}</strong>. Your payment was successful.
        </Text>
        <Text style={text}>
          We're getting your account ready. You'll receive a follow-up email shortly with
          the link to your dashboard and next steps for getting your AI agent up and running.
        </Text>
        <Text style={text}>
          If you have any questions in the meantime, just reply to this email — we're here to help.
        </Text>
        <Text style={footer}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomePurchaseEmail,
  subject: 'Welcome to Webespoke AI Builder — your dashboard is coming',
  displayName: 'Purchase welcome',
  previewData: { planName: 'Builder PAYG' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#000000', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.6', margin: '0 0 18px' }
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
