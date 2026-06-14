export interface CrmContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
}

export interface CrmCallActivityInput {
  phone: string;
  contactName?: string | null;
  agentName?: string | null;
  summary?: string | null;
  durationSeconds?: number | null;
  sentiment?: string | null;
  callId: string;
  calledAt?: string | null;
}

export interface CrmAdapter {
  name: string;
  upsertContact(contact: CrmContactInput): Promise<void>;
  logCallActivity(activity: CrmCallActivityInput): Promise<void>;
  healthCheck(): Promise<boolean>;
}
