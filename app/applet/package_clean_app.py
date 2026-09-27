import os
import zipfile

output_filename = "ajn_clean_working_app.zip"

include_files = [
    "package.json",
    "metadata.json",
    "tsconfig.json",
    "vite.config.ts",
    "server.ts",
    "channels.ts",
    "guideRegistry.ts",
    "archive-discovery.ts",
    "newsFeed.ts",
    "index.html",
    ".env.example",
    ".gitignore",
]

include_dirs = [
    "server",
    "src"
]

print(f"Creating {output_filename}...")

with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
    # Add explicit files
    for f in include_files:
        if os.path.exists(f):
            zipf.write(f, f)
            print(f"Added file: {f}")
        else:
            print(f"Warning: File not found: {f}")

    # Add directories recursively
    for d in include_dirs:
        if os.path.exists(d):
            for root, dirs, files in os.walk(d):
                for file in files:
                    full_path = os.path.join(root, file)
                    if file.endswith('.DS_Store'):
                        continue
                    zipf.write(full_path, full_path)
                    print(f"Added: {full_path}")
        else:
            print(f"Warning: Directory not found: {d}")

print("Packaging complete!")
