CREATE TYPE "public"."profit_reference" AS ENUM('session', 'day');--> statement-breakpoint
CREATE TYPE "public"."stop_policy" AS ENUM('keep_positions', 'close_positions');--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"realized_pnl" text DEFAULT '0' NOT NULL,
	"floating_pnl" text DEFAULT '0' NOT NULL,
	"commissions" text DEFAULT '0' NOT NULL,
	"swaps" text DEFAULT '0' NOT NULL,
	"net_pnl" text DEFAULT '0' NOT NULL,
	"trades_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"start_equity" text,
	"end_equity" text,
	"net_result" text,
	"trades_count" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robot_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"timeframe" varchar(8) DEFAULT 'M15' NOT NULL,
	"initial_lot" text DEFAULT '0.01' NOT NULL,
	"profit_target_net" text DEFAULT '10' NOT NULL,
	"max_loss_net" text DEFAULT '5' NOT NULL,
	"profit_reference" "profit_reference" DEFAULT 'session' NOT NULL,
	"max_trades" integer DEFAULT 20 NOT NULL,
	"max_positions" integer DEFAULT 1 NOT NULL,
	"max_spread_points" integer DEFAULT 30 NOT NULL,
	"allowed_hours" jsonb DEFAULT '{"start":0,"end":24}'::jsonb NOT NULL,
	"strategy_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stop_policy" "stop_policy" DEFAULT 'keep_positions' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "magic_number" integer;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "last_balance" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "last_equity" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "last_margin_level" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "last_currency" varchar(8);--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "last_snapshot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_runs" ADD CONSTRAINT "robot_runs_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_runs" ADD CONSTRAINT "robot_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_settings" ADD CONSTRAINT "robot_settings_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_metrics_instance_day_unique" ON "daily_metrics" USING btree ("instance_id","metric_date");--> statement-breakpoint
CREATE INDEX "robot_runs_instance_idx" ON "robot_runs" USING btree ("instance_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "robot_settings_instance_unique" ON "robot_settings" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_magic_number_unique" ON "instances" USING btree ("magic_number");