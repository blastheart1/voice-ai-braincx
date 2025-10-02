#!/usr/bin/env python3
"""
Setup script for Voice AI Conversational Agent
Helps users configure their environment variables
"""

import os
import shutil
from pathlib import Path

def setup_environment():
    """Set up the environment configuration"""
    print("🎤 Voice AI Conversational Agent - Setup")
    print("=" * 50)
    
    backend_dir = Path("backend")
    env_example = backend_dir / "env.example"
    env_file = backend_dir / ".env"
    
    # Check if env.example exists
    if not env_example.exists():
        print("❌ Error: env.example file not found in backend directory")
        return False
    
    # Check if .env already exists
    if env_file.exists():
        response = input("⚠️  .env file already exists. Overwrite? (y/N): ")
        if response.lower() != 'y':
            print("✅ Setup cancelled. Using existing .env file.")
            return True
    
    # Copy env.example to .env
    try:
        shutil.copy2(env_example, env_file)
        print(f"✅ Created {env_file}")
    except Exception as e:
        print(f"❌ Error creating .env file: {e}")
        return False
    
    print("\n📝 Next Steps:")
    print("1. Edit backend/.env with your actual API keys:")
    print("   - OPENAI_API_KEY: Get from https://platform.openai.com/api-keys")
    print("   - LIVEKIT_URL: Get from https://cloud.livekit.io/")
    print("   - LIVEKIT_API_KEY: Get from LiveKit dashboard")
    print("   - LIVEKIT_API_SECRET: Get from LiveKit dashboard")
    print("\n2. Install dependencies:")
    print("   Backend: cd backend && pip install -r requirements.txt")
    print("   Frontend: cd frontend && npm install")
    print("\n3. Start the servers:")
    print("   Backend: cd backend && python main.py")
    print("   Frontend: cd frontend && npm start")
    
    return True

if __name__ == "__main__":
    success = setup_environment()
    if success:
        print("\n🎉 Setup completed! Follow the next steps above.")
    else:
        print("\n❌ Setup failed. Please check the errors above.")
        exit(1)
