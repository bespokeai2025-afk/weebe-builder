/**
 * Builds the Retell `general_tools` definition for the document check tool.
 *
 * Drop this alongside the booking tools in retell.functions.ts when attaching
 * tools to an agent. The tool's webhook hits /api/public/retell/check-documents.
 *
 * Retell format: type="custom", url, speak_during_execution, parameters.
 */
export function buildDocumentTools() {
  const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  const base = `${PUBLIC_BASE_URL}/api/public/retell`;

  return [
    {
      type: "custom",
      name: "check_documents",
      description:
        "Check whether the caller has already uploaded their required documents. " +
        "Call this when the caller asks if their documents have been received, or when you need to verify " +
        "their document status before proceeding. " +
        "Pass the caller's phone number as 'phone'. " +
        "Returns a 'summary' field you can read aloud directly, plus structured counts. " +
        "If no documents are found and an upload_url is returned, you can offer to send them a link.",
      url: `${base}/check-documents`,
      speak_during_execution: true,
      execution_message_description:
        "Say: 'Let me just check that for you now, one moment.'",
      parameters: {
        type: "object",
        properties: {
          phone: {
            type: "string",
            description:
              "The caller's phone number in E.164 format e.g. +447700900000. " +
              "Use the number you are currently speaking with.",
          },
        },
        required: ["phone"],
      },
    },
  ];
}
