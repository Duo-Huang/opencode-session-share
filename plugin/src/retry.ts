/**
 * Run an idempotent task again after a short delay when the first attempt
 * fails. This covers transient RPC registration gaps while OpenCode reloads
 * plugins without hiding genuine errors: the second failure is returned.
 */
export async function retryOnce<T>(task: () => Promise<T>, delayMs = 600): Promise<T> {
  try {
    return await task()
  } catch {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return task()
  }
}
