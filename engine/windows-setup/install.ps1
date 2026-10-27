# Script d'installation automatique du moteur MT5 sur VPS Windows
# Ce script doit être exécuté en tant qu'administrateur

Write-Host "=== Installation du moteur MT5 sur VPS Contabo ===" -ForegroundColor Cyan
Write-Host ""

# Vérifier les droits administrateur
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERREUR: Ce script doit être exécuté en tant qu'administrateur" -ForegroundColor Red
    exit 1
}

# Configuration
$engineDir = "C:\mt5-engine"
$agentDir = "C:\mt5-windows-agent"
$setupDir = "C:\mt5-setup"
$pythonVersion = "3.10.11"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-amd64.exe"
$nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"

Write-Host "📁 Création des répertoires..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $engineDir | Out-Null
New-Item -ItemType Directory -Force -Path $agentDir | Out-Null
New-Item -ItemType Directory -Force -Path $setupDir | Out-Null

# Vérifier si le code moteur existe
$engineSource = "$setupDir\..\engine"
if (-not (Test-Path $engineSource)) {
    Write-Host "⚠️  ATTENTION: Le dossier engine/ n'a pas été trouvé dans $setupDir\.." -ForegroundColor Yellow
    Write-Host "   Assurez-vous d'avoir copié le dossier engine/ depuis le repository" -ForegroundColor Yellow
    $continue = Read-Host "Continuer quand même? (o/n)"
    if ($continue -ne "o") {
        exit 1
    }
} else {
    Write-Host "✅ Copie du moteur depuis $engineSource vers $engineDir" -ForegroundColor Green
    Copy-Item -Path "$engineSource\*" -Destination "$engineDir\" -Recurse -Force
}

# Vérifier si l'agent existe
$agentSource = "$setupDir\..\windows_agent"
if (Test-Path $agentSource) {
    Write-Host "✅ Copie de l'agent depuis $agentSource vers $agentDir" -ForegroundColor Green
    Copy-Item -Path "$agentSource\*" -Destination "$agentDir\" -Recurse -Force
}

Write-Host ""
Write-Host "🐍 Installation de Python $pythonVersion..." -ForegroundColor Yellow

# Télécharger Python si nécessaire
$pythonInstaller = "$setupDir\python-installer.exe"
if (-not (Test-Path $pythonInstaller)) {
    Write-Host "   Téléchargement de Python depuis $pythonUrl..." -ForegroundColor Gray
    try {
        Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonInstaller -UseBasicParsing
    } catch {
        Write-Host "   ⚠️  Erreur de téléchargement, tentative alternative..." -ForegroundColor Yellow
        $pythonUrl = "https://www.python.org/ftp/python/3.10.11/python-3.10.11-amd64.exe"
        Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonInstaller -UseBasicParsing
    }
}

# Installer Python silencieusement
Write-Host "   Installation de Python..." -ForegroundColor Gray
Start-Process -FilePath $pythonInstaller -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1", "Include_test=0" -Wait

# Rafraîchir les variables d'environnement
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "✅ Python installé" -ForegroundColor Green
python --version

Write-Host ""
Write-Host "📦 Installation des dépendances Python..." -ForegroundColor Yellow

cd $engineDir

# Créer l'environnement virtuel
Write-Host "   Création de l'environnement virtuel..." -ForegroundColor Gray
python -m venv .venv

# Activer l'environnement
.venv\Scripts\activate

# Installer les dépendances
Write-Host "   Installation des dépendances depuis requirements.txt..." -ForegroundColor Gray
pip install --upgrade pip
pip install -r requirements.txt

# Installer MetaTrader5 (Windows uniquement)
Write-Host "   Installation de MetaTrader5..." -ForegroundColor Gray
pip install MetaTrader5

Write-Host "✅ Dépendances installées" -ForegroundColor Green

Write-Host ""
Write-Host "📝 Configuration des services Windows..." -ForegroundColor Yellow

# Télécharger NSSM
$nssmZip = "$setupDir\nssm.zip"
if (-not (Test-Path $nssmZip)) {
    Write-Host "   Téléchargement de NSSM..." -ForegroundColor Gray
    Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip -UseBasicParsing
}

# Extraire NSSM
$nssmDir = "C:\nssm"
if (-not (Test-Path $nssmDir)) {
    Write-Host "   Extraction de NSSM..." -ForegroundColor Gray
    Expand-Archive -Path $nssmZip -DestinationPath $nssmDir -Force
}

$nssm = "$nssmDir\nssm-2.24\win64\nssm.exe"
if (-not (Test-Path $nssm)) {
    $nssm = (Get-ChildItem -Path $nssmDir -Recurse -Filter "nssm.exe" | Select-Object -First 1).FullName
}

Write-Host "   NSSM trouvé: $nssm" -ForegroundColor Gray

# Configurer le service moteur
Write-Host "   Configuration du service MT5Engine..." -ForegroundColor Gray
$pythonExe = "$engineDir\.venv\Scripts\python.exe"
$mainScript = "$engineDir\src\mt5_engine\__main__.py"
$envFile = "$engineDir\.env"

# Créer le fichier .env par défaut
if (-not (Test-Path $envFile)) {
    Write-Host "   Création du fichier .env par défaut..." -ForegroundColor Gray
    @"
# Backend
BACKEND_URL=https://votre-domaine.vercel.app
ENGINE_AUTH_SECRET=CHANGEZ-CECI-32-CARACTERES-MINIMUM
ENGINE_SERVICE_ID=contabo-engine-01

# MT5
MT5_PATH=C:\Program Files\MetaTrader 5\terminal64.exe
MT5_CONFIG_PATH=C:\Program Files\MetaTrader 5\Config

# Logs
LOG_LEVEL=info
"@ | Out-File -FilePath $envFile -Encoding UTF8
    
    Write-Host "   ⚠️  IMPORTANT: Éditez $envFile et configurez BACKEND_URL et ENGINE_AUTH_SECRET" -ForegroundColor Yellow
}

# Supprimer le service s'il existe déjà
$existingService = Get-Service -Name "MT5Engine" -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "   Suppression de l'ancien service MT5Engine..." -ForegroundColor Gray
    & $nssm stop MT5Engine
    & $nssm remove MT5Engine confirm
}

# Créer le service
& $nssm install MT5Engine $pythonExe $mainScript
& $nssm set MT5Engine AppDirectory $engineDir
& $nssm set MT5Engine AppEnvironmentFile $envFile
& $nssm set MT5Engine AppEnvironmentExtra "PYTHONUNBUFFERED=1"
& $nssm set MT5Engine DisplayName "MT5 Trading Engine"
& $nssm set MT5Engine Description "Moteur d'exécution MT5 pour la plateforme SaaS"

Write-Host "✅ Service MT5Engine configuré" -ForegroundColor Green

# Configurer le service agent si l'agent existe
if (Test-Path "$agentDir\agent.exe") {
    Write-Host "   Configuration du service MT5Agent..." -ForegroundColor Gray
    
    $existingAgent = Get-Service -Name "MT5Agent" -ErrorAction SilentlyContinue
    if ($existingAgent) {
        Write-Host "   Suppression de l'ancien service MT5Agent..." -ForegroundColor Gray
        & $nssm stop MT5Agent
        & $nssm remove MT5Agent confirm
    }
    
    $agentExe = "$agentDir\agent.exe"
    & $nssm install MT5Agent $agentExe
    & $nssm set MT5Agent AppDirectory $agentDir
    & $nssm set MT5Agent DisplayName "MT5 Windows Agent"
    & $nssm set MT5Agent Description "Agent Windows pour communication MT5"
    
    Write-Host "✅ Service MT5Agent configuré" -ForegroundColor Green
}

Write-Host ""
Write-Host "🔥 Démarrage des services..." -ForegroundColor Yellow

& $nssm start MT5Engine
if (Test-Path "$agentDir\agent.exe") {
    & $nssm start MT5Agent
}

Write-Host ""
Write-Host "✅ Installation terminée!" -ForegroundColor Green
Write-Host ""
Write-Host "Étapes suivantes:" -ForegroundColor Cyan
Write-Host "1. Éditez $envFile et configurez BACKEND_URL et ENGINE_AUTH_SECRET" -ForegroundColor White
Write-Host "2. Redémarrez le service: sc stop MT5Engine && sc start MT5Engine" -ForegroundColor White
Write-Host "3. Vérifiez les logs: Get-Content $engineDir\logs\engine.log -Tail 50" -ForegroundColor White
Write-Host "4. Vérifiez le statut: sc query MT5Engine" -ForegroundColor White
Write-Host ""
Write-Host "Si MT5 n'est pas installé:" -ForegroundColor Yellow
Write-Host "- Téléchargez l'installateur depuis votre broker" -ForegroundColor White
Write-Host "- Installez-le dans C:\Program Files\MetaTrader 5\" -ForegroundColor White
Write-Host "- Mettez à jour MT5_PATH dans $envFile" -ForegroundColor White
Write-Host ""
