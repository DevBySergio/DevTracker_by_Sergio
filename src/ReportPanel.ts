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
                    --card-border: var(--vscode-widget-border);
                    --accent: var(--vscode-textLink-foreground);
                    --text-secondary: var(--vscode-descriptionForeground);
                    
                    /* Colores Semánticos */
                    --green: #4ec9b0; 
                    --red: #f14c4c; 
                    --blue: #569cd6; 
                    --orange: #ce9178;
                }
                
                body { font-family: var(--vscode-font-family); background: var(--bg); color: var(--fg); margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column; }
                
                .navbar { padding: 10px 20px; border-bottom: 1px solid var(--card-border); background: rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center; }
                .brand { font-weight: 800; font-size: 1.2rem; letter-spacing: -0.5px; display:flex; align-items:center; gap:10px; color: var(--fg); }
                
                .tabs { display: flex; gap: 5px; background: var(--card-bg); padding: 3px; border-radius: 6px; }
                .tab-btn { background: none; border: none; color: var(--fg); padding: 6px 15px; cursor: pointer; border-radius: 4px; font-size: 0.9rem; opacity: 0.7; transition: all 0.2s; font-family: inherit;}
                .tab-btn:hover { opacity: 1; background: rgba(255,255,255,0.05); }
                .tab-btn.active { background: var(--accent); color: #fff; opacity: 1; font-weight: 600; }

                .view-header { 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    margin-bottom: 20px; 
                    flex-wrap: wrap; 
                    gap: 10px;
                    min-height: 40px; /* Evita saltos cuando se ocultan filtros */
                }
                
                .page-title { margin: 0; font-size: 1.5rem; font-weight: 600; }

                .filters { display: flex; gap: 8px; }
                .filter-btn { background: transparent; border: 1px solid var(--card-border); color: var(--fg); padding: 5px 12px; cursor: pointer; border-radius: 4px; font-size: 0.8rem; opacity: 0.8; font-family: inherit; }
                .filter-btn:hover { border-color: var(--accent); opacity: 1; }
                .filter-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; opacity: 1; font-weight: 600; }

                .container { padding: 20px; overflow-y: auto; flex: 1; max-width: 1200px; margin: 0 auto; width: 100%; box-sizing: border-box; }
                .view-section { display: none; }
                .view-section.active { display: block; animation: fadeIn 0.3s; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

                .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 20px; }
                
                .grid-2 { display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 20px; align-items: stretch; }
                @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
                
                .grid-full { width: 100%; margin-bottom: 20px; }

                .card { 
                    background: var(--card-bg); 
                    border: 1px solid var(--card-border); 
                    border-radius: 8px; 
                    padding: 20px; 
                    display: flex; 
                    flex-direction: column; 
                    justify-content: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    height: 100%; 
                    box-sizing: border-box;
                }
                .card-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-secondary); margin-bottom: 10px; font-weight: 600; }
                
                .metric-big { font-size: 2.2rem; font-weight: 700; line-height: 1.1; }
                .metric-sub { font-size: 0.9rem; color: var(--text-secondary); margin-top: 5px; }

                .chart-container { height: 260px; position: relative; width: 100%; }
                
                .table-wrapper { max-height: 300px; overflow-y: auto; }
                table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
                th { text-align: left; padding: 8px; border-bottom: 2px solid var(--card-border); color: var(--text-secondary); font-weight: 600;}
                td { padding: 8px; border-bottom: 1px solid var(--card-border); }
                tr:last-child td { border-bottom: none; }
                tr:hover { background-color: rgba(255,255,255,0.03); }
                
                .text-right { text-align: right; }
                .file-name { font-family: 'Consolas', 'Courier New', monospace; font-size: 0.85rem; color: var(--accent); }
                
                .goal-wrapper { text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
                .goal-percent { font-size: 4rem; font-weight: 800; line-height: 1; margin: 10px 0; }
                
                #filter-bar { display: none; } 
            </style>
        </head>
        <body>
            <div class="navbar">
                <div class="brand"><span>DevTracker</span></div>
                <div class="tabs">
                    <button class="tab-btn active" onclick="switchTab('session')">Current Session</button>
                    <button class="tab-btn" onclick="switchTab('project')">Project History</button>
                    <button class="tab-btn" onclick="switchTab('global')">Global History</button>
                </div>
            </div>

            <div class="container">
                <div class="view-header">
                    <h2 id="page-title" class="page-title">Session Overview</h2>
                    
                    <div id="filter-bar" class="filters">
                        <button class="filter-btn" onclick="setRange('today')" id="btn-today">Today</button>
                        <button class="filter-btn active" onclick="setRange('week')" id="btn-week">Last Week</button>
                        <button class="filter-btn" onclick="setRange('month')" id="btn-month">Last Month</button>
                        <button class="filter-btn" onclick="setRange('all')" id="btn-all">All Time</button>
                    </div>
                </div>

                <div id="view-session" class="view-section active">
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
                        <div class="card">
                            <div class="goal-wrapper">
                                <div class="card-title">Daily Goal Progress</div>
                                <div class="goal-percent" id="s-goal">0%</div>
                                <div class="metric-sub" id="s-goal-txt">of your daily target</div>
                                <div style="margin-top:10px; font-size:0.8rem; opacity:0.6" id="s-goal-target">Target: --</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="view-project" class="view-section">
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
                    
                    <div class="grid-full">
                        <div class="card">
                            <div class="card-title">Most Active Files (Top 10)</div>
                            <div class="table-wrapper">
                                <table id="p-files-table"></table>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="view-global" class="view-section">
                    <div class="grid-4">
                        <div class="card"><div class="card-title">Lifetime Code</div><div class="metric-big" id="g-time">--</div></div>
                        <div class="card"><div class="card-title">Total Added</div><div class="metric-big" style="color:var(--green)" id="g-added">--</div></div>
                        <div class="card"><div class="card-title">Total Projects</div><div class="metric-big" id="g-count">--</div></div>
                        <div class="card"><div class="card-title">Total Keystrokes</div><div class="metric-big" style="color:var(--orange)" id="g-keys">--</div></div>
                    </div>
                    
                    <div class="grid-2">
                        <div class="card">
                            <div class="card-title">Top Projects by Time</div>
                            <div class="table-wrapper">
                                <table id="top-table"></table>
                            </div>
                        </div>
                        <div class="card">
                            <div class="card-title">Languages Used (Global)</div>
                            <div class="chart-container"><canvas id="gLangChart"></canvas></div>
                        </div>
                    </div>
                    
                    <div class="grid-full">
                         <div class="card">
                            <div class="card-title">Peak Productivity Hours</div>
                            <div class="chart-container" style="height:220px"><canvas id="gHourChart"></canvas></div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                Chart.defaults.color = '#999';
                Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
                Chart.defaults.font.family = 'Segoe UI, sans-serif';
                
                let sChart = null, pChart = null, gChart = null; 
                let tChart = null; 
                let hChart = null; 

                let currentTab = 'session';
                let currentRange = 'week';
                
                let rawSession = ${sDataJson};
                let rawProject = ${pDataJson};
                let rawAll = ${allDataJson};
                let dailyGoal = ${goal};

                const LANGUAGE_COLOR_MAP = {
                    'typescript': '#3178c6',
                    'javascript': '#f1e05a',
                    'python': '#3572A5',
                    'java': '#b07219',
                    'c#': '#178600',
                    'html': '#e34c26',
                    'css': '#563d7c',
                    'scss': '#c6538c',
                    'json': '#858585',
                    'markdown': '#083fa1',
                    'php': '#4F5D95',
                    'go': '#00ADD8',
                    'ruby': '#701516',
                    'rust': '#dea584',
                    'c++': '#f34b7d',
                    'c': '#555555',
                    'vue': '#41b883',
                    'react': '#61dafb',
                    'angular': '#dd1b16',
                    'shell': '#89e051',
                    'sql': '#e38c00',
                    'xml': '#0060ac',
                    'yaml': '#cb171e'
                };
                const FALLBACK_COLORS = ['#569cd6','#4ec9b0','#ce9178','#dcdcaa', '#9cdcfe', '#c586c0', '#4fc1ff', '#d16969'];

                render();

                window.addEventListener('message', e => {
                    const msg = e.data;
                    if(msg.command === 'update') {
                        rawSession = msg.sData;
                        rawProject = msg.pData;
                        rawAll = msg.allData;
                        dailyGoal = msg.goal;
                        render();
                        updateHeader();
                    }
                });

                function switchTab(tab) {
                    currentTab = tab;
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    event.target.classList.add('active');
                    
                    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
                    document.getElementById('view-'+tab).classList.add('active');
                    
                    document.getElementById('filter-bar').style.display = (tab === 'session') ? 'none' : 'flex';
                    
                    updateHeader();
                    render();
                }

                function updateHeader() {
                    const titleEl = document.getElementById('page-title');
                    if(currentTab === 'session') {
                        titleEl.innerHTML = 'Session Overview';
                    } else if(currentTab === 'project') {
                        titleEl.innerHTML = 'Project: <span style="color:var(--accent)">' + rawProject.name + '</span>';
                    } else if(currentTab === 'global') {
                        titleEl.innerHTML = 'Global Statistics';
                    }
                }

                function setRange(r) {
                    currentRange = r;
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    document.getElementById('btn-'+r).classList.add('active');
                    render();
                }

                function render() {
                    document.getElementById('s-time').innerText = fmt(rawSession.seconds);
                    document.getElementById('s-added').innerText = '+' + rawSession.linesAdded;
                    document.getElementById('s-deleted').innerText = '-' + rawSession.linesDeleted;
                    document.getElementById('s-keys').innerText = rawSession.keystrokes;
                    
                    const targetSeconds = dailyGoal > 0 ? dailyGoal : 14400; 
                    const todayKey = new Date().toISOString().split('T')[0];
                    let globalTodaySeconds = 0;
                    
                    if (rawAll && Array.isArray(rawAll)) {
                        rawAll.forEach(p => {
                            if (p.days && p.days[todayKey]) globalTodaySeconds += p.days[todayKey].seconds;
                        });
                    }
                    
                    const pct = Math.min(100, Math.round((globalTodaySeconds / targetSeconds) * 100));
                    const gel = document.getElementById('s-goal');
                    gel.innerText = pct + '%';
                    
                    if(pct >= 100) {
                        gel.style.color = 'var(--green)';
                        document.getElementById('s-goal-txt').innerText = 'Daily goal reached! 🔥';
                    } else {
                        gel.style.color = 'var(--fg)';
                        document.getElementById('s-goal-txt').innerText = fmt(globalTodaySeconds) + ' today';
                    }
                    document.getElementById('s-goal-target').innerText = 'Target: ' + fmt(targetSeconds);
                    
                    sChart = renderDoughnut(document.getElementById('sLangChart'), sChart, rawSession.languages);

                    if (currentTab === 'project') renderProject();
                    if (currentTab === 'global') renderGlobal();
                }

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

                function renderProject() {
                    const days = getFilteredDays(Object.values(rawProject.days));
                    
                    let sec=0, add=0, del=0, key=0, trend={};
                    let langStats = {};
                    let fileStats = {};

                    days.forEach(d => {
                        sec+=d.seconds; add+=d.linesAdded; del+=d.linesDeleted; key+=(d.keystrokes||0);
                        trend[d.date] = (trend[d.date] || 0) + d.seconds;
                        if (d.languages) Object.values(d.languages).forEach(l => langStats[l.name] = (langStats[l.name] || 0) + l.seconds);
                        if (d.files) Object.keys(d.files).forEach(f => fileStats[f] = (fileStats[f] || 0) + d.files[f]);
                    });

                    document.getElementById('p-time').innerText = fmt(sec);
                    document.getElementById('p-added').innerText = '+'+add;
                    document.getElementById('p-deleted').innerText = '-'+del;
                    document.getElementById('p-keys').innerText = key;

                    renderTrendChart(trend);
                    pChart = renderDoughnut(document.getElementById('pLangChart'), pChart, langStats);
                    
                    let sortedFiles = Object.keys(fileStats)
                        .map(f => ({ name: f, sec: fileStats[f] }))
                        .sort((a,b) => b.sec - a.sec)
                        .slice(0, 50);
                        
                    let fileHtml = '';
                    sortedFiles.forEach(f => {
                        fileHtml += \`<tr>
                            <td class="file-name" title="\${f.name}">\${f.name}</td>
                            <td class="text-right">\${fmt(f.sec)}</td>
                        </tr>\`;
                    });
                    document.getElementById('p-files-table').innerHTML = fileHtml || '<tr><td colspan="2">No activity in this range</td></tr>';
                }

                function renderGlobal() {
                    let allDays = [];
                    rawAll.forEach(p => allDays.push(...Object.values(p.days)));
                    const days = getFilteredDays(allDays);

                    let sec=0, add=0, key=0;
                    let langStats = {}; 
                    let hourStats = new Array(24).fill(0); 

                    days.forEach(d => { 
                        sec+=d.seconds; add+=d.linesAdded; key+=(d.keystrokes||0);
                        if (d.languages) Object.values(d.languages).forEach(l => langStats[l.name] = (langStats[l.name] || 0) + l.seconds);
                        if (d.hours) Object.keys(d.hours).forEach(h => { const hi=parseInt(h); if(hi>=0&&hi<24) hourStats[hi]+=d.hours[h]; });
                    });

                    document.getElementById('g-time').innerText = fmt(sec);
                    document.getElementById('g-added').innerText = '+'+add;
                    document.getElementById('g-keys').innerText = key;
                    document.getElementById('g-count').innerText = rawAll.length;

                    let projStats = rawAll.map(p => {
                        const pDays = getFilteredDays(Object.values(p.days));
                        const pSec = pDays.reduce((a,b)=>a+b.seconds, 0);
                        return { name: p.name, sec: pSec };
                    }).filter(x => x.sec > 0).sort((a,b) => b.sec - a.sec).slice(0, 20);

                    let html=''; 
                    projStats.forEach(x => {
                        html+= \`<tr><td class="file-name">\${x.name}</td><td class="text-right">\${fmt(x.sec)}</td></tr>\`;
                    });
                    document.getElementById('top-table').innerHTML = html || '<tr><td colspan="2">No activity</td></tr>';

                    gChart = renderDoughnut(document.getElementById('gLangChart'), gChart, langStats);
                    renderHourChart(hourStats);
                }

                function getColorsForLanguages(labels) {
                    return labels.map((l, i) => LANGUAGE_COLOR_MAP[l.toLowerCase()] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
                }

                function renderDoughnut(canvas, chartInstance, dataMap) {
                    const lbls = Object.keys(dataMap);
                    const vals = Object.values(dataMap);
                    const bgColors = getColorsForLanguages(lbls);
                    const borderColor = document.body.classList.contains('vscode-light') ? '#ffffff' : '#1e1e1e';

                    if (chartInstance) {
                        chartInstance.data.labels = lbls;
                        chartInstance.data.datasets[0].data = vals;
                        chartInstance.data.datasets[0].backgroundColor = bgColors;
                        chartInstance.data.datasets[0].borderColor = borderColor;
                        chartInstance.update('none');
                        return chartInstance;
                    } else {
                        return new Chart(canvas, { 
                            type: 'doughnut', 
                            data: { 
                                labels: lbls, 
                                datasets: [{ 
                                    data: vals, 
                                    backgroundColor: bgColors, 
                                    borderWidth: 2, 
                                    borderColor: borderColor 
                                }] 
                            }, 
                            options: { 
                                responsive: true, 
                                maintainAspectRatio: false, 
                                plugins: { 
                                    legend: { position: 'left', labels: { boxWidth: 12, font: {size: 11} } },
                                    tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) } }
                                } 
                            } 
                        });
                    }
                }

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
                            type: 'bar', 
                            data: { 
                                labels: lbls.map(d=>d.slice(5)), 
                                datasets: [{ 
                                    label:'Hours', 
                                    data: vals, 
                                    backgroundColor: 'rgba(86, 156, 214, 0.7)', 
                                    borderColor: '#569cd6',
                                    borderWidth: 1,
                                    borderRadius: 3
                                }] 
                            }, 
                            options: { 
                                responsive:true, 
                                maintainAspectRatio:false, 
                                scales:{ y:{ beginAtZero:true } },
                                plugins: { tooltip: { callbacks: { label: c => ' ' + fmt(c.raw * 3600) } } }
                            } 
                        });
                    }
                }

                function renderHourChart(hourArray) {
                    const ctx = document.getElementById('gHourChart');
                    const lbls = hourArray.map((_, i) => i.toString().padStart(2, '0'));
                    const vals = hourArray.map(s => (s/60).toFixed(0)); 

                    if(hChart) {
                        hChart.data.datasets[0].data = vals;
                        hChart.update('none');
                    } else {
                        hChart = new Chart(ctx, {
                            type: 'bar',
                            data: {
                                labels: lbls,
                                datasets: [{
                                    label: 'Minutes',
                                    data: vals,
                                    backgroundColor: (ctx) => {
                                        const val = ctx.raw;
                                        return val > 30 ? 'rgba(78, 201, 176, 0.9)' : 'rgba(78, 201, 176, 0.4)';
                                    }, 
                                    borderRadius: 2
                                }]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: false,
                                scales: {
                                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                                    x: { grid: { display: false } }
                                },
                                plugins: { tooltip: { callbacks: { label: c => ' ' + fmt(c.raw * 60) } } }
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
