import { defineConfig } from "vite";
import { videoDevPlugin } from "./server/plugin.js";

export default defineConfig({
  plugins: [videoDevPlugin()],
  server: {
    port: 5900, // stable port so CodeToUI's launch URL (?project=) is fixed
    // Don't let Vite's own watcher fight project folders (mirrors CodeToUI).
    watch: { ignored: ["**/projects/**", "**/proto.video.json"] },
  },
});
