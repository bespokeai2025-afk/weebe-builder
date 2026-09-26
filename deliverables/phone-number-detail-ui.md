# Phone Number Detail UI — implementation review

## Scope and entry point

Implemented on `aditya/ui-light-mode`. **Phone Numbers** now opens a single-page workspace: searchable directory on the left and selected number settings on the right. The first owned number is displayed by default. Selecting another number updates `/phone-numbers?numberId=<record UUID>` in place; browser history and reload preserve the selection. No raw phone number is placed in the URL. Unknown IDs, query failures and loading have explicit states. Purchase/import, manual add and selected-number edit/delete actions remain available beside the directory. On mobile, the directory stacks above the settings.

The supplied written Retell reference defined the information architecture. No separate Retell screenshot was available in this attachment. This implementation uses WEBEE's actual components and existing theme surfaces.

## Files

- `src/components/telephony/PhoneNumberDetail.tsx`: compact header, name editor, agent controls, country fields, fallback field, advanced add-ons and copy action.
- `src/components/telephony/PhoneNumberWorkspace.tsx`: searchable persistent directory, selected state and responsive split view.
- `src/routes/_authenticated/phone-numbers.tsx`: optional ID search parameter, number selection, loading/error states and existing server-function connections.
- `tests/component/phone-number-detail.test.tsx`: unavailable-state and name-persistence success/failure tests.
- `tests/component/phone-number-workspace.test.tsx`: search and selection while the detail remains visible.
- `deliverables/phone-number-detail-ui.md`: this handoff.

## Existing architecture

This checkout has `/phone-numbers`; the previously discussed `/numbers` route is absent. No old-branch feature commit was imported in this phase.

`listPhoneNumbers` retrieves workspace-scoped records and joined agent names. Records contain ID, phone number, friendly name, provider/provider SID, workspace/configuration IDs, assigned agent, capabilities, active state and timestamps. The detail UI only renders safe display metadata. It does not present account credentials or provider SIDs.

`savePhoneNumber` supports friendly-name updates. Because that function also writes capabilities, the UI validates and passes the existing voice/SMS values instead of inventing defaults. `assignVoiceNumberToAgent` stores the assignment and attempts to refresh Twilio routing; the UI reports when routing refresh did not succeed. Agent options reuse the existing authenticated agent query.

The inbound webhook uses the record's shared `agent_id`. Removing an agent is not an explicit reject/disable operation. Existing outbound initiation also defaults to that same assignment. There is no independent outbound-agent setting in this model.

## Capability map

| Feature | Existing support | Detail UI |
| --- | --- | --- |
| Friendly name | Supported | Inline edit; real save, pending and error feedback |
| Inbound agent assignment | Supported; routing refresh can fail separately | Real assignment; accurate routing feedback |
| Inbound disable | Partial: unassignment only | “None assigned”; no promise that calls are disabled |
| A/B testing | Unsupported in inspected telephony code | Disabled switches, both directions |
| User inbound webhook | Unsupported; internal provider webhook is different | Disabled checkbox and explanation |
| Inbound country restrictions | Unsupported here | Disabled field; provider restrictions explicitly remain applicable |
| Fallback number | Unsupported here | Disabled labelled input |
| Outbound agent assignment | Partial: shared number assignment | Read-only selector showing shared agent |
| Outbound country restrictions | Unsupported here | Disabled field and explanation |
| Outbound calling | Existing server function, not wired in this phase | Disabled header button |
| SMS setup | Number capability exists; no number-detail setup wired | Disabled setup action |
| Verified caller ID | No supported setup found in inspected telephony code | Disabled setup action |
| Branded calling | No supported setup found in inspected telephony code | Disabled setup action |

Automated approval review rejected adding the real outbound-call flow because calls can contact third parties and incur charges beyond the visual-shell request. Explicit approval is needed to enable that flow. The existing backend was left unchanged.

## Visual and interaction decisions

One configuration column, four sections, full-width approximately 40px controls, compact section headings and separated add-on rows. Header actions align right on desktop and stack on mobile. A/B labels wrap instead of colliding with field labels. Add-on actions stack below descriptions on narrow screens.

Existing background/card/border/foreground/input tokens provide the light and dark surfaces. Shared primary buttons are black with white text at rest and turn solid yellow with near-black text on hover, using a 180ms transition and no gradient or glow. Browser checks verify both themes, button sizes, disabled/destructive states and reduced motion. Phone Numbers actions use the existing small button size (32px) and standard icon size (36px), while form fields remain 40px. The directory's selected-number accent stays yellow. Disabled actions have no hover animation, and reduced motion is respected. Destructive/secondary/ghost button variants retain their semantic styling. No non-button theme tokens changed.

The global primary-button theme lives in `src/components/ui/button-theme.css` and is imported by `src/components/ui/button.tsx`, including consumers of `buttonVariants`. Custom native buttons that do not use the shared primitive are not automatically restyled by this change.

Existing Button, Input, Select, Switch, Checkbox and DropdownMenu primitives are reused. Labels and descriptions are linked to controls. Saving/error feedback uses status/alert roles; editable actions have accessible names and existing keyboard focus treatment. Unsupported settings cannot issue saves. Clipboard confirmation appears only after the clipboard write succeeds.

No new API, database persistence, schema migration, provisioning change, pricing change, credential-resolution change or WhatsApp change was added. No actual calls, purchases, assignments or production record updates were made during verification.

## Verification

- After the split-view update, the workspace search/selection test passed in the first run and all three detail tests passed in the second run. Both combined attempts had a worker-start timeout for the other file. All four tests executed successfully across those attempts, but there is no clean combined run; the runner failure remains a verification limitation.
- Previous detail implementation full typecheck: 625 diagnostics before and 625 after. No diagnostics were reported for the detail component. The route's existing `Parameters<typeof saveFn>[0]["data"]` typing error remains unchanged. The full diagnostic-by-diagnostic comparison was stopped for excessive runtime; matching totals alone do not prove absence of every possible regression. Full typecheck was not repeated for the subsequent layout-only split-view update. No unrelated baseline errors were fixed.
- Focused ESLint check passes for the workspace, detail component and new workspace test after the split-view update.
- `git diff --check` passes.
- Four full-page rendered previews captured at 1440px and 390px, light and dark. No horizontal overflow and no browser page errors in the preview run.
- Screenshots use a representative fixture rendered with the real component and project CSS, not an authenticated production record. Its persistence callbacks deliberately reject. The external Inter font was unavailable during capture, so the configured system fallback is used.
- The actual local `/phone-numbers` route correctly redirects a fresh browser session to `/login?redirect=%2Fphone-numbers`, with no browser page errors. Authenticated end-to-end saves, real provider routing, database permissions and the application-wide shell were not visually verified. These remain integration checks, not claimed passes.

Preview assets are in `C:/Users/Adi/OneDrive/Pictures/Documents/ChatGPT/Weebee AI/phone-number-qa/`: `desktop-light.png`, `desktop-dark.png`, `mobile-light.png`, `mobile-dark.png`.

## Future phases

Explicit inbound-disable semantics, separate outbound assignment, country enforcement, fallback routing, traffic splits, user webhooks and add-on setup each need approved backend support before their controls can become operational. Outbound initiation already has a server function but needs approval and provider-specific readiness verification for the new entry point.

Stop at visual review of this detail UI. Dashboard/analytics and other pages are outside this phase.
