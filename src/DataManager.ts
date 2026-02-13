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
}

export interface ProjectData {
  name: string;
  path: string;
  days: { [date: string]: DayData };
}

export interface GlobalData {
  projects: { [path: string]: ProjectData };
  dailyGoal: number; // Meta en SEGUNDOS
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
    // Definir ruta: ~/.devtracker/data.json
    const homeDir = os.homedir();
    const folderPath = path.join(homeDir, ".devtracker");
    this.dataPath = path.join(folderPath, "data.json");

    // Crear carpeta si no existe
    if (!fs.existsSync(folderPath)) {
      try {
        fs.mkdirSync(folderPath, { recursive: true });
      } catch (e) {
        console.error("Error creando directorio de datos:", e);
      }
    }

    // Cargar datos persistentes
    this.currentData = this.loadDataFromDisk();

    // Inicializar estado de la sesión actual (en memoria)
    this.sessionState = {
      startTime: Date.now(),
      seconds: 0,
      keystrokes: 0,
      linesAdded: 0,
      linesDeleted: 0,
      languages: {},
    };
  }

  /**
   * Carga los datos del JSON. Si hay error o falta info, devuelve estructura default.
   */
  private loadDataFromDisk(): GlobalData {
    const defaultData: GlobalData = { dailyGoal: 14400, projects: {} }; // Default: 4 horas

    if (fs.existsSync(this.dataPath)) {
      try {
        const raw = fs.readFileSync(this.dataPath, "utf8");
        const parsed = JSON.parse(raw);

        // Migración simple: Asegurar que dailyGoal existe si el archivo es antiguo
        if (parsed.dailyGoal === undefined) {
          parsed.dailyGoal = 14400;
        }
        // Asegurar que projects existe
        if (!parsed.projects) {
          parsed.projects = {};
        }

        return parsed as GlobalData;
      } catch (error) {
        console.error("Error leyendo data.json, se usará default:", error);
        return defaultData;
      }
    }
    return defaultData;
  }

  /**
   * Guarda el estado actual en el disco (Síncrono para evitar race conditions simples)
   */
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

  // --- MÉTODOS DE REGISTRO (TRACKING) ---

  public addTime(projectPath: string, languageId: string, seconds: number) {
    // 1. Actualizar Sesión (RAM)
    this.sessionState.seconds += seconds;
    this.sessionState.languages[languageId] =
      (this.sessionState.languages[languageId] || 0) + seconds;

    // 2. Actualizar Persistencia (Disco/Objeto Global)
    const day = this.getTodayPersistentData(projectPath);

    day.seconds += seconds;

    // Registrar hora del día (0-23)
    const h = new Date().getHours().toString();
    day.hours[h] = (day.hours[h] || 0) + seconds;

    // Registrar lenguaje en el día
    if (!day.languages[languageId]) {
      day.languages[languageId] = { name: languageId, seconds: 0 };
    }
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

  // --- MÉTODOS DE GESTIÓN (GETTERS / SETTERS) ---

  /**
   * Establece la meta diaria.
   * @param hours - Recibe horas (pueden ser decimales, ej: 0.5 para 30 min).
   */
  public setDailyGoal(hours: number) {
    // Guardamos internamente en segundos para mayor precisión
    this.currentData.dailyGoal = Math.floor(hours * 3600);
    this.saveData();
  }

  public getDailyGoal(): number {
    // Retorna la meta en SEGUNDOS.
    // Si por alguna razón es 0 o undefined, retorna 4 horas (14400s)
    return this.currentData.dailyGoal || 14400;
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

  // --- UTILIDADES INTERNAS ---

  private getTodayPersistentData(projectPath: string): DayData {
    const project = this.getProjectData(projectPath);
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

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
    // Asegurar estructura si el objeto existía pero estaba incompleto
    if (!project.days[today].hours) project.days[today].hours = {};
    if (!project.days[today].languages) project.days[today].languages = {};

    return project.days[today];
  }

  // --- EXPORTACIÓN ---

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
