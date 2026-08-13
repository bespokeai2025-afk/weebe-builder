/**
 * Inbox teams — named groups of workspace members that a conversation can be routed to,
 * mirroring WATI's Teams concept.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  createWhatsappTeam,
  deleteWhatsappTeam,
  getWhatsappInboxMeta,
  listWhatsappTeams,
  setWhatsappTeamMembers,
} from "@/lib/dashboard/whatsapp.functions";

export function WhatsAppTeamsPanel() {
  const qc = useQueryClient();
  const listTeamsFn = useServerFn(listWhatsappTeams);
  const metaFn = useServerFn(getWhatsappInboxMeta);
  const createFn = useServerFn(createWhatsappTeam);
  const deleteFn = useServerFn(deleteWhatsappTeam);
  const setMembersFn = useServerFn(setWhatsappTeamMembers);

  const [newTeam, setNewTeam] = useState("");

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["wa-teams"],
    queryFn: () => listTeamsFn(),
    throwOnError: false,
  });

  const { data: meta } = useQuery({
    queryKey: ["wa-inbox-meta"],
    queryFn: () => metaFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["wa-teams"] });
    qc.invalidateQueries({ queryKey: ["wa-inbox-meta"] });
  };

  const create = useMutation({
    mutationFn: () => createFn({ data: { name: newTeam.trim() } }),
    onSuccess: () => {
      setNewTeam("");
      refresh();
      toast.success("Team created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (teamId: string) => deleteFn({ data: { teamId } }),
    onSuccess: () => {
      refresh();
      toast.success("Team deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setMembers = useMutation({
    mutationFn: (vars: { teamId: string; userIds: string[] }) => setMembersFn({ data: vars }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Inbox Teams
      </p>

      <div className="flex gap-2">
        <Input
          placeholder="New team name…"
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTeam.trim()) {
              e.preventDefault();
              create.mutate();
            }
          }}
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={!newTeam.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          Add
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading teams…</p>
      ) : teams.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No teams yet. Create one to route conversations to a group instead of one person.
        </p>
      ) : (
        <ul className="space-y-2">
          {teams.map((team) => (
            <li key={team.id} className="rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs font-medium">{team.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {team.memberIds.length} member{team.memberIds.length === 1 ? "" : "s"}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  aria-label={`Delete team ${team.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(team.id)}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {(meta?.members ?? []).map((m) => {
                  const checked = team.memberIds.includes(m.userId);
                  return (
                    <label
                      key={m.userId}
                      className="flex cursor-pointer items-center gap-1.5 text-[10px]"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setMembers.mutate({
                            teamId: team.id,
                            userIds: next
                              ? [...team.memberIds, m.userId]
                              : team.memberIds.filter((id) => id !== m.userId),
                          })
                        }
                      />
                      {m.name ?? m.userId.slice(0, 8)}
                    </label>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
