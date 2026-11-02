CREATE TABLE "org_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"openrouter_key_enc" text,
	"openrouter_key_last4" text,
	"ai_model" text,
	"ai_daily_limit" integer,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_updated_by_id_members_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;