import { ComingSoon } from "@/components/coming-soon";

export default function MediaPage() {
  return (
    <ComingSoon
      eyebrow="03 — Library"
      title="Media"
      description="Upload and manage videos and images used by posts. Files live in Supabase Storage; metadata (dimensions, duration, type) is tracked here. Built alongside reel posting in phase 2."
    />
  );
}
