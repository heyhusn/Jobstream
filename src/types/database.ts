// Hand-written to match supabase/migrations/0001_init.sql.
// Once the project is linked, replace this file with the generated one:
//   supabase gen types typescript --linked > src/types/database.ts
//
// Every table carries `Relationships: []` and the schema carries
// `Views`/`Functions` even though we don't use them, because
// @supabase/postgrest-js's GenericSchema constraint requires that
// exact shape to type query results — omit them and every query
// silently collapses to `never` instead of failing loudly.

export type TaskStatus = "queued" | "running" | "done" | "failed";
export type TaskType =
  | "parse_resume"
  | "generate_matches"
  | "cover_letter"
  | "skill_gap"
  | "resume_optimize"
  | "interview_turn";
export type RemoteType = "remote" | "hybrid" | "onsite";
export type RiskBand = "low" | "medium" | "high";
export type CoverLetterTone = "professional" | "warm" | "direct";
export type InterviewMode = "behavioral" | "technical";
export type InterviewSessionStatus = "active" | "completed";

export interface InterviewTurn {
  question: string;
  answer: string | null;
  feedback: string | null;
  score: number | null;
}
export interface InterviewSummary {
  overall_feedback: string;
  strengths: string[];
  areas_to_improve: string[];
}
export type ApplicationStage =
  | "saved"
  | "applied"
  | "interviewing"
  | "offer"
  | "rejected"
  | "withdrawn";

export interface MatchSignal {
  label: string;
  delta: number;
  direction: "pass" | "fail";
}

type Rel = { Relationships: [] };

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          parsed: Record<string, unknown> | null;
          years_experience: number | null;
          work_authorisation: string | null;
          parse_confidence: number | null;
          remote_preference: RemoteType | "no_preference" | null;
          salary_floor: number | null;
          salary_currency: string;
          onboarded_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
      } & Rel;
      resumes: {
        Row: {
          id: string;
          user_id: string;
          version: number;
          storage_path: string;
          file_name: string;
          extracted_text: string | null;
          parse_report: Record<string, unknown> | null;
          is_primary: boolean;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["resumes"]["Row"],
          "id" | "created_at" | "version" | "is_primary" | "extracted_text" | "parse_report"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["resumes"]["Row"],
              "version" | "is_primary" | "extracted_text" | "parse_report"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["resumes"]["Row"]>;
      } & Rel;
      companies: {
        Row: {
          id: string;
          canonical_name: string;
          domain: string | null;
          ats_type: string | null;
          size_band: string | null;
          hq_country: string | null;
          enrichment: Record<string, unknown>;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["companies"]["Row"]> & {
          canonical_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Row"]>;
      } & Rel;
      jobs: {
        Row: {
          id: string;
          company_id: string | null;
          title: string;
          description: string;
          location: string | null;
          remote_type: RemoteType | null;
          salary_min: number | null;
          salary_max: number | null;
          salary_currency: string;
          salary_disclosed: boolean;
          source: string;
          apply_url: string;
          fingerprint: string;
          first_seen_at: string;
          last_seen_at: string;
          repost_count: number;
          posted_at: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["jobs"]["Row"]> & {
          title: string;
          description: string;
          source: string;
          apply_url: string;
          fingerprint: string;
        };
        Update: Partial<Database["public"]["Tables"]["jobs"]["Row"]>;
      } & Rel;
      ghost_signals: {
        Row: {
          job_id: string;
          days_open: number;
          repost_count: number;
          salary_disclosed: boolean;
          on_company_site: boolean;
          company_fill_rate: number | null;
          risk_score: number;
          risk_band: RiskBand;
          reasons: string[];
          computed_at: string;
        };
        Insert: Database["public"]["Tables"]["ghost_signals"]["Row"];
        Update: Partial<Database["public"]["Tables"]["ghost_signals"]["Row"]>;
      } & Rel;
      matches: {
        Row: {
          id: string;
          user_id: string;
          job_id: string;
          score: number;
          score_breakdown: MatchSignal[];
          explanation: string | null;
          computed_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["matches"]["Row"], "id" | "computed_at">;
        Update: Partial<Database["public"]["Tables"]["matches"]["Row"]>;
      } & Rel;
      applications: {
        Row: {
          id: string;
          user_id: string;
          job_id: string;
          stage: ApplicationStage;
          stage_order: number;
          resume_version_id: string | null;
          notes: string | null;
          applied_at: string | null;
          next_action_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["applications"]["Row"]> & {
          user_id: string;
          job_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["applications"]["Row"]>;
      } & Rel;
      tasks: {
        Row: {
          id: string;
          user_id: string;
          task_type: TaskType;
          status: TaskStatus;
          input: Record<string, unknown>;
          result: Record<string, unknown> | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tasks"]["Row"]> & {
          user_id: string;
          task_type: TaskType;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Row"]>;
      } & Rel;
      usage_events: {
        Row: {
          id: string;
          user_id: string;
          feature: string;
          credits_charged: number;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["usage_events"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["usage_events"]["Row"]>;
      } & Rel;
      cover_letters: {
        Row: {
          id: string;
          user_id: string;
          job_id: string;
          application_id: string | null;
          subject: string | null;
          body: string;
          tone: CoverLetterTone;
          notes: string | null;
          model: string;
          prompt_version: number;
          edited: boolean;
          generated_at: string;
          updated_at: string;
        };
        // No Insert type on purpose: rows are written only by the
        // Edge Function under the service role, so a letter's
        // provenance always reflects a real generation. The client
        // can read, edit the text, and delete.
        Insert: never;
        Update: Partial<
          Pick<Database["public"]["Tables"]["cover_letters"]["Row"], "subject" | "body">
        >;
      } & Rel;
      interview_sessions: {
        Row: {
          id: string;
          user_id: string;
          job_id: string;
          mode: InterviewMode;
          status: InterviewSessionStatus;
          turns: InterviewTurn[];
          turn_count: number;
          max_turns: number;
          summary: InterviewSummary | null;
          model: string | null;
          created_at: string;
          updated_at: string;
        };
        // No Insert/Update on purpose: every write goes through
        // interview-prep under the service role, so a session's
        // turns and summary always reflect a real evaluation.
        Insert: never;
        Update: never;
      } & Rel;
      credit_balances: {
        Row: {
          user_id: string;
          tier: "free" | "pro";
          credits_remaining: number;
          credits_reset_at: string;
        };
        Insert: Database["public"]["Tables"]["credit_balances"]["Row"];
        Update: Partial<Database["public"]["Tables"]["credit_balances"]["Row"]>;
      } & Rel;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
