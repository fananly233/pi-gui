[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [string]$ExpectedVersion = "0.1.0",

    [string]$PreviousInstallerPath,

    [switch]$RequireSignature,

    [switch]$AllowCurrentMachine
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Invoke-Installer {
    param(
        [string]$Path,
        [string[]]$Arguments
    )

    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -Wait -PassThru
    Assert-Condition ($process.ExitCode -eq 0) "Installer failed with exit code $($process.ExitCode): $Path"
}

function Assert-ValidSignature {
    param(
        [string]$Path,
        [string]$Label
    )

    $signature = Get-AuthenticodeSignature -FilePath $Path
    Assert-Condition ($signature.Status -eq "Valid") "$Label signature is $($signature.Status), expected Valid"
}

function Test-AppLaunch {
    param([string]$ExecutablePath)

    $process = Start-Process -FilePath $ExecutablePath -PassThru
    try {
        Start-Sleep -Seconds 5
        Assert-Condition (-not $process.HasExited) "Installed Pi GUI exited during the launch smoke test"
    }
    finally {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
            $process.WaitForExit()
        }
    }
}

function Wait-Until {
    param(
        [scriptblock]$Condition,
        [string]$FailureMessage,
        [int]$TimeoutSeconds = 15
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)

    throw $FailureMessage
}

$isAuthorizedRunner = (
    $env:GITHUB_ACTIONS -eq "true" -and
    $env:RUNNER_OS -eq "Windows" -and
    $env:PI_GUI_CLEAN_MACHINE -eq "github-hosted-windows"
)
if (-not $isAuthorizedRunner -and -not $AllowCurrentMachine) {
    throw "Refusing to install outside the authorized clean-machine workflow. Use a disposable Windows VM/runner, or pass -AllowCurrentMachine explicitly."
}

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$resolvedPreviousInstaller = if ($PreviousInstallerPath) {
    (Resolve-Path -LiteralPath $PreviousInstallerPath).Path
} else {
    $null
}

$signature = Get-AuthenticodeSignature -FilePath $resolvedInstaller
Write-Host "Installer signature: $($signature.Status)"
if ($RequireSignature) {
    Assert-Condition ($signature.Status -eq "Valid") "The release installer must have a valid Authenticode signature"

    if ($resolvedPreviousInstaller) {
        $previousSignature = Get-AuthenticodeSignature -FilePath $resolvedPreviousInstaller
        Assert-Condition ($previousSignature.Status -eq "Valid") "The previous release installer must have a valid Authenticode signature"
    }
}

$installDirectory = Join-Path $env:LOCALAPPDATA "Pi GUI"
$executable = Join-Path $installDirectory "pi-gui.exe"
$uninstaller = Join-Path $installDirectory "uninstall.exe"
$appDataDirectory = Join-Path $env:APPDATA "com.pi.gui"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Pi GUI"
$marker = Join-Path $appDataDirectory "clean-machine-preservation.marker"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Pi GUI.lnk"
$startMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Pi GUI.lnk"

Assert-Condition (-not (Test-Path -LiteralPath $installDirectory)) "Pi GUI install directory already exists: $installDirectory"
Assert-Condition (-not (Test-Path -LiteralPath $appDataDirectory)) "Pi GUI app-data directory already exists: $appDataDirectory"
Assert-Condition (-not (Test-Path -LiteralPath $uninstallKey)) "Pi GUI uninstall registry key already exists"
Assert-Condition (-not (Test-Path -LiteralPath $desktopShortcut)) "Pi GUI desktop shortcut already exists"
Assert-Condition (-not (Test-Path -LiteralPath $startMenuShortcut)) "Pi GUI Start menu shortcut already exists"

$installedByThisRun = $false
$appDataCreatedByThisRun = $false

try {
    $initialInstaller = if ($resolvedPreviousInstaller) { $resolvedPreviousInstaller } else { $resolvedInstaller }
    Invoke-Installer -Path $initialInstaller -Arguments @("/S")
    $installedByThisRun = $true
    $appDataCreatedByThisRun = $true

    Assert-Condition (Test-Path -LiteralPath $executable -PathType Leaf) "Installed executable was not found: $executable"
    Assert-Condition (Test-Path -LiteralPath $uninstaller -PathType Leaf) "NSIS uninstaller was not found: $uninstaller"
    Assert-Condition (Test-Path -LiteralPath $uninstallKey) "NSIS uninstall registry key was not created"
    Assert-Condition (Test-Path -LiteralPath $desktopShortcut -PathType Leaf) "NSIS desktop shortcut was not created"
    Assert-Condition (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf) "NSIS Start menu shortcut was not created"
    if ($RequireSignature) {
        Assert-ValidSignature -Path $executable -Label "Installed executable"
    }
    Test-AppLaunch -ExecutablePath $executable

    New-Item -ItemType Directory -Path $appDataDirectory -Force | Out-Null
    Set-Content -LiteralPath $marker -Value "preserve across update and uninstall" -Encoding utf8

    Invoke-Installer -Path $resolvedInstaller -Arguments @("/S", "/UPDATE")

    $installedVersion = (Get-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion).DisplayVersion
    Assert-Condition ($installedVersion -eq $ExpectedVersion) "Expected installed version $ExpectedVersion, got $installedVersion"
    Assert-Condition (Test-Path -LiteralPath $marker -PathType Leaf) "App data was not preserved across the update path"
    if ($RequireSignature) {
        Assert-ValidSignature -Path $executable -Label "Updated executable"
    }
    Test-AppLaunch -ExecutablePath $executable

    Invoke-Installer -Path $uninstaller -Arguments @("/S")
    $installedByThisRun = $false

    Wait-Until { -not (Test-Path -LiteralPath $executable) } "Installed executable remains after uninstall"
    Wait-Until { -not (Test-Path -LiteralPath $uninstallKey) } "Uninstall registry key remains after uninstall"
    Wait-Until { -not (Test-Path -LiteralPath $installDirectory) } "Install directory remains after uninstall"
    Wait-Until { -not (Test-Path -LiteralPath $desktopShortcut) } "Desktop shortcut remains after uninstall"
    Wait-Until { -not (Test-Path -LiteralPath $startMenuShortcut) } "Start menu shortcut remains after uninstall"
    Assert-Condition (Test-Path -LiteralPath $marker -PathType Leaf) "Default uninstall unexpectedly removed Pi GUI app data"

    Write-Host "CLEAN_MACHINE_INSTALL_SMOKE=PASS"
    Write-Host "INSTALLER=$resolvedInstaller"
    Write-Host "VERSION=$ExpectedVersion"
    Write-Host "SIGNATURE=$($signature.Status)"
}
finally {
    if ($installedByThisRun -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        $cleanup = Start-Process -FilePath $uninstaller -ArgumentList @("/S") -Wait -PassThru
        if ($cleanup.ExitCode -ne 0) {
            Write-Warning "Cleanup uninstaller exited with $($cleanup.ExitCode)"
        }
    }

    if ($appDataCreatedByThisRun -and (Test-Path -LiteralPath $appDataDirectory)) {
        $resolvedAppData = [System.IO.Path]::GetFullPath($appDataDirectory)
        $expectedAppData = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA "com.pi.gui"))
        if ($resolvedAppData -ne $expectedAppData) {
            throw "Refusing to clean an unexpected app-data path: $resolvedAppData"
        }
        Remove-Item -LiteralPath $resolvedAppData -Recurse -Force
    }
}
