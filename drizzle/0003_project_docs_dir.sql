ALTER TABLE "projects" ADD COLUMN "docs_dir" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_docs_dir_unique" UNIQUE("docs_dir");