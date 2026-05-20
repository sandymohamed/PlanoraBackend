-- AlterEnum
ALTER TYPE "MilestoneStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "milestones" ADD COLUMN     "description" TEXT,
ADD COLUMN     "project_id" TEXT,
ADD COLUMN     "start_date" TIMESTAMP(3),
ALTER COLUMN "goal_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
