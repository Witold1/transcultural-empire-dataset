import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const processedDir = path.resolve(__dirname, "../data/processed");

/** Serve / copy repo-level data/processed as /data for the explorer. */
function serveProcessedData(): Plugin {
  const contentType = (file: string) =>
    file.endsWith(".json") || file.endsWith(".geojson")
      ? "application/json; charset=utf-8"
      : "application/octet-stream";

  return {
    name: "serve-processed-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        const file = path.normalize(path.join(processedDir, rel));
        if (
          !file.startsWith(processedDir) ||
          !fs.existsSync(file) ||
          !fs.statSync(file).isFile()
        ) {
          return next();
        }
        res.setHeader("Content-Type", contentType(file));
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist/data");
      fs.mkdirSync(outDir, { recursive: true });
      for (const name of fs.readdirSync(processedDir)) {
        const src = path.join(processedDir, name);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, path.join(outDir, name));
        }
      }
    },
  };
}

export default defineConfig({
  // GitHub Pages project sites live under /<repo>/; set BASE_PATH in CI.
  base: process.env.BASE_PATH || "/",
  plugins: [serveProcessedData()],
  server: {
    fs: { allow: [path.resolve(__dirname, "..")] },
  },
});
