const WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-2/3"];

/** A single shimmering placeholder block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />;
}

/** Pill-shaped placeholders — drivers, sessions, laps. */
export function SkeletonPills({
  count = 6,
  width = "w-28",
  className = "",
}: {
  count?: number;
  width?: string;
  className?: string;
}) {
  return (
    <div aria-hidden className={`flex flex-wrap gap-2 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={`skeleton h-9 rounded-full ${width}`} />
      ))}
    </div>
  );
}

/** Placeholder lines for a paragraph. */
export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className={`skeleton block h-3.5 ${WIDTHS[index % WIDTHS.length]}`}
        />
      ))}
    </div>
  );
}

/** Chart area placeholder, sized to the real chart so nothing jumps on load. */
export function SkeletonChart({
  height = 260,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`skeleton w-full rounded-xl ${className}`}
      style={{ height }}
    />
  );
}

/** Table rows placeholder. */
export function SkeletonTable({
  rows = 8,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <span className="skeleton h-4 w-8" />
          <span className="skeleton h-4 flex-1" />
          <span className="skeleton h-4 w-28" />
          <span className="skeleton h-4 w-14" />
        </div>
      ))}
    </div>
  );
}
