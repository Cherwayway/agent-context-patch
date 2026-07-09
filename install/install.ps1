param(
  [ValidateSet("DryRun", "Workspace")]
  [string]$Mode = "DryRun",
  [string]$WorkspacePath = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$templateRoot = Join-Path $repoRoot "templates\.agent-context"
$workspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
$targetRoot = Join-Path $workspace ".agent-context"

$planned = @(
  ".agent-context\PROJECT_CONTEXT_INDEX.md",
  ".agent-context\PROJECT_PROFILE.md",
  ".agent-context\config.yml",
  ".agent-context\checklists\coding.md",
  ".agent-context\checklists\prd.md",
  ".agent-context\checklists\seo.md",
  ".agent-context\proposals\README.md",
  ".agent-context\reports\README.md",
  ".agent-context\mistakes\README.md",
  ".agent-context\archive\README.md"
)

Write-Host "Agent Context Patch installer"
Write-Host "Mode: $Mode"
Write-Host "Workspace: $workspace"
Write-Host ""
Write-Host "Planned workspace files:"
$planned | ForEach-Object { Write-Host "  $_" }
Write-Host ""

$agentFiles = @("AGENTS.md", "CLAUDE.md")
foreach ($file in $agentFiles) {
  $path = Join-Path $workspace $file
  if (Test-Path -LiteralPath $path) {
    Write-Host "Existing $file detected. Installer will not modify it directly."
    Write-Host "Ask your agent to create a patch using adapters/codex or adapters/claude."
  }
}

if ($Mode -eq "DryRun") {
  Write-Host ""
  Write-Host "Dry run complete. No files were written."
  exit 0
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

Get-ChildItem -Path $templateRoot -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($templateRoot.Length).TrimStart([char]"\", [char]"/")
  $dest = Join-Path $targetRoot $relative
  $destDir = Split-Path -Parent $dest
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  if (Test-Path -LiteralPath $dest) {
    Write-Host "Skip existing: $dest"
  } else {
    Copy-Item -LiteralPath $_.FullName -Destination $dest
    Write-Host "Created: $dest"
  }
}

Write-Host ""
Write-Host "Workspace context installed. Next: run `$evolve init."
