# Dev Setup

Bootstrap the NEXUS OS development environment.

```powershell
# 1. Python engine
cd apps/engine/backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
cd ../..

# 2. Frontend
cd apps/shell/frontend
npm install
cd ../..

# 3. Tauri (Rust)
# Ensure Rust toolchain + C++ Build Tools are installed
cargo --version

# 4. Env
copy .env.example .env
```
