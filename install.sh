#!/bin/bash
# Nexus OS — One-Click Installer
# Installs everything needed and sets up auto-start
# Usage: curl -fsSL https://... | bash   OR   bash install.sh

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}${BOLD}"
echo "  ╔══════════════════════════════════╗"
echo "  ║        Nexus OS Installer       ║"
echo "  ║   The OS that understands you   ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${NC}"

NEXUS_DIR="$HOME/nexus"
NEXUS_REPO="${NEXUS_REPO:-https://github.com/your-org/nexus.git}"

# ─── Prerequisites Check ───
echo -e "\n${BOLD}[1/6] Checking prerequisites...${NC}"

# Node.js
if command -v node &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"
else
  echo -e "  ${RED}✗ Node.js not found${NC}"
  echo "  Installing via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
fi

# Git
if command -v git &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Git $(git --version | awk '{print $3}')"
else
  echo -e "  ${YELLOW}⚠ Installing Git...${NC}"
  xcode-select --install 2>/dev/null || true
fi

# PM2 (optional, for background running)
if command -v pm2 &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} PM2 $(pm2 -v)"
else
  echo -e "  ${YELLOW}⚠ Installing PM2...${NC}"
  npm install -g pm2
fi

echo -e "  ${GREEN}✓${NC} Prerequisites met"

# ─── API Key Setup ───
echo -e "\n${BOLD}[2/6] Configuring LLM provider...${NC}"

ENV_FILE="$NEXUS_DIR/.env"

if [ -f "$NEXUS_DIR/.env" ]; then
  echo -e "  ${GREEN}✓${NC} Existing .env found, preserving"
else
  echo ""
  echo "  Which LLM provider?"
  echo "  1) DeepSeek (cheapest, recommended)"
  echo "  2) Anthropic (Claude, best quality)"
  echo "  3) Ollama (local, free, needs setup)"
  echo "  4) Skip (configure later)"
  read -p "  Choice [1]: " provider_choice
  provider_choice=${provider_choice:-1}

  case $provider_choice in
    1)
      read -p "  DeepSeek API key: " ds_key
      cat > "$ENV_FILE" << EOF
NEXUS_LLM_PROVIDER=deepseek
NEXUS_LLM_MODEL=deepseek-chat
DEEPSEEK_API_KEY=$ds_key
NEXUS_PORT=47900
EOF
      ;;
    2)
      read -p "  Anthropic API key: " anth_key
      cat > "$ENV_FILE" << EOF
NEXUS_LLM_PROVIDER=anthropic
NEXUS_LLM_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=$anth_key
NEXUS_PORT=47900
EOF
      ;;
    3)
      cat > "$ENV_FILE" << EOF
NEXUS_LLM_PROVIDER=ollama
NEXUS_LLM_MODEL=llama3:8b
OLLAMA_URL=http://localhost:11434
NEXUS_PORT=47900
EOF
      ;;
    *)
      cat > "$ENV_FILE" << EOF
NEXUS_LLM_PROVIDER=deepseek
NEXUS_LLM_MODEL=deepseek-chat
# Add your API key: DEEPSEEK_API_KEY=sk-...
NEXUS_PORT=47900
EOF
      ;;
  esac
  echo -e "  ${GREEN}✓${NC} Configuration saved"
fi

# ─── Install Dependencies ───
echo -e "\n${BOLD}[3/6] Installing Nexus dependencies...${NC}"

cd "$NEXUS_DIR"
npm install --omit=dev 2>&1 | tail -1

echo -e "  ${GREEN}✓${NC} Dependencies installed"

# ─── Build UI ───
echo -e "\n${BOLD}[4/6] Building desktop interface...${NC}"

cd "$NEXUS_DIR/ui"
if [ ! -d "node_modules" ]; then
  npm install 2>&1 | tail -1
fi
npx vite build 2>&1 | tail -3

echo -e "  ${GREEN}✓${NC} UI built"

# ─── Index Initial Files ───
echo -e "\n${BOLD}[5/6] Indexing your files (this builds the knowledge graph)...${NC}"

cd "$NEXUS_DIR"
node -e "
  require('dotenv').config();
  const graph = require('./graph');
  graph.migrate(graph.getDb());
  
  const fs = require('fs');
  const path = require('path');
  const home = require('os').homedir();
  
  const dirs = ['Desktop', 'Downloads', 'Documents'];
  let count = 0;
  
  for (const d of dirs) {
    try {
      const fullPath = path.join(home, d);
      const entries = fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
      for (const f of entries.slice(0, 50)) {
        graph.upsertEntity('file', f, { path: path.join(fullPath, f), metadata: {} });
        count++;
      }
    } catch {}
  }
  
  console.log('  Indexed', count, 'files into knowledge graph');
  console.log('  Graph:', graph.getStats().entities, 'entities total');
" 2>/dev/null

echo -e "  ${GREEN}✓${NC} Knowledge graph built"

# ─── Set Up Auto-Start ───
echo -e "\n${BOLD}[6/6] Setting up auto-start...${NC}"

LAUNCHD_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$LAUNCHD_DIR/com.nexus.os.plist"

mkdir -p "$LAUNCHD_DIR"

cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.nexus.os</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which node)</string>
    <string>$NEXUS_DIR/server/index.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$NEXUS_DIR</string>
  <key>StandardOutPath</key>
  <string>$NEXUS_DIR/logs/server.log</string>
  <key>StandardErrorPath</key>
  <string>$NEXUS_DIR/logs/server-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>$(dirname $(which node)):$PATH</string>
  </dict>
</dict>
</plist>
EOF

# Unload old, load new
launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load "$PLIST_FILE" 2>/dev/null

echo -e "  ${GREEN}✓${NC} Auto-start configured (launchd)"

# ─── Done ───
echo -e "\n${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════╗"
echo "  ║     Nexus OS is installed!      ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "  ${BOLD}Open in browser:${NC}  http://localhost:47900"
echo -e "  ${BOLD}Electron app:${NC}     cd ~/nexus/ui && npm run electron"
echo -e "  ${BOLD}PM2 management:${NC}   pm2 status"
echo -e "  ${BOLD}Server logs:${NC}     tail -f ~/nexus/logs/server.log"
echo ""
echo -e "  Just type what you want. No menus. No learning curves."
echo ""

# Try to open in browser
sleep 2
open http://localhost:47900 2>/dev/null || true
