import { describe, expect, test } from "bun:test"
import { retryOnce } from "./retry"

describe("retryOnce", () => {
  test("returns the first result without retrying", async () => {
    let calls = 0
    const value = await retryOnce(async () => {
      calls++
      return "ok"
    }, 0)

    expect(value).toBe("ok")
    expect(calls).toBe(1)
  })

  test("retries once after a transient failure", async () => {
    let calls = 0
    const value = await retryOnce(async () => {
      calls++
      if (calls === 1) throw new Error("transient")
      return "ok"
    }, 0)

    expect(value).toBe("ok")
    expect(calls).toBe(2)
  })

  test("surfaces the second failure", async () => {
    let calls = 0
    const task = async () => {
      calls++
      throw new Error(`failure ${calls}`)
    }

    await expect(retryOnce(task, 0)).rejects.toThrow("failure 2")
    expect(calls).toBe(2)
  })
})
