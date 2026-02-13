import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface LanguageData {
  name: string;
  seconds: number;
}

export interface DayData {
  date: string;
  seconds: number;
  keystrokes: number;
  linesAdded: number;
  linesDeleted: number;
  languages: { [key: string]: LanguageData };
  hours: { [hour: string]: number };
}

export interface ProjectData {
  name: string;
  path: string;
  days: { [date: string]: DayData };
}

export interface GlobalData {
  projects: { [path: string]: ProjectData };
  dailyGoal: number;
}

export interface SessionState {
  startTime: number;
  seconds: number;
  keystrokes: number;
  linesAdded: number;
  linesDeleted: number;
  languages: { [key: string]: number };
}

export class DataManager {
  private dataPath: string;
  private currentData: GlobalData;

  private sessionState: SessionState;

  constructor() {
    const homeDir = os.homedir();
    const folderPath = path.join(homeDir, ".devtracker");
    this.dataPath = path.join(folderPath, "data.json");

    if (!fs.existsSync(folderPath)) {
      try {
        fs.mkdirSync(folderPath, { recursive: true });
      } catch (e) {
        console.error(e);
      }
    }
    this.currentData = this.loadDataFromDisk();

    this.sessionState = {
      startTime: Date.now(),
      seconds: 0,
      keystrokes: 0,
      linesAdded: 0,
      linesDeleted: 0,
      languages: {},
    };
  }

  private loadDataFromDisk(): GlobalData {
    if (fs.existsSync(this.dataPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
      } catch (error) {
        return { dailyGoal: 14400, projects: {} };
      }
    }
    return { dailyGoal: 14400, projects: {} };
  }

  public saveData(): void {
    try {
      fs.writeFileSync(
        this.dataPath,
        JSON.stringify(this.currentData, null, 2),
      );
    } catch (e) {
      console.error(e);
    }
  }

  private normalizePath(p: string): string {
    return path.normalize(p).toLowerCase();
  }

  public addTime(projectPath: string, languageId: string, seconds: number) {
    this.sessionState.seconds += seconds;
    this.sessionState.languages[languageId] =
      (this.sessionState.languages[languageId] || 0) + seconds;

    const day = this.getTodayPersistentData(projectPath);
    day.seconds += seconds;
    const h = new Date().getHours().toString();
    day.hours[h] = (day.hours[h] || 0) + seconds;
    if (!day.languages[languageId])
      day.languages[languageId] = { name: languageId, seconds: 0 };
    day.languages[languageId].seconds += seconds;
  }

  public addKeystrokes(projectPath: string, count: number) {
    this.sessionState.keystrokes += count;
    const day = this.getTodayPersistentData(projectPath);
    day.keystrokes = (day.keystrokes || 0) + count;
  }

  public addLines(projectPath: string, added: number, deleted: number) {
    if (added === 0 && deleted === 0) return;
    this.sessionState.linesAdded += added;
    this.sessionState.linesDeleted += deleted;
    const day = this.getTodayPersistentData(projectPath);
    day.linesAdded += added;
    day.linesDeleted += deleted;
  }

  public setDailyGoal(hours: number) {
    this.currentData.dailyGoal = hours * 3600;
    this.saveData();
  }

  public getProjectData(projectPath: string): ProjectData {
    const key = this.normalizePath(projectPath);
    if (!this.currentData.projects[key]) {
      this.currentData.projects[key] = {
        name: path.basename(projectPath),
        path: projectPath,
        days: {},
      };
    }
    return this.currentData.projects[key];
  }

  private getTodayPersistentData(projectPath: string): DayData {
    const project = this.getProjectData(projectPath);
    const today = new Date().toISOString().split("T")[0];
    if (!project.days[today]) {
      project.days[today] = {
        date: today,
        seconds: 0,
        keystrokes: 0,
        linesAdded: 0,
        linesDeleted: 0,
        languages: {},
        hours: {},
      };
    }
    if (!project.days[today].hours) project.days[today].hours = {};
    return project.days[today];
  }

  public getSessionState(): SessionState {
    return this.sessionState;
  }

  public getAllProjects(): ProjectData[] {
    return Object.values(this.currentData.projects);
  }

  public getDailyGoal(): number {
    return this.currentData.dailyGoal || 14400;
  }

  public generateCSV(): string {
    let csv = "Project,Date,Seconds,LinesAdded,LinesDeleted,Keystrokes\n";
    Object.values(this.currentData.projects).forEach((p) => {
      Object.values(p.days).forEach((d) => {
        csv += `"${p.name}","${d.date}",${d.seconds},${d.linesAdded},${d.linesDeleted},${d.keystrokes || 0}\n`;
      });
    });
    return csv;
  }
}
