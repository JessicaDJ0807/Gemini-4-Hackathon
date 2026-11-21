import { ApiError } from '../../packages/contracts/style-analysis.mjs';
import { tripDates, validDestination } from '../../packages/contracts/trip.mjs';
import { unavailableWeather, validateWeather } from '../../packages/contracts/weather.mjs';

export function localDate(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export async function getTripWeather(body, { fetchImpl = fetch, now = () => new Date(), timeoutMs = 8000 } = {}) {
  let dates;
  try {
    if (!validDestination(body?.destination)) throw new Error('Select a valid destination.');
    dates = tripDates(body.startDate, body.endDate);
  } catch (error) { throw new ApiError(400, 'INVALID_WEATHER_REQUEST', error.message); }
  const { destination } = body;
  const today = localDate(now(), destination.timezone);
  const lastDay = new Date(Date.parse(`${today}T00:00:00Z`) + 15 * 86400000).toISOString().slice(0, 10);
  const inRange = (date) => date >= today && date <= lastDay;
  const empty = unavailableWeather(dates);
  const outsideWarning = 'Forecasts are unavailable for past dates or dates beyond the current forecast window.';
  if (!dates.some(inRange)) return { weather: empty, warnings: [outsideWarning], retryable: false };
  const url = `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
    latitude: String(destination.latitude), longitude: String(destination.longitude), timezone: destination.timezone,
    daily: 'temperature_2m_min,temperature_2m_max,precipitation_probability_max',
    temperature_unit: 'celsius', forecast_days: '16', timeformat: 'iso8601'
  })}`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error('Provider unavailable');
    const payload = await response.json();
    const daily = payload.daily;
    const units = payload.daily_units;
    const fields = ['temperature_2m_min', 'temperature_2m_max', 'precipitation_probability_max'];
    if (!Array.isArray(daily?.time) || new Set(daily.time).size !== daily.time.length ||
        !fields.every((field) => Array.isArray(daily[field]) && daily[field].length === daily.time.length) ||
        units?.temperature_2m_min !== '°C' || units?.temperature_2m_max !== '°C' || units?.precipitation_probability_max !== '%') throw new Error('Invalid provider response');
    const fetchedAt = now().toISOString();
    const weather = empty.map((unknown) => {
      const index = daily.time.indexOf(unknown.date);
      if (!inRange(unknown.date) || index < 0) return unknown;
      const day = {
        date: unknown.date, kind: 'forecast', minTempC: daily.temperature_2m_min[index],
        maxTempC: daily.temperature_2m_max[index], precipitationProbabilityPct: daily.precipitation_probability_max[index],
        sourceUrl: url, fetchedAt
      };
      try { return validateWeather([day], [day.date])[0]; } catch { return unknown; }
    });
    const warnings = [];
    if (dates.some((date) => !inRange(date))) warnings.push(outsideWarning);
    if (weather.some((day) => inRange(day.date) && (day.kind === 'unavailable' || [day.minTempC, day.maxTempC, day.precipitationProbabilityPct].includes(null)))) warnings.push('Some forecast measurements are unavailable. Missing values are not estimates.');
    return { weather, warnings, retryable: weather.some((day) => inRange(day.date) && day.kind === 'unavailable') };
  } catch {
    return { weather: empty, warnings: ['Could not fetch the weather. Your trip can still be confirmed; retry when ready.'], retryable: true };
  }
}
