# DevTracker 📊

**DevTracker** is a professional analytics dashboard designed for developers who want to understand their coding habits, optimize their workflow, and stay motivated.

Unlike other tracking tools, **DevTracker works 100% locally**. Your coding data never leaves your machine.

## ✨ Key Features

### 1. ⏱️ Real-Time Analytics Dashboard

Visualize key metrics with a clean, professional design divided into three strategic views:

- **Current Session:** Volatile metrics that reset when you close VS Code. Perfect for measuring work sprints.
- **Project History:** Analyze the evolution of your current project with range filters (7 Days, 30 Days, Month, All Time).
- **Global Stats:** A complete overview of your "coding life" aggregating data across all your projects.

### 2. 📈 Detailed Metrics

We don't just count time. DevTracker dives deep into your activity:

- **Active Time:** Smart timer that pauses automatically after inactivity.
- **Line Churn:** Differentiates between **Lines Added** (New Value) and **Lines Deleted** (Refactoring).
- **Keystrokes:** Measures your typing intensity.
- **Languages:** Doughnut charts showing language distribution per session.

### 3. 🎯 Gamification & Goals

- **Daily Goal Ring:** Set a daily hour target and visualize your progress in real-time.
- **Visual Feedback:** Semantic color indicators to evaluate your performance at a glance.

### 4. 🔒 Total Privacy & Data Freedom

- **100% Offline:** Your data is stored in a local JSON file in your user folder (`~/.devtracker/data.json`).
- **CSV Export:** Export your entire history to **CSV** with a single click to perform your own analysis in Excel, Python, or Notion.

---

## 🚀 How to Use

Once installed, DevTracker starts working automatically in the background.

### Available Commands

Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and type:

- `DevTracker: Open Dashboard`: Opens the main analytics panel.
- `DevTracker: Set Daily Goal`: Configures your daily hour target (Default: 4 hours).
- `DevTracker: Export Data (CSV)`: Generates a `.csv` file with your full history.

---

## 📸 Screenshots

### Session View

![Session View](media/screenshot-session.png)

### Project History

![Project View](media/screenshot-project.png)

---

## ⚙️ Configuration

DevTracker is designed as a "Zero Config" tool, but handles smart defaults:

- **Inactivity Threshold:** The extension stops counting time after **5 minutes** of no keyboard/mouse activity to ensure accuracy.
- **Data Storage:**
  - Mac/Linux: `~/.devtracker/data.json`
  - Windows: `%USERPROFILE%\.devtracker\data.json`

---

## 🛡️ Privacy Policy

Your data is yours.

- **No Telemetry:** This extension does **NOT** send any data to external servers.
- **Local Storage:** All metrics are calculated and stored locally on your machine.

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).

---

**Happy Coding!** 🚀
