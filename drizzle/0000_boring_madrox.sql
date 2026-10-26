CREATE TYPE "public"."account_environment" AS ENUM('demo', 'real');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('unverified', 'connected', 'disconnected', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."command_status" AS ENUM('requested', 'received', 'accepted', 'started', 'completed', 'failed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."command_type" AS ENUM('start', 'stop_new_entries', 'stop_strategy', 'emergency_close', 'update_parameters', 'reload_policy');--> statement-breakpoint
CREATE TYPE "public"."instance_mode" AS ENUM('simulation', 'demo', 'real');--> statement-breakpoint
CREATE TYPE "public"."instance_state" AS ENUM('STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR', 'RISK_HALTED', 'DISCONNECTED');--> statement-breakpoint
CREATE TYPE "public"."license_status" AS ENUM('active', 'suspended', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."position_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."secret_kind" AS ENUM('mt5_trading_password', 'mt5_investor_password', 'broker_api_key');--> statement-breakpoint
CREATE TYPE "public"."strategy_status" AS ENUM('draft', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."strategy_version_status" AS ENUM('draft', 'validated', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."trade_event_type" AS ENUM('order_sent', 'order_accepted', 'order_rejected', 'position_opened', 'position_modified', 'position_closed', 'deal', 'reconnect', 'risk_block', 'engine_error');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'pending', 'deleted');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" varchar(24) DEFAULT 'user' NOT NULL,
	"action" varchar(96) NOT NULL,
	"target_type" varchar(48),
	"target_id" varchar(64),
	"request_id" varchar(64),
	"result" varchar(24) DEFAULT 'success' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_acks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"engine_id" varchar(64) NOT NULL,
	"ack" "command_status" NOT NULL,
	"code" varchar(48),
	"message" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"type" "command_type" NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"requested_by" uuid NOT NULL,
	"engine_id" varchar(64),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "command_status" DEFAULT 'requested' NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_transition_code" varchar(48),
	"last_transition_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trading_account_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"engine_id" varchar(64),
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"result_code" varchar(48),
	"result_message" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "engine_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engine_id" varchar(64) NOT NULL,
	"engine_version" varchar(32) NOT NULL,
	"terminal_kind" varchar(32) DEFAULT 'unknown' NOT NULL,
	"state" varchar(32) NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"trading_account_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"risk_profile_id" uuid NOT NULL,
	"license_id" uuid,
	"symbols" jsonb NOT NULL,
	"parameters" jsonb NOT NULL,
	"artifact_digest" varchar(128),
	"mode" "instance_mode" DEFAULT 'simulation' NOT NULL,
	"real_authorized_at" timestamp with time zone,
	"real_authorized_by" uuid,
	"state" "instance_state" DEFAULT 'STOPPED' NOT NULL,
	"engine_confirmed_state" "instance_state" DEFAULT 'STOPPED' NOT NULL,
	"last_engine_seen_at" timestamp with time zone,
	"stop_reason" text,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_id" uuid NOT NULL,
	"strategy_version_id" uuid,
	"strategy_id" uuid,
	"max_instances" integer,
	"allows_real_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" "license_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"max_accounts" integer DEFAULT 1 NOT NULL,
	"max_instances" integer DEFAULT 1 NOT NULL,
	"grace_hours" smallint DEFAULT 6 NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"license_id" uuid,
	"provider" varchar(48) NOT NULL,
	"external_reference" varchar(128) NOT NULL,
	"amount" text NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" varchar(32) NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trading_account_id" uuid NOT NULL,
	"instance_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"position_id" varchar(64) NOT NULL,
	"side" "position_side" NOT NULL,
	"volume" text NOT NULL,
	"open_price" text NOT NULL,
	"current_price" text,
	"profit" text,
	"margin" text,
	"open_time" timestamp with time zone,
	"close_time" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket" varchar(128) NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limits_bucket_window_start_pk" PRIMARY KEY("bucket","window_start")
);
--> statement-breakpoint
CREATE TABLE "risk_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"max_daily_loss" text NOT NULL,
	"max_drawdown_pct" text NOT NULL,
	"max_open_positions" integer NOT NULL,
	"max_total_exposure" text NOT NULL,
	"max_spread_points" integer NOT NULL,
	"min_margin_level_pct" text NOT NULL,
	"max_risk_per_trade_pct" text NOT NULL,
	"max_lot_size" text NOT NULL,
	"forbid_lot_increase_after_loss" boolean DEFAULT true NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(48) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"kind" "secret_kind" DEFAULT 'mt5_trading_password' NOT NULL,
	"vault_reference" text,
	"ciphertext" text NOT NULL,
	"nonce" varchar(32) NOT NULL,
	"key_version" integer NOT NULL,
	"algorithm" varchar(32) DEFAULT 'aes-256-gcm' NOT NULL,
	"encrypted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotates_at" date,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"fingerprint_hash" varchar(64),
	"ip_hash" varchar(64),
	"user_agent" text,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"status" "strategy_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"version" varchar(32) NOT NULL,
	"parameter_schema" jsonb NOT NULL,
	"supported_symbols" jsonb NOT NULL,
	"symbol_aliases" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_constraints" jsonb NOT NULL,
	"martingale_allowed" boolean DEFAULT false NOT NULL,
	"artifact_digest" varchar(128) NOT NULL,
	"status" "strategy_version_status" DEFAULT 'draft' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trading_account_id" uuid NOT NULL,
	"instance_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"command_id" uuid,
	"broker_ticket" varchar(64),
	"event_type" "trade_event_type" NOT NULL,
	"symbol" varchar(32),
	"volume" text,
	"price" text,
	"result" varchar(64),
	"retcode" varchar(32),
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"broker" varchar(120) NOT NULL,
	"server" varchar(120) NOT NULL,
	"login" varchar(32) NOT NULL,
	"secret_record_id" uuid,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"environment" "account_environment" DEFAULT 'demo' NOT NULL,
	"status" "account_status" DEFAULT 'unverified' NOT NULL,
	"real_mode_approved_at" timestamp with time zone,
	"real_mode_approved_by" uuid,
	"last_test_at" timestamp with time zone,
	"last_test_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text,
	"identity_provider" varchar(64),
	"display_name" varchar(120),
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_acks" ADD CONSTRAINT "command_acks_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."commands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_tests" ADD CONSTRAINT "connection_tests_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_tests" ADD CONSTRAINT "connection_tests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_tests" ADD CONSTRAINT "connection_tests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_risk_profile_id_risk_profiles_id_fk" FOREIGN KEY ("risk_profile_id") REFERENCES "public"."risk_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_real_authorized_by_users_id_fk" FOREIGN KEY ("real_authorized_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_entitlements" ADD CONSTRAINT "license_entitlements_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_entitlements" ADD CONSTRAINT "license_entitlements_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_entitlements" ADD CONSTRAINT "license_entitlements_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_snapshots" ADD CONSTRAINT "positions_snapshots_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_snapshots" ADD CONSTRAINT "positions_snapshots_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_snapshots" ADD CONSTRAINT "positions_snapshots_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_records" ADD CONSTRAINT "secret_records_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."commands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_secret_record_id_secret_records_id_fk" FOREIGN KEY ("secret_record_id") REFERENCES "public"."secret_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_real_mode_approved_by_users_id_fk" FOREIGN KEY ("real_mode_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_request_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "command_acks_command_idx" ON "command_acks" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commands_idempotency_key_unique" ON "commands" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "commands_pending_idx" ON "commands" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "commands_instance_idx" ON "commands" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "connection_tests_pending_idx" ON "connection_tests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "connection_tests_account_idx" ON "connection_tests" USING btree ("trading_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engine_heartbeats_engine_time_unique" ON "engine_heartbeats" USING btree ("engine_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "engine_heartbeats_engine_idx" ON "engine_heartbeats" USING btree ("engine_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "instances_owner_idx" ON "instances" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "instances_account_idx" ON "instances" USING btree ("trading_account_id");--> statement-breakpoint
CREATE INDEX "instances_state_idx" ON "instances" USING btree ("state");--> statement-breakpoint
CREATE INDEX "instances_engine_state_idx" ON "instances" USING btree ("engine_confirmed_state");--> statement-breakpoint
CREATE INDEX "license_entitlements_license_idx" ON "license_entitlements" USING btree ("license_id");--> statement-breakpoint
CREATE UNIQUE INDEX "license_entitlements_unique" ON "license_entitlements" USING btree ("license_id","strategy_version_id","strategy_id");--> statement-breakpoint
CREATE INDEX "licenses_owner_status_idx" ON "licenses" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "licenses_expires_idx" ON "licenses" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_unique" ON "payments" USING btree ("provider","external_reference");--> statement-breakpoint
CREATE INDEX "payments_owner_idx" ON "payments" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "positions_snapshots_account_time_idx" ON "positions_snapshots" USING btree ("trading_account_id","observed_at");--> statement-breakpoint
CREATE INDEX "positions_snapshots_owner_idx" ON "positions_snapshots" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_snapshots_unique" ON "positions_snapshots" USING btree ("trading_account_id","position_id","observed_at");--> statement-breakpoint
CREATE INDEX "risk_profiles_owner_idx" ON "risk_profiles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_profiles_owner_name_unique" ON "risk_profiles" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "secret_records_owner_idx" ON "secret_records" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "secret_records_key_version_idx" ON "secret_records" USING btree ("key_version");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_slug_unique" ON "strategies" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_strategy_version_unique" ON "strategy_versions" USING btree ("strategy_id","version");--> statement-breakpoint
CREATE INDEX "strategy_versions_status_idx" ON "strategy_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trade_events_account_time_idx" ON "trade_events" USING btree ("trading_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "trade_events_instance_time_idx" ON "trade_events" USING btree ("instance_id","occurred_at");--> statement-breakpoint
CREATE INDEX "trade_events_owner_idx" ON "trade_events" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_accounts_owner_server_login_unique" ON "trading_accounts" USING btree ("owner_user_id","server","login");--> statement-breakpoint
CREATE INDEX "trading_accounts_owner_idx" ON "trading_accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "trading_accounts_status_idx" ON "trading_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");