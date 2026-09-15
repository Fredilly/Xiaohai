CREATE TABLE "permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
  "role_id" uuid NOT NULL,
  "permission_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
  "staff_account_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_roles_pk" PRIMARY KEY("staff_account_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "staff_data_scopes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staff_account_id" uuid NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_data_scopes_scope_shape_check" CHECK (("scope_type" = 'GLOBAL' and "scope_id" is null) or ("scope_type" in ('REGION', 'FRANCHISEE', 'STORE') and "scope_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_data_scopes" ADD CONSTRAINT "staff_data_scopes_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_unique" ON "permissions" USING btree ("key");
--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_unique" ON "roles" USING btree ("key");
--> statement-breakpoint
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions" USING btree ("permission_id");
--> statement-breakpoint
CREATE INDEX "staff_roles_role_id_idx" ON "staff_roles" USING btree ("role_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_data_scopes_staff_type_id_unique" ON "staff_data_scopes" USING btree ("staff_account_id","scope_type","scope_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_data_scopes_staff_global_unique" ON "staff_data_scopes" USING btree ("staff_account_id") WHERE "scope_type" = 'GLOBAL';
--> statement-breakpoint
CREATE INDEX "staff_data_scopes_staff_account_id_idx" ON "staff_data_scopes" USING btree ("staff_account_id");
--> statement-breakpoint
CREATE INDEX "staff_data_scopes_target_idx" ON "staff_data_scopes" USING btree ("scope_type","scope_id");
