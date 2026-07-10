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

function Remove-V1YamlInlineComment([string]$Line) {
  $quote = [char]0
  $escaped = $false
  for ($index = 0; $index -lt $Line.Length; $index++) {
    $character = $Line[$index]
    if ($quote -eq [char]34) {
      if ($escaped) {
        $escaped = $false
      } elseif ($character -eq [char]92) {
        $escaped = $true
      } elseif ($character -eq $quote) {
        $quote = [char]0
      }
    } elseif ($quote -eq [char]39) {
      if ($character -eq $quote -and $index + 1 -lt $Line.Length -and $Line[$index + 1] -eq $quote) {
        $index++
      } elseif ($character -eq $quote) {
        $quote = [char]0
      }
    } elseif ($character -eq [char]34 -or $character -eq [char]39) {
      $quote = $character
    } elseif ($character -eq [char]35 -and ($index -eq 0 -or [char]::IsWhiteSpace($Line[$index - 1]))) {
      return $Line.Substring(0, $index).TrimEnd()
    }
  }
  return $Line
}

function Split-V1YamlInlineList([string]$Value, [int]$LineNumber) {
  $parts = [Collections.Generic.List[string]]::new()
  $quote = [char]0
  $escaped = $false
  $start = 0
  for ($index = 0; $index -lt $Value.Length; $index++) {
    $character = $Value[$index]
    if ($quote -eq [char]34) {
      if ($escaped) {
        $escaped = $false
      } elseif ($character -eq [char]92) {
        $escaped = $true
      } elseif ($character -eq $quote) {
        $quote = [char]0
      }
    } elseif ($quote -eq [char]39) {
      if ($character -eq $quote -and $index + 1 -lt $Value.Length -and $Value[$index + 1] -eq $quote) {
        $index++
      } elseif ($character -eq $quote) {
        $quote = [char]0
      }
    } elseif ($character -eq [char]34 -or $character -eq [char]39) {
      $quote = $character
    } elseif ($character -eq [char]44) {
      $part = $Value.Substring($start, $index - $start).Trim()
      if (-not $part) { throw "line $LineNumber has an empty inline list item" }
      $parts.Add($part) | Out-Null
      $start = $index + 1
    }
  }
  if ($quote -ne [char]0) { throw "line $LineNumber has an unclosed quote in an inline list" }
  $finalPart = $Value.Substring($start).Trim()
  if (-not $finalPart) { throw "line $LineNumber has an empty inline list item" }
  $parts.Add($finalPart) | Out-Null
  return [pscustomobject]@{ Parts = $parts.ToArray() }
}

function ConvertFrom-V1YamlScalar([AllowEmptyString()][string]$RawValue, [int]$LineNumber) {
  if ($RawValue -ceq "true" -or $RawValue -ceq "false") {
    return [pscustomobject]@{ Type = "boolean"; Value = ($RawValue -ceq "true") }
  }
  if ($RawValue -ceq "null" -or $RawValue -ceq "~") {
    return [pscustomobject]@{ Type = "null"; Value = $null }
  }
  if ($RawValue -cmatch '^-?(?:0|[1-9][0-9]*)$') {
    [long]$number = 0
    if (-not [long]::TryParse(
      $RawValue,
      [Globalization.NumberStyles]::AllowLeadingSign,
      [Globalization.CultureInfo]::InvariantCulture,
      [ref]$number
    )) {
      throw "line $LineNumber has an out-of-range integer"
    }
    return [pscustomobject]@{ Type = "integer"; Value = $number }
  }
  if ($RawValue.StartsWith("[")) {
    if (-not $RawValue.EndsWith("]")) { throw "line $LineNumber has an unclosed inline list" }
    $inner = $RawValue.Substring(1, $RawValue.Length - 2).Trim()
    $items = [Collections.Generic.List[object]]::new()
    if ($inner) {
      foreach ($part in (Split-V1YamlInlineList $inner $LineNumber).Parts) {
        $items.Add((ConvertFrom-V1YamlScalar $part $LineNumber)) | Out-Null
      }
    }
    return [pscustomobject]@{ Type = "list"; Value = $items }
  }
  if ($RawValue.StartsWith([string][char]34)) {
    if (-not $RawValue.EndsWith([string][char]34)) { throw "line $LineNumber has an unclosed quoted string" }
    try {
      $decoded = ConvertFrom-Json -InputObject $RawValue
    } catch {
      throw "line $LineNumber has an invalid quoted string"
    }
    if ($decoded -isnot [string]) { throw "line $LineNumber has an invalid quoted string" }
    return [pscustomobject]@{ Type = "string"; Value = $decoded }
  }
  if ($RawValue.StartsWith([string][char]39)) {
    if (-not $RawValue.EndsWith([string][char]39)) { throw "line $LineNumber has an unclosed quoted string" }
    $inner = $RawValue.Substring(1, $RawValue.Length - 2)
    $decoded = [Text.StringBuilder]::new()
    for ($index = 0; $index -lt $inner.Length; $index++) {
      if ($inner[$index] -eq [char]39) {
        if ($index + 1 -ge $inner.Length -or $inner[$index + 1] -ne [char]39) {
          throw "line $LineNumber has an invalid quoted string"
        }
        $decoded.Append([char]39) | Out-Null
        $index++
      } else {
        $decoded.Append($inner[$index]) | Out-Null
      }
    }
    return [pscustomobject]@{ Type = "string"; Value = $decoded.ToString() }
  }
  return [pscustomobject]@{ Type = "string"; Value = $RawValue }
}

function ConvertFrom-V1YamlDocument([string]$Source) {
  $normalized = $Source
  if ($normalized.Length -gt 0 -and [int]$normalized[0] -eq 0xFEFF) {
    $normalized = $normalized.Substring(1)
  }
  $records = [Collections.Generic.List[object]]::new()
  $rawLines = [regex]::Split($normalized, "`r?`n")
  for ($index = 0; $index -lt $rawLines.Length; $index++) {
    $raw = $rawLines[$index]
    if ($raw.Contains("`t")) { throw "line $($index + 1) contains a tab" }
    $withoutComment = Remove-V1YamlInlineComment $raw
    if (-not $withoutComment.Trim()) { continue }
    $indent = $withoutComment.Length - $withoutComment.TrimStart([char[]]@([char]32)).Length
    $records.Add([pscustomobject]@{
      Line = $index + 1
      Indent = $indent
      Content = $withoutComment.Trim()
    }) | Out-Null
  }

  $entries = @{}
  if ($records.Count -eq 0) { return $entries }
  if ($records[0].Indent -ne 0) { throw "the document must start at indentation zero" }
  $stack = [Collections.Generic.List[object]]::new()

  foreach ($record in $records) {
    while ($stack.Count -gt 0 -and $record.Indent -le $stack[$stack.Count - 1].Indent) {
      $stack.RemoveAt($stack.Count - 1)
    }
    $parent = if ($stack.Count -gt 0) { $stack[$stack.Count - 1] } else { $null }
    if ($record.Indent -eq 0 -and $parent) { throw "line $($record.Line) has unexpected indentation" }
    if ($record.Indent -gt 0 -and -not $parent) { throw "line $($record.Line) has unexpected indentation" }
    if ($parent) {
      if ($null -eq $parent.ChildIndent) {
        $parent.ChildIndent = $record.Indent
      } elseif ($parent.ChildIndent -ne $record.Indent) {
        throw "line $($record.Line) has inconsistent indentation"
      }
    }

    if ($record.Content -ceq "-" -or $record.Content.StartsWith("- ")) {
      if (-not $parent -or $parent.Path -cne "enabled_domains") {
        throw "line $($record.Line) has an unsupported sequence"
      }
      $rawItem = $record.Content.Substring(1).Trim()
      if (-not $rawItem) { throw "line $($record.Line) has an empty sequence item" }
      $entry = $entries[$parent.Path]
      if ($entry.Kind -ceq "container") {
        $entry.Kind = "list"
        $entry.Value = [Collections.Generic.List[object]]::new()
      } elseif ($entry.Kind -cne "list") {
        throw "line $($record.Line) has an invalid sequence parent"
      }
      $item = ConvertFrom-V1YamlScalar $rawItem $record.Line
      if ($item.Type -ceq "list") { throw "line $($record.Line) has a nested sequence" }
      $entry.Value.Add($item) | Out-Null
      continue
    }

    $mapping = [regex]::Match($record.Content, '^([A-Za-z_][A-Za-z0-9_-]*):(?: +(.*))?$')
    if (-not $mapping.Success) { throw "line $($record.Line) uses unsupported YAML syntax" }
    $key = $mapping.Groups[1].Value
    if ([Array]::IndexOf([string[]]@("__proto__", "prototype", "constructor"), $key) -ge 0) {
      throw "line $($record.Line) uses dangerous key $key"
    }
    $path = if ($parent) { "$($parent.Path).$key" } else { $key }
    if ($entries.ContainsKey($path)) { throw "line $($record.Line) duplicates key $path" }

    if ($mapping.Groups[2].Success) {
      $scalar = ConvertFrom-V1YamlScalar $mapping.Groups[2].Value $record.Line
      $entries[$path] = [pscustomobject]@{
        Kind = $scalar.Type
        Value = $scalar.Value
        ChildIndent = $null
      }
    } else {
      $entry = [pscustomobject]@{ Kind = "container"; Value = $null; ChildIndent = $null }
      $entries[$path] = $entry
      $stack.Add([pscustomobject]@{
        Path = $path
        Indent = $record.Indent
        ChildIndent = $null
        Entry = $entry
      }) | Out-Null
    }
  }
  return $entries
}

function Test-V1ConfigDocument([string]$Source) {
  try {
    $entries = ConvertFrom-V1YamlDocument $Source
  } catch {
    return "yaml-syntax-invalid"
  }

  $requiredPaths = [string[]]@(
    "schema_version",
    "created_with_kit_version",
    "last_migrated_with_kit_version",
    "context_write_policy",
    "enabled_domains",
    "budgets",
    "budgets.active_context",
    "budgets.active_context.unit",
    "budgets.active_context.warn",
    "budgets.active_context.block_auto",
    "budgets.single_proposal",
    "budgets.single_proposal.unit",
    "budgets.single_proposal.warn",
    "budgets.pending_proposals",
    "budgets.pending_proposals.unit",
    "budgets.pending_proposals.warn",
    "budgets.pending_proposals.block_auto",
    "privacy",
    "privacy.raw_conversation_stored",
    "privacy.full_logs_stored",
    "privacy.secrets_stored",
    "privacy.customer_data_stored",
    "privacy.absolute_user_paths_stored"
  )
  $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($path in $requiredPaths) { $allowed.Add($path) | Out-Null }
  foreach ($path in $entries.Keys) {
    if (-not $allowed.Contains($path)) { return "unsupported-key" }
  }
  foreach ($path in $requiredPaths) {
    if (-not $entries.ContainsKey($path)) { return "missing-required-key" }
  }

  foreach ($container in [string[]]@(
    "budgets",
    "budgets.active_context",
    "budgets.single_proposal",
    "budgets.pending_proposals",
    "privacy"
  )) {
    if ($entries[$container].Kind -cne "container") { return "mapping-required" }
  }
  if ($entries["schema_version"].Kind -cne "integer" -or $entries["schema_version"].Value -ne 1) {
    return "schema-version-invalid"
  }
  if ($entries["created_with_kit_version"].Kind -cne "string" -or
    $entries["created_with_kit_version"].Value -cne "0.2.0") {
    return "created-kit-version-invalid"
  }
  $migratedVersion = $entries["last_migrated_with_kit_version"]
  if (-not (($migratedVersion.Kind -ceq "null") -or
    ($migratedVersion.Kind -ceq "string" -and $migratedVersion.Value -ceq "0.2.0"))) {
    return "migrated-kit-version-invalid"
  }
  $policy = $entries["context_write_policy"]
  if ($policy.Kind -cne "string" -or
    -not ($policy.Value -ceq "propose" -or $policy.Value -ceq "auto")) {
    return "write-policy-invalid"
  }

  $domains = $entries["enabled_domains"]
  if ($domains.Kind -cne "list") { return "enabled-domains-invalid" }
  $seenDomains = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($domain in $domains.Value) {
    if ($domain.Type -cne "string" -or $domain.Value -cnotmatch '^[a-z0-9][a-z0-9-]*$') {
      return "enabled-domain-invalid"
    }
    if (-not $seenDomains.Add($domain.Value)) { return "enabled-domain-duplicate" }
  }

  foreach ($budget in @(
    @{ Path = "budgets.active_context"; Unit = "lines"; Bounded = $true },
    @{ Path = "budgets.single_proposal"; Unit = "lines"; Bounded = $false },
    @{ Path = "budgets.pending_proposals"; Unit = "count"; Bounded = $true }
  )) {
    $unit = $entries["$($budget.Path).unit"]
    $warn = $entries["$($budget.Path).warn"]
    if ($unit.Kind -cne "string" -or $unit.Value -cne $budget.Unit) { return "budget-unit-invalid" }
    if ($warn.Kind -cne "integer" -or $warn.Value -le 0) { return "budget-warning-invalid" }
    if ($budget.Bounded) {
      $block = $entries["$($budget.Path).block_auto"]
      if ($block.Kind -cne "integer" -or $block.Value -le $warn.Value) {
        return "budget-block-invalid"
      }
    }
  }

  foreach ($privacyKey in [string[]]@(
    "raw_conversation_stored",
    "full_logs_stored",
    "secrets_stored",
    "customer_data_stored",
    "absolute_user_paths_stored"
  )) {
    $privacy = $entries["privacy.$privacyKey"]
    if ($privacy.Kind -cne "boolean" -or $privacy.Value -ne $false) { return "privacy-invalid" }
  }
  return ""
}

function Get-V1ConfigClassification([string]$Source) {
  $normalized = $Source
  if ($normalized.Length -gt 0 -and [int]$normalized[0] -eq 0xFEFF) {
    $normalized = $normalized.Substring(1)
  }
  $schemaValues = [Collections.Generic.List[string]]::new()
  foreach ($rawLine in [regex]::Split($normalized, "`r?`n")) {
    $cleanedLine = Remove-V1YamlInlineComment $rawLine
    if ($cleanedLine.StartsWith("schema_version:")) {
      $schemaValues.Add($cleanedLine.Substring("schema_version:".Length).TrimStart()) | Out-Null
    }
  }
  if ($schemaValues.Count -eq 0) {
    return [pscustomobject]@{ Kind = "legacy"; Version = ""; Reason = "missing-schema-version" }
  }
  if ($schemaValues.Count -gt 1) {
    return [pscustomobject]@{ Kind = "conflict"; Version = ""; Reason = "duplicate-schema-version" }
  }
  try {
    $schema = ConvertFrom-V1YamlScalar $schemaValues[0] 1
  } catch {
    return [pscustomobject]@{ Kind = "invalid"; Version = ""; Reason = "schema-version-invalid" }
  }
  if ($schema.Type -cne "integer") {
    return [pscustomobject]@{ Kind = "invalid"; Version = ""; Reason = "schema-version-invalid" }
  }
  if ($schema.Value -eq 0) {
    return [pscustomobject]@{ Kind = "legacy"; Version = "0"; Reason = "legacy-v0-is-read-only" }
  }
  if ($schema.Value -gt 1) {
    return [pscustomobject]@{ Kind = "future"; Version = [string]$schema.Value; Reason = "newer-bootstrap-required" }
  }
  if ($schema.Value -ne 1) {
    return [pscustomobject]@{ Kind = "invalid"; Version = [string]$schema.Value; Reason = "schema-version-invalid" }
  }
  $reason = Test-V1ConfigDocument $Source
  if ($reason) {
    return [pscustomobject]@{ Kind = "invalid"; Version = "1"; Reason = $reason }
  }
  return [pscustomobject]@{ Kind = "valid"; Version = "1"; Reason = "" }
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
  $configClassification = Get-V1ConfigClassification (Get-Content -Raw -LiteralPath $legacyConfig)
  if ($configClassification.Kind -ceq "conflict") {
    $legacyWorkspace = $true
    Add-PlanAction "Conflict" "workspace-context" "" $legacyConfig $configClassification.Reason
  } elseif ($configClassification.Kind -ceq "legacy") {
    $legacyWorkspace = $true
    Add-PlanAction "MigrationRequired" "workspace-context" "" $legacyConfig "legacy-v0-is-read-only"
  } elseif ($configClassification.Kind -ceq "future") {
    $legacyWorkspace = $true
    Add-PlanAction "UpgradeRequired" "workspace-context" "" $legacyConfig "schema-version=$($configClassification.Version);newer-bootstrap-required"
  } elseif ($configClassification.Kind -ceq "invalid") {
    $legacyWorkspace = $true
    Add-PlanAction "InvalidConfig" "workspace-context" "" $legacyConfig "schema-v1-envelope-invalid;$($configClassification.Reason)"
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
$blocked = @($actions | Where-Object { $_.State -in @("Conflict", "InvalidConfig", "MigrationRequired", "UpgradeRequired") }).Count -gt 0

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
  Write-Error "The approved plan is blocked by an invalid config, conflict, upgrade, or migration requirement."
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
