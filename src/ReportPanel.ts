import * as vscode from "vscode";
import { SessionState, ProjectData } from "./DataManager";

export class ReportPanel {
  public static currentPanel: ReportPanel | undefined;
  public static readonly viewType = "devTrackerStats";
  public readonly currentProjectPath: string;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    sessionData: SessionState,
    projectData: ProjectData,
    allProjects: ProjectData[],
    dailyGoal: number,
    projectPath: string,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReportPanel.currentPanel) {
      ReportPanel.currentPanel._panel.reveal(column);
      ReportPanel.currentPanel.sendUpdate(
        sessionData,
        projectData,
        allProjects,
        dailyGoal,
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReportPanel.viewType,
      "DevTracker Dashboard",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
        retainContextWhenHidden: true,
      },
    );

    ReportPanel.currentPanel = new ReportPanel(
      panel,
      extensionUri,
      sessionData,
      projectData,
      allProjects,
      dailyGoal,
      projectPath,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sData: SessionState,
    pData: ProjectData,
    allData: ProjectData[],
    goal: number,
    path: string,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.currentProjectPath = path;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.html = this._getWebviewContent(
      sData,
      pData,
      allData,
      goal,
    );
  }

  public sendUpdate(
    sData: SessionState,
    pData: ProjectData,
    allData: ProjectData[],
    goal: number,
  ) {
    this._panel.webview.postMessage({
      command: "update",
      sData,
      pData,
      allData,
      goal,
    });
  }

  public dispose() {
    ReportPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _getWebviewContent(
    sData: SessionState,
    pData: ProjectData,
    allData: ProjectData[],
    goal: number,
  ) {
    const webview = this._panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "chart.min.js"),
    );

    const sDataJson = JSON.stringify(sData);
    const pDataJson = JSON.stringify(pData);
    const allDataJson = JSON.stringify(allData);

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="${scriptUri}"></script>
            <title>DevTracker</title>
            <style>
                :root {
                    --bg: var(--vscode-editor-background);
                    --fg: var(--vscode-editor-foreground);
                    --card-bg: var(--vscode-editor-inactiveSelectionBackground);
                    --border: var(--vscode-widget-border);
                    --accent: var(--vscode-textLink-foreground);
                    --green: #4ec9b0; --red: #f14c4c; --blue: #569cd6; --orange: #ce9178;
                }
                body { font-family: var(--vscode-font-family); background: var(--bg); color: var(--fg); margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column; }
                
                /* NAVBAR */
                .navbar { padding: 10px 20px; border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.2); display: flex; justify-content: space-between; align-items: center; }
                .brand { font-weight: 800; font-size: 1.1rem; letter-spacing: -0.5px; display:flex; align-items:center; gap:10px;}
                
                .tabs { display: flex; gap: 5px; background: var(--card-bg); padding: 3px; border-radius: 6px; }
                .tab-btn { background: none; border: none; color: var(--fg); padding: 6px 15px; cursor: pointer; border-radius: 4px; font-size: 0.9rem; opacity: 0.7; transition: all 0.2s;}
                .tab-btn:hover { opacity: 1; background: rgba(255,255,255,0.05); }
                .tab-btn.active { background: var(--accent); color: #fff; opacity: 1; font-weight: 600; }

                /* FILTERS */
                .filters { display: flex; gap: 5px; margin-top: 15px; margin-bottom: 15px; justify-content: flex-end; }
                .filter-btn { background: transparent; border: 1px solid var(--border); color: var(--fg); padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 0.8rem; opacity: 0.6; }
                .filter-btn.active { border-color: var(--accent); color: var(--accent); opacity: 1; font-weight: bold; }

                /* LAYOUT */
                .container { padding: 20px; overflow-y: auto; flex: 1; }
                .view-section { display: none; }
                .view-section.active { display: block; animation: fadeIn 0.3s; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

                .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
                
                /* Grid 2 columnas: izquierda ancha (gráficos lineales/tablas), derecha estrecha (tarta) */
                .grid-2 { display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 20px; }
                @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }

                .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; display: flex; flex-direction: column; justify-content: center; }
                .card-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6; margin-bottom: 5px; font-weight: 600; }
                .metric-big { font-size: 2rem; font-weight: 700; }
                .metric-sub { font-size: 0.85rem; opacity: 0.5; margin-top: 5px; }

                .chart-container { height: 250px; position: relative; width: 100%; }
                table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
                td, th { padding: 10px; border-bottom: 1px solid var(--border); text-align: left; }
                .text-right { text-align: right; }
                
                #filter-bar { display: none; } 
                
                /* GOAL CIRCLE */
                .goal-wrapper { text-align: center; }
                .goal-percent { font-size: 3.5rem; font-weight: 800; line-height: 1; }
            </style>
        </head>
        <body>
            <div class="navbar">
                <div class="brand">
                    <span>DevTracker</span>
                </div>
                <div class="tabs">
                    <button class="tab-btn active" onclick="switchTab('session')">Current Session</button>
                    <button class="tab-btn" onclick="switchTab('project')">Project History</button>
                    <button class="tab-btn" onclick="switchTab('global')">Global History</button>
                </div>
            </div>

            <div class="container">
                <div id="filter-bar" class="filters">
                    <button class="filter-btn" onclick="setRange('today')" id="btn-today">Today</button>
                    <button class="filter-btn active" onclick="setRange('week')" id="btn-week">Last Week</button>
                    <button class="filter-btn" onclick="setRange('month')" id="btn-month">Last Month</button>
                    <button class="filter-btn" onclick="setRange('all')" id="btn-all">All Time</button>
                </div>

                <div id="view-session" class="view-section active">
                    <h2 style="margin-top:0">Session Overview</h2>
                    <div class="grid-4">
                        <div class="card"><div class="card-title">Session Time</div><div class="metric-big" style="color:var(--blue)" id="s-time">0m</div></div>
                        <div class="card"><div class="card-title">Lines Added</div><div class="metric-big" style="color:var(--green)" id="s-added">0</div></div>
                        <div class="card"><div class="card-title">Lines Deleted</div><div class="metric-big" style="color:var(--red)" id="s-deleted">0</div></div>
                        <div class="card"><div class="card-title">Keystrokes</div><div class="metric-big" style="color:var(--orange)" id="s-keys">0</div></div>
                    </div>
                    
                    <div class="grid-2">
                        <div class="card">
                            <div class="card-title">Languages Used (Session)</div>
                            <div class="chart-container"><canvas id="sLangChart"></canvas></div>
                        </div>
                        <div class="card goal-wrapper">
                            <div class="card-title">Daily Goal Progress</div>
                            <div class="goal-percent" id="s-goal">0%</div>
                            <div class="metric-sub" id="s-goal-txt">of your daily target</div>
                            <div style="margin-top:10px; font-size:0.8rem; opacity:0.4" id="s-goal-target">Target: --</div>
                        </div>
                    </div>
                </div>

                <div id="view-project" class="view-section">
                    <h2 style="margin-top:0">Project: <span id="p-name">...</span></h2>
                    <div class="grid-4">
                        <div class="card"><div class="card-title">Total Time</div><div class="metric-big" id="p-time">--</div></div>
                        <div class="card"><div class="card-title">Lines Added</div><div class="metric-big" style="color:var(--green)" id="p-added">--</div></div>
                        <div class="card"><div class="card-title">Lines Deleted</div><div class="metric-big" style="color:var(--red)" id="p-deleted">--</div></div>
                        <div class="card"><div class="card-title">Keystrokes</div><div class="metric-big" style="color:var(--orange)" id="p-keys">--</div></div>
                    </div>
                    <div class="grid-2">
                        <div class="card">
                            <div class="card-title">Activity Trend (Hours)</div>
                            <div class="chart-container"><canvas id="trendChart"></canvas></div>
                        </div>
                        <div class="card">
                            <div class="card-title">Languages Used (Project)</div>
                            <div class="chart-container"><canvas id="pLangChart"></canvas></div>
                        </div>
                    </div>
                </div>

                <div id="view-global" class="view-section">
                    <h2 style="margin-top:0">Global Statistics</h2>
                    <div class="grid-4">
                        <div class="card"><div class="card-title">Lifetime Code</div><div class="metric-big" id="g-time">--</div></div>
                        <div class="card"><div class="card-title">Total Added</div><div class="metric-big" style="color:var(--green)" id="g-added">--</div></div>
                        <div class="card"><div class="card-title">Total Projects</div><div class="metric-big" id="g-count">--</div></div>
                        <div class="card"><div class="card-title">Total Keystrokes</div><div class="metric-big" style="color:var(--orange)" id="g-keys">--</div></div>
                    </div>
                    <div class="grid-2">
                        <div class="card">
                            <div class="card-title">Top Projects by Time</div>
                            <table id="top-table"></table>
                        </div>
                        <div class="card">
                            <div class="card-title">Languages Used (Global)</div>
                            <div class="chart-container"><canvas id="gLangChart"></canvas></div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                Chart.defaults.color = '#888';
                Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
                
                // Variables para las instancias de Charts
                let sChart = null; // Session Languages
                let pChart = null; // Project Languages
                let gChart = null; // Global Languages
                let tChart = null; // Trend (Project)

                let currentTab = 'session';
                let currentRange = 'week';
                
                let rawSession = ${sDataJson};
                let rawProject = ${pDataJson};
                let rawAll = ${allDataJson};
                let dailyGoal = ${goal};

                // Colores para los gráficos circulares
                const LANG_COLORS = ['#569cd6','#4ec9b0','#ce9178','#dcdcaa', '#9cdcfe', '#c586c0', '#4fc1ff', '#d16969', '#d7ba7d'];

                render();

                window.addEventListener('message', e => {
                    const msg = e.data;
                    if(msg.command === 'update') {
                        rawSession = msg.sData;
                        rawProject = msg.pData;
                        rawAll = msg.allData;
                        dailyGoal = msg.goal;
                        render();
                    }
                });

                function switchTab(tab) {
                    currentTab = tab;
                    
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    event.target.classList.add('active');
                    
                    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
                    document.getElementById('view-'+tab).classList.add('active');

                    document.getElementById('filter-bar').style.display = (tab === 'session') ? 'none' : 'flex';
                    render();
                }

                function setRange(r) {
                    currentRange = r;
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    document.getElementById('btn-'+r).classList.add('active');
                    render();
                }

                function render() {
                    // --- SESSION RENDER ---
                    document.getElementById('s-time').innerText = fmt(rawSession.seconds);
                    document.getElementById('s-added').innerText = '+' + rawSession.linesAdded;
                    document.getElementById('s-deleted').innerText = '-' + rawSession.linesDeleted;
                    document.getElementById('s-keys').innerText = rawSession.keystrokes;
                    
                    const targetSeconds = dailyGoal > 0 ? dailyGoal : 14400; 
                    const pct = Math.min(100, Math.round((rawSession.seconds / targetSeconds) * 100));
                    
                    const gel = document.getElementById('s-goal');
                    gel.innerText = pct + '%';
                    
                    if(pct >= 100) {
                        gel.style.color = 'var(--green)';
                        document.getElementById('s-goal-txt').innerText = 'Daily goal reached! 🔥';
                    } else {
                        gel.style.color = 'var(--fg)';
                        document.getElementById('s-goal-txt').innerText = 'of your daily target';
                    }
                    document.getElementById('s-goal-target').innerText = 'Target: ' + fmt(targetSeconds);
                    
                    // Renderizamos gráfico de Sesión usando la nueva función helper
                    sChart = renderDoughnut(document.getElementById('sLangChart'), sChart, rawSession.languages);

                    if (currentTab === 'project') renderProject();
                    if (currentTab === 'global') renderGlobal();
                }

                // --- Helper para filtrar días según rango ---
                function getFilteredDays(daysArr) {
                    const now = new Date();
                    now.setHours(0,0,0,0);
                    const cutoff = new Date(now);

                    if(currentRange === 'week') cutoff.setDate(now.getDate() - 7);
                    else if(currentRange === 'month') cutoff.setDate(now.getDate() - 30);
                    else if(currentRange === 'all') cutoff.setFullYear(2000);

                    return daysArr.filter(d => {
                        const parts = d.date.split('-');
                        const date = new Date(parts[0], parts[1]-1, parts[2]); 
                        date.setHours(0,0,0,0);

                        if (currentRange === 'today') return date.getTime() === now.getTime();
                        return date >= cutoff;
                    });
                }

                // --- RENDER PROJECT ---
                function renderProject() {
                    document.getElementById('p-name').innerText = rawProject.name;
                    const days = getFilteredDays(Object.values(rawProject.days));
                    
                    let sec=0, add=0, del=0, key=0, trend={};
                    let langStats = {}; // Acumulador de lenguajes

                    days.forEach(d => {
                        sec+=d.seconds; add+=d.linesAdded; del+=d.linesDeleted; key+=(d.keystrokes||0);
                        trend[d.date] = (trend[d.date] || 0) + d.seconds;
                        
                        // Sumar lenguajes del histórico
                        if (d.languages) {
                            Object.values(d.languages).forEach(l => {
                                langStats[l.name] = (langStats[l.name] || 0) + l.seconds;
                            });
                        }
                    });

                    document.getElementById('p-time').innerText = fmt(sec);
                    document.getElementById('p-added').innerText = '+'+add;
                    document.getElementById('p-deleted').innerText = '-'+del;
                    document.getElementById('p-keys').innerText = key;

                    renderTrendChart(trend);
                    // Renderizar el nuevo gráfico de lenguajes del proyecto
                    pChart = renderDoughnut(document.getElementById('pLangChart'), pChart, langStats);
                }

                // --- RENDER GLOBAL ---
                function renderGlobal() {
                    let allDays = [];
                    rawAll.forEach(p => allDays.push(...Object.values(p.days)));
                    const days = getFilteredDays(allDays);

                    let sec=0, add=0, key=0;
                    let langStats = {}; // Acumulador de lenguajes global

                    days.forEach(d => { 
                        sec+=d.seconds; add+=d.linesAdded; key+=(d.keystrokes||0);
                        
                        // Sumar lenguajes globalmente
                        if (d.languages) {
                            Object.values(d.languages).forEach(l => {
                                langStats[l.name] = (langStats[l.name] || 0) + l.seconds;
                            });
                        }
                    });

                    document.getElementById('g-time').innerText = fmt(sec);
                    document.getElementById('g-added').innerText = '+'+add;
                    document.getElementById('g-keys').innerText = key;
                    document.getElementById('g-count').innerText = rawAll.length;

                    // Top Projects Logic
                    let projStats = rawAll.map(p => {
                        const pDays = getFilteredDays(Object.values(p.days));
                        const pSec = pDays.reduce((a,b)=>a+b.seconds, 0);
                        return { name: p.name, sec: pSec };
                    }).filter(x => x.sec > 0).sort((a,b) => b.sec - a.sec).slice(0,10);

                    let html=''; 
                    projStats.forEach(x => {
                        html+= \`<tr><td>\${x.name}</td><td class="text-right">\${fmt(x.sec)}</td></tr>\`;
                    });
                    document.getElementById('top-table').innerHTML = html || '<tr><td>No activity in this range</td></tr>';

                    // Renderizar el nuevo gráfico de lenguajes global
                    gChart = renderDoughnut(document.getElementById('gLangChart'), gChart, langStats);
                }

                // --- HELPER: Renderizado Genérico de Doughnut (Tarta) ---
                function renderDoughnut(canvas, chartInstance, dataMap) {
                    const lbls = Object.keys(dataMap);
                    const vals = Object.values(dataMap);

                    if (chartInstance) {
                        chartInstance.data.labels = lbls;
                        chartInstance.data.datasets[0].data = vals;
                        chartInstance.update('none');
                        return chartInstance;
                    } else {
                        return new Chart(canvas, { 
                            type: 'doughnut', 
                            data: { 
                                labels: lbls, 
                                datasets: [{ 
                                    data: vals, 
                                    backgroundColor: LANG_COLORS, 
                                    borderWidth: 0 
                                }] 
                            }, 
                            options: { 
                                responsive: true, 
                                maintainAspectRatio: false, 
                                plugins: { 
                                    legend: { 
                                        position: 'right', 
                                        labels: { boxWidth: 10, color: '#888', font: {size: 10} } 
                                    } 
                                } 
                            } 
                        });
                    }
                }

                // --- Helper: Renderizado Trend (Línea) ---
                function renderTrendChart(trendMap) {
                    const ctx = document.getElementById('trendChart');
                    const lbls = Object.keys(trendMap).sort();
                    const vals = lbls.map(k => (trendMap[k]/3600).toFixed(2)); 
                    
                    if(tChart) { 
                        tChart.data.labels = lbls.map(d=>d.slice(5)); 
                        tChart.data.datasets[0].data = vals; 
                        tChart.update('none'); 
                    } else {
                        tChart = new Chart(ctx, { 
                            type: 'line', 
                            data: { 
                                labels: lbls.map(d=>d.slice(5)), 
                                datasets: [{ 
                                    label:'Hours', 
                                    data: vals, 
                                    borderColor: '#4fc1ff', 
                                    backgroundColor: 'rgba(79,193,255,0.1)', 
                                    fill:true, 
                                    tension:0.4 
                                }] 
                            }, 
                            options: { 
                                responsive:true, 
                                maintainAspectRatio:false, 
                                scales:{ y:{ beginAtZero:true } } 
                            } 
                        });
                    }
                }

                function fmt(s) { 
                    const h=Math.floor(s/3600);
                    const m=Math.floor((s%3600)/60); 
                    if (h === 0 && m === 0 && s > 0) return '< 1m';
                    return h>0 ? h+'h '+m+'m' : m+'m'; 
                }
            </script>
        </body>
        </html>`;
  }
}
