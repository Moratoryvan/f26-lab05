import type { Booking } from './types';

/**
 * True when a candidate slot leaves an existing booking untouched, meaning the
 * slot ends before the booking opens or starts after the booking closes.
 */
export function isSlotFree(
  slotStart: number,
  slotEnd: number,
  bookingStart: number,
  bookingEnd: number,
): boolean {
  const startsAfterBooking = slotStart >= bookingEnd;
  const endsBeforeBooking = slotEnd <= bookingStart;
  return startsAfterBooking || endsBeforeBooking;
}

/**
 * Walks the window in fixed steps and returns the start minute of every slot
 * that no booking touches.
 */
export function findFreeSlots(
  bookings: Booking[],
  windowStart: number,
  windowEnd: number,
  slotMinutes: number,
): number[] {
  const free: number[] = [];
  if (slotMinutes <= 0) {
    return free;
  }
  for (let slotStart = windowStart; slotStart + slotMinutes <= windowEnd; slotStart += slotMinutes) {
    const slotEnd = slotStart + slotMinutes;
    let taken = false;
    for (const booking of bookings) {
      if (!isSlotFree(slotStart, slotEnd, booking.start, booking.end)) {
        taken = true;
        break;
      }
    }
    if (!taken) {
      free.push(slotStart);
    }
  }
  return free;
}

/**
 * Minutes of one interval that fall inside the window, zero when the two do not
 * meet. The single place a booking is measured against a window.
 */
export function overlapMinutes(
  intervalStart: number,
  intervalEnd: number,
  windowStart: number,
  windowEnd: number,
): number {
  const from = Math.max(intervalStart, windowStart);
  const to = Math.min(intervalEnd, windowEnd);
  return to > from ? to - from : 0;
}

/** Minutes still open inside the window once every booking is subtracted. */
export function freeMinutes(bookings: Booking[], windowStart: number, windowEnd: number): number {
  let booked = 0;
  for (const booking of bookings) {
    booked += overlapMinutes(booking.start, booking.end, windowStart, windowEnd);
  }
  return Math.max(0, windowEnd - windowStart - booked);
}
