-- Public beta launch: contact submissions + premium waitlist leads

CREATE TABLE "contact_submissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_submissions_created_at_idx" ON "contact_submissions"("created_at");

CREATE TABLE "waitlist_leads" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'unknown',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waitlist_leads_email_source_key" ON "waitlist_leads"("email", "source");

CREATE INDEX "waitlist_leads_created_at_idx" ON "waitlist_leads"("created_at");
