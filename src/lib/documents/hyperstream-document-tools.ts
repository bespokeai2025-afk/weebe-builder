/**
 * Builds the OpenAI Realtime function tool definition for the document check
 * tool when running through HyperStream.
 *
 * Mirrors the Retell version in document-tools.server.ts but uses the
 * HyperStream endpoint and includes `agent_id` as a required parameter
 * (same pattern as hyperstream-booking-tools.ts).
 *
 * The `url` field is NOT sent to OpenAI (it strips unknown fields) but is
 * read back by tool-executor.ts to know where to POST when the tool fires.
 */
export function buildHyperStreamDocumentTools(agentId: string) {
  const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  const base = `${PUBLIC_BASE_URL}/api/public/hyperstream`;

  return [
    {
      type: "custom",
      name: "send_upload_link",
      description:
        "Generate a secure document upload link for the caller and send it to them by SMS. " +
        "Call this when the caller wants to send their documents but hasn't done so yet, " +
        "or when you need to resend the upload link. " +
        "Pass the caller's phone number as 'phone'. " +
        "Returns a 'summary' field you can read aloud directly, and a 'sms_sent' boolean. " +
        "If sms_sent is true, tell the caller to check their messages. " +
        "If sms_sent is false, inform them the link couldn't be texted.",
      url: `${base}/send-upload-link`,
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: `Your agent identifier. Always pass exactly: "${agentId}"`,
          },
          phone: {
            type: "string",
            description:
              "The caller's phone number in E.164 format e.g. +447700900000. " +
              "Use the number you are currently speaking with.",
          },
        },
        required: ["agent_id", "phone"],
      },
    },
    {
      type: "custom",
      name: "check_documents",
      description:
        "Check whether the caller has already uploaded their required documents. " +
        "Call this when the caller asks if their documents have been received, or when you need to verify " +
        "their document status before proceeding. " +
        "Pass the caller's phone number as 'phone'. " +
        "Returns a 'summary' field you can read aloud directly, plus structured counts and an upload_url " +
        "you can offer to send if no documents have been uploaded yet.",
      url: `${base}/check-documents`,
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: `Your agent identifier. Always pass exactly: "${agentId}"`,
          },
          phone: {
            type: "string",
            description:
              "The caller's phone number in E.164 format e.g. +447700900000. " +
              "Use the number you are currently speaking with.",
          },
        },
        required: ["agent_id", "phone"],
      },
    },
  ];
}
