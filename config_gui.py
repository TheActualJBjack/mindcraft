import tkinter as tk
from tkinter import ttk, messagebox
import re
import os
import sys
import subprocess
import socket

SETTINGS_FILE = "settings.js"

def get_local_ip():
    try:
        # Create a dummy socket to detect IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class ConfigApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Mindcraft Bot Config")
        self.root.geometry("400x500")

        self.load_settings()

        # UI Components
        main_frame = ttk.Frame(root, padding="20")
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Host (IP) - Auto-detect
        ttk.Label(main_frame, text="Host IP (Auto-Detected):").pack(anchor=tk.W, pady=(0, 5))
        local_ip = get_local_ip()
        self.host_var = tk.StringVar(value=local_ip)
        self.host_entry = ttk.Entry(main_frame, textvariable=self.host_var)
        self.host_entry.pack(fill=tk.X, pady=(0, 15))

        # Port - Default 1111
        ttk.Label(main_frame, text="Port (Default: 1111):").pack(anchor=tk.W, pady=(0, 5))
        self.port_var = tk.StringVar(value="1111")
        self.port_entry = ttk.Entry(main_frame, textvariable=self.port_var)
        self.port_entry.pack(fill=tk.X, pady=(0, 15))

        # Minecraft Version - Ask User (Default from file or prompt)
        file_ver = self.settings.get("minecraft_version", "1.21.1")
        ttk.Label(main_frame, text="Minecraft Version:").pack(anchor=tk.W, pady=(0, 5))
        self.version_var = tk.StringVar(value=file_ver)
        self.version_combobox = ttk.Combobox(main_frame, textvariable=self.version_var, values=["1.21.1", "1.20.4", "1.19.4", "1.18.2"])
        self.version_combobox.pack(fill=tk.X, pady=(0, 15))

        # Auth
        file_auth = self.settings.get("auth", "offline")
        ttk.Label(main_frame, text="Auth Type:").pack(anchor=tk.W, pady=(0, 5))
        self.auth_var = tk.StringVar(value=file_auth)
        self.auth_combobox = ttk.Combobox(main_frame, textvariable=self.auth_var, values=["offline", "microsoft"], state="readonly")
        self.auth_combobox.pack(fill=tk.X, pady=(0, 15))

        # Profile
        file_prof = self.settings.get("base_profile", "survival")
        ttk.Label(main_frame, text="Base Profile:").pack(anchor=tk.W, pady=(0, 5))
        self.profile_var = tk.StringVar(value=file_prof)
        self.profile_combobox = ttk.Combobox(main_frame, textvariable=self.profile_var, values=["survival", "creative", "god_mode"])
        self.profile_combobox.pack(fill=tk.X, pady=(0, 15))

        # Buttons
        button_frame = ttk.Frame(main_frame)
        button_frame.pack(fill=tk.X, pady=(20, 0))

        self.save_btn = ttk.Button(button_frame, text="Save Settings", command=self.save_settings)
        self.save_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0, 5))

        self.run_btn = ttk.Button(button_frame, text="Save & Run Bot", command=self.run_bot)
        self.run_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(5, 0))

    def load_settings(self):
        self.settings = {}
        if not os.path.exists(SETTINGS_FILE):
            # messagebox.showwarning("Warning", f"{SETTINGS_FILE} not found. Using defaults.")
            return

        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            content = f.read()

        # Regex patterns to find values
        patterns = {
            "host": r'"host":\s*"([^"]+)"',
            "port": r'"port":\s*(\d+)',
            "minecraft_version": r'"minecraft_version":\s*"([^"]+)"',
            "auth": r'"auth":\s*"([^"]+)"',
            "base_profile": r'"base_profile":\s*"([^"]+)"'
        }

        for key, pattern in patterns.items():
            match = re.search(pattern, content)
            if match:
                self.settings[key] = match.group(1)

    def save_settings(self):
        if not os.path.exists(SETTINGS_FILE):
            messagebox.showerror("Error", f"{SETTINGS_FILE} not found!")
            return False

        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                content = f.read()

            # Replace values using regex
            content = re.sub(r'"host":\s*"[^"]+"', f'"host": "{self.host_var.get()}"', content)
            content = re.sub(r'"port":\s*\d+', f'"port": {self.port_var.get()}', content)
            content = re.sub(r'"minecraft_version":\s*"[^"]+"', f'"minecraft_version": "{self.version_var.get()}"', content)
            content = re.sub(r'"auth":\s*"[^"]+"', f'"auth": "{self.auth_var.get()}"', content)
            content = re.sub(r'"base_profile":\s*"[^"]+"', f'"base_profile": "{self.profile_var.get()}"', content)

            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                f.write(content)

            messagebox.showinfo("Success", "Settings saved successfully!")
            return True
        except Exception as e:
            messagebox.showerror("Error", f"Failed to save settings: {str(e)}")
            return False

    def run_bot(self):
        if self.save_settings():
            try:
                # Determine command based on OS
                if sys.platform == "win32":
                    subprocess.Popen(["start", "cmd", "/k", "node main.js"], shell=True)
                else:
                    # Linux/Mac - try to open a new terminal if possible, or just run in background
                    # Fallback to simple execution
                    print("Starting bot in current terminal...")
                    subprocess.Popen(["node", "main.js"])

            except Exception as e:
                messagebox.showerror("Error", f"Failed to launch bot: {str(e)}")

if __name__ == "__main__":
    root = tk.Tk()
    app = ConfigApp(root)
    root.mainloop()
