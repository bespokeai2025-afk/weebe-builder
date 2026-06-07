import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

import { template as welcomePurchase } from './welcome-purchase'
import { template as planUpgraded } from './plan-upgraded'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'welcome-purchase': welcomePurchase,
  'plan-upgraded': planUpgraded,
}
