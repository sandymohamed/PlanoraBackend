import {
  RoutineFrequency,
  RoutineSchedule,
} from "@/domains/routines/routine.service";
import { DateTime } from "luxon";

/**
 * Calculate the next occurrence based on frequency and schedule.
 *
 * IMPORTANT:
 * - schedule.time is a LOCAL wall-clock time.
 * - timezone is the IANA timezone in which that time applies.
 * - The returned Date represents the absolute UTC instant.
 *
 * Example:
 *   schedule.time = "04:50"
 *   timezone      = "Africa/Cairo"
 *
 *   means:
 *   04:50 Africa/Cairo
 *
 *   and the returned Date will represent the equivalent UTC instant.
 */
export function calculateNextOccurrence(
  frequency: RoutineFrequency,
  schedule: RoutineSchedule,
  timezone: string,
): Date {
  const zone = timezone || "UTC";

  const now = DateTime.now().setZone(zone);

  const timeParts = (schedule.time || "00:00").split(":").map(Number);

  const hours = timeParts[0] ?? 0;
  const minutes = timeParts[1] ?? 0;

  // Basic validation
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(
      `Invalid routine time "${schedule.time}" for timezone "${zone}"`,
    );
  }

  console.log("Calculating next occurrence:", {
    frequency,
    schedule,
    timezone: zone,
    nowLocal: now.toISO(),
    nowUTC: now.toUTC().toISO(),
  });

  let next: DateTime;

  switch (frequency) {
    case "DAILY": {
      // Interpret schedule.time as LOCAL time in the routine timezone.
      next = now.set({
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0,
      });

      // If today's occurrence has already passed,
      // move to tomorrow in the SAME timezone.
      if (next <= now) {
        next = next.plus({ days: 1 });
      }

      break;
    }

    case "WEEKLY": {
      const targetDays = schedule.days || [];

      if (targetDays.length === 0) {
        throw new Error("WEEKLY routine requires at least one scheduled day");
      }

      // Luxon weekday:
      // Monday = 1
      // Tuesday = 2
      // ...
      // Sunday = 7
      //
      // If your database currently stores JS getDay() values:
      // Sunday = 0, Monday = 1, ..., Saturday = 6
      // then convert them here.
      const currentWeekday = now.weekday;

      let soonest: DateTime | null = null;

      for (const day of targetDays) {
        const targetWeekday = day === 0 ? 7 : day;

        let daysToAdd = (targetWeekday - currentWeekday + 7) % 7;

        let candidate = now.plus({ days: daysToAdd }).set({
          hour: hours,
          minute: minutes,
          second: 0,
          millisecond: 0,
        });

        // If the candidate is today but the time has already passed,
        // move it to the next week.
        if (candidate <= now) {
          candidate = candidate.plus({ weeks: 1 });
        }

        if (!soonest || candidate < soonest) {
          soonest = candidate;
        }
      }

      if (!soonest) {
        throw new Error(
          "Unable to calculate next occurrence for WEEKLY routine",
        );
      }

      next = soonest;

      break;
    }

    case "MONTHLY": {
      const targetDay = schedule.day || 1;

      // Start with this month's target date.
      next = now.set({
        day: targetDay,
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0,
      });

      // If this month's occurrence has passed,
      // calculate next month's occurrence.
      if (next <= now) {
        next = next.plus({ months: 1 }).set({
          day: targetDay,
          hour: hours,
          minute: minutes,
          second: 0,
          millisecond: 0,
        });
      }

      break;
    }

    case "YEARLY": {
      // Your existing behavior uses January 1st.
      next = now.set({
        month: 1,
        day: 1,
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0,
      });

      // If this year's occurrence has passed,
      // move to next year.
      if (next <= now) {
        next = next.plus({ years: 1 }).set({
          month: 1,
          day: 1,
          hour: hours,
          minute: minutes,
          second: 0,
          millisecond: 0,
        });
      }

      break;
    }

    default:
      next = now.plus({ days: 1 }).set({
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0,
      });
  }

  const result = next.toUTC().toJSDate();

  console.log("Calculated next occurrence:", {
    local: next.toISO(),
    utc: next.toUTC().toISO(),
    jsDate: result.toISOString(),
    timezone: zone,
  });

  return result;
}
