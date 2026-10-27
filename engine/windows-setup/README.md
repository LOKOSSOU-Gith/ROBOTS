# Guide d'installation du VPS Contabo pour le moteur MT5

Ce guide couvre l'installation complète du moteur Python et de MetaTrader 5 sur un VPS Windows Contabo.

## 📋 Prérequis

- VPS Windows Server 2022 (Contabo)
- Accès RDP au VPS
- Python 3.10+ sera installé automatiquement
- MetaTrader 5 doit être téléchargé depuis votre broker

## 🚀 Installation automatique (recommandé)

Le script `install.ps1` automatise l'installation complète:

### Étape 1: Télécharger les fichiers

Depuis votre machine locale, copiez vers le VPS via RDP:
- Dossier `engine/` → `C:\mt5-engine\engine`
- Dossier `windows_agent/` → `C:\mt5-windows-agent`
- Dossier `windows-setup/` → `C:\mt5-setup`

### Étape 2: Exécuter le script d'installation

1. Connectez-vous au VPS via RDP
2. Ouvrez PowerShell en tant qu'administrateur
3. Naviguez vers le dossier setup:
```powershell
cd C:\mt5-setup
```

4. Exécutez le script:
```powershell
.\install.ps1
```

Le script va:
- ✅ Installer Python 3.10
- ✅ Installer MetaTrader 5 (si vous fournissez l'installateur)
- ✅ Installer les dépendances Python
- ✅ Configurer le service Windows pour le moteur
- ✅ Configurer le service Windows pour l'agent
- ✅ Créer les fichiers de configuration

### Étape 3: Configurer les variables d'environnement

Après l'installation, créez le fichier `.env`:
```powershell
cd C:\mt5-engine\engine
notepad .env
```

Ajoutez:
```env
# Backend
BACKEND_URL=https://votre-domaine.vercel.app
ENGINE_AUTH_SECRET=votre-secret-32-caractères-minimum
ENGINE_SERVICE_ID=contabo-engine-01

# MT5
MT5_PATH=C:\Program Files\MetaTrader 5\terminal64.exe
MT5_CONFIG_PATH=C:\Program Files\MetaTrader 5\Config

# Logs
LOG_LEVEL=info
```

### Étape 4: Démarrer les services

```powershell
# Démarrer le service moteur
sc start MT5Engine

# Démarrer le service agent
sc start MT5Agent

# Vérifier les statuts
sc query MT5Engine
sc query MT5Agent
```

## 🔧 Installation manuelle

Si vous préférez une installation manuelle:

### 1. Installer Python 3.10

```powershell
# Télécharger Python 3.10
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.10.11/python-3.10.11-amd64.exe" -OutFile "python-installer.exe"

# Installer silencieusement
.\python-installer.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0

# Redémarrer pour prendre effet les variables d'environnement
```

### 2. Installer MetaTrader 5

- Téléchargez l'installateur depuis votre broker
- Exécutez-le et installez dans `C:\Program Files\MetaTrader 5\`
- Notez le chemin exact pour la configuration

### 3. Configurer le moteur

```powershell
cd C:\mt5-engine\engine

# Créer l'environnement virtuel
python -m venv .venv

# Activer l'environnement
.venv\Scripts\activate

# Installer les dépendances
pip install -r requirements.txt

# Installer MetaTrader5 (Windows uniquement)
pip install MetaTrader5
```

### 4. Configurer le service Windows moteur

Créez `install-engine-service.ps1`:
```powershell
$nssm = "C:\nssm\nssm.exe"
$servicePath = "C:\mt5-engine\engine\.venv\Scripts\python.exe"
$scriptPath = "C:\mt5-engine\engine\src\mt5_engine\__main__.py"
$envFile = "C:\mt5-engine\engine\.env"

# Télécharger NSSM si nécessaire
if (-not (Test-Path $nssm)) {
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "nssm.zip"
    Expand-Archive -Path "nssm.zip" -DestinationPath "C:\nssm"
}

& $nssm install MT5Engine $servicePath $scriptPath
& $nssm set MT5Engine AppDirectory "C:\mt5-engine\engine"
& $nssm set MT5Engine AppEnvironmentFile $envFile
& $nssm set MT5Engine AppEnvironmentExtra "PYTHONUNBUFFERED=1"
& $nssm start MT5Engine
```

Exécutez:
```powershell
powershell -ExecutionPolicy Bypass -File install-engine-service.ps1
```

### 5. Configurer le service Windows agent

```powershell
# Copier l'agent
Copy-Item -Path "C:\mt5-windows-agent" -Destination "C:\mt5-windows-agent" -Recurse

# Créer le service
$nssm = "C:\nssm\nssm.exe"
$agentPath = "C:\mt5-windows-agent\agent.exe"

& $nssm install MT5Agent $agentPath
& $nssm set MT5Agent AppDirectory "C:\mt5-windows-agent"
& $nssm start MT5Agent
```

## 🔍 Vérification

### Vérifier que les services tournent

```powershell
sc query MT5Engine
sc query MT5Agent
```

### Vérifier les logs

```powershell
# Logs du moteur
Get-Content C:\mt5-engine\engine\logs\engine.log -Tail 50

# Logs du service Windows
Get-EventLog -LogName Application -Source "MT5Engine" -Newest 20
```

### Vérifier la connexion au backend

Depuis le VPS:
```powershell
curl https://votre-domaine.vercel.app/api/v1/health
```

Doit retourner: `{"status":"ok"}`

## 🔒 Configuration du Firewall

```powershell
# Autoriser les connexions sortantes HTTPS
New-NetFirewallRule -DisplayName "Allow HTTPS Outbound" -Direction Outbound -Protocol TCP -LocalPort 443 -Action Allow

# Bloquer les connexions entrantes non nécessaires (optionnel)
# Seul le backend doit contacter le moteur, pas l'inverse
```

## 📊 Monitoring

### Monitoring basique avec Get-Service

```powershell
# Script de monitoring
while ($true) {
    $engine = (Get-Service MT5Engine).Status
    $agent = (Get-Service MT5Agent).Status
    Write-Host "$(Get-Date) - Engine: $engine, Agent: $agent"
    Start-Sleep -Seconds 60
}
```

### Monitoring avancé

Considérez d'installer:
- **Windows Performance Monitor** - Pour les métriques système
- **Event Forwarding** - Pour centraliser les logs
- **Sentry** - Pour le tracking d'erreurs Python

## 🐛 Dépannage

### Le service ne démarre pas

```powershell
# Vérifier les logs
Get-Content C:\mt5-engine\engine\logs\engine.log -Tail 100

# Tester manuellement
cd C:\mt5-engine\engine
.venv\Scripts\activate
python src\mt5_engine\__main__.py
```

### MetaTrader5 ne se connecte pas

- Vérifiez que MT5 est installé dans le bon chemin
- Vérifiez que MT5 peut se connecter au broker manuellement
- Vérifiez que le chemin dans `.env` est correct

### Le moteur ne communique pas avec le backend

- Vérifiez que `BACKEND_URL` est correct dans `.env`
- Vérifiez que `ENGINE_AUTH_SECRET` est identique à Vercel
- Vérifiez que le firewall autorise les connexions sortantes
- Testez avec curl depuis le VPS

### Erreur Python ModuleNotFoundError

```powershell
cd C:\mt5-engine\engine
.venv\Scripts\activate
pip install -r requirements.txt
```

## 🔄 Mises à jour

### Mettre à jour le moteur

```powershell
# Arrêter le service
sc stop MT5Engine

# Mettre à jour le code (via Git ou copie)
cd C:\mt5-engine\engine
git pull  # ou copier les nouveaux fichiers

# Mettre à jour les dépendances
.venv\Scripts\activate
pip install -r requirements.txt --upgrade

# Redémarrer le service
sc start MT5Engine
```

## 📞 Support

En cas de problème:
1. Consultez les logs du moteur
2. Consultez les logs du service Windows
3. Vérifiez la configuration `.env`
4. Consultez la documentation du projet

## 🚨 Sécurité

- ✅ N'exposez pas le VPS directement sur internet
- ✅ Utilisez un mot de passe RDP fort
- ✅ Gardez le système à jour (Windows Update)
- ✅ Ne stockez pas de secrets en clair
- ✅ Utilisez un firewall strict
