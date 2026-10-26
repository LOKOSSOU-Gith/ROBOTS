import { Badge, type Tone } from "@/components/ui";
import { STATE_LABELS, STATE_TONES, type InstanceState } from "@/server/domain/states";

export function StatusBadge({ state }: { state: InstanceState }) {
  return <Badge tone={STATE_TONES[state] as Tone}>{STATE_LABELS[state]}</Badge>;
}

export function Freshness({ at }: { at: Date | null }) {
  if (!at) return <span className="text-muted">jamais confirmé</span>;
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  const label =
    seconds < 60
      ? `il y a ${seconds} s`
      : seconds < 3600
        ? `il y a ${Math.floor(seconds / 60)} min`
        : `il y a ${Math.floor(seconds / 3600)} h`;
  return <span className="text-muted">confirmé {label}</span>;
}
