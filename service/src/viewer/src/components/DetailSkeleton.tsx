export function DetailSkeleton(props: { label: string }) {
  return (
    <div class="detail-skeleton" role="status" aria-live="polite">
      <span class="detail-skeleton-label">{props.label}</span>
      <span class="skeleton-line" />
      <span class="skeleton-line short" />
    </div>
  )
}
