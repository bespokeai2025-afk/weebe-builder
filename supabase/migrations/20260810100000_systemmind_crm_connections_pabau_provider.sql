-- Allow Pabau as a SystemMind CRM connection provider (DNR medical receptionist).
ALTER TABLE public.systemmind_crm_connections
  DROP CONSTRAINT IF EXISTS systemmind_crm_connections_provider_check;

ALTER TABLE public.systemmind_crm_connections
  ADD CONSTRAINT systemmind_crm_connections_provider_check
  CHECK (provider IN (
    'hubspot','salesforce','pipedrive','gohighlevel','dynamics','zoho',
    'pabau','webee','generic_rest','webhook'
  ));
