// A small line chart in plain SVG (no chart library): one value per interview, oldest on the left.
// Works for a single point (drawn as a dot) and many; the caller shows the empty state.

export type ChartPoint = { label: string; value: number };

const W = 600;
const H = 180;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

/** The smallest round step (1, 2, 2.5 or 5 × 10^k) of at least `raw`; 1 for nothing to show. */
export function niceStep(raw: number) {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw - 1e-9) ?? 10) * pow;
}

export function LineChart(props: {
  points: ChartPoint[];
  /** Read out by screen readers, e.g. "Words per minute per interview". */
  title: string;
  unit?: string;
  /** A shaded target range, e.g. a comfortable speaking pace. */
  band?: [number, number];
}) {
  const { points, band } = props;
  const values = points.map((p) => p.value).concat(band ?? []);
  // Axis from 0 to two round steps (1, 2, 2.5 or 5 × a power of ten) above the highest value.
  const step = niceStep(Math.max(...values, 0) / 2);
  const min = 0;
  const max = 2 * step;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [0, step, max].map((v) => Math.round(v * 100) / 100);
  // At most ~6 date labels, always the first and the last.
  const every = Math.max(1, Math.ceil(points.length / 6));
  const labelled = points.map((_, i) => i % every === 0 || i === points.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={props.title}>
      <title>
        {`${props.title}: ${points.map((p) => `${p.label} ${p.value}${props.unit ? ` ${props.unit}` : ''}`).join(', ')}`}
      </title>
      {band && (
        <rect
          x={PAD.left}
          width={plotW}
          y={y(band[1])}
          height={Math.max(0, y(band[0]) - y(band[1]))}
          className="fill-emerald-500/10"
        />
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeDasharray="3 3" />
          <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
            {t}
          </text>
        </g>
      ))}
      {points.length > 1 && <path d={path} fill="none" className="stroke-primary" strokeWidth={2} />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={3.5} className="fill-primary" />
          {labelled[i] && (
            <text
              x={x(i)}
              y={H - 8}
              // The first and last labels stay inside the chart.
              textAnchor={
                points.length > 1 && i === 0 ? 'start' : points.length > 1 && i === points.length - 1 ? 'end' : 'middle'
              }
              className="fill-muted-foreground text-[11px]"
            >
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
