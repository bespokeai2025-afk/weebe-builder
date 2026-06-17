---
name: Business DNA + Proactive HiveMind OS
description: Architecture for DNA discovery engine, stored briefings, 15-section campaign packages, proactive scheduler tick, and unified action centre.
---

## Key files
- `supabase/migrations/20260717000004_business_dna_briefings.sql` — extends growthmind_business_dna (confidence_scores, discovery_sources + 19 fields), creates hivemind_briefings, extends growthmind_campaign_proposals (15 new cols). MUST be applied manually in Supabase SQL Editor.
- `src/lib/hivemind/dna-discovery.server.ts` — AI extraction from calls/leads/KBs/campaigns; merges into growthmind_business_dna with confidence scores
- `src/lib/hivemind/briefing-generator.server.ts` — daily/weekly/monthly briefing generation (GPT-4o); saves to hivemind_briefings
- `src/lib/hivemind/business-dna.functions.ts` — all server fns: getBusinessDna, updateBusinessDna, runDnaDiscovery, generateBriefing, listBriefings, getBriefing, markBriefingRead, getUnreadBriefingCount, generateDnaProposalsFn
- `src/lib/hivemind/proactive-engine.ts` — daily scheduler tick (DNA refresh + briefing generation); called from campaign-executor.ts
- `src/lib/growthmind/growthmind.campaign-proposals.ts` — extended with generateFullCampaignPackage (15-section GPT-4o generation); getCampaignProposals now selects all extended cols

## Routes
- `/hivemind/business-dna` — DNA completeness ring, 6 sections, confidence bars, Re-discover button
- `/hivemind/briefings` — list + full view, generate buttons for daily/weekly/monthly

## Action Centre (hivemind.actions.tsx)
- New "Campaign Proposals" tab (first tab); renders ProposalCard with full 15-section expand
- "Generate from DNA" button calls generateDnaProposalsFn
- handlePropApprove/handlePropReject call updateProposalStatus server fn
- Separate query key: "campaign-proposals-actions"

## generateFullCampaignPackage pattern
- Called as plain async fn (not server fn) from business-dna.functions.ts
- Uses buildBusinessContext() from growthmind.business-context.ts + DNA row for richer context
- Returns { count, ids } — inserts directly via supabaseAdmin

## Scheduler integration
- proactive-engine.ts exports runProactiveTick(sb, workspaceId)
- campaign-executor.ts calls it in Promise.all alongside other ticks
- Response JSON now includes proactiveEngine: { workspacesScanned, dnaRefreshed, briefingsGenerated, errors }

## Why nothing auto-executes
All DNA discoveries, briefings, and campaign proposals go through growthmind_campaign_proposals (status=draft) or hivemind_actions (status=pending). User must approve via action centre.
