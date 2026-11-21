export const unavailableWeather = (dates) => dates.map((date) => ({
  date, kind: 'unavailable', minTempC: null, maxTempC: null, precipitationProbabilityPct: null
}));

export function validateWeather(weather, dates) {
  if (!Array.isArray(weather) || weather.length !== dates.length) throw new Error('Weather must cover every trip day.');
  for (let i = 0; i < dates.length; i++) {
    const day = weather[i];
    if (!day || day.date !== dates[i] || !['forecast', 'unavailable'].includes(day.kind)) throw new Error('Weather dates do not match the trip.');
    const values = [day.minTempC, day.maxTempC, day.precipitationProbabilityPct];
    if (!values.every((value) => value === null || Number.isFinite(value)) ||
        (day.precipitationProbabilityPct !== null && (day.precipitationProbabilityPct < 0 || day.precipitationProbabilityPct > 100)) ||
        (day.minTempC !== null && day.maxTempC !== null && day.minTempC > day.maxTempC)) throw new Error('Invalid weather measurements.');
    if (day.kind === 'unavailable' && values.some((value) => value !== null)) throw new Error('Unavailable weather must not contain measurements.');
    if (day.kind === 'forecast' && (values.every((value) => value === null) || typeof day.sourceUrl !== 'string' ||
        !day.sourceUrl.startsWith('https://') || typeof day.fetchedAt !== 'string' || !Number.isFinite(Date.parse(day.fetchedAt)))) throw new Error('Forecast requires measurements, a source, and a fetch timestamp.');
  }
  return structuredClone(weather);
}
