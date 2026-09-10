import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { TaskStatus, TaskType } from "@/types/database";

/**
 * Every generation feature in JobSpy (resume parse, cover letter,
 * skill gap, interview turn) follows one shape: write a row to
 * `tasks`, then watch that row until it's done. Whatever fulfils
 * it — a Supabase Edge Function today, a Celery worker once the
 * FastAPI backend exists — only has to update the same row, so
 * this hook never has to change when the backend does.
 *
 * Realtime is the primary channel; a slow poll runs alongside it
 * as a fallback, since Realtime can silently miss a delivery on a
 * flaky connection and a stuck "running" spinner is worse than an
 * extra request every few seconds.
 */

export interface TaskRow<TResult = Record<string, unknown>> {
  id: string;
  status: TaskStatus;
  result: TResult | null;
  error: string | null;
}

type TaskState<TResult> =
  | { phase: "idle" }
  | { phase: "queued"; taskId: string }
  | { phase: "running"; taskId: string }
  | { phase: "done"; taskId: string; result: TResult }
  | { phase: "failed"; taskId: string; error: string };

const POLL_MS = 4000;

export function useAsyncTask<TInput extends Record<string, unknown>, TResult = Record<string, unknown>>(
  taskType: TaskType
) {
  const [state, setState] = useState<TaskState<TResult>>({ phase: "idle" });
  const pollRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // `run` awaits two round trips before any state change lands, so
  // a double-click gets through twice and inserts two tasks — two
  // charges for one result. A ref flips synchronously; state does not.
  const inFlightRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    pollRef.current = null;
    channelRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  function applyRow(row: TaskRow<TResult>) {
    if (row.status === "done") {
      // Note the missing `&& row.result`: a task that finishes with
      // a null result is still finished. Requiring one left the UI
      // spinning forever on a state it could never leave.
      inFlightRef.current = false;
      setState({ phase: "done", taskId: row.id, result: (row.result ?? {}) as TResult });
      cleanup();
    } else if (row.status === "failed") {
      inFlightRef.current = false;
      setState({ phase: "failed", taskId: row.id, error: row.error ?? "Something went wrong." });
      cleanup();
    } else if (row.status === "running") {
      setState((s) => (s.phase === "done" || s.phase === "failed" ? s : { phase: "running", taskId: row.id }));
    }
  }

  /** Watch a task that already exists — a retry, or one this
   *  component wasn't mounted for when it was created. */
  const watch = useCallback(
    (taskId: string) => {
      cleanup();
      inFlightRef.current = true;
      setState({ phase: "running", taskId });
      subscribe(taskId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cleanup]
  );

  function subscribe(taskId: string) {
    // Realtime: push updates as they land.
    channelRef.current = supabase
      .channel(`task-${taskId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks", filter: `id=eq.${taskId}` },
        (payload) => applyRow(payload.new as TaskRow<TResult>)
      )
      .subscribe();

    // Fallback: poll in case a Realtime event is missed.
    pollRef.current = window.setInterval(async () => {
      const { data: row } = await supabase
        .from("tasks")
        .select("id, status, result, error")
        .eq("id", taskId)
        .single();
      if (row) applyRow(row as TaskRow<TResult>);
    }, POLL_MS);
  }

  const run = useCallback(async (input: TInput) => {
    // Two clicks land inside the window below; the second must not
    // create a second task.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    cleanup();
    setState({ phase: "queued", taskId: "" });

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      inFlightRef.current = false;
      setState({ phase: "failed", taskId: "", error: "You need to be signed in." });
      return;
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: userData.user.id, task_type: taskType, input, status: "queued" })
      .select("id, status, result, error")
      .single();

    if (error || !data) {
      inFlightRef.current = false;
      setState({ phase: "failed", taskId: "", error: error?.message ?? "Could not start the task." });
      return;
    }

    setState({ phase: "queued", taskId: data.id });
    subscribe(data.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskType, cleanup]);

  const reset = useCallback(() => {
    inFlightRef.current = false;
    cleanup();
    setState({ phase: "idle" });
  }, [cleanup]);

  return { state, run, watch, reset };
}
