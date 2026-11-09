export function AssistantWorking(props: { label: string }) {
  return (
    <div class="assistant-working" role="status" aria-live="polite">
      <span class="typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{props.label}</span>
    </div>
  )
}
