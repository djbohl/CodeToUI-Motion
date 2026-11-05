// Encode a captured PNG frame sequence into MP4/WebM with ffmpeg.
//
// We spawn the ffmpeg binary directly (no fluent-ffmpeg) to keep deps minimal.
// The binary is the bundled ffmpeg-static; if that's unavailable we fall back to
// a system `ffmpeg` on PATH.

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export const FRAME_PATTERN = "frame-%06d.png"; // 1-indexed: frame-000001.png

/** Resolve an ffmpeg binary path: bundled ffmpeg-static, else system "ffmpeg". */
export async function resolveFfmpeg() {
  try {
    const mod = await import("ffmpeg-static");
    const p = mod.default || mod;
    if (p && typeof p === "string") {
      await access(p, constants.X_OK);
      return p;
    }
  } catch {
    // fall through to system ffmpeg
  }
  return "ffmpeg";
}

/**
 * Build ffmpeg CLI args for an image2 sequence → video, optionally muxing audio tracks.
 * Pure/testable.
 * @param {{ framesDir:string, fps:number, format:"mp4"|"webm", outPath:string,
 *           audio?: Array<{path,start,volume,trimStart,trimEnd}> }} o
 */
export function buildFfmpegArgs({ framesDir, fps, format, outPath, audio = [] }) {
  const input = path.join(framesDir, FRAME_PATTERN);
  const pad = "pad=ceil(iw/2)*2:ceil(ih/2)*2"; // even dims (libx264 yuv420p); harmless for VP9
  const args = ["-y", "-framerate", String(fps), "-i", input];

  // Each audio track is its own input; trimStart via -ss, window length via -t.
  for (const a of audio) {
    if (a.trimStart > 0) args.push("-ss", String(a.trimStart / 1000));
    if (a.trimEnd != null) args.push("-t", String(Math.max(0, a.trimEnd - a.trimStart) / 1000));
    args.push("-i", a.path);
  }

  if (audio.length) {
    // filter_complex: pad video, delay+gain each track, mix them.
    const parts = [`[0:v]${pad}[v]`];
    const labels = [];
    audio.forEach((a, i) => {
      const lbl = `a${i}`;
      const vol = a.volume != null ? a.volume : 1;
      parts.push(`[${i + 1}:a]adelay=${Math.round(a.start)}|${Math.round(a.start)},volume=${vol}[${lbl}]`);
      labels.push(`[${lbl}]`);
    });
    parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0[aout]`);
    args.push("-filter_complex", parts.join(";"), "-map", "[v]", "-map", "[aout]");
  } else {
    args.push("-vf", pad);
  }

  args.push("-r", String(fps));
  if (format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0", "-crf", "32");
    if (audio.length) args.push("-c:a", "libopus");
  } else {
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    if (audio.length) args.push("-c:a", "aac");
  }
  if (audio.length) args.push("-shortest");
  args.push(outPath);
  return args;
}

/**
 * Encode the frames described by a capture manifest to outPath.
 * @param {{ framesDir: string, fps: number, format: "mp4"|"webm", frameCount: number }} manifest
 * @param {string} outPath
 */
export async function encode(manifest, outPath, audio = []) {
  const bin = await resolveFfmpeg();
  const args = buildFfmpegArgs({
    framesDir: manifest.framesDir,
    fps: manifest.fps,
    format: manifest.format,
    outPath,
    audio,
  });
  await runFfmpeg(bin, args);
  return outPath;
}

function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 64000) stderr = stderr.slice(-64000);
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to launch ffmpeg (${bin}): ${err.message}`))
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}
