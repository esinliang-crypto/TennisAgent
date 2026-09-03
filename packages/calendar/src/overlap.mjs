function intervalEnd(start, durationMinutes) {
  const startMs = new Date(start).getTime();
  if (Number.isNaN(startMs)) throw new Error(`Invalid interval start: ${start}`);
  return new Date(startMs + durationMinutes * 60 * 1000).toISOString();
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  const aStartMs = new Date(aStart).getTime();
  const aEndMs = new Date(aEnd).getTime();
  const bStartMs = new Date(bStart).getTime();
  const bEndMs = new Date(bEnd).getTime();

  if ([aStartMs, aEndMs, bStartMs, bEndMs].some(Number.isNaN)) {
    throw new Error('Invalid interval boundary');
  }

  return aStartMs < bEndMs && bStartMs < aEndMs;
}

function isCalendarFree(candidate, busyIntervals = []) {
  if (!Array.isArray(busyIntervals)) throw new Error('busyIntervals must be an array');
  const candidateEnd = intervalEnd(candidate.startTime, candidate.durationMinutes);
  return !busyIntervals.some((busy) => intervalsOverlap(
    candidate.startTime,
    candidateEnd,
    busy.start,
    busy.end,
  ));
}

export {
  intervalEnd,
  intervalsOverlap,
  isCalendarFree,
};
