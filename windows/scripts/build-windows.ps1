param(
    [switch]$Installer
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath "node_modules")) {
        npm install
    }
    if ($Installer) {
        npm run package
    }
    else {
        npm run package:dir
    }
}
finally {
    Pop-Location
}
