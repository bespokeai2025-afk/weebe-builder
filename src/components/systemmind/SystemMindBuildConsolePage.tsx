import { useEffect, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Hammer, GitBranch, Layers, Zap, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { SystemMindBuildWorkspacePage } from "./SystemMindBuildWorkspacePage";
import { SystemMindWorkflowsPage } from "./SystemMindWorkflowsPage";
import { WorkflowDraftsPage } from "./WorkflowDraftsPage";
import { SystemMindAutomationPage } from "./SystemMindAutomationPage";
import { SystemMindFixPlansPage } from "./SystemMindFixPlansPage";

export type BuildConsoleTab = "build" | "workflows" | "drafts" | "automation" | "fix-plans";

const CONSOLE_TABS: Array<{ value: BuildConsoleTab; label: string; icon: React.ElementType }> = [
  { value: "build",      label: "Build",      icon: Hammer    },
  { value: "workflows",  label: "Workflows",  icon: GitBranch },
  { value: "drafts",     label: "Drafts",     icon: Layers    },
  { value: "automation", label: "Automation", icon: Zap       },
  { value: "fix-plans",  label: "Fix Plans",  icon: Wrench    },
];

const TAB_VALUES = CONSOLE_TABS.map((t) => t.value) as readonly string[];

// One console for all SystemMind build work: building agents/workflows,
// reviewing drafts, approving automation, and running fix plans — replacing
// the five separate sidebar pages that used to hold these.
export function SystemMindBuildConsolePage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    tab?: string; session?: string; workflow?: string; agent?: string; convert?: string;
  };

  // Deep-link params (session/agent/convert) always mean the Build tab.
  const hasBuildParams = Boolean(search.session || search.agent || search.convert);
  const urlTab: BuildConsoleTab = hasBuildParams
    ? "build"
    : (TAB_VALUES.includes(search.tab ?? "") ? (search.tab as BuildConsoleTab) : "build");

  const [activeTab, setActiveTab] = useState<BuildConsoleTab>(urlTab);

  // Keep tab in sync when the URL changes (e.g. a draft "open in builder" link).
  useEffect(() => { setActiveTab(urlTab); }, [urlTab]);

  function selectTab(tab: BuildConsoleTab) {
    setActiveTab(tab);
    navigate({
      to: "/systemmind/build",
      search: (prev: Record<string, unknown>) => ({ ...prev, tab }),
      replace: true,
    });
  }

  return (
    <SystemMindShell>
      <div className="px-4 pt-4 md:px-6">
        <div className="flex items-center gap-1 border-b border-white/[0.06] overflow-x-auto no-scrollbar">
          {CONSOLE_TABS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => selectTab(value)}
              className={cn(
                "flex items-center gap-1.5 px-3 pb-2 pt-1 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                activeTab === value
                  ? "border-sky-400 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={activeTab === "build" ? "px-4 md:px-6" : undefined}>
        {activeTab === "build"      && <SystemMindBuildWorkspacePage embedded />}
        {activeTab === "workflows"  && <SystemMindWorkflowsPage />}
        {activeTab === "drafts"     && <WorkflowDraftsPage embedded />}
        {activeTab === "automation" && <div className="p-6"><SystemMindAutomationPage embedded /></div>}
        {activeTab === "fix-plans"  && <SystemMindFixPlansPage embedded />}
      </div>
    </SystemMindShell>
  );
}
