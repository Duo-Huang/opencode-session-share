export function LivePill(props: { state: string; title: string }) {
  return (
    <div class="live-pill no-print" data-state={props.state} title={props.title}>
      <span class="live-dot" />
      <span>{props.state}</span>
    </div>
  )
}
