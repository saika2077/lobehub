CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"seq" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_agent_id" text,
	"assignee_user_id" text,
	"assignee_agent_id" text,
	"parent_task_id" text,
	"name" text,
	"description" varchar(255),
	"instruction" text NOT NULL,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" integer DEFAULT 0,
	"heartbeat_interval" integer DEFAULT 300,
	"heartbeat_timeout" integer,
	"last_heartbeat_at" timestamp with time zone,
	"schedule_pattern" text,
	"schedule_timezone" text DEFAULT 'UTC',
	"total_topics" integer DEFAULT 0,
	"max_topics" integer,
	"current_topic_id" text,
	"context" jsonb DEFAULT '{}'::jsonb,
	"config" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"depends_on_id" text NOT NULL,
	"type" text DEFAULT 'blocks' NOT NULL,
	"condition" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"document_id" text NOT NULL,
	"pinned_by" text DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_created_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" DROP CONSTRAINT IF EXISTS "task_dependencies_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" DROP CONSTRAINT IF EXISTS "task_dependencies_depends_on_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" DROP CONSTRAINT IF EXISTS "task_documents_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" DROP CONSTRAINT IF EXISTS "task_documents_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_deps_unique_idx" ON "task_dependencies" USING btree ("task_id","depends_on_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_deps_task_id_idx" ON "task_dependencies" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_deps_depends_on_id_idx" ON "task_dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_docs_unique_idx" ON "task_documents" USING btree ("task_id","document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_docs_task_id_idx" ON "task_documents" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_docs_document_id_idx" ON "task_documents" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_identifier_idx" ON "tasks" USING btree ("identifier","created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_created_by_user_id_idx" ON "tasks" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_created_by_agent_id_idx" ON "tasks" USING btree ("created_by_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_user_id_idx" ON "tasks" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_agent_id_idx" ON "tasks" USING btree ("assignee_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_priority_idx" ON "tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_heartbeat_idx" ON "tasks" USING btree ("status","last_heartbeat_at");
