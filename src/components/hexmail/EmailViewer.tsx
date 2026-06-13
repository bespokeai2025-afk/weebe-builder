import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Inbox,
  Send,
  Clock,
  Search,
  RefreshCw,
  Mail,
  MailOpen,
  ChevronRight,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type EmailTab = "inbox" | "sent" | "scheduled";

const TABS: { value: EmailTab; icon: typeof Inbox; label: string }[] = [
  { value: "inbox",     icon: Inbox, label: "Inbox"     },
  { value: "sent",      icon: Send,  label: "Sent"      },
  { value: "scheduled", icon: Clock, label: "Scheduled" },
];

interface MockEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  preview: string;
  date: string;
  opened: boolean;
  campaign?: string;
}

const MOCK_SENT: MockEmail[] = [
  {
    id: "1",
    from: "you@webee.ai",
    to: "alex.johnson@example.com",
    subject: "Following up on your demo request",
    preview: "Hi Alex, I wanted to follow up on the demo you requested last week...",
    date: "Jun 12, 2026",
    opened: true,
    campaign: "30-Day Warm Nurture",
  },
  {
    id: "2",
    from: "you@webee.ai",
    to: "sarah.k@techcorp.io",
    subject: "Your onboarding next steps",
    preview: "Welcome to the platform! Here are the next steps to get you started...",
    date: "Jun 11, 2026",
    opened: true,
    campaign: "Onboarding Series",
  },
  {
    id: "3",
    from: "you@webee.ai",
    to: "mike.chen@startup.co",
    subject: "Re: Pricing question",
    preview: "Thanks for reaching out about our enterprise pricing. I'd be happy to...",
    date: "Jun 10, 2026",
    opened: false,
    campaign: "Re-engagement",
  },
  {
    id: "4",
    from: "you@webee.ai",
    to: "jessica.m@leads.net",
    subject: "Quick check-in",
    preview: "Hi Jessica, just wanted to check in and see if you had any questions...",
    date: "Jun 9, 2026",
    opened: false,
  },
];

function EmailRow({ email, type }: { email: MockEmail; type: EmailTab }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/20 transition-colors",
        !email.opened && type === "sent" && "bg-primary/3",
      )}
      onClick={() => setExpanded((p) => !p)}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Read indicator */}
        <div className="mt-1 shrink-0">
          {type === "sent" ? (
            email.opened
              ? <MailOpen className="h-4 w-4 text-muted-foreground" />
              : <Mail className="h-4 w-4 text-primary" />
          ) : (
            <Circle className={cn("h-2.5 w-2.5 mt-0.5", email.opened ? "fill-muted-foreground text-muted-foreground" : "fill-primary text-primary")} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("text-sm truncate", !email.opened && type !== "inbox" ? "font-semibold" : "font-medium")}>
              {type === "sent" ? email.to : email.from}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {email.campaign && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary bg-primary/5">
                  {email.campaign}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground whitespace-nowrap">{email.date}</span>
            </div>
          </div>
          <p className={cn("text-sm truncate mt-0.5", !email.opened && type !== "inbox" ? "text-foreground" : "text-muted-foreground")}>
            {email.subject}
          </p>
          {!expanded && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{email.preview}</p>
          )}
        </div>

        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform mt-0.5", expanded && "rotate-90")} />
      </div>

      {expanded && (
        <div className="px-11 pb-4 space-y-2">
          <div className="rounded-lg border bg-card p-4 text-sm">
            <div className="flex gap-4 text-xs text-muted-foreground mb-3 pb-3 border-b">
              <span><strong className="text-foreground">From:</strong> {email.from}</span>
              <span><strong className="text-foreground">To:</strong> {email.to}</span>
            </div>
            <p className="text-muted-foreground leading-relaxed">{email.preview}</p>
            <p className="text-muted-foreground mt-2 leading-relaxed">
              Let me know if you have any questions or if there's anything I can help you with.
            </p>
            <p className="text-muted-foreground mt-2">Best regards</p>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab }: { tab: EmailTab }) {
  const configs = {
    inbox: {
      icon: Inbox,
      title: "Your inbox is empty",
      desc: "Replies from your campaigns and contacts will appear here.",
    },
    sent: {
      icon: Send,
      title: "No sent emails yet",
      desc: "Emails sent through your campaigns will appear here.",
    },
    scheduled: {
      icon: Clock,
      title: "No scheduled emails",
      desc: "Emails queued for future delivery will appear here.",
    },
  };
  const { icon: Icon, title, desc } = configs[tab];
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="rounded-full bg-muted/40 p-5">
        <Icon className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">{desc}</p>
      </div>
    </div>
  );
}

export function EmailViewer() {
  const [tab, setTab] = useState<EmailTab>("sent");
  const [search, setSearch] = useState("");

  const emails = tab === "sent" ? MOCK_SENT : [];
  const filtered = search.trim()
    ? emails.filter(
        (e) =>
          e.subject.toLowerCase().includes(search.toLowerCase()) ||
          e.to.toLowerCase().includes(search.toLowerCase()) ||
          e.from.toLowerCase().includes(search.toLowerCase()),
      )
    : emails;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        {/* Tab switcher */}
        <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 gap-0.5">
          {TABS.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === value
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {value === "sent" && MOCK_SENT.length > 0 && (
                <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  {MOCK_SENT.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 pl-8 w-52 text-xs"
              placeholder="Search emails…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Email list */}
      <div className="rounded-lg border overflow-hidden">
        {/* Column header */}
        <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-2.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-5" />
          <span className="flex-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {tab === "sent" ? "Recipient" : "From"}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Campaign</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-24 text-right">Date</span>
          <span className="w-5" />
        </div>

        {filtered.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          filtered.map((email) => (
            <EmailRow key={email.id} email={email} type={tab} />
          ))
        )}
      </div>

      {tab === "sent" && (
        <p className="text-xs text-muted-foreground text-center">
          Showing sample data — connect your email provider in Settings to see live emails.
        </p>
      )}
    </div>
  );
}
