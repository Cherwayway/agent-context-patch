[CmdletBinding()]
param(
  [ValidateSet("DryRun", "Apply", "Workspace", "UpdateDryRun", "UpdateApply")]
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

$isUpdateMode = $Mode -eq "UpdateDryRun" -or $Mode -eq "UpdateApply"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$templateRoot = Join-Path $repoRoot "templates\.agent-context"
$skillSourceRoot = Join-Path $repoRoot "skills\evolve"
$workspace = if ($isUpdateMode) {
  [IO.Path]::GetFullPath($WorkspacePath)
} else {
  (Resolve-Path -LiteralPath $WorkspacePath).Path
}
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
  $sha = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
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

function Test-SemanticVersion([AllowEmptyString()][string]$Value) {
  return $Value -cmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z'
}

function Compare-NumericSemanticIdentifier([string]$Left, [string]$Right) {
  if ($Left.Length -lt $Right.Length) { return -1 }
  if ($Left.Length -gt $Right.Length) { return 1 }
  return [string]::CompareOrdinal($Left, $Right)
}

function Get-SemanticVersionPrecedence([string]$Version) {
  $withoutBuild = $Version
  $buildIndex = $withoutBuild.IndexOf([char]"+")
  if ($buildIndex -ge 0) { $withoutBuild = $withoutBuild.Substring(0, $buildIndex) }
  $prereleaseIndex = $withoutBuild.IndexOf([char]"-")
  $core = if ($prereleaseIndex -ge 0) {
    $withoutBuild.Substring(0, $prereleaseIndex)
  } else {
    $withoutBuild
  }
  $prerelease = if ($prereleaseIndex -ge 0) {
    @($withoutBuild.Substring($prereleaseIndex + 1).Split([char]"."))
  } else {
    @()
  }
  return [pscustomobject]@{ Core = @($core.Split([char]".")); Prerelease = $prerelease }
}

function Compare-SemanticVersion([string]$Left, [string]$Right) {
  $leftVersion = Get-SemanticVersionPrecedence $Left
  $rightVersion = Get-SemanticVersionPrecedence $Right
  for ($index = 0; $index -lt 3; $index++) {
    $comparison = Compare-NumericSemanticIdentifier $leftVersion.Core[$index] $rightVersion.Core[$index]
    if ($comparison -ne 0) { return $comparison }
  }
  if ($leftVersion.Prerelease.Count -eq 0 -and $rightVersion.Prerelease.Count -eq 0) { return 0 }
  if ($leftVersion.Prerelease.Count -eq 0) { return 1 }
  if ($rightVersion.Prerelease.Count -eq 0) { return -1 }

  $count = [Math]::Max($leftVersion.Prerelease.Count, $rightVersion.Prerelease.Count)
  for ($index = 0; $index -lt $count; $index++) {
    if ($index -ge $leftVersion.Prerelease.Count) { return -1 }
    if ($index -ge $rightVersion.Prerelease.Count) { return 1 }
    $leftIdentifier = $leftVersion.Prerelease[$index]
    $rightIdentifier = $rightVersion.Prerelease[$index]
    $leftNumeric = $leftIdentifier -cmatch '^[0-9]+\z'
    $rightNumeric = $rightIdentifier -cmatch '^[0-9]+\z'
    if ($leftNumeric -and $rightNumeric) {
      $comparison = Compare-NumericSemanticIdentifier $leftIdentifier $rightIdentifier
    } elseif ($leftNumeric) {
      $comparison = -1
    } elseif ($rightNumeric) {
      $comparison = 1
    } else {
      $comparison = [string]::CompareOrdinal($leftIdentifier, $rightIdentifier)
    }
    if ($comparison -ne 0) { return $comparison }
  }
  return 0
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
    -not (Test-SemanticVersion $entries["created_with_kit_version"].Value)) {
    return "created-kit-version-invalid"
  }
  $migratedVersion = $entries["last_migrated_with_kit_version"]
  if (-not (($migratedVersion.Kind -ceq "null") -or
    ($migratedVersion.Kind -ceq "string" -and (Test-SemanticVersion $migratedVersion.Value)))) {
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

function Get-TreeFingerprint([string]$Root) {
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw "Tree root is not a directory: $Root"
  }

  $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd([char]"\", [char]"/")
  $entries = [Collections.Generic.List[string]]::new()
  Get-ChildItem -LiteralPath $fullRoot -Recurse -Directory -Force |
    ForEach-Object {
      $relative = $_.FullName.Substring($fullRoot.Length).TrimStart([char]"\", [char]"/").Replace("\", "/")
      $entries.Add("D:$($relative.Length):$relative") | Out-Null
    }
  Get-ChildItem -LiteralPath $fullRoot -Recurse -File -Force |
    ForEach-Object {
      $relative = $_.FullName.Substring($fullRoot.Length).TrimStart([char]"\", [char]"/").Replace("\", "/")
      $entries.Add("F:$($relative.Length):${relative}:$(Get-Sha256File $_.FullName)") | Out-Null
    }
  return Get-Sha256Text ([string]::Join("`n", @($entries | Sort-Object)))
}

function Copy-TreeSnapshot([string]$SourceRoot, [string]$DestinationRoot) {
  if (Test-Path -LiteralPath $DestinationRoot) {
    throw "Snapshot destination already exists: $DestinationRoot"
  }
  New-Item -ItemType Directory -Path $DestinationRoot | Out-Null

  $fullSource = [IO.Path]::GetFullPath($SourceRoot).TrimEnd([char]"\", [char]"/")
  Get-ChildItem -LiteralPath $fullSource -Recurse -Directory -Force |
    Sort-Object FullName |
    ForEach-Object {
      $relative = $_.FullName.Substring($fullSource.Length).TrimStart([char]"\", [char]"/")
      New-Item -ItemType Directory -Force -Path (Join-Path $DestinationRoot $relative) | Out-Null
    }
  Get-ChildItem -LiteralPath $fullSource -Recurse -File -Force |
    Sort-Object FullName |
    ForEach-Object {
      $relative = $_.FullName.Substring($fullSource.Length).TrimStart([char]"\", [char]"/")
      $destination = Join-Path $DestinationRoot $relative
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
      [IO.File]::Copy($_.FullName, $destination, $false)
    }
}

function Get-JsonRootPropertyTokens([string]$Source) {
  $properties = [Collections.Generic.List[string]]::new()
  $versionStringEscapeStates = [Collections.Generic.List[bool]]::new()
  $depth = 0
  $inString = $false
  $escaped = $false
  $stringHadEscape = $false
  $pendingRootProperty = ""
  $token = [Text.StringBuilder]::new()

  for ($index = 0; $index -lt $Source.Length; $index++) {
    $character = $Source[$index]
    if ($inString) {
      if ($escaped) {
        $escaped = $false
        continue
      }
      if ($character -ceq [char]"\") {
        $escaped = $true
        $stringHadEscape = $true
        continue
      }
      if ($character -ceq [char]'"') {
        $inString = $false
        if ($depth -eq 1) {
          $lookahead = $index + 1
          while ($lookahead -lt $Source.Length -and [char]::IsWhiteSpace($Source[$lookahead])) {
            $lookahead++
          }
          if ($lookahead -lt $Source.Length -and $Source[$lookahead] -ceq [char]':') {
            $pendingRootProperty = if ($stringHadEscape) { "<escaped>" } else { $token.ToString() }
            $properties.Add($pendingRootProperty) | Out-Null
          } elseif ($pendingRootProperty -ceq "version") {
            $versionStringEscapeStates.Add($stringHadEscape) | Out-Null
            $pendingRootProperty = ""
          }
        }
        continue
      }
      $token.Append($character) | Out-Null
      continue
    }

    if ($character -ceq [char]'"') {
      $inString = $true
      $escaped = $false
      $stringHadEscape = $false
      $token.Clear() | Out-Null
    } elseif ($character -ceq [char]'{' -or $character -ceq [char]'[') {
      $depth++
    } elseif ($character -ceq [char]'}' -or $character -ceq [char]']') {
      if ($depth -eq 1) { $pendingRootProperty = "" }
      $depth--
    } elseif ($character -ceq [char]',' -and $depth -eq 1) {
      $pendingRootProperty = ""
    }
  }
  return [pscustomobject]@{
    Properties = @($properties)
    VersionStringEscapeStates = @($versionStringEscapeStates)
  }
}

function Get-SkillManifestVersion([string]$SkillRoot) {
  $manifestPath = Join-Path $SkillRoot "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Skill manifest is missing: $manifestPath"
  }
  $manifestSource = Get-Content -Raw -LiteralPath $manifestPath
  try {
    $manifest = $manifestSource | ConvertFrom-Json
  } catch {
    throw "Skill manifest is invalid JSON: $manifestPath"
  }
  $rootTokens = Get-JsonRootPropertyTokens $manifestSource
  $rootVersionTokens = @($rootTokens.Properties | Where-Object { $_ -ceq "version" })
  $versionProperties = if ($manifest -is [pscustomobject]) {
    @($manifest.PSObject.Properties | Where-Object { $_.Name -ceq "version" })
  } else {
    @()
  }
  if ($rootVersionTokens.Count -ne 1 -or $rootTokens.VersionStringEscapeStates.Count -ne 1 -or
    $rootTokens.VersionStringEscapeStates[0] -or $versionProperties.Count -ne 1 -or
    $versionProperties[0].Value -isnot [string]) {
    throw "Skill manifest must be one JSON object with exactly one lowercase string version property: $manifestPath"
  }
  $version = $versionProperties[0].Value
  if (-not (Test-SemanticVersion $version)) {
    throw "Skill manifest version is not valid SemVer: $manifestPath"
  }
  return $version
}

if ($isUpdateMode) {
  if (-not $skillTarget) {
    Write-Error "UpdateDryRun/UpdateApply require -SkillTargetPath."
  }
  if ($instructionTarget) {
    Write-Error "UpdateDryRun/UpdateApply only update SkillTargetPath; do not pass -InstructionFilePath."
  }
  if (-not (Test-Path -LiteralPath $skillSourceRoot -PathType Container)) {
    Write-Error "Candidate release skill is missing: $skillSourceRoot"
  }
  if (-not (Test-Path -LiteralPath $skillTarget -PathType Container)) {
    Write-Error "Installed skill target is missing: $skillTarget"
  }

  $sourceReparsePoint = Get-FirstReparsePoint $skillSourceRoot
  $targetReparsePoint = Get-FirstReparsePoint $skillTarget
  if ($sourceReparsePoint) {
    Add-PlanAction "Conflict" "skill-update" $sourceReparsePoint $skillTarget "candidate-reparse-point-not-followed"
  } elseif ($targetReparsePoint) {
    Add-PlanAction "Conflict" "skill-update" $skillSourceRoot $targetReparsePoint "target-reparse-point-not-followed"
  }

  $sourceVersion = Get-SkillManifestVersion $skillSourceRoot
  $targetVersion = Get-SkillManifestVersion $skillTarget
  $sourceTreeHash = Get-TreeFingerprint $skillSourceRoot
  $targetTreeHash = Get-TreeFingerprint $skillTarget
  $skillName = Split-Path -Leaf $skillTarget.TrimEnd([char]"\", [char]"/")
  $skillParent = Split-Path -Parent $skillTarget.TrimEnd([char]"\", [char]"/")
  $backupRoot = Join-Path $skillParent ".agent-context-patch-backups"
  $backupPath = Join-Path $backupRoot "$skillName-$targetVersion-before-$sourceVersion"
  $backupRootReparsePoint = Get-FirstReparsePoint $backupRoot
  $backupRootInvalidType = (Test-Path -LiteralPath $backupRoot) -and -not (Test-Path -LiteralPath $backupRoot -PathType Container)

  if ($backupRootReparsePoint) {
    Add-PlanAction "Conflict" "skill-update" $skillTarget $backupRootReparsePoint "backup-root-reparse-point-not-followed"
  } elseif ($backupRootInvalidType) {
    Add-PlanAction "Conflict" "skill-update" $skillTarget $backupRoot "backup-root-not-directory"
  }

  if (-not $sourceReparsePoint -and -not $targetReparsePoint -and -not $backupRootReparsePoint -and -not $backupRootInvalidType) {
    if ($sourceVersion -ceq $targetVersion -and $sourceTreeHash -eq $targetTreeHash) {
      Add-PlanAction "NoUpdate" "skill-update" $skillSourceRoot $skillTarget "installed=$targetVersion;source=$sourceVersion;tree-sha256=$sourceTreeHash"
    } elseif ($sourceVersion -ceq $targetVersion) {
      Add-PlanAction "Conflict" "skill-update" $skillSourceRoot $skillTarget "same-version-tree-differs;version=$sourceVersion;source-tree-sha256=$sourceTreeHash;target-tree-sha256=$targetTreeHash"
    } elseif ((Compare-SemanticVersion $sourceVersion $targetVersion) -le 0) {
      Add-PlanAction "DowngradeRequired" "skill-update" $skillSourceRoot $skillTarget "installed=$targetVersion;source=$sourceVersion;newer-release-required"
    } elseif (Test-Path -LiteralPath $backupPath) {
      Add-PlanAction "Conflict" "skill-update" $skillSourceRoot $backupPath "backup-already-exists;installed=$targetVersion;source=$sourceVersion"
    } else {
      Add-PlanAction "UpgradeSkill" "skill-update" $skillSourceRoot $skillTarget "installed=$targetVersion;source=$sourceVersion;source-tree-sha256=$sourceTreeHash;target-tree-sha256=$targetTreeHash"
    }
  }

  $updatePlanLines = [Collections.Generic.List[string]]::new()
  $updatePlanLines.Add("operation=skill-update")
  $updatePlanLines.Add("source=$(ConvertTo-NormalPath $skillSourceRoot)")
  $updatePlanLines.Add("target=$(ConvertTo-NormalPath $skillTarget)")
  $updatePlanLines.Add("backup=$(ConvertTo-NormalPath $backupPath)")
  $updatePlanLines.Add("sourceVersion=$sourceVersion")
  $updatePlanLines.Add("targetVersion=$targetVersion")
  $updatePlanLines.Add("sourceTreeHash=$sourceTreeHash")
  $updatePlanLines.Add("targetTreeHash=$targetTreeHash")
  $actions |
    Sort-Object State, Kind, Target, Source, Detail |
    ForEach-Object {
      $updatePlanLines.Add("$($_.State)|$($_.Kind)|$(ConvertTo-NormalPath $_.Source)|$(ConvertTo-NormalPath $_.Target)|$($_.Detail)")
    }
  $updatePlanHash = Get-Sha256Text ([string]::Join("`n", $updatePlanLines))
  $updateBlocked = @($actions | Where-Object { $_.State -in @("Conflict", "DowngradeRequired") }).Count -gt 0
  $upgradeAction = $actions | Where-Object { $_.State -eq "UpgradeSkill" } | Select-Object -First 1

  Write-Host "Agent Context Patch Bootstrap"
  Write-Host "Mode: $Mode"
  Write-Host "Skill source: $skillSourceRoot"
  Write-Host "Skill target: $skillTarget"
  Write-Host "Backup path: $backupPath"
  Write-Host ""
  Write-Host "Plan:"
  foreach ($action in $actions) {
    $suffix = if ($action.Detail) { " ($($action.Detail))" } else { "" }
    Write-Host "$($action.State): $($action.Target)$suffix"
  }
  Write-Host "Plan hash: $updatePlanHash"
  Write-Host "Plan status: $(if ($updateBlocked) { 'blocked' } else { 'ready' })"

  if ($Mode -eq "UpdateDryRun") {
    Write-Host "Dry run complete. No files were written."
    exit $(if ($updateBlocked) { 2 } else { 0 })
  }
  if (-not $ApprovedPlanHash) {
    Write-Error "UpdateApply requires -ApprovedPlanHash from the reviewed UpdateDryRun."
  }
  if ($ApprovedPlanHash.ToLowerInvariant() -ne $updatePlanHash) {
    Write-Error "Approved update plan hash does not match the current source and target trees. Re-run UpdateDryRun and review the new plan."
  }
  if ($updateBlocked) {
    Write-Error "The approved update plan is blocked by a conflict."
  }
  if (-not $upgradeAction) {
    Write-Host ""
    Write-Host "Update receipt:"
    Write-Host "Status: no-update"
    Write-Host "Plan hash: $updatePlanHash"
    Write-Host "Installed version: $targetVersion"
    Write-Host "Previous version: $targetVersion"
    Write-Host "Restart required: false"
    exit 0
  }

  $stagePath = Join-Path $skillParent ".agent-context-patch-stage-$([Guid]::NewGuid().ToString('N'))"
  $originalMoved = $false
  $candidateActivated = $false
  try {
    Copy-TreeSnapshot $skillSourceRoot $stagePath
    if ((Get-TreeFingerprint $skillSourceRoot) -ne $sourceTreeHash) {
      throw "Candidate release changed after planning."
    }
    if ((Get-TreeFingerprint $stagePath) -ne $sourceTreeHash) {
      throw "Staged skill does not match the planned candidate release."
    }
    if (Get-FirstReparsePoint $backupRoot) {
      throw "Skill backup root became a reparse point after planning: $backupRoot"
    }
    if ((Test-Path -LiteralPath $backupRoot) -and -not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
      throw "Skill backup root is not a directory: $backupRoot"
    }
    if (Test-Path -LiteralPath $backupPath) {
      throw "Backup path appeared after planning: $backupPath"
    }
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Move-Item -LiteralPath $skillTarget -Destination $backupPath
    $originalMoved = $true
    if ((Get-TreeFingerprint $backupPath) -ne $targetTreeHash) {
      throw "Backup does not match the planned installed skill."
    }
    if ($env:ACP_BOOTSTRAP_TEST_FAULT -in @("after-skill-backup", "during-skill-restore")) {
      throw "Injected verification failure after skill backup."
    }
    if ($env:ACP_BOOTSTRAP_TEST_FAULT -ceq "target-appeared-before-activation") {
      New-Item -ItemType Directory -Path $skillTarget | Out-Null
      [IO.File]::WriteAllText(
        (Join-Path $skillTarget "foreign-target.txt"),
        "foreign target must survive`n",
        [Text.UTF8Encoding]::new($false)
      )
      throw "Injected unexpected skill target before activation."
    }
    Move-Item -LiteralPath $stagePath -Destination $skillTarget
    $candidateActivated = $true
    if ((Get-TreeFingerprint $skillTarget) -ne $sourceTreeHash) {
      throw "Installed skill does not match the planned candidate release."
    }
  } catch {
    $failure = $_.Exception.Message
    $restored = $false
    $restoreFailure = ""
    if ($originalMoved) {
      if ($env:ACP_BOOTSTRAP_TEST_FAULT -ceq "during-skill-restore") {
        $restoreFailure = "Injected failure during automatic restore."
      } else {
        try {
          if (Test-Path -LiteralPath $skillTarget) {
            if (-not $candidateActivated) {
              throw "Unexpected skill target appeared before activation; it was preserved."
            }
            if (Get-FirstReparsePoint $skillTarget) {
              throw "Activated skill target contains a reparse point; it was preserved."
            }
            if ((Get-TreeFingerprint $skillTarget) -ne $sourceTreeHash) {
              throw "Activated skill target changed after activation; it was preserved."
            }
            Remove-Item -LiteralPath $skillTarget -Recurse -Force
          }
          if (-not (Test-Path -LiteralPath $backupPath -PathType Container)) {
            throw "Recovery copy is missing: $backupPath"
          }
          Move-Item -LiteralPath $backupPath -Destination $skillTarget
          $restored = Test-Path -LiteralPath $skillTarget -PathType Container
          if (-not $restored) { throw "Restored skill target is missing: $skillTarget" }
        } catch {
          $restoreFailure = $_.Exception.Message
        }
      }
    }
    if (Test-Path -LiteralPath $stagePath) {
      Remove-Item -LiteralPath $stagePath -Recurse -Force
    }
    if (-not $originalMoved) {
      Write-Error "Skill update failed before the installed skill was replaced: $failure"
    } elseif ($restored) {
      Write-Error "Skill update failed and the previous installation was restored: $failure"
    } else {
      Write-Error "Skill update failed; automatic restore also failed. Recovery copy: $backupPath. Update failure: $failure Restore failure: $restoreFailure"
    }
  }

  Write-Host ""
  Write-Host "Update receipt:"
  Write-Host "Status: applied"
  Write-Host "Plan hash: $updatePlanHash"
  Write-Host "Installed version: $sourceVersion"
  Write-Host "Previous version: $targetVersion"
  Write-Host "Backup path: $backupPath"
  Write-Host "Restart required: true"
  exit 0
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
