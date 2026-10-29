-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('pending_approval', 'approved', 'rejected', 'publishing', 'published', 'failed');

-- AlterTable
ALTER TABLE "schedule" ADD COLUMN     "jitterMinutes" INTEGER NOT NULL DEFAULT 20;

-- CreateTable
CREATE TABLE "activity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "targetName" TEXT,
    "targetUrl" TEXT,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "runId" TEXT,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_draft" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'pending_approval',
    "source" TEXT NOT NULL DEFAULT 'owner',
    "scheduledFor" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "postUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "runId" TEXT,

    CONSTRAINT "post_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_identityId_occurredAt_idx" ON "activity"("identityId", "occurredAt");

-- CreateIndex
CREATE INDEX "activity_organizationId_occurredAt_idx" ON "activity"("organizationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "post_draft_runId_key" ON "post_draft"("runId");

-- CreateIndex
CREATE INDEX "post_draft_status_scheduledFor_idx" ON "post_draft"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "post_draft_identityId_createdAt_idx" ON "post_draft"("identityId", "createdAt");

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_runId_fkey" FOREIGN KEY ("runId") REFERENCES "run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_draft" ADD CONSTRAINT "post_draft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_draft" ADD CONSTRAINT "post_draft_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_draft" ADD CONSTRAINT "post_draft_runId_fkey" FOREIGN KEY ("runId") REFERENCES "run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
