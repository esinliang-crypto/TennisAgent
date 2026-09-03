function hardConstraints(profile) {
  return profile?.hardConstraints ?? [];
}

function hasHardConstraint(profile, feature) {
  return hardConstraints(profile).some((constraint) => constraint.feature === feature);
}

function calendarRequired(profile, { defaultCalendarBusyIsHard = true } = {}) {
  return defaultCalendarBusyIsHard || hasHardConstraint(profile, 'calendar');
}

function weatherConstraints(profile) {
  return hardConstraints(profile).filter((constraint) => constraint.feature === 'weather');
}

function noPrecipitationConstraint(constraint) {
  return ['no_precipitation', 'no_rain'].includes(constraint.value)
    || (constraint.direction === 'avoid' && constraint.target === true);
}

function evaluateWeather(candidate, preferenceProfile) {
  const constraints = weatherConstraints(preferenceProfile);
  const weather = candidate.features?.weather;
  const failures = [];

  for (const constraint of constraints) {
    if (!weather?.forecastAvailable) {
      failures.push({
        feature: 'weather',
        reason: 'weather_unknown',
      });
      continue;
    }

    if (noPrecipitationConstraint(constraint) && weather.precipitationMm === null) {
      failures.push({
        feature: 'weather',
        reason: 'weather_precipitation_unknown',
      });
      continue;
    }

    if (noPrecipitationConstraint(constraint) && weather.precipitationMm > 0) {
      failures.push({
        feature: 'weather',
        reason: 'weather_precipitation',
      });
    }
  }

  return {
    accepted: failures.length === 0,
    failures,
  };
}

function evaluateCalendar(candidate, preferenceProfile, options = {}) {
  if (!calendarRequired(preferenceProfile, options)) {
    return { accepted: true, failures: [] };
  }

  const calendar = candidate.features?.calendar;
  if (!calendar || calendar.free === null || calendar.free === undefined) {
    return {
      accepted: false,
      failures: [{
        feature: 'calendar',
        reason: 'calendar_unknown',
      }],
    };
  }

  if (calendar.free === false) {
    return {
      accepted: false,
      failures: [{
        feature: 'calendar',
        reason: 'calendar_conflict',
      }],
    };
  }

  return { accepted: true, failures: [] };
}

function applyHardConstraints({
  candidates,
  preferenceProfile,
  defaultCalendarBusyIsHard = true,
} = {}) {
  if (!Array.isArray(candidates)) throw new Error('candidates must be an array');

  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    const reasons = [
      ...evaluateCalendar(candidate, preferenceProfile, { defaultCalendarBusyIsHard }).failures,
      ...evaluateWeather(candidate, preferenceProfile).failures,
    ];

    if (reasons.length === 0) {
      accepted.push(candidate);
    } else {
      rejected.push({ candidate, reasons });
    }
  }

  return { accepted, rejected };
}

export {
  applyHardConstraints,
  evaluateCalendar,
  evaluateWeather,
};
