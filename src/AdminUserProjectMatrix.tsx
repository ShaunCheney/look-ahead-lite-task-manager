import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

type ProjectRole = "admin" | "editor" | "viewer";

type UserProfileRow = {
  user_id: string;
};

type ProjectRow = {
  id: string;
  name: string;
};

type ProjectMemberRow = {
  user_id: string;
  project_id: string;
  role: ProjectRole;
};

type Props = {
  isSuperAdmin: boolean;
};

function makeKey(userId: string, projectId: string) {
  return `${userId}:${projectId}`;
}

export default function AdminUserProjectMatrix({ isSuperAdmin }: Props) {
  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutatingKeys, setMutatingKeys] = useState<Set<string>>(() => new Set());

  const memberByKey = useMemo(() => {
    const map = new Map<string, ProjectMemberRow>();
    for (const member of members) {
      map.set(makeKey(member.user_id, member.project_id), member);
    }
    return map;
  }, [members]);

  useEffect(() => {
    let cancelled = false;

    async function loadMatrix() {
      if (!isSuperAdmin) {
        if (!cancelled) {
          setUsers([]);
          setProjects([]);
          setMembers([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const usersPromise = supabase
          .from("user_profiles")
          .select("user_id")
          .order("user_id", { ascending: true });

        const projectsPromise = supabase
          .from("projects")
          .select("id,name")
          .order("name", { ascending: true });

        const membersPromise = supabase
          .from("project_members")
          .select("user_id,project_id,role");

        const [
          { data: userRows, error: usersError },
          { data: projectRows, error: projectsError },
          { data: memberRows, error: membersError },
        ] = await Promise.all([usersPromise, projectsPromise, membersPromise]);

        if (usersError) throw usersError;
        if (projectsError) throw projectsError;
        if (membersError) throw membersError;

        if (cancelled) return;

        setUsers((userRows || []) as UserProfileRow[]);
        setProjects((projectRows || []) as ProjectRow[]);
        setMembers((memberRows || []) as ProjectMemberRow[]);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load access data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMatrix();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  async function handleToggle(userId: string, projectId: string, checked: boolean) {
    if (!isSuperAdmin) return;
    const key = makeKey(userId, projectId);
    if (mutatingKeys.has(key)) return;

    const existing = memberByKey.get(key);
    if (checked && existing) return;
    if (!checked && !existing) return;

    setMutatingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    const previousMembers = members;

    try {
      if (checked) {
        const optimistic: ProjectMemberRow = {
          user_id: userId,
          project_id: projectId,
          role: "viewer",
        };
        setMembers((prev) => [...prev, optimistic]);
        const { error: insertError } = await supabase
          .from("project_members")
          .insert({ user_id: userId, project_id: projectId, role: "viewer" });
        if (insertError) throw insertError;
      } else {
        setMembers((prev) =>
          prev.filter((member) => !(member.user_id === userId && member.project_id === projectId))
        );
        const { error: deleteError } = await supabase
          .from("project_members")
          .delete()
          .eq("user_id", userId)
          .eq("project_id", projectId);
        if (deleteError) throw deleteError;
      }
    } catch (err: any) {
      setMembers(previousMembers);
      setError(err?.message || "Failed to update access.");
    } finally {
      setMutatingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function handleRoleChange(userId: string, projectId: string, role: ProjectRole) {
    if (!isSuperAdmin) return;
    const key = makeKey(userId, projectId);
    if (mutatingKeys.has(key)) return;

    const existing = memberByKey.get(key);

    setMutatingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    const previousMembers = members;

    try {
      if (existing) {
        setMembers((prev) =>
          prev.map((member) =>
            member.user_id === userId && member.project_id === projectId
              ? { ...member, role }
              : member
          )
        );
        const { error: updateError } = await supabase
          .from("project_members")
          .update({ role })
          .eq("user_id", userId)
          .eq("project_id", projectId);
        if (updateError) throw updateError;
      } else {
        const optimistic: ProjectMemberRow = {
          user_id: userId,
          project_id: projectId,
          role,
        };
        setMembers((prev) => [...prev, optimistic]);
        const { error: insertError } = await supabase
          .from("project_members")
          .insert({ user_id: userId, project_id: projectId, role });
        if (insertError) throw insertError;
      }
    } catch (err: any) {
      setMembers(previousMembers);
      setError(err?.message || "Failed to update role.");
    } finally {
      setMutatingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  if (!isSuperAdmin) return null;

  if (loading) {
    return <div className="text-sm text-neutral-500">Loading access matrix...</div>;
  }

  if (error) {
    return <div className="text-sm text-rose-600">{error}</div>;
  }

  if (users.length === 0) {
    return <div className="text-sm text-neutral-500">No users found.</div>;
  }

  if (projects.length === 0) {
    return <div className="text-sm text-neutral-500">No projects found.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border border-neutral-200">
        <thead className="bg-neutral-50">
          <tr>
            <th className="text-left p-2 border-b border-neutral-200">User</th>
            {projects.map((project) => (
              <th key={project.id} className="text-left p-2 border-b border-neutral-200">
                {project.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.user_id} className="border-b border-neutral-200">
              <td className="p-2 align-top font-medium">{user.user_id}</td>
              {projects.map((project) => {
                const key = makeKey(user.user_id, project.id);
                const member = memberByKey.get(key);
                const checked = !!member;
                const isMutating = mutatingKeys.has(key);
                return (
                  <td key={project.id} className="p-2 align-top">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isMutating}
                        onChange={(e) => handleToggle(user.user_id, project.id, e.target.checked)}
                      />
                      <span className="text-xs text-neutral-500">Access</span>
                    </label>
                    {checked && (
                      <select
                        className="mt-2 w-full border border-neutral-200 rounded px-2 py-1 text-sm bg-white"
                        value={member?.role || "viewer"}
                        disabled={isMutating}
                        onChange={(e) => handleRoleChange(user.user_id, project.id, e.target.value as ProjectRole)}
                      >
                        <option value="admin">admin</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
