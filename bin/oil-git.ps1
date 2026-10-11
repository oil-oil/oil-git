param([Parameter(ValueFromRemainingArguments = $true)][string[]]$LaunchArguments)
# Pass arguments as an array to preserve spaces and Unicode paths.
$TaskAppPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'oil-git.exe'
if (-not (Test-Path $TaskAppPath)) { $TaskAppPath = Join-Path $env:LOCALAPPDATA 'Oil Git\oil-git.exe' }
if (-not (Test-Path $TaskAppPath)) {
    throw 'Oil Git was not found. Install the application first. / 未找到 Oil Git，请先安装应用。'
}
$TaskCommand = ''
$TaskLocaleValue = $false
$TaskRepositoryPending = $false
for ($TaskIndex = 0; $TaskIndex -lt $LaunchArguments.Count; $TaskIndex++) {
    $TaskArgument = $LaunchArguments[$TaskIndex]
    if ($TaskLocaleValue) {
        $TaskLocaleValue = $false
    } elseif ($TaskArgument -eq '--lang') {
        $TaskLocaleValue = $true
    } elseif (-not $TaskCommand) {
        $TaskCommand = $TaskArgument
        $TaskRepositoryPending = $TaskCommand -eq 'open'
    } elseif ($TaskRepositoryPending) {
        if (-not $TaskArgument.StartsWith('--') -and -not [IO.Path]::IsPathRooted($TaskArgument)) {
            $LaunchArguments[$TaskIndex] = Join-Path (Get-Location).ProviderPath $TaskArgument
        }
        $TaskRepositoryPending = $false
    }
}
$TaskPreviousEncoding = [Console]::OutputEncoding
try {
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    if (-not $TaskCommand -or $TaskCommand -eq 'open') {
        # Desktop launch is asynchronous; success only confirms dispatch.
        & $TaskAppPath @LaunchArguments
        $TaskExitCode = 0
    } else {
        # A GUI-subsystem executable must use a pipeline for PowerShell to wait.
        # Write each line verbatim, without reformatting JSON.
        & $TaskAppPath @LaunchArguments | ForEach-Object { [Console]::Out.WriteLine($_) }
        $TaskExitCode = $LASTEXITCODE
    }
} finally {
    [Console]::OutputEncoding = $TaskPreviousEncoding
}
exit $TaskExitCode
