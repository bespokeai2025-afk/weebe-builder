import { useRelativeTime } from "@/lib/use-relative-time";

interface RelativeTimeProps {
  date: Date | string | number | null | undefined;
  short?: boolean;
  fallback?: string;
  className?: string;
}

export function RelativeTime({ date, short, fallback, className }: RelativeTimeProps) {
  const text = useRelativeTime(date, { short, fallback });
  if (className) return <span className={className}>{text}</span>;
  return <>{text}</>;
}
