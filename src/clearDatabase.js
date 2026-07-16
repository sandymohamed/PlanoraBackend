import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearDatabase() {
  console.log('🗑️ Clearing database...');

  await prisma.$transaction(async (tx) => {
    // ============================
    // Project-related tables (delete in correct order)
    // ============================
    console.log('  📁 Clearing project-related tables...');
    
    try {
      await tx.projectNotification.deleteMany();
      console.log('    ✅ projectNotification');
    } catch (e) { console.log('    ❌ projectNotification failed:', e.message); }
    
    try {
      await tx.projectActivity.deleteMany();
      console.log('    ✅ projectActivity');
    } catch (e) { console.log('    ❌ projectActivity failed:', e.message); }
    
    try {
      await tx.projectFile.deleteMany();
      console.log('    ✅ projectFile');
    } catch (e) { console.log('    ❌ projectFile failed:', e.message); }
    
    try {
      await tx.projectComment.deleteMany();
      console.log('    ✅ projectComment');
    } catch (e) { console.log('    ❌ projectComment failed:', e.message); }
    
    try {
      await tx.projectInvitation.deleteMany();
      console.log('    ✅ projectInvitation');
    } catch (e) { console.log('    ❌ projectInvitation failed:', e.message); }
    
    try {
      await tx.projectMember.deleteMany();
      console.log('    ✅ projectMember');
    } catch (e) { console.log('    ❌ projectMember failed:', e.message); }
    
    try {
      await tx.project.deleteMany();
      console.log('    ✅ project');
    } catch (e) { console.log('    ❌ project failed:', e.message); }
    
    try {
      await tx.projectTemplate.deleteMany();
      console.log('    ✅ projectTemplate');
    } catch (e) { console.log('    ❌ projectTemplate failed:', e.message); }

    // ============================
    // Routines
    // ============================
    console.log('  🔄 Clearing routines...');
    
    try {
      await tx.routineTask.deleteMany();
      console.log('    ✅ routineTask');
    } catch (e) { console.log('    ❌ routineTask failed:', e.message); }
    
    try {
      await tx.routine.deleteMany();
      console.log('    ✅ routine');
    } catch (e) { console.log('    ❌ routine failed:', e.message); }

    // ============================
    // Tasks, Milestones, Goals
    // ============================
    console.log('  📋 Clearing tasks and goals...');
    
    try {
      await tx.alarm.deleteMany();
      console.log('    ✅ alarm');
    } catch (e) { console.log('    ❌ alarm failed:', e.message); }
    
    try {
      await tx.task.deleteMany();
      console.log('    ✅ task');
    } catch (e) { console.log('    ❌ task failed:', e.message); }
    
    try {
      await tx.milestone.deleteMany();
      console.log('    ✅ milestone');
    } catch (e) { console.log('    ❌ milestone failed:', e.message); }
    
    try {
      await tx.goal.deleteMany();
      console.log('    ✅ goal');
    } catch (e) { console.log('    ❌ goal failed:', e.message); }

    // ============================
    // Timers
    // ============================
    console.log('  ⏱️ Clearing timers...');
    
    try {
      await tx.timerSession.deleteMany();
      console.log('    ✅ timerSession');
    } catch (e) { console.log('    ❌ timerSession failed:', e.message); }
    
    try {
      await tx.timer.deleteMany();
      console.log('    ✅ timer');
    } catch (e) { console.log('    ❌ timer failed:', e.message); }

    // ============================
    // User-related tables
    // ============================
    console.log('  👤 Clearing user-related tables...');
    
    try {
      await tx.notification.deleteMany();
      console.log('    ✅ notification');
    } catch (e) { console.log('    ❌ notification failed:', e.message); }
    
    try {
      await tx.reminder.deleteMany();
      console.log('    ✅ reminder');
    } catch (e) { console.log('    ❌ reminder failed:', e.message); }
    
    try {
      await tx.analyticsEvent.deleteMany();
      console.log('    ✅ analyticsEvent');
    } catch (e) { console.log('    ❌ analyticsEvent failed:', e.message); }
    
    try {
      await tx.refreshToken.deleteMany();
      console.log('    ✅ refreshToken');
    } catch (e) { console.log('    ❌ refreshToken failed:', e.message); }
    
    try {
      await tx.passwordResetToken.deleteMany();
      console.log('    ✅ passwordResetToken');
    } catch (e) { console.log('    ❌ passwordResetToken failed:', e.message); }
    
    try {
      await tx.userSubscription.deleteMany();
      console.log('    ✅ userSubscription');
    } catch (e) { console.log('    ❌ userSubscription failed:', e.message); }
    
    try {
      await tx.aiUsageLog.deleteMany();
      console.log('    ✅ aiUsageLog');
    } catch (e) { console.log('    ❌ aiUsageLog failed:', e.message); }
    
    try {
      await tx.weeklyReview.deleteMany();
      console.log('    ✅ weeklyReview');
    } catch (e) { console.log('    ❌ weeklyReview failed:', e.message); }

    // ============================
    // Public tables (no foreign keys)
    // ============================
    console.log('  🌐 Clearing public tables...');
    
    try {
      await tx.contactSubmission.deleteMany();
      console.log('    ✅ contactSubmission');
    } catch (e) { console.log('    ❌ contactSubmission failed:', e.message); }
    
    try {
      await tx.waitlistLead.deleteMany();
      console.log('    ✅ waitlistLead');
    } catch (e) { console.log('    ❌ waitlistLead failed:', e.message); }

    // ============================
    // Finally Users (last because everything references them)
    // ============================
    console.log('  🗑️ Deleting users...');
    
    try {
      await tx.user.deleteMany();
      console.log('    ✅ user');
    } catch (e) { console.log('    ❌ user failed:', e.message); }

    console.log('✅ Database cleared successfully!');
  });
}

async function main() {
  try {
    await clearDatabase();
  } catch (error) {
    console.error('❌ Failed to clear database:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
    if (error.meta) {
      console.error('Error meta:', error.meta);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();