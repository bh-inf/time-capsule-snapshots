export function taipeiParts(now: Date): {
  date: string;
  generatedAt: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const date = `${pick("year")}-${pick("month")}-${pick("day")}`;
  return { date, generatedAt: `${date}T${pick("hour")}:${pick("minute")}:${pick("second")}+08:00` };
}
