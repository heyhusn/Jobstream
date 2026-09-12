import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { ApplicationStage, RemoteType } from "@/types/database";
import { STAGE_IDS } from "@/lib/stages";
import { dirtyRows } from "@/lib/board";

export interface ApplicationJob {
  id: string;
  title: string;
  location: string | null;
  remote_type: RemoteType | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  apply_url: string;
  posted_at: string | null;
  company: { id: string; canonical_name: string } | null;
}

export interface ApplicationItem {
  id: string;
  stage: ApplicationStage;
  stage_order: number;
  notes: string | null;
  applied_at: string | null;
  next_action_at: string | null;
  interview_at: string | null;
  interview_timezone: string | null;
  resume_version_id: string | null;
  created_at: string;
  updated_at: string;
  job: ApplicationJob;
}

/** Grouped by stage, each column already sorted by stage_order. */
export type Board = Record<ApplicationStage, ApplicationItem[]>;

export function emptyBoard(): Board {
  const board = {} as Board;
  for (const stage of STAGE_IDS) board[stage] = [];
  return board;
}

export function groupByStage(items: ApplicationItem[] | undefined): Board {
  const board = emptyBoard();
  for (const item of items ?? []) board[item.stage]?.push(item);
  for (const stage of STAGE_IDS) {
    board[stage].sort(
      (a, b) =>
        a.stage_order - b.stage_order ||
        // Deterministic tiebreak so two cards that share a
        // stage_order (a half-applied reorder, a concurrent write
        // from another tab) never flip position between renders.
        a.created_at.localeCompare(b.created_at)
    );
  }
  return board;
}

export function flattenBoard(board: Board): ApplicationItem[] {
  return STAGE_IDS.flatMap((stage) =>
    board[stage].map((item, index) => ({ ...item, stage, stage_order: index }))
  );
}

export function applicationsKey(userId: string | undefined) {
  return ["applications", userId] as const;
}

// The hand-written Database type declares no foreign-key
// Relationships, so postgrest-js can't type the nested select on
// its own — same containment strategy as useMatches: one honest
// interface and one cast at the query boundary.
interface RawApplicationRow extends Omit<ApplicationItem, "job"> {
  job: ApplicationJob | null;
}

const SELECT = `
  id, stage, stage_order, notes, applied_at, next_action_at,
  interview_at, interview_timezone,
  resume_version_id, created_at, updated_at,
  job:jobs (
    id, title, location, remote_type, salary_min, salary_max,
    salary_currency, apply_url, posted_at,
    company:companies ( id, canonical_name )
  )
` as const;

export function useApplications() {
  const { user } = useAuth();

  return useQuery({
    queryKey: applicationsKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<ApplicationItem[]> => {
      const { data, error } = await supabase
        .from("applications")
        .select(SELECT)
        .eq("user_id", user!.id)
        .order("stage_order", { ascending: true });

      if (error) throw error;

      // A job row can go away under an application (source
      // delisted it, a cleanup job ran). Dropping those rather
      // than rendering a card with no title is the honest read —
      // the alternative is a ghost card nobody can act on.
      return ((data ?? []) as unknown as RawApplicationRow[]).filter(
        (row): row is ApplicationItem => row.job != null
      );
    },
  });
}

/**
 * Match scores keyed by job id. Kept as its own query rather than
 * joined onto applications: there's no FK between the two tables,
 * and a tracked job doesn't have to have a match row at all (you
 * can apply to something that never cleared your bar).
 */
export function useMatchScores() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["match-scores", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("matches")
        .select("job_id, score")
        .eq("user_id", user!.id);

      if (error) throw error;

      const byJob: Record<string, number> = {};
      for (const row of data ?? []) byJob[row.job_id] = row.score;
      return byJob;
    },
  });
}

/**
 * Persists a whole board arrangement, writing only the rows whose
 * stage or position actually moved. A drop usually dirties two or
 * three rows, not the entire tracker, and sending the untouched
 * ones would churn `updated_at` on cards the person never touched.
 *
 * The optimistic cache write happens at the call site (the board
 * swaps its local drag state and the cache in the same tick, so
 * there's no frame where the card snaps back), which is why this
 * mutation only rolls back and refetches.
 */
export function useReorderApplications() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      next,
      previous,
    }: {
      next: ApplicationItem[];
      previous: ApplicationItem[];
    }) => {
      const dirty = dirtyRows(next, previous);
      if (dirty.length === 0) return;

      const before = new Map(previous.map((a) => [a.id, a]));

      const results = await Promise.all(
        dirty.map((a) => {
          const patch: {
            stage: ApplicationStage;
            stage_order: number;
            applied_at?: string;
          } = { stage: a.stage, stage_order: a.stage_order };

          // Stamp the date only when this drag is what moved the
          // card into Applied. Inserting a card renumbers the whole
          // column, so every other card in it is "dirty" too — and
          // stamping those re-fills a date the person deliberately
          // cleared, with today's.
          const wasStage = before.get(a.id)?.stage;
          if (a.stage === "applied" && wasStage !== "applied" && !a.applied_at) {
            patch.applied_at = new Date().toISOString();
          }

          return supabase.from("applications").update(patch).eq("id", a.id).eq("user_id", user!.id);
        })
      );

      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onMutate: async () => {
      // The optimistic write happens at the call site, but the
      // in-flight refetches still have to be stopped: any query that
      // resolves mid-drag overwrites the board with stale rows and
      // the card visibly jumps back for the length of the save.
      await qc.cancelQueries({ queryKey: applicationsKey(user?.id) });
    },
    onError: (_err, vars) => {
      // Restore positions without resurrecting rows. `previous` is a
      // snapshot from drag-start, so writing it back wholesale undoes
      // anything else that happened in between — most visibly, a card
      // the person deleted mid-save reappears on the board after
      // they were told it was gone.
      const positions = new Map(vars.previous.map((a) => [a.id, a]));
      qc.setQueryData<ApplicationItem[]>(applicationsKey(user?.id), (current) =>
        (current ?? []).map((a) => {
          const was = positions.get(a.id);
          return was ? { ...a, stage: was.stage, stage_order: was.stage_order } : a;
        })
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: applicationsKey(user?.id) });
    },
  });
}

export type ApplicationPatch = Partial<
  Pick<
    ApplicationItem,
    | "stage"
    | "stage_order"
    | "notes"
    | "applied_at"
    | "next_action_at"
    | "interview_at"
    | "interview_timezone"
    | "resume_version_id"
  >
>;

/** Field-level edits from the drawer, optimistic and rolled back on failure. */
export function useUpdateApplication() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = applicationsKey(user?.id);

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ApplicationPatch }) => {
      const { error } = await supabase
        .from("applications")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ApplicationItem[]>(key);
      qc.setQueryData<ApplicationItem[]>(key, (old) =>
        (old ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a))
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeleteApplication() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = applicationsKey(user?.id);

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("applications")
        .delete()
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ApplicationItem[]>(key);
      qc.setQueryData<ApplicationItem[]>(key, (old) => (old ?? []).filter((a) => a.id !== id));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["tracked-job-ids", user?.id] });
    },
  });
}

/**
 * Job ids already on the board, mapped to their current stage.
 * Matches/Search use `.has()` (a Map supports the same call as the
 * Set this used to be) to show "Saved" instead of "Save to tracker";
 * the stage itself backs the roadmap's minor m11 — an explicit
 * "you applied here before" warning at the moment someone is about
 * to click through to apply again, not just a disabled save button.
 */
export function useTrackedJobIds() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["tracked-job-ids", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Map<string, ApplicationStage>> => {
      const { data, error } = await supabase
        .from("applications")
        .select("job_id, stage")
        .eq("user_id", user!.id);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.job_id, r.stage as ApplicationStage]));
    },
  });
}

/**
 * Saving from Matches. New cards go to the top of Saved rather
 * than the bottom — the thing you just saved is the thing you're
 * about to act on.
 */
export function useSaveToTracker() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data: existing } = await supabase
        .from("applications")
        .select("id")
        .eq("user_id", user!.id)
        .eq("job_id", jobId)
        .maybeSingle();

      // unique (user_id, job_id) — saving twice is a no-op, not an error.
      if (existing) return;

      const { data: top } = await supabase
        .from("applications")
        .select("stage_order")
        .eq("user_id", user!.id)
        .eq("stage", "saved")
        .order("stage_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      const { error } = await supabase.from("applications").insert({
        user_id: user!.id,
        job_id: jobId,
        stage: "saved",
        stage_order: (top?.stage_order ?? 0) - 1,
      });

      // The check above is a read, so another tab — or a retry whose
      // first request actually landed — can insert between it and
      // here. `unique (user_id, job_id)` catches that, and the row
      // being there is exactly what was wanted: reporting it as a
      // failure shows "Saved to tracker" and an error banner at once.
      if (error && error.code !== "23505") throw error;
    },
    onMutate: async (jobId) => {
      const key = ["tracked-job-ids", user?.id];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Set<string>>(key);
      qc.setQueryData<Set<string>>(key, (old) => new Set(old).add(jobId));
      return { previous };
    },
    onError: (_err, _jobId, ctx) => {
      if (ctx?.previous) qc.setQueryData(["tracked-job-ids", user?.id], ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tracked-job-ids", user?.id] });
      qc.invalidateQueries({ queryKey: applicationsKey(user?.id) });
    },
  });
}

/** Resume versions, for the drawer's "applied with" select. */
export function useResumes() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["resumes", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resumes")
        .select("id, version, file_name, is_primary, created_at")
        .eq("user_id", user!.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
