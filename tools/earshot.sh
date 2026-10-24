#!/usr/bin/env bash
# earshot (github.com/Leonxlnx/earshot, MIT): lets an agent "hear" audio (loudness, timing, sync, sound tags).
#   tools/earshot.sh measure qa-out/review/it_9x16/mix.wav
#   tools/earshot.sh timeline qa-out/review/it_9x16/mix.wav
# Installed in C:/Users/Admin/AI/earshot (.venv, CPU torch, models in .cache/hf); ffmpeg from winget.
# Override with EARSHOT_PY / FFMPEG_DIR on another machine.
PY="${EARSHOT_PY:-/c/Users/Admin/AI/earshot/.venv/Scripts/python.exe}"
FF="${FFMPEG_DIR:-$(ls -d /c/Users/Admin/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg*/ffmpeg-*/bin 2>/dev/null | head -1)}"
export PATH="$FF:$PATH" PYTHONIOENCODING=utf-8
exec "$PY" -m earshot "$@"
