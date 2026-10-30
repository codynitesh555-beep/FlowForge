CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "family_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_sessions_refresh_token_hash_format" CHECK ("refresh_token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "auth_sessions_expiry_after_creation" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "auth_sessions_family_expiry_check" CHECK ("family_expires_at" > "created_at" AND "expires_at" <= "family_expires_at"),
    CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");
CREATE INDEX "auth_sessions_family_id_revoked_at_idx" ON "auth_sessions"("family_id", "revoked_at");
CREATE INDEX "auth_sessions_user_id_revoked_at_expires_at_idx" ON "auth_sessions"("user_id", "revoked_at", "expires_at");

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "password_reset_tokens_expiry_after_creation" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_expires_at_idx" ON "password_reset_tokens"("user_id", "expires_at");
CREATE UNIQUE INDEX "password_reset_tokens_one_pending_per_user_key"
  ON "password_reset_tokens"("user_id") WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;

CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invited_email" VARCHAR(320) NOT NULL,
    "role" "membership_role" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_invitations_email_normalized_check" CHECK ("invited_email" = lower("invited_email") AND "invited_email" = btrim("invited_email")),
    CONSTRAINT "organization_invitations_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "organization_invitations_expiry_after_creation" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "organization_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");
CREATE INDEX "organization_invitations_organization_id_invited_email_idx" ON "organization_invitations"("organization_id", "invited_email");
CREATE INDEX "organization_invitations_expires_at_idx" ON "organization_invitations"("expires_at");
CREATE UNIQUE INDEX "organization_invitations_one_pending_email_key"
  ON "organization_invitations"("organization_id", "invited_email") WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
