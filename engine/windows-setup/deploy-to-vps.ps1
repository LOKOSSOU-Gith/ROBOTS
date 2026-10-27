# Script de déploiement du moteur vers le VPS Contabo
# Ce script doit être exécuté depuis votre machine locale

param(
    [Parameter(Mandatory=$true)]
    [string]$VpsIp,
    
    [Parameter(Mandatory=$true)]
    [string]$VpsUsername,
    
    [Parameter(Mandatory=$false)]
    [string]$VpsPassword
)

Write-Host "=== Déploiement du moteur MT5 vers VPS Contabo ===" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $scriptDir
$localEngineDir = "$projectRoot\engine"
$localAgentDir = "$projectRoot\windows_agent"
$remoteDir = "C:\mt5-setup"

Write-Host "📁 Vérification des fichiers locaux..." -ForegroundColor Yellow

if (-not (Test-Path $localEngineDir)) {
    Write-Host "❌ Erreur: Dossier engine/ non trouvé à $localEngineDir" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $localAgentDir)) {
    Write-Host "⚠️  Avertissement: Dossier windows_agent/ non trouvé à $localAgentDir" -ForegroundColor Yellow
}

Write-Host "✅ Fichiers trouvés" -ForegroundColor Green
Write-Host ""

Write-Host "📤 Copie des fichiers vers le VPS ($VpsIp)..." -ForegroundColor Yellow

# Utiliser robocopy pour copier les fichiers via partage réseau ou SCP
# Pour RDP, on utilise un partage réseau Windows

# Option 1: Via partage réseau (si activé)
$networkPath = "\\$VpsIp\C$"
if (Test-Path $networkPath) {
    Write-Host "   Via partage réseau..." -ForegroundColor Gray
    
    # Créer le dossier distant
    $remoteTarget = "$networkPath\mt5-setup"
    New-Item -ItemType Directory -Force -Path $remoteTarget | Out-Null
    
    # Copier le moteur
    Write-Host "   Copie de engine/..." -ForegroundColor Gray
    robocopy $localEngineDir "$remoteTarget\engine" /E /Z /R:5 /W:5
    
    # Copier l'agent si existe
    if (Test-Path $localAgentDir) {
        Write-Host "   Copie de windows_agent/..." -ForegroundColor Gray
        robocopy $localAgentDir "$remoteTarget\windows_agent" /E /Z /R:5 /W:5
    }
    
    # Copier le script d'installation
    Copy-Item -Path "$scriptDir\install.ps1" -Destination "$remoteTarget\install.ps1" -Force
    Copy-Item -Path "$scriptDir\README.md" -Destination "$remoteTarget\README.md" -Force
    
    Write-Host "✅ Fichiers copiés via partage réseau" -ForegroundColor Green
} else {
    Write-Host "⚠️  Partage réseau non accessible" -ForegroundColor Yellow
    Write-Host "   Utilisez RDP manuel ou configurez le partage réseau" -ForegroundColor White
    Write-Host ""
    Write-Host "Instructions manuelles:" -ForegroundColor Cyan
    Write-Host "1. Connectez-vous au VPS via RDP" -ForegroundColor White
    Write-Host "2. Créez le dossier C:\mt5-setup" -ForegroundColor White
    Write-Host "3. Copiez depuis votre machine locale:" -ForegroundColor White
    Write-Host "   - $localEngineDir → C:\mt5-setup\engine" -ForegroundColor White
    if (Test-Path $localAgentDir) {
        Write-Host "   - $localAgentDir → C:\mt5-setup\windows_agent" -ForegroundColor White
    }
    Write-Host "   - $scriptDir\install.ps1 → C:\mt5-setup\install.ps1" -ForegroundColor White
    Write-Host "4. Exécutez C:\mt5-setup\install.ps1 sur le VPS" -ForegroundColor White
    exit 0
}

Write-Host ""
Write-Host "🔧 Exécution de l'installation sur le VPS..." -ForegroundColor Yellow

# Utiliser psexec ou WinRM pour exécuter le script à distance
# Pour simplifier, on donne les instructions pour l'exécution manuelle

Write-Host "Les fichiers ont été copiés sur le VPS." -ForegroundColor Green
Write-Host ""
Write-Host "Étapes suivantes sur le VPS:" -ForegroundColor Cyan
Write-Host "1. Connectez-vous au VPS via RDP" -ForegroundColor White
Write-Host "2. Ouvrez PowerShell en tant qu'administrateur" -ForegroundColor White
Write-Host "3. Naviguez vers: cd C:\mt5-setup" -ForegroundColor White
Write-Host "4. Exécutez: .\install.ps1" -ForegroundColor White
Write-Host ""
Write-Host "Pour un déploiement automatisé complet, configurez WinRM sur le VPS." -ForegroundColor Yellow
Write-Host ""

# Option pour exécution via WinRM (si configuré)
Write-Host "Tentative d'exécution via WinRM..." -ForegroundColor Gray
try {
    $password = ConvertTo-SecureString $VpsPassword -AsPlainText -Force
    $credential = New-Object System.Management.Automation.PSCredential ($VpsUsername, $password)
    
    $session = New-PSSession -ComputerName $VpsIp -Credential $credential -ErrorAction Stop
    
    Invoke-Command -Session $session -ScriptBlock {
        cd C:\mt5-setup
        .\install.ps1
    }
    
    Remove-PSSession $session
    
    Write-Host "✅ Installation exécutée avec succès via WinRM" -ForegroundColor Green
} catch {
    Write-Host "⚠️  WinRM non configuré ou erreur d'authentification" -ForegroundColor Yellow
    Write-Host "   Procédez à l'installation manuelle comme indiqué ci-dessus" -ForegroundColor White
}

Write-Host ""
Write-Host "=== Déploiement terminé ===" -ForegroundColor Cyan
