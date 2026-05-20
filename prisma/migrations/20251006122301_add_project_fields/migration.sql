-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "color" TEXT DEFAULT '#6366f1',
ADD COLUMN     "end_date" TIMESTAMP(3),
ADD COLUMN     "start_date" TIMESTAMP(3);
