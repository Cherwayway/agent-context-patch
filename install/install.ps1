[CmdletBinding()]
param(
  [ValidateSet("DryRun", "Apply", "Workspace")]
  [string]$Mode = "DryRun",
  [string]$WorkspacePath = (Get-Location).Path,
  [ValidateSet("Codex", "Claude", "Other")]
  [string]$Agent = "Other",
  [string]$SkillTargetPath = "",
  [string]$InstructionFilePath = "",
  [string]$ApprovedPlanHash = ""
)

$ErrorActionPreference = "Stop"

if ($Mode -eq "Workspace") {
  Write-Error "Mode Workspace was replaced by DryRun/Apply. Dry-run first, approve the plan hash, then use -Mode Apply -ApprovedPlanHash <hash>."
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$templateRoot = Join-Path $repoRoot "templates\.agent-context"
$skillSourceRoot = Join-Path $repoRoot "skills\evolve"
$workspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
$targetRoot = Join-Path $workspace ".agent-context"
$skillTarget = if ($SkillTargetPath) {
  if ([IO.Path]::IsPathRooted($SkillTargetPath)) {
    [IO.Path]::GetFullPath($SkillTargetPath)
  } else {
    [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $SkillTargetPath))
  }
} else {
  ""
}
$instructionTarget = if ($InstructionFilePath) {
  if ([IO.Path]::IsPathRooted($InstructionFilePath)) {
    [IO.Path]::GetFullPath($InstructionFilePath)
  } else {
    [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $InstructionFilePath))
  }
} else {
  ""
}

$actions = [Collections.Generic.List[object]]::new()

function ConvertTo-NormalPath([string]$Path) {
  if (-not $Path) { return "" }
  return [IO.Path]::GetFullPath($Path).Replace("\", "/")
}

function Get-Sha256Text([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-Sha256File([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-FirstReparsePoint([string]$Root) {
  $rootItem = Get-Item -LiteralPath $Root -Force -ErrorAction SilentlyContinue
  if (-not $rootItem) { return "" }
  if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    return $rootItem.FullName
  }
  if (-not $rootItem.PSIsContainer) { return "" }

  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($rootItem.FullName)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        return $child.FullName
      }
      if ($child.PSIsContainer) { $pending.Push($child.FullName) }
    }
  }
  return ""
}

function Add-PlanAction(
  [string]$State,
  [string]$Kind,
  [string]$Source,
  [string]$Target,
  [string]$Detail = ""
) {
  $actions.Add([pscustomobject]@{
    State = $State
    Kind = $Kind
    Source = $Source
    Target = $Target
    Detail = $Detail
  })
}

function Add-TreePlan([string]$SourceRoot, [string]$DestinationRoot, [string]$Kind) {
  Get-ChildItem -LiteralPath $SourceRoot -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($SourceRoot.Length).TrimStart([char]"\", [char]"/")
    $destination = Join-Path $DestinationRoot $relative
    $sourceHash = Get-Sha256File $_.FullName
    if (-not (Test-Path -LiteralPath $destination)) {
      Add-PlanAction "Create" $Kind $_.FullName $destination "source-sha256=$sourceHash"
    } elseif ((Get-Item -LiteralPath $destination).PSIsContainer) {
      Add-PlanAction "Conflict" $Kind $_.FullName $destination "target-is-directory;source-sha256=$sourceHash"
    } elseif ($sourceHash -eq (Get-Sha256File $destination)) {
      Add-PlanAction "Skip" $Kind $_.FullName $destination "identical;source-sha256=$sourceHash"
    } elseif ($Kind -eq "workspace-context") {
      Add-PlanAction "Preserve" $Kind $_.FullName $destination "existing-workspace-context;source-sha256=$sourceHash"
    } else {
      Add-PlanAction "Conflict" $Kind $_.FullName $destination "existing-skill-differs;source-sha256=$sourceHash"
    }
  }
}

$legacyConfig = Join-Path $targetRoot "config.yml"
$legacyWorkspace = $false
$contextReparsePoint = Get-FirstReparsePoint $targetRoot
if ($contextReparsePoint) {
  $legacyWorkspace = $true
  Add-PlanAction "Conflict" "workspace-context" "" $contextReparsePoint "reparse-point-not-followed"
} elseif ((Test-Path -LiteralPath $targetRoot) -and -not (Test-Path -LiteralPath $targetRoot -PathType Container)) {
  $legacyWorkspace = $true
  Add-PlanAction "Conflict" "workspace-context" "" $targetRoot "context-root-is-not-directory"
} elseif ((Test-Path -LiteralPath $legacyConfig) -and -not (Test-Path -LiteralPath $legacyConfig -PathType Leaf)) {
  $legacyWorkspace = $true
  Add-PlanAction "Conflict" "workspace-context" "" $legacyConfig "config-is-not-a-file"
} elseif (Test-Path -LiteralPath $legacyConfig -PathType Leaf) {
  $schemaMatches = [regex]::Matches(
    (Get-Content -Raw -LiteralPath $legacyConfig),
    '(?m)^\s*schema_version\s*:\s*([0-9]+)\s*(?:#.*)?$'
  )
  if ($schemaMatches.Count -gt 1) {
    $legacyWorkspace = $true
    Add-PlanAction "Conflict" "workspace-context" "" $legacyConfig "duplicate-schema-version"
  } elseif ($schemaMatches.Count -eq 0 -or $schemaMatches[0].Groups[1].Value -eq "0") {
    $legacyWorkspace = $true
    Add-PlanAction "MigrationRequired" "workspace-context" "" $legacyConfig "legacy-v0-is-read-only"
  } elseif ($schemaMatches[0].Groups[1].Value -ne "1") {
    $legacyWorkspace = $true
    Add-PlanAction "UpgradeRequired" "workspace-context" "" $legacyConfig "schema-version=$($schemaMatches[0].Groups[1].Value);newer-bootstrap-required"
  }
} elseif ((Test-Path -LiteralPath $targetRoot -PathType Container) -and
  @(Get-ChildItem -LiteralPath $targetRoot -Force).Count -gt 0) {
  $legacyWorkspace = $true
  Add-PlanAction "MigrationRequired" "workspace-context" "" $targetRoot "legacy-v0-missing-config-is-read-only"
}

if (-not $legacyWorkspace) {
  Add-TreePlan $templateRoot $targetRoot "workspace-context"
}

if ($skillTarget) {
  $sourceManifest = Join-Path $skillSourceRoot "manifest.json"
  $targetManifest = Join-Path $skillTarget "manifest.json"
  $skillReparsePoint = Get-FirstReparsePoint $skillTarget
  if ($skillReparsePoint) {
    Add-PlanAction "Conflict" "skill" $sourceManifest $skillReparsePoint "reparse-point-not-followed"
  } elseif ((Test-Path -LiteralPath $skillTarget) -and -not (Test-Path -LiteralPath $targetManifest)) {
    Add-PlanAction "Conflict" "skill" $sourceManifest $skillTarget "existing-unversioned-skill"
  } elseif (Test-Path -LiteralPath $targetManifest) {
    $sourceVersion = (Get-Content -Raw -LiteralPath $sourceManifest | ConvertFrom-Json).version
    $targetVersion = (Get-Content -Raw -LiteralPath $targetManifest | ConvertFrom-Json).version
    if ($sourceVersion -ne $targetVersion) {
      Add-PlanAction "UpgradeRequired" "skill" $sourceManifest $targetManifest "installed=$targetVersion;source=$sourceVersion"
    } else {
      Add-TreePlan $skillSourceRoot $skillTarget "skill"
    }
  } else {
    Add-TreePlan $skillSourceRoot $skillTarget "skill"
  }
}

if ($instructionTarget) {
  Add-PlanAction "GuidancePatchRequired" "instruction" "" $instructionTarget "agent-must-propose-semantic-patch"
}

$planLines = [Collections.Generic.List[string]]::new()
$planLines.Add("agent=$Agent")
$planLines.Add("workspace=$(ConvertTo-NormalPath $workspace)")
$planLines.Add("skillTarget=$(ConvertTo-NormalPath $skillTarget)")
$planLines.Add("instructionTarget=$(ConvertTo-NormalPath $instructionTarget)")
$actions |
  Sort-Object State, Kind, Target, Source, Detail |
  ForEach-Object {
    $planLines.Add("$($_.State)|$($_.Kind)|$(ConvertTo-NormalPath $_.Source)|$(ConvertTo-NormalPath $_.Target)|$($_.Detail)")
  }
$planHash = Get-Sha256Text ([string]::Join("`n", $planLines))
$blocked = @($actions | Where-Object { $_.State -in @("Conflict", "MigrationRequired", "UpgradeRequired") }).Count -gt 0

Write-Host "Agent Context Patch Bootstrap"
Write-Host "Mode: $Mode"
Write-Host "Agent: $Agent"
Write-Host "Workspace: $workspace"
if ($skillTarget) { Write-Host "Skill target: $skillTarget" }
if ($instructionTarget) { Write-Host "Instruction target: $instructionTarget" }
Write-Host ""
Write-Host "Plan:"
foreach ($action in $actions) {
  $suffix = if ($action.Detail) { " ($($action.Detail))" } else { "" }
  Write-Host "$($action.State): $($action.Target)$suffix"
}
Write-Host "Plan hash: $planHash"
Write-Host "Plan status: $(if ($blocked) { 'blocked' } else { 'ready' })"

if ($Mode -eq "DryRun") {
  Write-Host "Dry run complete. No files were written."
  exit $(if ($blocked) { 2 } else { 0 })
}

if (-not $ApprovedPlanHash) {
  Write-Error "Apply requires -ApprovedPlanHash from the reviewed dry-run."
}
if ($ApprovedPlanHash.ToLowerInvariant() -ne $planHash) {
  Write-Error "Approved plan hash does not match the current plan. Re-run dry-run and review the new plan."
}
if ($blocked) {
  Write-Error "The approved plan is blocked by a conflict, upgrade, or migration requirement."
}

$created = [Collections.Generic.List[string]]::new()
try {
  foreach ($action in $actions | Where-Object { $_.State -eq "Create" }) {
    $destinationDirectory = Split-Path -Parent $action.Target
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    if (Test-Path -LiteralPath $action.Target) {
      throw "Target changed after planning: $($action.Target)"
    }
    $expectedSourceHash = [regex]::Match($action.Detail, 'source-sha256=([a-f0-9]{64})').Groups[1].Value
    if (-not $expectedSourceHash -or (Get-Sha256File $action.Source) -ne $expectedSourceHash) {
      throw "Source changed after planning: $($action.Source)"
    }
    [IO.File]::Copy($action.Source, $action.Target, $false)
    $created.Add($action.Target)
    if ((Get-Sha256File $action.Target) -ne $expectedSourceHash) {
      throw "Copied content did not match its planned source: $($action.Target)"
    }
  }
} catch {
  foreach ($createdPath in $created) {
    if (Test-Path -LiteralPath $createdPath) {
      Remove-Item -LiteralPath $createdPath -Force
    }
  }
  Write-Error "Bootstrap failed and created files were rolled back: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Install receipt:"
Write-Host "Status: applied"
Write-Host "Plan hash: $planHash"
Write-Host "Created files: $($created.Count)"
Write-Host "Preserved files: $(@($actions | Where-Object { $_.State -eq 'Preserve' }).Count)"
Write-Host "Skipped files: $(@($actions | Where-Object { $_.State -eq 'Skip' }).Count)"
Write-Host "Guidance patch required: $([bool]$instructionTarget)"
