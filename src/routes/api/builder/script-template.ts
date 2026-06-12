import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/builder/script-template")({
  server: {
    handlers: {
      GET: async () => {
        // Dynamic import keeps docx out of the client bundle entirely
        const {
          Document,
          Packer,
          Paragraph,
          TextRun,
          HeadingLevel,
          AlignmentType,
          BorderStyle,
          ShadingType,
          TableRow,
          TableCell,
          Table,
          WidthType,
          convertInchesToTwip,
        } = await import("docx");

        // ── Helpers ────────────────────────────────────────────────────────

        const h1 = (text: string) =>
          new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } });

        const h2 = (text: string) =>
          new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 } });

        const h3 = (text: string) =>
          new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 180, after: 60 } });

        const p = (text: string, bold = false, italic = false) =>
          new Paragraph({
            children: [new TextRun({ text, bold, italics: italic, size: 22 })],
            spacing: { after: 80 },
          });

        const li = (text: string) =>
          new Paragraph({
            children: [new TextRun({ text, size: 22 })],
            bullet: { level: 0 },
            spacing: { after: 60 },
          });

        const kv = (label: string, value: string) =>
          new Paragraph({
            children: [
              new TextRun({ text: `${label}  `, bold: true, size: 22 }),
              new TextRun({ text: value, size: 22, color: "444444" }),
            ],
            spacing: { after: 60 },
          });

        const hr = () =>
          new Paragraph({
            text: "",
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
            spacing: { after: 200 },
          });

        const row = (a: string, b: string) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: a, font: "Courier New", size: 20 })] })],
                width: { size: 44, type: WidthType.PERCENTAGE },
                shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
                margins: { top: convertInchesToTwip(0.04), bottom: convertInchesToTwip(0.04), left: convertInchesToTwip(0.1), right: convertInchesToTwip(0.06) },
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: "→", size: 20, bold: true, color: "888888" })] })],
                width: { size: 6, type: WidthType.PERCENTAGE },
                margins: { top: convertInchesToTwip(0.04), bottom: convertInchesToTwip(0.04) },
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: b, font: "Courier New", size: 20, color: "1a56db" })] })],
                width: { size: 50, type: WidthType.PERCENTAGE },
                shading: { type: ShadingType.CLEAR, fill: "EFF6FF" },
                margins: { top: convertInchesToTwip(0.04), bottom: convertInchesToTwip(0.04), left: convertInchesToTwip(0.1), right: convertInchesToTwip(0.1) },
              }),
            ],
          });

        const table = (rows: [string, string][]) =>
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows.map(([a, b]) => row(a, b)),
          });

        // ── Document ───────────────────────────────────────────────────────

        const doc = new Document({
          styles: {
            paragraphStyles: [
              {
                id: "Heading1",
                name: "Heading 1",
                basedOn: "Normal",
                next: "Normal",
                quickFormat: true,
                run: { size: 28, bold: true, color: "1a56db" },
                paragraph: { spacing: { before: 320, after: 120 } },
              },
              {
                id: "Heading2",
                name: "Heading 2",
                basedOn: "Normal",
                next: "Normal",
                quickFormat: true,
                run: { size: 24, bold: true, color: "111827" },
                paragraph: { spacing: { before: 240, after: 80 } },
              },
              {
                id: "Heading3",
                name: "Heading 3",
                basedOn: "Normal",
                next: "Normal",
                quickFormat: true,
                run: { size: 22, bold: true, color: "4B5563" },
                paragraph: { spacing: { before: 180, after: 60 } },
              },
            ],
          },
          sections: [
            {
              properties: {
                page: {
                  margin: {
                    top:    convertInchesToTwip(1),
                    bottom: convertInchesToTwip(1),
                    left:   convertInchesToTwip(1.2),
                    right:  convertInchesToTwip(1.2),
                  },
                },
              },
              children: [
                // Title block
                new Paragraph({
                  children: [new TextRun({ text: "OmniVoice Script Template", bold: true, size: 40, color: "1a56db" })],
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 80 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: "Use this structure to get clean, accurate flow imports every time.", size: 22, color: "6B7280", italics: true })],
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 360 },
                }),
                hr(),

                // Business Overview
                h1("=== BUSINESS OVERVIEW ==="),
                p("Replace this with a short description of your company, services, and key facts the agent needs to know. This section is auto-detected and injected into the global prompt — it will NEVER be spoken aloud.", false, true),
                p(""),
                p("We are SolarEdge Solutions, a residential solar installation company based in Austin, Texas. We help homeowners reduce their electricity bills by up to 80% with custom solar panel systems. Our installations come with a 25-year performance guarantee and a zero-deposit finance option."),
                p(""),
                hr(),

                // Agent Personality
                h1("=== AGENT PERSONALITY & VOICE ==="),
                p("Define who the agent is. Auto-detected and becomes the identity section of the global prompt.", false, true),
                p(""),
                kv("Agent Name:", "Maya"),
                kv("Role:", "Solar Savings Consultant"),
                kv("Personality:", "Warm, confident, and consultative. Maya speaks like a knowledgeable friend — not a salesperson. She listens carefully, uses the customer's first name naturally, and never rushes."),
                kv("Tone:", "Friendly and upbeat, but professional. Avoid filler words. Keep sentences short and conversational."),
                kv("Key Phrases:", '"That\'s a great question", "Totally understand", "Most of our customers see a return within 5 to 7 years"'),
                p(""),
                hr(),

                // Important Notes
                h1("=== IMPORTANT NOTES ==="),
                p("Rules, compliance constraints, and escalation instructions. Auto-routed to global prompt.", false, true),
                p(""),
                li("Never quote exact prices — always offer a free custom quote."),
                li("Do not discuss competitor companies."),
                li("If the caller becomes aggressive or upset, transfer to the human support team."),
                li("Always confirm the caller's name and address before booking."),
                p(""),
                hr(),

                // Conversation Script
                h1("CONVERSATION SCRIPT"),
                p("Use STEP N: headers. One instruction per step. Each step becomes one node in the flow.", false, true),
                p(""),

                h2("STEP 1: Opening Greeting"),
                p("Hi, this is Maya calling from SolarEdge Solutions. Am I speaking with [first name]?"),
                p("(pause)", false, true),
                p("I'm reaching out because homeowners in your area have been taking advantage of the new state solar rebate programme — and I wanted to see if your home might qualify."),
                p(""),

                h2("STEP 2: Permission Check"),
                p("Is now a good time for a quick two-minute chat?"),
                p(""),

                h2("STEP 3: Qualify — Home Ownership"),
                p("Do you own your home, or are you renting?"),
                p(""),
                li("If yes / owns home: move to step 4."),
                li("If no / renting: politely explain the programme is for homeowners only, thank them for their time, and end the call."),
                p(""),

                h2("STEP 4: Qualify — Electricity Bill"),
                p("And roughly how much is your monthly electricity bill at the moment?"),
                p(""),
                li("If under $100: savings may be smaller, but still note the interest and continue."),
                li("If over $100: great, this is ideal for the programme — move to step 5."),
                p(""),

                h2("STEP 5: Benefit Pitch"),
                p("With a system sized for your home, most of our customers cut their bill by 70 to 80 percent. (pause) And with our zero-deposit finance option, most people are cash-positive from day one."),
                p(""),

                h2("STEP 6: Schedule a Survey"),
                p("I'd love to get one of our local energy advisors to run a free no-obligation assessment for your home. It takes about 30 minutes and there's absolutely no pressure to proceed."),
                p(""),
                p("Would you be open to scheduling that?"),
                p(""),
                li("If yes / interested: move to booking."),
                li("If not now / call me back: acknowledge, offer a callback time, and end politely."),
                li("If not interested: thank them and close the call gracefully."),
                p(""),

                h2("STEP 7: Book Appointment"),
                p("Let me find a time that works for you."),
                p(""),
                p("Can I also grab your email address so we can send the confirmation? (spell it back letter-by-letter to confirm)"),
                p(""),
                p("And the best phone number to reach you on?"),
                p(""),
                p("[BOOKING — schedule a free solar assessment with the local advisor team; collect full name, email, and phone before booking; infer timezone from area code and confirm with caller]", true),
                p(""),

                h2("STEP 8: Confirm Details"),
                p("Perfect! I've got you booked in. Just to confirm — your name is [full name], the email is [email], and the best number is [phone number]?"),
                p("(pause)", false, true),
                p("And I've got you in [timezone] — does that sound right?"),
                p(""),

                h2("STEP 9: Closing"),
                p("Brilliant. You'll receive a confirmation text shortly. Our advisor will be in touch 24 hours before the appointment to confirm."),
                p(""),
                p("Is there anything else I can help you with today?"),
                p("(pause)", false, true),
                p("Wonderful — thanks so much for your time, [first name]. We look forward to meeting you. Have a great day!"),
                p(""),

                h2("STEP 10: End Call"),
                p(""),
                hr(),

                // Formatting Tips
                h1("FORMATTING TIPS FOR CLEAN IMPORTS"),
                p("Use these conventions in your own scripts to ensure 100% clean conversion every time."),
                p(""),

                h3("Section Headings — auto-routed to global prompt, never spoken"),
                table([
                  ["=== BUSINESS OVERVIEW ===",        "Company facts, services, pricing"],
                  ["=== AGENT PERSONALITY & VOICE ===", "Agent name, style, tone, identity"],
                  ["=== IMPORTANT NOTES ===",           "Rules, compliance, prohibited topics"],
                  ["=== FAQ ===",                       "Reference info the agent can draw on"],
                ]),
                p(""),

                h3("Conversation Steps — each becomes one flow node"),
                table([
                  ["STEP 1: Title", "One step = one node"],
                  ["1. Title",      "Numbered format also works"],
                ]),
                p("One instruction per step. Split two questions into two steps.", false, true),
                p(""),

                h3("Variables — auto-converted to builder format"),
                table([
                  ["[first name]",   "{{first_name}}"],
                  ["[full name]",    "{{full_name}}"],
                  ["[phone number]", "{{phone_number}}"],
                  ["[address]",      "{{address}}"],
                  ["[email]",        "{{email}}"],
                  ["[company name]", "{{company_name}}"],
                  ["[date]",         "{{date}}"],
                  ["[time]",         "{{time}}"],
                ]),
                p(""),

                h3("Pauses — auto-converted to voice instructions"),
                table([
                  ["(pause)",       "[pause]"],
                  ["(brief pause)", "[pause briefly]"],
                  ["(long pause)",  "[pause 2 seconds]"],
                ]),
                p(""),

                h3("Special Node Types"),
                table([
                  ["If yes: ..., If no: ...", "logic_split node with branches"],
                  ["[BOOKING — description]", "5-node Cal.com booking flow"],
                  ["transfer to [team name]", "call_transfer node"],
                ]),
              ],
            },
          ],
        });

        const buffer = await Packer.toBuffer(doc);

        return new Response(buffer, {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition":
              'attachment; filename="omnvoice-script-template.docx"',
            "Content-Length": String(buffer.byteLength),
          },
        });
      },
    },
  },
});
