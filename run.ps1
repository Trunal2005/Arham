param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'First run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt'
}
& $pythonPath -m uvicorn arham.app:app --host 127.0.0.1 --port $Port
