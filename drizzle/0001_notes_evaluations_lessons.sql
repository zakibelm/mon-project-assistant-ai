CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text,
	"problem_type" text NOT NULL,
	"title" text NOT NULL,
	"problem" text NOT NULL,
	"resolution" text NOT NULL,
	"recommendation" text NOT NULL,
	"weight" real NOT NULL,
	"source_task_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "problem_type" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "note_problem" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "note_resolution" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "note_author_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "note_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rated_by_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "validated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "validated_by_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lessons_org_idx" ON "lessons" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_note_author_id_members_id_fk" FOREIGN KEY ("note_author_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_rated_by_id_members_id_fk" FOREIGN KEY ("rated_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_validated_by_id_members_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_rating_range" CHECK ("tasks"."rating" is null or "tasks"."rating" between 1 and 5);