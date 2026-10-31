/**
 * Converts a recorded demo (.webm) to an .mp4 that plays everywhere
 * (H.264, yuv420p, fast start for web upload).
 *
 *   node e2e/to-mp4.mjs [input.webm] [output.mp4]
 *   FFMPEG=/path/to/ffmpeg node e2e/to-mp4.mjs     # if ffmpeg isn't on PATH
 *
 * Defaults to e2e/videos/sisonke-demo.webm → e2e/videos/sisonke-demo.mp4.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(process.argv[2] ?? path.join(here, "videos/sisonke-demo.webm"));
const output = path.resolve(process.argv[3] ?? input.replace(/\.webm$/i, "") + ".mp4");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";

if (!fs.existsSync(input)) {
  console.error(`No video at ${input}. Record one first: BASE_URL=… pnpm demo`);
  process.exit(1);
}

const args = [
  "-y", "-hide_banner", "-loglevel", "error", "-stats",
  "-i", input,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
  "-movflags", "+faststart",
  "-an",
  output,
];
const run = spawnSync(ffmpeg, args, { stdio: "inherit" });
if (run.error?.code === "ENOENT") {
  console.error("ffmpeg not found. Install it (brew install ffmpeg) or set FFMPEG=/path/to/ffmpeg.");
  process.exit(1);
}
if (run.status !== 0) process.exit(run.status ?? 1);
const mb = (fs.statSync(output).size / 1e6).toFixed(1);
console.log(`\nWrote ${output} (${mb} MB)`);
