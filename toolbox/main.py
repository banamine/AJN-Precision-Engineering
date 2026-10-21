from __future__ import annotations

import tkinter as tk
from tkinter import messagebox


class ToolboxApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("AJN Dev Toolbox — read-only diagnostics")
        self.geometry("900x600")
        self.configure(bg="#111827")
        title = tk.Label(self, text="AJN Dev Toolbox", bg="#111827", fg="white", font=("Segoe UI", 20, "bold"))
        title.pack(anchor="w", padx=20, pady=(20, 4))
        subtitle = tk.Label(self, text="Observation only — does not modify AJN application code", bg="#111827", fg="#9ca3af")
        subtitle.pack(anchor="w", padx=20, pady=(0, 15))
        self.log = tk.Text(self, bg="#0b1220", fg="#d1d5db", insertbackground="white")
        self.log.pack(fill="both", expand=True, padx=20, pady=10)
        button = tk.Button(self, text="Readiness reminder", command=self.reminder, bg="#2563eb", fg="white", relief="flat")
        button.pack(anchor="e", padx=20, pady=(0, 20))
        self.log.insert("end", "Toolbox initialized. Use the standalone runners for evidence collection.\n")

    def reminder(self) -> None:
        messagebox.showinfo("AJN Dev Toolbox", "Run runners directly first. The GUI is only a presentation layer over deterministic runner output.")


if __name__ == "__main__":
    ToolboxApp().mainloop()
