# Installing & Running Winsle

Welcome to Winsle! This guide will walk you through compiling and running the application on your PC.

## Prerequisites

To build and run this application, you will need the following dependencies installed on your system:

1. **Node.js** (v18 or newer)
   - Download from: [https://nodejs.org](https://nodejs.org)
2. **Rust**
   - Download and install using `rustup` from: [https://rustup.rs](https://rustup.rs)
   - *Windows Users:* Ensure you have the C++ build tools installed (Visual Studio Build Tools), which the Rust installer will usually prompt you to install.

## Setup Instructions

1. **Clone or Download the Repository:**
   Copy the files to your local device.

2. **Install Node Dependencies:**
   Open a terminal in the `app` folder and run:
   ```bash
   cd app
   npm install
   ```

3. **Run in Development Mode (Live Reload):**
   If you want to run the app in development mode to see changes live:
   ```bash
   npm run tauri dev
   ```

4. **Build for Production (Installable Executable):**
   If you want to build a standalone executable that you can just copy and paste, run:
   ```bash
   npm run tauri build
   ```
   *Once the build finishes, you can find the `.exe` file inside:*
   `app/src-tauri/target/release/winsle.exe`

   You can safely copy this `winsle.exe` file anywhere on your computer or to another Windows device and run it directly!

## Quick Start
You can just double-click the executable to launch Winsle. It will sit in your system tray and run in the background. Enjoy!
