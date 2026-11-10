import type { LngLat, SceneGeometry } from "@/lib/geometry";

const STROKE: Record<string, string> = { donor: "var(--route-donor)", helper: "var(--route-helper)", other: "var(--route-other)" };

function projector(bounds: [LngLat, LngLat], width: number, height: number, pad: number) {
  const [[minX, minY], [maxX, maxY]] = bounds;
  const midLat = ((minY + maxY) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat);
  const spanX = Math.max((maxX - minX) * kx, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return ([x, y]: LngLat): [number, number] => [offX + (x - minX) * kx * scale, height - (offY + (y - minY) * scale)];
}

function path(points: LngLat[], project: (p: LngLat) => [number, number]): string {
  return points
    .map((p, i) => {
      const [x, y] = project(p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Spatial schematic drawn straight from source coordinates. Used when map tiles are unavailable and as a compact preview. */
export function RouteSchematic({
  scene,
  width = 640,
  height = 420,
  compact = false,
  title = "Route schematic",
}: {
  scene: SceneGeometry;
  width?: number;
  height?: number;
  compact?: boolean;
  title?: string;
}) {
  if (!scene.bounds) return null;
  const project = projector(scene.bounds, width, height, compact ? 14 : 28);
  const order: Record<string, number> = { other: 0, helper: 1, donor: 2 };
  const vehicles = [...scene.vehicles].sort((a, b) => order[a.role] - order[b.role]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={title}>
      <rect width={width} height={height} fill="var(--surface)" />
      {vehicles.map((v) => (
        <g key={v.routeId}>
          <path d={path(v.completed, project)} fill="none" stroke={STROKE[v.role]} strokeOpacity={0.22} strokeWidth={compact ? 1.2 : 1.5} />
          <path
            d={path(v.planned, project)}
            fill="none"
            stroke={STROKE[v.role]}
            strokeWidth={v.role === "other" ? (compact ? 1.1 : 1.4) : compact ? 1.8 : 2.4}
            strokeDasharray={v.role === "helper" ? "6 4" : v.role === "other" ? "2 3" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={v.role === "other" ? 0.7 : 1}
          />
        </g>
      ))}
      {scene.stops
        .filter((s) => s.status === "transferred")
        .map((s) => {
          const [x, y] = project(s.lngLat);
          return <circle key={`${s.routeId}${s.stopId}`} cx={x} cy={y} r={compact ? 2.4 : 3.4} fill="var(--route-helper)" stroke="var(--surface)" strokeWidth={1} />;
        })}
      {scene.stops
        .filter((s) => s.lateWindowed > 0 || s.afterShift)
        .map((s) => {
          const [x, y] = project(s.lngLat);
          return <circle key={`late${s.routeId}${s.stopId}`} cx={x} cy={y} r={compact ? 3 : 4.2} fill="none" stroke="var(--danger)" strokeWidth={1.4} />;
        })}
      {vehicles.map((v) => {
        const [x, y] = project(v.position);
        return (
          <g key={`pos${v.routeId}`}>
            <rect x={x - 5} y={y - 5} width={10} height={10} rx={2} fill={STROKE[v.role]} stroke="var(--surface)" strokeWidth={1.5} />
            {!compact ? (
              <text x={x + 9} y={y + 4} fontSize={11} fontFamily="var(--font-mono)" fill="var(--ink)">
                {v.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {scene.meeting
        ? (() => {
            const [x, y] = project(scene.meeting.lngLat);
            return (
              <g>
                <circle cx={x} cy={y} r={compact ? 6 : 8} fill="var(--copper)" stroke="var(--surface)" strokeWidth={2.5} />
                {!compact ? (
                  <text x={x + 12} y={y - 8} fontSize={11} fontFamily="var(--font-mono)" fill="var(--copper-ink)">
                    {scene.meeting.label}
                  </text>
                ) : null}
              </g>
            );
          })()
        : null}
    </svg>
  );
}
