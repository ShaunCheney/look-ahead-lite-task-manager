import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type ProjectRole = "admin" | "editor" | "viewer";
type AccessRole = ProjectRole | "none";

type UserProfileRow = {
  user_id: string;
  email: string | null;
  is_super_admin: boolean | null;
};

type ProjectRow = {
  id: string;
  name?: string | null;
  title?: string | null;
};

type ProjectMemberRow = {
  project_id: string;
  user_id: string;
  role: ProjectRole;
};

type Props = {
  isSuperAdmin: boolean;
};

function makeKey(userId: string, projectId: string) {
  return `${userId}:${projectId}`;
}

function projectLabel(project: ProjectRow) {
  return project.name || project.title || project.id;
}

function normalizeRole(value: any): ProjectRole {
  return value === "admin" || value === "editor" || value === "viewer" ? value : "viewer";
}

function applyMemberRole(
  members: ProjectMemberRow[],
  userId: string,
  projectId: string,
  role: AccessRole
) {
  if (role === "none") {
    return members.filter((member) => !(member.user_id === userId && member.project_id === projectId));
  }
  let found = false;
  const next = members.map((member) => {
    if (member.user_id === userId && member.project_id === projectId) {
      found = true;
      return { ...member, role };
    }
    return member;
  });
  if (!found) {
    next.push({ user_id: userId, project_id: projectId, role });
  }
  return next;
}

export default function AdminUserAccessPanel({ isSuperAdmin }: Props) {
  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "access">("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [mutatingKeys, setMutatingKeys] = useState<Set<string>>(() => new Set());
  const [adminMutatingIds, setAdminMutatingIds] = useState<Set<string>>(() => new Set());
  const [reloadToken, setReloadToken] = useState(0);

  const memberByKey = useMemo(() => {
    const map = new Map<string, ProjectMemberRow>();
    for (const member of members) {
      map.set(makeKey(member.user_id, member.project_id), member);
    }
    return map;
  }, [members]);

  const selectedUser = users.find((u) => u.user_id === selectedUserId) || null;

  useEffect(() => {
    let cancelled = false;

    async function loadAccessPanel() {
      if (!isSuperAdmin) {
        if (!cancelled) {
          setUsers([]);
          setProjects([]);
          setMembers([]);
          setSelectedUserId("");
          setLoading(false);
          setError(null);
          setNotice(null);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const usersPromise = supabase
          .from("user_profiles")
          .select("user_id,email,is_super_admin")
          .order("email", { ascending: true });

        const projectsPromise = supabase
          .from("projects")
          .select("id,name,title")
          .order("name", { ascending: true });

        const membersPromise = supabase
          .from("project_members")
          .select("project_id,user_id,role");

        const [
          { data: userRows, error: usersError },
          { data: projectRows, error: projectsError },
          { data: memberRows, error: membersError },
        ] = await Promise.all([usersPromise, projectsPromise, membersPromise]);

        if (usersError) throw usersError;
        if (projectsError) throw projectsError;
        if (membersError) throw membersError;

        if (cancelled) return;

        const normalizedUsers: UserProfileRow[] = (userRows || []).map((row: any) => ({
          user_id: row.user_id,
          email: row.email ?? null,
          is_super_admin: row.is_super_admin ?? null,
        }));

        const normalizedProjects: ProjectRow[] = (projectRows || []).map((row: any) => ({
          id: row.id,
          name: row.name ?? null,
          title: row.title ?? null,
        }));

        const normalizedMembers: ProjectMemberRow[] = (memberRows || []).map((row: any) => ({
          project_id: row.project_id,
          user_id: row.user_id,
          role: normalizeRole(row.role),
        }));

        setUsers(normalizedUsers);
        setProjects(normalizedProjects);
        setMembers(normalizedMembers);
        setSelectedUserId((prev) => {
          if (prev && normalizedUsers.some((u) => u.user_id === prev)) return prev;
          return normalizedUsers[0]?.user_id || "";
        });
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load access data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAccessPanel();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, reloadToken]);

  async function handleSuperAdminToggle(userId: string, nextValue: boolean) {
    if (!isSuperAdmin) return;
    if (adminMutatingIds.has(userId)) return;

    setNotice(null);
    setAdminMutatingIds((prev) => {
      const next = new Set(prev);
      next.add(userId);
      return next;
    });

    const previousUsers = users;
    setUsers((prev) =>
      prev.map((user) =>
        user.user_id === userId ? { ...user, is_super_admin: nextValue } : user
      )
    );

    try {
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ is_super_admin: nextValue })
        .eq("user_id", userId);
      if (updateError) throw updateError;
      setNotice({
        type: "success",
        message: nextValue ? "Super admin granted." : "Super admin removed.",
      });
    } catch (err: any) {
      setUsers(previousUsers);
      setNotice({ type: "error", message: err?.message || "Failed to update super admin." });
    } finally {
      setAdminMutatingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  async function handleAccessRoleChange(userId: string, projectId: string, nextRole: AccessRole) {
    if (!isSuperAdmin) return;
    const key = makeKey(userId, projectId);
    if (mutatingKeys.has(key)) return;

    const existing = memberByKey.get(key);
    if (!existing && nextRole === "none") return;
    if (existing && existing.role === nextRole) return;

    setNotice(null);
    setMutatingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    setMembers((prev) => applyMemberRole(prev, userId, projectId, nextRole));

    try {
      if (nextRole === "none") {
        const { error } = await supabase
          .from("project_members")
          .delete()
          .eq("project_id", projectId)
          .eq("user_id", userId);
        if (error) throw error;
        setNotice({ type: "success", message: "Access removed." });
      } else if (existing) {
        const { error } = await supabase
          .from("project_members")
          .update({ role: nextRole })
          .eq("project_id", projectId)
          .eq("user_id", userId);
        if (error) throw error;
        setNotice({ type: "success", message: "Role updated." });
      } else {
        const { error } = await supabase
          .from("project_members")
          .insert({ project_id: projectId, user_id: userId, role: nextRole });
        if (error) throw error;
        setNotice({ type: "success", message: "Access granted." });
      }
    } catch (err: any) {
      setMembers((prev) => applyMemberRole(prev, userId, projectId, existing?.role ?? "none"));
      setNotice({ type: "error", message: err?.message || "Failed to update access." });
    } finally {
      setMutatingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  if (!isSuperAdmin) return null;

  return (
    <Card className="rounded-2xl border border-neutral-200 bg-white">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Internal Users</div>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => setReloadToken((prev) => prev + 1)}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>

        {notice && (
          <div className={`text-sm ${notice.type === "success" ? "text-emerald-600" : "text-rose-600"}`}>
            {notice.message}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-neutral-500">Loading access data...</div>
        ) : error ? (
          <div className="text-sm text-rose-600">{error}</div>
        ) : users.length === 0 ? (
          <div className="text-sm text-neutral-500">No users found.</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-neutral-500">No projects found.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[240px_1fr]">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50">
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                Users
              </div>
              <div className="max-h-[380px] overflow-y-auto">
                {users.map((user) => {
                  const isSelected = user.user_id === selectedUserId;
                  const label = user.email || user.user_id;
                  return (
                    <button
                      key={user.user_id}
                      type="button"
                      onClick={() => setSelectedUserId(user.user_id)}
                      className={`w-full text-left px-3 py-2 border-b border-neutral-200 ${
                        isSelected ? "bg-neutral-900 text-white" : "hover:bg-white"
                      }`}
                    >
                      <div className="text-sm font-medium truncate">{label}</div>
                      {user.email && (
                        <div className={`text-xs truncate ${isSelected ? "text-white/70" : "text-neutral-500"}`}>
                          {user.user_id}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-200">
                <Button
                  size="sm"
                  className="rounded-full"
                  variant={activeTab === "overview" ? "default" : "secondary"}
                  onClick={() => setActiveTab("overview")}
                >
                  Overview
                </Button>
                <Button
                  size="sm"
                  className="rounded-full"
                  variant={activeTab === "access" ? "default" : "secondary"}
                  onClick={() => setActiveTab("access")}
                >
                  Job Access
                </Button>
              </div>

              <div className="p-4 space-y-3">
                {!selectedUser ? (
                  <div className="text-sm text-neutral-500">Select a user to manage access.</div>
                ) : activeTab === "overview" ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-neutral-500">Email</div>
                      <div className="text-sm font-semibold">
                        {selectedUser.email || "No email on file"}
                      </div>
                      <div className="text-xs text-neutral-500">{selectedUser.user_id}</div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">Super Admin</div>
                        <div className="text-xs text-neutral-500">Full access to all projects.</div>
                      </div>
                      <Switch
                        checked={!!selectedUser.is_super_admin}
                        onCheckedChange={(checked) => handleSuperAdminToggle(selectedUser.user_id, checked)}
                        disabled={adminMutatingIds.has(selectedUser.user_id)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {projects.map((project) => {
                      const key = makeKey(selectedUser.user_id, project.id);
                      const member = memberByKey.get(key);
                      const checked = !!member;
                      const isMutating = mutatingKeys.has(key);
                      return (
                        <div
                          key={project.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{projectLabel(project)}</div>
                            <div className="text-xs text-neutral-500">
                              {checked ? `Role: ${member?.role || "viewer"}` : "No access"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) =>
                                handleAccessRoleChange(
                                  selectedUser.user_id,
                                  project.id,
                                  value === true ? "viewer" : "none"
                                )
                              }
                              disabled={isMutating}
                            />
                            {checked && (
                              <Select
                                value={member?.role || "viewer"}
                                onValueChange={(value) =>
                                  handleAccessRoleChange(
                                    selectedUser.user_id,
                                    project.id,
                                    value as ProjectRole
                                  )
                                }
                                disabled={isMutating}
                              >
                                <SelectTrigger className="w-[140px] bg-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white">
                                  <SelectItem value="admin">admin</SelectItem>
                                  <SelectItem value="editor">editor</SelectItem>
                                  <SelectItem value="viewer">viewer</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
