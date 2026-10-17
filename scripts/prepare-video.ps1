$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$taskVideoDir = Join-Path (Get-Location) 'test-results\video-package'
New-Item -ItemType Directory -Path $taskVideoDir -Force | Out-Null
node scripts/video-cards.cjs
if ($LASTEXITCODE -ne 0) { throw 'Could not render video cards' }
Add-Type -AssemblyName System.Speech
$taskVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$taskVoice.Rate = 1
$taskChapters = Get-Content -LiteralPath 'docs/evidence/video-chapters.json' -Raw | ConvertFrom-Json
try {
    for ($taskIndex = 0; $taskIndex -lt $taskChapters.Count; $taskIndex++) {
        $taskVoice.SetOutputToWaveFile((Join-Path $taskVideoDir "segment-$taskIndex.wav"))
        $taskVoice.Speak($taskChapters[$taskIndex].narration)
    }
} finally { $taskVoice.Dispose() }
& '.\.venv\Scripts\python.exe' scripts/package_video.py
if ($LASTEXITCODE -ne 0) { throw 'Video packaging failed' }
