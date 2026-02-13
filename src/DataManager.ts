import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// --- INTERFACES DE DATOS ---

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
  files: { [filePath: string]: number }; // <--- NUEVA MÉTRICA: Archivos individuales
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

// --- CLASE DATAMANAGER ---

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
        console.error("Error creando directorio de datos:", e);
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
    const defaultData: GlobalData = { dailyGoal: 14400, projects: {} };

    if (fs.existsSync(this.dataPath)) {
      try {
        const raw = fs.readFileSync(this.dataPath, "utf8");
        const parsed = JSON.parse(raw);

        if (parsed.dailyGoal === undefined) parsed.dailyGoal = 14400;
        if (!parsed.projects) parsed.projects = {};

        return parsed as GlobalData;
      } catch (error) {
        console.error("Error leyendo data.json:", error);
        return defaultData;
      }
    }
    return defaultData;
  }

  public saveData(): void {
    try {
      fs.writeFileSync(
        this.dataPath,
        JSON.stringify(this.currentData, null, 2),
      );
    } catch (e) {
      console.error("Error guardando datos:", e);
    }
  }

  private normalizePath(p: string): string {
    return path.normalize(p).toLowerCase();
  }

  // --- TRACKING ---

  /**
   * Ahora acepta 'relativeFilePath' para trackear archivos específicos
   */
  public addTime(
    projectPath: string,
    languageId: string,
    relativeFilePath: string,
    seconds: number,
  ) {
    // 1. Session
    this.sessionState.seconds += seconds;
    this.sessionState.languages[languageId] =
      (this.sessionState.languages[languageId] || 0) + seconds;

    // 2. Persistent
    const day = this.getTodayPersistentData(projectPath);
    day.seconds += seconds;

    // Hora
    const h = new Date().getHours().toString();
    day.hours[h] = (day.hours[h] || 0) + seconds;

    // Lenguaje
    if (!day.languages[languageId]) {
      day.languages[languageId] = { name: languageId, seconds: 0 };
    }
    day.languages[languageId].seconds += seconds;

    // Archivo (NUEVO)
    // Si el archivo no existe en el registro de hoy, inicializarlo
    if (!day.files) day.files = {};
    day.files[relativeFilePath] = (day.files[relativeFilePath] || 0) + seconds;
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

  // --- GETTERS / SETTERS ---

  public setDailyGoal(hours: number) {
    this.currentData.dailyGoal = Math.floor(hours * 3600);
    this.saveData();
  }

  public getDailyGoal(): number {
    return this.currentData.dailyGoal || 14400;
  }

  public getTodayTotalSeconds(): number {
    const today = new Date().toISOString().split("T")[0];
    let total = 0;
    Object.values(this.currentData.projects).forEach((p) => {
      if (p.days[today]) {
        total += p.days[today].seconds;
      }
    });
    return total;
  }

  public getSessionState(): SessionState {
    return this.sessionState;
  }

  public getAllProjects(): ProjectData[] {
    return Object.values(this.currentData.projects);
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

  // --- UTILIDADES ---

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
        files: {}, // Inicializamos el mapa de archivos
      };
    }
    // Safety checks para datos antiguos
    if (!project.days[today].hours) project.days[today].hours = {};
    if (!project.days[today].languages) project.days[today].languages = {};
    if (!project.days[today].files) project.days[today].files = {};

    return project.days[today];
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
