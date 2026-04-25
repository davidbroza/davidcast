default: install

# Build davidcast.app and install it to /Applications.
install:
    @command -v pnpm  >/dev/null || { echo "pnpm required — brew install pnpm"; exit 1; }
    @command -v cargo >/dev/null || { echo "Rust required — https://rustup.rs"; exit 1; }
    cd desktop && pnpm install --frozen-lockfile
    cd desktop && pnpm tauri build
    -killall davidcast 2>/dev/null || true
    rm -rf /Applications/davidcast.app
    cp -R desktop/src-tauri/target/release/bundle/macos/davidcast.app /Applications/
    xattr -cr /Applications/davidcast.app
    @echo ""
    @echo "✓ installed: /Applications/davidcast.app"
    @echo "  open it once to grant Accessibility, then use ⌃ Space anywhere."

# Vite + Rust hot-reload dev session.
dev:
    cd desktop && pnpm install
    cd desktop && pnpm tauri dev

# Build the release .app without copying it.
build:
    cd desktop && pnpm install --frozen-lockfile
    cd desktop && pnpm tauri build

# Remove davidcast from /Applications. Store at ~/Library/Application Support/davidcast/ is kept.
uninstall:
    -killall davidcast 2>/dev/null || true
    rm -rf /Applications/davidcast.app
    @echo "✓ removed /Applications/davidcast.app"
