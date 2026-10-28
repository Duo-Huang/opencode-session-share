import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

const disableRocketLoader = {
  name: "disable-cloudflare-rocket-loader",
  enforce: "post" as const,
  transformIndexHtml(html: string) {
    return html.replace(/<script type="module"/g, '<script type="module" data-cfasync="false"')
  },
}

export default defineConfig({
  root: "src/viewer",
  base: "/",
  plugins: [solid(), tailwindcss(), disableRocketLoader],
  build: {
    outDir: "../../dist/viewer",
    emptyOutDir: true,
    assetsDir: "assets",
  },
})
