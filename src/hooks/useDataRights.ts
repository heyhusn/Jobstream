import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Data rights (roadmap M25 / minor m38): export your own data, or
 * delete your account. Both call server-side logic that enforces the
 * actual boundary (RLS + `auth.uid()` for export, a verified JWT for
 * deletion) — nothing here is a client-side-only safeguard.
 */

/**
 * Downloads everything `export_my_data()` (migration
 * 0021_data_rights.sql) returns as one JSON file. The RPC itself does
 * the real work; this just turns the returned object into a file the
 * browser saves, the same `Blob` + temporary `<a download>` pattern
 * any client-side export uses.
 */
export function useExportMyData() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("export_my_data");
      if (error) throw error;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jobspy-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}

/**
 * Permanently deletes the signed-in account and everything it owns.
 * `confirmation` must be the account's own email, checked server-side
 * against the verified caller identity — this function doesn't (and
 * can't) enforce that itself, it just forwards what the person typed.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (confirmation: string) => {
      const { data, error } = await supabase.functions.invoke("delete-my-account", {
        body: { confirmation },
      });
      if (error) {
        // A non-2xx response's real message (e.g. "Type your account
        // email exactly...") lives in the error's Response body, not
        // in the thrown error's own generic "non-2xx status" message —
        // worth the extra unwrap here given what's at stake.
        const context = (error as { context?: Response }).context;
        let detail: string | null = null;
        if (context) {
          try {
            const body = await context.json();
            if (typeof body?.error === "string") detail = body.error;
          } catch {
            // context wasn't JSON — fall through to the generic error
          }
        }
        throw detail ? new Error(detail) : error;
      }
      if (data?.error) throw new Error(data.error);
    },
  });
}
