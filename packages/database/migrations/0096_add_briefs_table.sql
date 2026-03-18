CREATE TABLE IF NOT EXISTS "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text,
	"cron_job_id" text,
	"topic_id" text,
	"agent_id" text,
	"type" text NOT NULL,
	"priority" text DEFAULT 'info',
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"artifacts" jsonb,
	"actions" jsonb,
	"comment_type" text,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_cron_job_id_agent_cron_jobs_id_fk";--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_cron_job_id_agent_cron_jobs_id_fk" FOREIGN KEY ("cron_job_id") REFERENCES "public"."agent_cron_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_user_id_idx" ON "briefs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_task_id_idx" ON "briefs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_cron_job_id_idx" ON "briefs" USING btree ("cron_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_agent_id_idx" ON "briefs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_type_idx" ON "briefs" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_priority_idx" ON "briefs" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_unresolved_idx" ON "briefs" USING btree ("user_id","resolved_at");
