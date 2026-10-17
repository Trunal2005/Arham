"""Combine verified UI recording, architecture cards, and disclosed machine narration."""
import json
from pathlib import Path
import subprocess
import textwrap
import wave

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / "test-results/video-package"
evidence = ROOT / "docs/evidence"
chapters = json.loads((evidence / "video-chapters.json").read_text())
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()


def duration(file):
    with wave.open(str(file)) as audio:
        return audio.getnframes() / audio.getframerate()


raw_probe = subprocess.run([ffmpeg, "-hide_banner", "-i", str(evidence / "walkthrough.webm")], capture_output=True, text=True)
import re
match = re.search(r"Duration: (\d+):(\d+):([\d.]+)", raw_probe.stderr)
if not match:
    raise RuntimeError("Cannot inspect source recording")
raw_duration = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
intro = duration(folder / "segment-0.wav") + 1
segments = []
for i, chapter in enumerate(chapters):
    start = 0 if i == 0 else intro + chapter["seconds"]
    end = start + duration(folder / f"segment-{i}.wav")
    segments.append({"start": start, "end": end, "text": chapter["narration"], "title": chapter["title"]})
for previous, following in zip(segments, segments[1:]):
    if previous["end"] > following["start"]:
        raise RuntimeError("Narration overlaps; increase speech rate or shorten chapter text")
tail = max(3, segments[-1]["end"] - intro - raw_duration + 2)
command = [ffmpeg, "-hide_banner", "-y", "-loop", "1", "-t", str(intro), "-i", str(folder / "intro.png"),
           "-i", str(evidence / "walkthrough.webm"), "-loop", "1", "-t", str(tail), "-i", str(folder / "outro.png")]
for i in range(len(chapters)):
    command += ["-i", str(folder / f"segment-{i}.wav")]
filters = [f"[{i}:v]fps=25,format=yuv420p,setsar=1[v{i}]" for i in range(3)]
filters.append("[v0][v1][v2]concat=n=3:v=1:a=0[video]")
for i, segment in enumerate(segments):
    filters.append(f"[{i+3}:a]adelay={round(segment['start']*1000)}:all=1[a{i}]")
filters.append("".join(f"[a{i}]" for i in range(len(chapters))) + f"amix=inputs={len(chapters)}:normalize=0[audio]")
command += ["-filter_complex", ";".join(filters), "-map", "[video]", "-map", "[audio]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(evidence / "submission-walkthrough.mp4")]
subprocess.run(command, check=True)


def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    return f"{milliseconds//3600000:02d}:{milliseconds//60000%60:02d}:{milliseconds//1000%60:02d}.{milliseconds%1000:03d}"


captions = []
for segment in segments:
    lines = textwrap.wrap(segment["text"], width=66)
    chunks = ["\n".join(lines[i:i+2]) for i in range(0, len(lines), 2)]
    total = sum(len(c) for c in chunks)
    cursor = segment["start"]
    for chunk in chunks:
        end = cursor + (segment["end"] - segment["start"]) * len(chunk) / total
        captions.append(f"{timestamp(cursor)} --> {timestamp(end)}\n{chunk}")
        cursor = end
(evidence / "submission-walkthrough.vtt").write_text("WEBVTT\n\n" + "\n\n".join(captions), encoding="utf-8")
decoded = subprocess.run([ffmpeg, "-v", "error", "-i", str(evidence / "submission-walkthrough.mp4"), "-f", "null", "-"], capture_output=True, text=True)
decoded.check_returncode()
(evidence / "video-package.json").write_text(json.dumps({"source_recording_seconds": raw_duration, "intro_seconds": intro,
    "outro_seconds": tail, "narration": "Local Windows System.Speech synthetic voice; not a human recording", "segments": segments,
    "total_seconds": intro + raw_duration + tail, "status": "decoded successfully; presentation should be personally reviewed before submission",
    "captions": "Approximate phrase timing from synthesized segment duration; at most two lines per cue"}, indent=2))
