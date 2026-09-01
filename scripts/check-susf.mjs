import { getSusfAvailability } from '../packages/susf/src/index.mjs';

try {
  const availability = await getSusfAvailability({
    days: Number(process.env.SUSF_DAYS_COUNT ?? 7),
    durationMinutes: Number(process.env.SUSF_DURATION ?? 60),
  });

  console.log(JSON.stringify({ availability }, null, 2));
} catch (error) {
  if (error?.code) {
    console.error(error.code);
    if (error.message && error.message !== error.code) {
      console.error(error.message);
    }
  } else {
    console.error(error?.message ?? String(error));
  }
  process.exitCode = error?.code === 'NO_AVAILABILITY' ? 2 : 1;
}
