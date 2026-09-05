# Zhiyu KnowledgeMaster

[简体中文](README.md) | [English](README.en.md)

> A local-first knowledge workspace for reading and studying research papers, built for both macOS and Windows with Tauri.

KnowledgeMaster brings paper collection, close reading and annotation, research notes, multi-document Q&A, and knowledge synthesis into one desktop application. Your documents and metadata stay on your own disk by default. AI can access only the scope you explicitly authorize, and only when you initiate a request.

## Features

### Research Library

- Import files with a file picker, recursive folder scan, drag and drop, or a URL.
- Read PDF, HTML, Markdown, TXT, DOC, and DOCX files.
- Deduplicate imports by both filename and SHA-256; original files are stored in a flat directory.
- Prefer the paper naming format `First Author et al., Paper Title` when metadata can be recognized.
- Organize documents in hierarchical virtual topics; one document can belong to multiple topics.
- Recommend topics locally after import and create associations only after user confirmation.
- Search titles, authors, topics, and full text with keywords, without a vector database.
- Choose the library location. Placing it in iCloud Drive, OneDrive, or another synced directory delegates synchronization to the operating system.

### Reading, Annotation, and Notes

- Continuous PDF.js reader with selectable text, trackpad or wheel zoom, bookmarks, and document outline navigation.
- Read-only HTML, Markdown, and plain-text previews; Markdown supports GFM and LaTeX.
- Multi-tab reading. Hiding or restoring either sidebar keeps the current document and page.
- Select text in PDFs or text documents to open nearby Ask AI, quote, highlight, underline, and note actions.
- Selected-region AI context includes extracted source text and, when multimodal input is enabled, a screenshot of the selected region.
- Annotation markers stay in the page margin. Click a highlighted or underlined region to edit its note or delete the annotation.
- Summary notes are stored as Markdown files and can reference multiple source annotations.
- Export either the original document or a copy with annotations.

### AI and Local Agents

- Direct API mode supports DeepSeek, Zhipu GLM, and custom OpenAI-compatible endpoints.
- API mode can use either relevant text snippets or autonomous retrieval with file tools.
- Connect to locally installed Claude Code and Codex CLIs, inspect their collapsible execution logs, and stop a running task manually.
- Select multiple documents or topics as the Q&A scope. Agent mode creates an isolated temporary workspace for that scope.
- Agents receive read-only copies of original files and can reuse existing PDF, OCR, or parsing caches instead of relying on pre-chunked text.
- With no selected text, files, or topics, chat starts without loading local documents.
- Files downloaded by an Agent enter a pending-import area. The user confirms both the import and its virtual topics.
- Preserve conversation history and generate incremental Markdown summaries.

### Local-First Storage and Safety

- Documents, topics, search text, annotations, notes, and conversations live in the selected local library.
- API keys are stored in macOS Keychain or Windows Credential Manager.
- Starting the app, opening Settings, or switching providers does not read a key. Keys are accessed only when sending a request or testing a connection.
- Agents can write only inside isolated workspaces; source copies and parsing caches are read-only.
- Metadata uses indexed SQLite tables with foreign keys. A legacy `knowledge.json` library is migrated on first launch, and a migration backup that the app no longer updates is retained.
- The frontend has no arbitrary filesystem access; all file operations go through validated Rust commands.

## Platforms and Technology

| Item | macOS | Windows |
|---|---|---|
| Minimum target | macOS 14+ | Windows 10/11 |
| WebView | System WebKit | WebView2 |
| Credentials | Keychain | Credential Manager |
| Agent termination | Terminate the process | Terminate the process tree with `taskkill /T` |
| Release packages | `.dmg` | Portable `.exe` / NSIS installer `.exe` |

Shared stack:

- Tauri 2
- React 19, TypeScript, and Vite
- Rust
- PDF.js
- React Markdown, GFM, and KaTeX

KnowledgeMaster does not use Electron, require a hosted application backend, or include embeddings or a vector database.

## Install and Get Started

### Windows

1. Download `KnowledgeMaster-portable.exe` from [GitHub Releases](https://github.com/hkcao/KnowledgeMaster/releases). It is a portable build: put it in a normal folder and double-click it to run.
2. To create Start menu shortcuts, download the NSIS package whose filename ends in `-setup.exe`. Do not download the macOS `.dmg` package.
3. The portable build requires WebView2. Recent Windows 10/11 installations normally include it. If the application does not start, install Microsoft Edge WebView2 Runtime first. The installer build can bootstrap a missing runtime over the network.
4. Unsigned releases may trigger Windows SmartScreen. Verify that the file came from this repository's Release page, then choose **More info > Run anyway**.
5. On first launch, choose a library directory in Settings. For cross-device synchronization, you may choose a OneDrive directory, but do not modify the same library from two computers at the same time.
6. An API key is needed only when using AI. Configure DeepSeek, Zhipu GLM, or a custom OpenAI-compatible endpoint in Settings. The key is read on demand and stored in Windows Credential Manager.

If a Release does not yet contain a Windows package, build it from source with the instructions below.

### macOS

Download the `.dmg` from [GitHub Releases](https://github.com/hkcao/KnowledgeMaster/releases), open it, drag KnowledgeMaster into Applications, and launch it. Because current builds are not Apple-notarized, macOS may require approval under **System Settings > Privacy & Security** the first time you open the app.

## Build from Source

### Windows

Prepare a Windows 10/11 x64 environment with:

- [Node.js 22 LTS](https://nodejs.org/).
- [Rust stable](https://www.rust-lang.org/tools/install) with the default `x86_64-pc-windows-msvc` toolchain.
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** and a Windows 10/11 SDK.
- Microsoft Edge WebView2 Runtime. Recent Windows 10/11 installations normally include it; otherwise install the Evergreen Runtime from [Microsoft WebView2](https://developer.microsoft.com/microsoft-edge/webview2/).

Run in PowerShell:

```powershell
git clone https://github.com/hkcao/KnowledgeMaster.git
cd KnowledgeMaster
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Build the app and copy the raw executable as a portable package:

```powershell
npm run tauri build -- --bundles nsis
Copy-Item src-tauri\target\release\knowledge-master.exe KnowledgeMaster-portable.exe
```

The same build produces an NSIS installer:

```powershell
Get-ChildItem src-tauri\target\release\bundle\nsis\*-setup.exe
```

Windows packages should be built on Windows. The repository's GitHub Actions workflow validates both the portable executable and installer on a Windows runner. Pushing a `v*` tag attaches both `.exe` files to the matching GitHub Release.

### macOS

Install macOS 14+, Xcode Command Line Tools, Node.js 22 LTS, and Rust stable, then run:

```bash
git clone https://github.com/hkcao/KnowledgeMaster.git
cd KnowledgeMaster
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Build the `.app` and `.dmg` packages:

```bash
npm run tauri build -- --bundles app,dmg
```

Build outputs are written to `src-tauri/target/release/bundle/macos/` and `src-tauri/target/release/bundle/dmg/`.

Production packages should be built on their target operating system. `.github/workflows/tauri-ci.yml` runs frontend and Rust tests on both macOS and Windows, builds a macOS `.dmg`, and produces Windows portable and NSIS packages.

## Local Library Layout

```text
<library>/
├── knowledge.db                   # SQLite metadata
├── knowledge.json.migrated-v8.bak # Created only during a legacy migration
└── source/
    ├── documents/                 # Imported source files
    ├── downloads/pending/         # Agent downloads awaiting confirmation
    ├── generated/agent-cache/     # Reusable parsing and OCR results
    ├── index/                     # Locally extracted text
    └── notes/                     # Summary notes in Markdown
```

macOS and Windows use the same relative paths and SQLite schema. A library can live in a synced folder, but it should not be opened for concurrent modification on multiple devices.

## Agent Setup

Install and authenticate the CLI in a local terminal, then test the connection in KnowledgeMaster Settings:

- Claude Code: the app looks for `claude`; on Windows it also recognizes the npm-generated `claude.cmd` shim.
- Codex: the app looks for `codex`; on macOS it can also recognize the Codex binary bundled with the ChatGPT app, and on Windows it recognizes `codex.cmd`.

Quitting KnowledgeMaster terminates Agent processes started by that app session. It does not stop Agents independently running in other terminals.

After selecting documents or topics, the app creates an isolated system temporary directory for the authorized scope. The Agent sees only document copies, parsing caches, and writable generated/download directories. It does not receive the original library path. Changing the Q&A scope switches to a new workspace and Agent session.

## Current Limitations

1. Automatically recalled long-term memory across conversations is not implemented yet.
2. Context compression, cache reuse, and token efficiency still need optimization.
3. Parsing and reuse strategies for scanned PDFs, complex tables, formulas, and OCR still need optimization.
4. Visual polish and motion design can be improved further.
5. Windows is a supported implementation and CI target, but trackpad, input-method, WebView2, and Agent CLI compatibility still require ongoing validation on real Windows devices.

## License

Licensed under the [MIT License](LICENSE).
