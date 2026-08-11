/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */,
/* 1 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ENGLISH_STRINGS: () => (/* binding */ ENGLISH_STRINGS)
/* harmony export */ });
const ENGLISH_STRINGS = {
    appName: "DevTracker",
    documentTitle: "DevTracker Dashboard",
    skipToDashboard: "Skip to dashboard",
    dashboardViews: "Dashboard views",
    dateRange: "Date range",
    projectSelector: "Project",
    selectProject: "Select a project",
    actions: "Actions",
    actionItems: {
        export: "Export",
        settings: "Settings",
        openData: "Open Data",
        reset: "Reset",
    },
    views: {
        today: "Overview",
        project: "Trends",
        quality: "Workflow",
        global: "Projects",
    },
    ranges: {
        today: "Today",
        week: "Last Week",
        month: "Last Month",
        all: "Last 90 Days",
    },
    subtitles: {
        today: "Live view of today’s coding activity across tracked projects.",
        project: "Range-based activity time and patterns for the selected project.",
        quality: "Descriptive diagnostics, saves, debug time, and Git branch context.",
        global: "Activity across every tracked project in the selected range.",
    },
    metrics: {
        activeToday: "Active Today",
        dailyGoal: "Daily Goal",
        topThreeFileShare: "Top-3 File Share",
        currentFlow: "Current Flow",
        characterEditVolume: "Character Edit Volume",
        approximateLineActivity: "Approx. Line Activity",
        currentDiagnostics: "Current Diagnostics",
        gitContext: "Git Context",
        projectTime: "Project Time",
        characterEditsPerHour: "Character Edits / Active Hour",
        removalShare: "Removal Share (Approx.)",
        errors: "Errors",
        warnings: "Warnings",
        saves: "Saves",
        debugTime: "Debug Time",
        trackedTime: "Tracked Time",
        projects: "Projects",
        mostActiveHour: "Most Active Hour",
        uniqueActiveFiles: "Unique Active Files",
        flowBlocks: "Flow Blocks",
    },
    panels: {
        todayTimeline: "Today · 15-Minute Activity",
        focusProfile: "Focus Profile",
        projectDistribution: "Project Distribution",
        languageDistribution: "Language Distribution",
        sessionLanguages: "Session Languages",
        activeFiles: "Active Files",
        activityTrend: "Activity Trend",
        languages: "Languages",
        mostActiveFiles: "Most Active Files",
        diagnosticsTrend: "Diagnostics Trend",
        branchMix: "Branch Mix",
        currentSignals: "Current Signals",
        weeklyHeatmap: "Weekly Heatmap",
        topProjects: "Top Projects",
        globalLanguages: "Global Languages",
    },
    empty: {
        noActivity: "No activity yet",
        noActiveFile: "No active file",
        noSessionLanguages: "No session languages yet",
        noActiveFilesToday: "No active files today",
        noLanguagesInRange: "No languages in this range",
        noActivityInRange: "No activity in this range",
        gitUnavailable: "Git unavailable",
        diagnosticsUnavailable: "Diagnostics unavailable",
        noGlobalLanguageActivity: "No global language activity",
        overviewTitle: "No activity yet today",
        overviewBody: "DevTracker will show active time, focus context, and distributions here after your first tracked interaction.",
        noProjectDistribution: "No project activity yet",
        noLanguageDistribution: "No language activity yet",
    },
    dayNames: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    chartLabels: {
        hours: "Hours",
        errors: "Errors",
        warnings: "Warnings",
        info: "Info",
        activeMinutes: "Active minutes",
    },
    tableHeaders: {
        file: ["File", "Time", "Activity samples"],
        project: ["Project", "Time", "Top-3 share"],
    },
    signals: {
        errors: "Errors",
        warnings: "Warnings",
        info: "Info",
        hints: "Hints",
        dirtyFiles: "Dirty files",
    },
    phrases: {
        session: "Session",
        longest: "Longest",
        of: "of",
        editEvents: "edit events",
        largeEditEvents: "large edit events",
        inserted: "inserted",
        removedLineBreaksApprox: "removed line breaks (approx.)",
        errors: "errors",
        warnings: "warnings",
        trackedDays: "tracked days",
        observedEditorTransitions: "Observed editor transitions",
        approximateLineBreakChanges: "approximate line-break changes",
        tracked: "tracked",
        savesPerHour: "saves/hour",
    },
    initial: {
        zeroEditEvents: "0 edit events",
        approximateNetZeroLineBreaks: "Approx. net 0 line breaks",
        zeroWarnings: "0 warnings",
        zeroSavesPerHour: "0 saves/hour",
        zeroObservedEditorTransitions: "Observed editor transitions 0",
        legacyApproximation: "Legacy v1 approximation",
        zeroApproximateLineBreakChanges: "0 approximate line-break changes",
    },
    aria: {
        activeTimeToday: "Active time today",
        dailyGoalProgress: "Daily goal progress",
        topThreeFileShare: "Top three file share",
        currentFlowBlock: "Current flow block",
        characterEditVolume: "Character edit volume",
        approximateLineActivity: "Approximate line activity",
        currentDiagnostics: "Current diagnostics",
        gitContext: "Git context",
        activeHoursTodayChart: "Bar chart of active time in 15-minute buckets across today",
        projectHoursChart: "Bar chart of project active hours",
        diagnosticsChart: "Stacked chart of diagnostics by severity",
    },
    status: {
        dataUnavailable: "Dashboard data is temporarily unavailable",
        currentProject: "Current Project",
        currentSnapshot: "Current snapshot",
        selectedRange: "Selected range",
        allTrackedActivity: "All tracked activity",
        withActivity: "With activity",
        targetZeroMinutes: "Target 0m",
        sessionZeroMinutes: "Session 0m",
        longestZeroMinutes: "Longest 0m",
        selectProjectToContinue: "Select a project to view project-specific data.",
        loading: "Loading dashboard data…",
        trackedAcrossProjects: "Tracked across active projects today",
        goalNotConfigured: "Daily goal unavailable",
        fileDetailUnavailable: "File detail is disabled",
        exactRetainedFileCount: "Distinct retained file identities with activity",
        observedFlowBlocks: "Observed interaction-based flow blocks today",
        updatedJustNow: "Updated just now",
        tracking: {
            active: "Tracking",
            inactive: "Inactive",
            paused: "Paused",
            unfocused: "Unfocused",
        },
    },
    focusProfile: {
        topThreeFiles: "Top-3 file share",
        topThreeFilesDescription: "Share of active time in the three most active retained files.",
        fileSwitches: "File switches / active hour",
        fileSwitchesDescription: "Confirmed file changes normalized by tracked active time.",
        typicalFlow: "Typical flow block",
        typicalFlowDescription: "Average active time inside an observed interaction-based flow block.",
        unavailable: "Unavailable",
    },
};


/***/ }),
/* 2 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   restoreDashboardState: () => (/* binding */ restoreDashboardState)
/* harmony export */ });
function restoreDashboardState(value, fallbackProjectId, availableProjectIds) {
    const record = isRecord(value) ? value : {};
    const view = isView(record.view) ? record.view : "today";
    const range = isRange(record.range) ? record.range : "week";
    const available = new Set(availableProjectIds);
    const restoredProjectId = safeProjectId(record.projectId);
    const projectId = restoredProjectId &&
        (available.size === 0 || available.has(restoredProjectId))
        ? restoredProjectId
        : fallbackProjectId;
    return { view, range, projectId };
}
function isView(value) {
    return value === "today" || value === "project" ||
        value === "quality" || value === "global";
}
function isRange(value) {
    return value === "today" || value === "week" ||
        value === "month" || value === "all";
}
function safeProjectId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 128
        ? value
        : null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}


/***/ }),
/* 3 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   buildOverviewViewModel: () => (/* binding */ buildOverviewViewModel)
/* harmony export */ });
/* harmony import */ var _queries_PersonalInsights__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(4);

/**
 * Adapts the bounded one-day range projection to the Overview UI. Metric
 * formulas stay delegated to PersonalInsights; this layer only supplies
 * labels, the 96 wall-clock buckets, and presentation-specific availability.
 */
function buildOverviewViewModel(period, dailyGoalSeconds, fileDetailAvailable) {
    const normalizedPeriod = ensureSelectedDay(period);
    const dailyGoalMs = secondsToMilliseconds(dailyGoalSeconds);
    const insights = (0,_queries_PersonalInsights__WEBPACK_IMPORTED_MODULE_0__.buildPersonalInsights)({
        period: normalizedPeriod,
        dailyGoalMs,
        selectedLocalDate: normalizedPeriod.range.endLocalDate,
        todayLocalDate: normalizedPeriod.range.endLocalDate,
        fileDetailAvailable,
    });
    return Object.freeze({
        hasActivity: normalizedPeriod.metrics.activeTimeMs > 0,
        activeTimeMs: normalizedPeriod.metrics.activeTimeMs,
        dailyGoalMs,
        dailyGoalCompletionPercent: insights.dailyGoalCompletionPercent.value,
        uniqueActiveFiles: fileDetailAvailable
            ? normalizedPeriod.files.filter((file) => file.activeTimeMs > 0).length
            : null,
        flowBlockCount: normalizedPeriod.metrics.flowBlockCount,
        focusProfile: insights.focusProfile,
        projectDistribution: labelDistribution(insights.projectDistribution.value, new Map(normalizedPeriod.projects.map((project) => [
            project.project.id,
            project.project.displayName,
        ]))),
        languageDistribution: labelDistribution(insights.languageDistribution.value, new Map()),
        timeline: quarterHourTimeline(normalizedPeriod),
    });
}
function ensureSelectedDay(period) {
    if (period.days.some((day) => day.localDate === period.range.endLocalDate)) {
        return period;
    }
    return {
        ...period,
        days: [{
                localDate: period.range.endLocalDate,
                metrics: period.metrics,
            }],
    };
}
function secondsToMilliseconds(value) {
    const milliseconds = value * 1000;
    return Number.isSafeInteger(milliseconds) && milliseconds > 0
        ? milliseconds
        : null;
}
function labelDistribution(values, labels) {
    return Object.freeze((values ?? [])
        .filter((value) => value.activeTimeMs > 0)
        .map((value) => Object.freeze({
        ...value,
        label: labels.get(value.id) ?? value.id,
    })));
}
function quarterHourTimeline(period) {
    const totals = new Array(96).fill(0);
    period.quarterHours.forEach((bucket) => {
        if (bucket.localDate !== period.range.endLocalDate) {
            return;
        }
        const match = /^(\d{2}):(\d{2})\b/.exec(bucket.label);
        if (!match) {
            return;
        }
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour < 0 || hour > 23 || minute % 15 !== 0 || minute > 45) {
            return;
        }
        totals[hour * 4 + minute / 15] += bucket.activeTimeMs;
    });
    return Object.freeze(totals.map((activeTimeMs, index) => Object.freeze({
        label: `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`,
        activeTimeMs,
    })));
}


/***/ }),
/* 4 */
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   buildPersonalInsights: () => (/* binding */ buildPersonalInsights),
/* harmony export */   calculateActiveDayStreak: () => (/* binding */ calculateActiveDayStreak),
/* harmony export */   calculateActiveDays: () => (/* binding */ calculateActiveDays),
/* harmony export */   calculateFourWeekActiveTimeBaseline: () => (/* binding */ calculateFourWeekActiveTimeBaseline),
/* harmony export */   calculateMostActiveHour: () => (/* binding */ calculateMostActiveHour),
/* harmony export */   calculateTopThreeShare: () => (/* binding */ calculateTopThreeShare),
/* harmony export */   goalCompletionPercent: () => (/* binding */ goalCompletionPercent),
/* harmony export */   ratePerActiveHour: () => (/* binding */ ratePerActiveHour)
/* harmony export */ });
const HOUR_MS = 60 * 60 * 1000;
function buildPersonalInsights(input) {
    const { period } = input;
    const weeklyPeriod = input.weeklyPeriod ?? period;
    const selectedLocalDate = input.selectedLocalDate ?? period.range.endLocalDate;
    const todayLocalDate = input.todayLocalDate ?? period.range.endLocalDate;
    assertLocalDate(selectedLocalDate);
    assertLocalDate(todayLocalDate);
    const selectedDay = period.days.find((day) => day.localDate === selectedLocalDate);
    if (!selectedDay) {
        throw new Error("selectedLocalDate must belong to the queried period");
    }
    const dailyGoal = validGoal(input.dailyGoalMs);
    const weeklyGoal = validGoal(input.weeklyGoalMs);
    const fileDetailAvailable = input.fileDetailAvailable ?? true;
    const activeDays = calculateActiveDays(period.days);
    const streakDays = calculateActiveDayStreak(period.days, selectedLocalDate, todayLocalDate);
    const weeklyScope = isCalendarWeekScope(weeklyPeriod, todayLocalDate);
    const weeklyBaseline = calculateFourWeekActiveTimeBaseline(input.previousCompleteWeeks ?? [], weeklyPeriod.range.startLocalDate);
    const topThreeFileShare = fileDetailAvailable
        ? calculateTopThreeShare(period.files, period.metrics.activeTimeMs)
        : null;
    const switchRate = ratePerActiveHour(period.metrics.fileSwitchEvents, period.metrics.activeTimeMs);
    const typicalFlow = period.metrics.flowBlockCount > 0
        ? Math.round(period.metrics.flowActiveMs / period.metrics.flowBlockCount)
        : null;
    return {
        dailyGoalMs: insight(dailyGoal, "validated configured dailyGoalMs", "exact-configured-duration", "The configured goal is absent, non-integer, non-positive, or outside the safe integer range."),
        weeklyGoalMs: insight(weeklyGoal, "validated configured weeklyGoalMs", "exact-configured-duration", "The configured goal is absent, non-integer, non-positive, or outside the safe integer range."),
        dailyGoalCompletionPercent: insight(goalCompletionPercent(selectedDay.metrics.activeTimeMs, dailyGoal), "min(100, selectedDay.activeTimeMs / dailyGoalMs * 100)", "derived", "The daily goal is absent or invalid."),
        weeklyGoalCompletionPercent: insight(weeklyScope
            ? goalCompletionPercent(weeklyPeriod.metrics.activeTimeMs, weeklyGoal)
            : null, "min(100, calendarWeek.activeTimeMs / weeklyGoalMs * 100)", "derived", "The weekly goal is absent or invalid, or the query is not a complete calendar week or current week-to-date."),
        activeDays: insight(activeDays, "count(days where activeTimeMs > 0)", "derived", "Never unavailable; an empty or inactive range returns zero."),
        streakDays: insight(streakDays, "consecutive local days with activeTimeMs > 0 ending at min(selectedLocalDate, todayLocalDate)", "derived", "Never unavailable; a non-active selected day returns zero."),
        fourWeekActiveTimeBaseline: insight(weeklyBaseline, "median(activeTimeMs of the four latest prior complete Monday-Sunday weeks with data)", "derived", "Fewer than two of the four prior complete weeks contain positive active time."),
        focusProfile: {
            topThreeFileSharePercent: insight(topThreeFileShare, "sum(activeTimeMs of three most active retained documents) / totalActiveTimeMs * 100", "derived", "File detail is disabled or total active time is zero."),
            fileSwitchesPerActiveHour: insight(switchRate, "fileSwitchEvents / (activeTimeMs / 3,600,000)", "derived", "Total active time is zero."),
            typicalFlowActiveMs: insight(typicalFlow, "round(flowActiveMs / flowBlockCount) to the nearest millisecond", "derived", "No flow block was observed."),
        },
        projectDistribution: distributionInsight(period.projects.map((project) => ({
            id: project.project.id,
            activeTimeMs: project.metrics.activeTimeMs,
        })), period.metrics.activeTimeMs, "project"),
        languageDistribution: distributionInsight(period.languages, period.metrics.activeTimeMs, "language"),
        fileDistribution: fileDetailAvailable
            ? distributionInsight(period.files, period.metrics.activeTimeMs, "file")
            : insight(null, "document.activeTimeMs / totalActiveTimeMs * 100", "derived", "File detail is disabled."),
        mostActiveHour: insight(calculateMostActiveHour(period.quarterHours), "sum(activeTimeMs of quarter-hour buckets within each local hour); choose the greatest, breaking ties by earliest wall bucket", "derived", "No local hour contains positive active time."),
        timeDistributionSummary: insight(`Active time was recorded on ${activeDays} of ${period.days.length} selected local days.`, "format(activeDays, selectedLocalDays)", "derived", "Never unavailable."),
        fragmentationSummary: insight(switchRate === null
            ? `${period.metrics.fileSwitchEvents} confirmed file switches were recorded; no active-time rate is available.`
            : `${period.metrics.fileSwitchEvents} confirmed file switches were recorded (${formatDecimal(switchRate)} per active hour).`, "format(fileSwitchEvents, fileSwitchesPerActiveHour)", "derived", "Never unavailable; the rate is described as unavailable when active time is zero."),
    };
}
function goalCompletionPercent(activeTimeMs, goalMs) {
    assertNonNegativeSafeInteger(activeTimeMs, "activeTimeMs");
    const valid = validGoal(goalMs);
    return valid === null
        ? null
        : Math.min(100, (activeTimeMs / valid) * 100);
}
function calculateActiveDays(days) {
    return days.reduce((count, day) => {
        assertNonNegativeSafeInteger(day.metrics.activeTimeMs, "activeTimeMs");
        return count + (day.metrics.activeTimeMs > 0 ? 1 : 0);
    }, 0);
}
function calculateActiveDayStreak(days, selectedLocalDate, todayLocalDate) {
    assertLocalDate(selectedLocalDate);
    assertLocalDate(todayLocalDate);
    const byDate = new Map();
    days.forEach((day) => {
        assertLocalDate(day.localDate);
        assertNonNegativeSafeInteger(day.metrics.activeTimeMs, "activeTimeMs");
        if (byDate.has(day.localDate)) {
            throw new Error(`Duplicate day ${day.localDate}`);
        }
        byDate.set(day.localDate, day.metrics.activeTimeMs);
    });
    let cursor = selectedLocalDate > todayLocalDate ? todayLocalDate : selectedLocalDate;
    let streak = 0;
    while ((byDate.get(cursor) ?? 0) > 0) {
        streak += 1;
        cursor = addCalendarDays(cursor, -1);
    }
    return streak;
}
function calculateFourWeekActiveTimeBaseline(weeks, beforeLocalDate) {
    assertLocalDate(beforeLocalDate);
    const priorFour = weeks
        .filter((week) => week.range.endLocalDate < beforeLocalDate &&
        isCompleteCalendarWeek(week))
        .sort((left, right) => right.range.endLocalDate.localeCompare(left.range.endLocalDate))
        .filter((week, index, values) => values.findIndex((candidate) => candidate.range.startLocalDate === week.range.startLocalDate) === index)
        .slice(0, 4);
    priorFour.forEach((week) => assertNonNegativeSafeInteger(week.metrics.activeTimeMs, "activeTimeMs"));
    const eligible = priorFour.filter((week) => week.metrics.activeTimeMs > 0);
    if (eligible.length < 2) {
        return null;
    }
    const sortedValues = eligible
        .map((week) => week.metrics.activeTimeMs)
        .sort((left, right) => left - right);
    const midpoint = Math.floor(sortedValues.length / 2);
    const median = sortedValues.length % 2 === 1
        ? sortedValues[midpoint]
        : Math.round(sortedValues[midpoint - 1] +
            (sortedValues[midpoint] - sortedValues[midpoint - 1]) / 2);
    return {
        medianActiveTimeMs: median,
        weeksUsed: eligible.map((week) => ({
            startLocalDate: week.range.startLocalDate,
            endLocalDate: week.range.endLocalDate,
            activeTimeMs: week.metrics.activeTimeMs,
        })),
    };
}
function calculateTopThreeShare(files, totalActiveTimeMs) {
    assertNonNegativeSafeInteger(totalActiveTimeMs, "totalActiveTimeMs");
    if (totalActiveTimeMs === 0) {
        return null;
    }
    const topThree = [...files]
        .map((file) => {
        assertNonNegativeSafeInteger(file.activeTimeMs, "file.activeTimeMs");
        return file.activeTimeMs;
    })
        .sort((left, right) => right - left)
        .slice(0, 3)
        .reduce((total, value) => total + value, 0);
    return (topThree / totalActiveTimeMs) * 100;
}
function ratePerActiveHour(eventCount, activeTimeMs) {
    assertNonNegativeSafeInteger(eventCount, "eventCount");
    assertNonNegativeSafeInteger(activeTimeMs, "activeTimeMs");
    return activeTimeMs === 0
        ? null
        : eventCount / (activeTimeMs / HOUR_MS);
}
function calculateMostActiveHour(quarterHours) {
    const hours = new Map();
    quarterHours.forEach((bucket) => {
        assertLocalDate(bucket.localDate);
        assertNonNegativeSafeInteger(bucket.activeTimeMs, "bucket.activeTimeMs");
        const startedAt = Number(bucket.key);
        if (!Number.isSafeInteger(startedAt)) {
            throw new Error("Quarter-hour bucket key must be a safe timestamp");
        }
        const match = /^(\d{2}):\d{2} (UTC[+-]\d{2}:\d{2})$/.exec(bucket.label);
        if (!match) {
            throw new Error(`Invalid quarter-hour label ${bucket.label}`);
        }
        const key = `${bucket.localDate}\0${match[1]}\0${bucket.utcOffsetMinutes}`;
        const existing = hours.get(key);
        if (existing) {
            hours.set(key, {
                ...existing,
                activeTimeMs: safeAdd(existing.activeTimeMs, bucket.activeTimeMs, "hour.activeTimeMs"),
                startedAt: Math.min(existing.startedAt, startedAt),
            });
        }
        else {
            hours.set(key, {
                localDate: bucket.localDate,
                label: `${match[1]}:00 ${match[2]}`,
                utcOffsetMinutes: bucket.utcOffsetMinutes,
                activeTimeMs: bucket.activeTimeMs,
                startedAt,
            });
        }
    });
    return ([...hours.values()]
        .filter((hour) => hour.activeTimeMs > 0)
        .sort((left, right) => right.activeTimeMs - left.activeTimeMs ||
        left.startedAt - right.startedAt)[0] ?? null);
}
function distributionInsight(values, totalActiveTimeMs, dimension) {
    assertNonNegativeSafeInteger(totalActiveTimeMs, "totalActiveTimeMs");
    if (totalActiveTimeMs === 0) {
        return insight(null, `${dimension}.activeTimeMs / totalActiveTimeMs * 100`, "derived", "Total active time is zero.");
    }
    return insight(values.map((value) => {
        assertNonNegativeSafeInteger(value.activeTimeMs, `${dimension}.activeTimeMs`);
        return {
            id: value.id,
            activeTimeMs: value.activeTimeMs,
            sharePercent: (value.activeTimeMs / totalActiveTimeMs) * 100,
        };
    }), `${dimension}.activeTimeMs / totalActiveTimeMs * 100`, "derived", "Total active time is zero.");
}
function isCalendarWeekScope(period, todayLocalDate) {
    const dates = period.range.localDates;
    if (dates.length === 0 ||
        dates[0] !== period.range.startLocalDate ||
        dates[dates.length - 1] !== period.range.endLocalDate ||
        dayOfWeek(period.range.startLocalDate) !== 1 ||
        dates.length > 7) {
        return false;
    }
    for (let index = 1; index < dates.length; index += 1) {
        if (dates[index] !== addCalendarDays(dates[index - 1], 1)) {
            return false;
        }
    }
    return (dates.length === 7 && dayOfWeek(period.range.endLocalDate) === 0) || period.range.endLocalDate === todayLocalDate;
}
function isCompleteCalendarWeek(period) {
    return (period.range.complete &&
        period.range.localDates.length === 7 &&
        period.range.localDates[0] === period.range.startLocalDate &&
        period.range.localDates[6] === period.range.endLocalDate &&
        dayOfWeek(period.range.startLocalDate) === 1 &&
        dayOfWeek(period.range.endLocalDate) === 0 &&
        period.range.localDates.every((date, index) => date === addCalendarDays(period.range.startLocalDate, index)));
}
function validGoal(value) {
    return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value : null;
}
function insight(value, formula, precision, unavailableWhen) {
    return { value, metadata: { formula, precision, unavailableWhen } };
}
function formatDecimal(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
function assertNonNegativeSafeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative safe integer`);
    }
}
function safeAdd(left, right, name) {
    const total = left + right;
    assertNonNegativeSafeInteger(total, name);
    return total;
}
function assertLocalDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`Invalid local date ${value}`);
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
        throw new Error(`Invalid local date ${value}`);
    }
}
function dayOfWeek(localDate) {
    assertLocalDate(localDate);
    const [year, month, day] = localDate.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function addCalendarDays(localDate, amount) {
    assertLocalDate(localDate);
    const [year, month, day] = localDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}


/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1);
/* harmony import */ var _src_webview_shellState__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(2);
/* harmony import */ var _src_webview_overviewModel__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(3);



const themeColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
Chart.defaults.color = themeColor('--text-secondary');
Chart.defaults.borderColor = themeColor('--card-border');
Chart.defaults.font.family = themeColor('--font-family');
const initialData = JSON.parse(document.getElementById('initial-data')?.textContent ?? "{}");
const vscodeApi = acquireVsCodeApi();
const restoredState = (0,_src_webview_shellState__WEBPACK_IMPORTED_MODULE_1__.restoreDashboardState)(vscodeApi.getState(), initialData.currentProjectId, initialData.projects.map(project => project.id));
let currentTab = restoredState.view;
let currentRange = restoredState.range;
let selectedProjectId = restoredState.projectId;
const knownProjects = new Map(initialData.projects.map(project => [project.id, project.displayName]));
let requestSequence = 0;
let activeRequestId = '';
let dashboardData = null;
let rawSession = normalizeSession();
let rawProject = { name: _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.currentProject, path: '', days: {} };
let rawComparisonProject = null;
let rawAll = [];
let rangeDays = [];
let dailyGoal = initialData.dailyGoalSeconds;
let runtimeLastUpdatedAt = initialData.lastUpdatedAt;
let runtimeFileDetailAvailable = initialData.fileDetailAvailable;
let todayTrendChart = null;
let projectTrendChart = null;
let qualityTrendChart = null;
const dayNames = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.dayNames;
const colors = Array.from({ length: 8 }, (_value, index) => themeColor(`--chart-${index + 1}`));
document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
});
document.querySelectorAll('.filter-btn').forEach(button => {
    button.addEventListener('click', () => setRange(button.dataset.range));
});
document.getElementById('project-selector')?.addEventListener('change', event => {
    const value = event.currentTarget.value;
    selectedProjectId = value || null;
    persistDashboardState();
    requestView();
});
document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'dashboard/action', action: button.dataset.action });
        document.getElementById('actions-menu').open = false;
    });
});
window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.protocolVersion !== initialData.protocolVersion) {
        return;
    }
    if (msg.type === 'dashboard/tracking-status') {
        dailyGoal = msg.dailyGoalSeconds;
        runtimeFileDetailAvailable = msg.fileDetailAvailable;
        renderTrackingStatus(msg.status, msg.lastUpdatedAt);
        if (currentTab === 'today' && dashboardData) {
            renderToday();
        }
        return;
    }
    if (msg.requestId !== activeRequestId || msg.view !== currentTab) {
        return;
    }
    if (msg.type === 'dashboard/snapshot') {
        dashboardData = msg.data;
        rememberProjects(msg.data.current.projects);
        adaptDashboardData();
        render();
    }
    if (msg.type === 'dashboard/live-delta' && dashboardData && dashboardData.revision === msg.baseRevision) {
        applyViewModelDelta(dashboardData, msg.delta, msg.revision);
        rememberProjects(dashboardData.current.projects);
        adaptDashboardData();
        render();
    }
    if (msg.type === 'dashboard/error') {
        document.getElementById('page-subtitle').textContent = `${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.dataUnavailable} (${msg.code}).`;
        setBusy(false);
    }
});
renderProjectOptions();
applyShellState();
renderTrackingStatus(initialData.trackingStatus, initialData.lastUpdatedAt);
persistDashboardState();
requestView();
function switchTab(tab) {
    currentTab = tab;
    persistDashboardState();
    applyShellState();
    requestView();
}
function applyShellState() {
    document.querySelectorAll('.tab-btn').forEach(item => {
        const active = item.dataset.tab === currentTab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.view-section').forEach(section => {
        const active = section.id === 'view-' + currentTab;
        section.classList.toggle('active', active);
        section.hidden = !active;
    });
    document.getElementById('filter-bar').hidden = currentTab === 'today';
    document.querySelectorAll('.filter-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.range === currentRange);
    });
    document.getElementById('project-selector').value = selectedProjectId ?? '';
    updateHeader();
}
function setRange(range) {
    currentRange = range;
    persistDashboardState();
    applyShellState();
    requestView();
}
function requestView() {
    const needsProject = currentTab === 'project' || currentTab === 'quality';
    activeRequestId = 'request-' + (++requestSequence);
    dashboardData = null;
    if (needsProject && !selectedProjectId) {
        activeRequestId = '';
        updateHeader();
        document.getElementById('page-subtitle').textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.selectProjectToContinue;
        setBusy(false);
        return;
    }
    const projectId = needsProject ? selectedProjectId : null;
    setBusy(true);
    document.getElementById('page-subtitle').textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.loading;
    vscodeApi.postMessage({
        type: 'dashboard/request-view',
        protocolVersion: initialData.protocolVersion,
        requestId: activeRequestId,
        view: currentTab,
        range: {
            preset: currentTab === 'today' ? 'today' : rangePreset(currentRange),
            includeComparison: currentTab === 'project'
        },
        projectId
    });
}
function persistDashboardState() {
    vscodeApi.setState({
        view: currentTab,
        range: currentRange,
        projectId: selectedProjectId,
    });
}
function rememberProjects(projects) {
    let changed = false;
    projects.forEach(project => {
        const { id, displayName } = project.project;
        if (knownProjects.get(id) !== displayName) {
            knownProjects.set(id, displayName);
            changed = true;
        }
    });
    if (changed) {
        renderProjectOptions();
    }
}
function renderProjectOptions() {
    const selector = document.getElementById('project-selector');
    selector.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.selectProject;
    selector.append(placeholder);
    [...knownProjects.entries()]
        .sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]))
        .forEach(([id, displayName]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = displayName;
        selector.append(option);
    });
    selector.value = selectedProjectId ?? '';
}
function renderTrackingStatus(status, lastUpdatedAt) {
    runtimeLastUpdatedAt = lastUpdatedAt;
    const target = document.getElementById('tracking-status');
    target.dataset.status = status;
    target.title = `Last updated ${new Date(lastUpdatedAt).toLocaleString()}`;
    document.getElementById('tracking-status-label').textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.tracking[status];
    const overviewStatus = document.getElementById('overview-tracking-status');
    if (overviewStatus) {
        overviewStatus.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.tracking[status];
    }
    renderFreshness();
}
function renderFreshness() {
    const target = document.getElementById('overview-freshness');
    if (!target) {
        return;
    }
    const updated = new Date(runtimeLastUpdatedAt);
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - runtimeLastUpdatedAt) / 1000));
    target.dateTime = updated.toISOString();
    target.title = updated.toLocaleString();
    target.textContent = elapsedSeconds < 60
        ? _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.updatedJustNow
        : `Updated ${Math.floor(elapsedSeconds / 60)}m ago`;
}
function setBusy(busy) {
    document.getElementById('dashboard-content').setAttribute('aria-busy', String(busy));
}
function rangePreset(range) {
    if (range === 'today') {
        return 'today';
    }
    if (range === 'month') {
        return '30-days';
    }
    if (range === 'all') {
        return '90-days';
    }
    return '7-days';
}
function render() {
    setBusy(false);
    updateHeader();
    renderToday();
    if (currentTab === 'project') {
        renderProject();
    }
    if (currentTab === 'quality') {
        renderQuality();
    }
    if (currentTab === 'global') {
        renderGlobal();
    }
}
function updateHeader() {
    const title = document.getElementById('page-title');
    const subtitle = document.getElementById('page-subtitle');
    const projectName = rawProject && rawProject.name ? rawProject.name : _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.currentProject;
    if (currentTab === 'today') {
        title.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.views.today;
        subtitle.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.subtitles.today;
    }
    if (currentTab === 'project') {
        title.textContent = `${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.views.project}: ${projectName}`;
        subtitle.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.subtitles.project;
    }
    if (currentTab === 'quality') {
        title.textContent = `${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.views.quality}: ${projectName}`;
        subtitle.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.subtitles.quality;
    }
    if (currentTab === 'global') {
        title.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.views.global;
        subtitle.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.subtitles.global;
    }
}
function adaptDashboardData() {
    const current = dashboardData.current;
    rangeDays = periodDays(current, true);
    rawSession = normalizeSession(metricsAsLegacy(current.metrics, current));
    rawProject = periodAsLegacyProject(current);
    rawComparisonProject = dashboardData.comparison
        ? periodAsLegacyProject(dashboardData.comparison)
        : null;
    rawAll = current.projects.map(project => projectAsLegacy(project, current.range.endLocalDate));
    if (currentTab === 'today') {
        rawAll = [{ name: _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.views.today, path: '', days: Object.fromEntries(rangeDays.map(day => [day.date, day])) }];
    }
}
function periodAsLegacyProject(period) {
    const project = period.projects[0];
    const days = periodDays(period, true);
    return {
        name: project ? project.project.displayName : _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.currentProject,
        path: project ? project.project.id : '',
        days: Object.fromEntries(days.map(day => [day.date, day]))
    };
}
function projectAsLegacy(project, localDate) {
    const day = metricsAsLegacy(project.metrics, {
        range: { localDates: [localDate] },
        languages: project.languages,
        files: project.files,
        quarterHours: []
    }, localDate);
    return {
        name: project.project.displayName,
        path: project.project.id,
        days: { [localDate]: day }
    };
}
function periodDays(period, includeDistributions) {
    const byDate = new Map(period.days.map(day => [day.localDate, day.metrics]));
    const hoursByDate = {};
    (period.quarterHours || []).forEach(bucket => {
        const hour = String(bucket.label || '').slice(0, 2);
        const target = hoursByDate[bucket.localDate] || (hoursByDate[bucket.localDate] = {});
        target[hour] = (target[hour] || 0) + Number(bucket.activeTimeMs || 0) / 1000;
    });
    return period.range.localDates.map((localDate, index) => {
        const day = metricsAsLegacy(byDate.get(localDate), period, localDate);
        day.hours = hoursByDate[localDate] || {};
        if (!includeDistributions || index !== 0) {
            day.languages = {};
            day.activeTimeByDocumentMs = {};
        }
        return day;
    });
}
function metricsAsLegacy(metrics, period, localDate = undefined) {
    const safe = metrics || emptyRangeMetrics();
    const languages = Object.fromEntries((period.languages || []).map(item => [item.id, {
            name: item.id,
            seconds: Number(item.activeTimeMs || 0) / 1000
        }]));
    const files = Object.fromEntries((period.files || []).map(item => [item.id, Number(item.activeTimeMs || 0)]));
    return {
        date: localDate || (period.range && period.range.endLocalDate) || getLocalDateKey(),
        seconds: Number(safe.activeTimeMs || 0) / 1000,
        insertedCharacters: Number(safe.insertedCharacters || 0),
        removedCharacters: Number(safe.removedCharacters || 0),
        insertedLineBreaksApprox: Number(safe.insertedLineBreaksApprox || 0),
        removedLineBreaksApprox: Number(safe.removedLineBreaksApprox || 0),
        editEvents: Number(safe.editEvents || 0),
        largeEditEvents: Number(safe.largeEditEvents || 0),
        saves: Number(safe.saveEvents || 0),
        contextSwitches: Number(safe.fileSwitchEvents || 0),
        debugSeconds: Number(safe.debugActiveTimeMs || 0) / 1000,
        diagnosticsBySeverity: normalizeDiagnostics(safe.diagnostics && safe.diagnostics.current),
        flow: {
            count: Number(safe.flowBlockCount || 0),
            totalSeconds: Number(safe.flowActiveMs || 0) / 1000,
            longestSeconds: Number(safe.longestFlowActiveMs || 0) / 1000,
            currentSeconds: 0
        },
        languages,
        activeTimeByDocumentMs: files,
        branches: {},
        gitDirtyFiles: 0,
        hours: {}
    };
}
function emptyRangeMetrics() {
    return {
        diagnostics: { current: {} }
    };
}
function applyViewModelDelta(target, delta, revision) {
    applyPeriodDelta(target.current, delta.current);
    if (delta.comparison.kind === 'replace') {
        target.comparison = delta.comparison.value;
    }
    if (delta.comparison.kind === 'patch' && target.comparison) {
        applyPeriodDelta(target.comparison, delta.comparison.value);
    }
    if (delta.comparisonStatus !== null) {
        target.comparisonStatus = delta.comparisonStatus;
    }
    target.revision = revision;
}
function applyPeriodDelta(target, delta) {
    if (delta.range !== null) {
        target.range = delta.range;
    }
    if (delta.metrics !== null) {
        target.metrics = delta.metrics;
    }
    if (delta.days !== null) {
        target.days = patchCollection(target.days, delta.days, item => item.localDate);
    }
    if (delta.projects !== null) {
        target.projects = patchCollection(target.projects, delta.projects, item => item.project.id);
    }
    if (delta.languages !== null) {
        target.languages = patchCollection(target.languages, delta.languages, item => item.id);
    }
    if (delta.files !== null) {
        target.files = patchCollection(target.files, delta.files, item => item.id);
    }
    if (delta.quarterHours !== null) {
        target.quarterHours = patchCollection(target.quarterHours, delta.quarterHours, item => item.key);
    }
}
function patchCollection(current, delta, keyOf) {
    const values = new Map(current.map(item => [keyOf(item), item]));
    delta.remove.forEach(key => values.delete(key));
    delta.upsert.forEach(item => values.set(keyOf(item), item));
    return [...values.values()];
}
function normalizeSession(session = {}) {
    const safe = session || {};
    return {
        startTime: safe.startTime || Date.now(),
        seconds: safe.seconds || 0,
        insertedCharacters: safe.insertedCharacters || 0,
        removedCharacters: safe.removedCharacters || 0,
        insertedLineBreaksApprox: safe.insertedLineBreaksApprox || 0,
        removedLineBreaksApprox: safe.removedLineBreaksApprox || 0,
        languages: safe.languages || {},
        files: activeFileSeconds(safe),
        activeFileCounts: activeFileCounts(safe),
        editEvents: safe.editEvents || 0,
        largeEditEvents: safe.largeEditEvents || 0,
        activeTimeByDocumentMs: safe.activeTimeByDocumentMs || {},
        saves: safe.saves || 0,
        focusSeconds: safe.focusSeconds || safe.seconds || 0,
        idleSeconds: safe.idleSeconds || 0,
        debugSeconds: safe.debugSeconds || 0,
        diagnosticsBySeverity: normalizeDiagnostics(safe.diagnosticsBySeverity),
        contextSwitches: safe.contextSwitches || 0,
        branches: safe.branches || {},
        gitDirtyFiles: safe.gitDirtyFiles || 0,
        flow: normalizeFlow(safe.flow)
    };
}
function normalizeDay(day) {
    const safe = day || {};
    return {
        date: safe.date || getLocalDateKey(),
        seconds: safe.seconds || 0,
        insertedCharacters: safe.insertedCharacters || 0,
        removedCharacters: safe.removedCharacters || 0,
        insertedLineBreaksApprox: safe.insertedLineBreaksApprox || 0,
        removedLineBreaksApprox: safe.removedLineBreaksApprox || 0,
        languages: safe.languages || {},
        hours: safe.hours || {},
        files: activeFileSeconds(safe),
        activeFileCounts: activeFileCounts(safe),
        editEvents: safe.editEvents || 0,
        largeEditEvents: safe.largeEditEvents || 0,
        activeTimeByDocumentMs: safe.activeTimeByDocumentMs || {},
        saves: safe.saves || 0,
        focusSeconds: safe.focusSeconds || safe.seconds || 0,
        idleSeconds: safe.idleSeconds || 0,
        debugSeconds: safe.debugSeconds || 0,
        diagnosticsBySeverity: normalizeDiagnostics(safe.diagnosticsBySeverity),
        contextSwitches: safe.contextSwitches || 0,
        branches: safe.branches || {},
        gitDirtyFiles: safe.gitDirtyFiles || 0,
        flow: normalizeFlow(safe.flow)
    };
}
function normalizeDiagnostics(value = {}) {
    const safe = value || {};
    return {
        error: safe.error || 0,
        warning: safe.warning || 0,
        info: safe.info || 0,
        hint: safe.hint || 0
    };
}
function activeFileSeconds(value) {
    const safe = value || {};
    const exact = safe.activeTimeByDocumentMs || {};
    if (Object.keys(exact).length > 0) {
        return Object.fromEntries(Object.entries(exact).map(([id, durationMs]) => [id, Number(durationMs || 0) / 1000]));
    }
    return safe.files || {};
}
function activeFileCounts(value) {
    return Object.fromEntries(Object.keys(activeFileSeconds(value)).map(id => [id, 1]));
}
function normalizeFlow(value = {}) {
    const safe = value || {};
    return {
        count: safe.count || 0,
        totalSeconds: safe.totalSeconds || 0,
        longestSeconds: safe.longestSeconds || 0,
        currentSeconds: safe.currentSeconds || 0
    };
}
function getLocalDateKey() {
    const date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function daysForProject(project) {
    if (!project || !project.days) {
        return [];
    }
    return Object.values(project.days).map(normalizeDay);
}
function allDays() {
    const result = [];
    rawAll.forEach(project => result.push(...daysForProject(project)));
    return result;
}
function getFilteredDays(days) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const cutoff = new Date(now);
    if (currentRange === 'week') {
        cutoff.setDate(now.getDate() - 6);
    }
    if (currentRange === 'month') {
        cutoff.setDate(now.getDate() - 29);
    }
    if (currentRange === 'all') {
        cutoff.setFullYear(2000);
    }
    return days.filter(day => {
        const date = dateFromKey(day.date);
        if (currentRange === 'today') {
            return date.getTime() === now.getTime();
        }
        return date >= cutoff;
    });
}
function getPreviousRangeDays(days) {
    if (currentRange === 'all') {
        return [];
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const length = currentRange === 'month' ? 30 : currentRange === 'week' ? 7 : 1;
    const end = new Date(now);
    end.setDate(now.getDate() - length);
    const start = new Date(end);
    start.setDate(end.getDate() - length + 1);
    return days.filter(day => {
        const date = dateFromKey(day.date);
        return date >= start && date <= end;
    });
}
function dateFromKey(key) {
    const parts = key.split('-').map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setHours(0, 0, 0, 0);
    return date;
}
function aggregateDays(days) {
    const agg = emptyAgg();
    days.forEach(day => {
        agg.seconds += day.seconds;
        agg.focusSeconds += day.focusSeconds;
        agg.idleSeconds += day.idleSeconds;
        agg.debugSeconds += day.debugSeconds;
        agg.insertedCharacters += day.insertedCharacters;
        agg.removedCharacters += day.removedCharacters;
        agg.insertedLineBreaksApprox += day.insertedLineBreaksApprox;
        agg.removedLineBreaksApprox += day.removedLineBreaksApprox;
        agg.editEvents += day.editEvents;
        agg.largeEditEvents += day.largeEditEvents;
        agg.saves += day.saves;
        agg.contextSwitches += day.contextSwitches;
        agg.gitDirtyFiles = Math.max(agg.gitDirtyFiles, day.gitDirtyFiles);
        agg.flow.count += day.flow.count;
        agg.flow.totalSeconds += day.flow.totalSeconds;
        agg.flow.longestSeconds = Math.max(agg.flow.longestSeconds, day.flow.longestSeconds);
        addMap(agg.languages, Object.fromEntries(Object.values(day.languages).map(language => [language.name, language.seconds])));
        addMap(agg.files, day.files);
        addMap(agg.activeTimeByDocumentMs, day.activeTimeByDocumentMs);
        addMap(agg.activeFileCounts, day.activeFileCounts);
        addMap(agg.branches, day.branches);
        addDiagnostics(agg.diagnosticsBySeverity, day.diagnosticsBySeverity);
        Object.entries(day.hours).forEach(([hour, seconds]) => {
            agg.hours[hour] = (agg.hours[hour] || 0) + seconds;
        });
    });
    return agg;
}
function emptyAgg() {
    return {
        seconds: 0,
        focusSeconds: 0,
        idleSeconds: 0,
        debugSeconds: 0,
        insertedCharacters: 0,
        removedCharacters: 0,
        insertedLineBreaksApprox: 0,
        removedLineBreaksApprox: 0,
        editEvents: 0,
        largeEditEvents: 0,
        saves: 0,
        contextSwitches: 0,
        gitDirtyFiles: 0,
        diagnosticsBySeverity: normalizeDiagnostics(),
        flow: normalizeFlow(),
        languages: {},
        files: {},
        activeTimeByDocumentMs: {},
        activeFileCounts: {},
        branches: {},
        hours: {}
    };
}
function addMap(target, source) {
    Object.entries(source || {}).forEach(([key, value]) => {
        target[key] = (target[key] || 0) + Number(value || 0);
    });
}
function addDiagnostics(target, source) {
    const diagnostics = normalizeDiagnostics(source);
    target.error += diagnostics.error;
    target.warning += diagnostics.warning;
    target.info += diagnostics.info;
    target.hint += diagnostics.hint;
}
function renderToday() {
    if (!dashboardData) {
        return;
    }
    const overview = (0,_src_webview_overviewModel__WEBPACK_IMPORTED_MODULE_2__.buildOverviewViewModel)(dashboardData.current, dailyGoal, runtimeFileDetailAvailable);
    const empty = document.getElementById('overview-empty');
    const content = document.getElementById('overview-content');
    empty.hidden = overview.hasActivity;
    content.hidden = !overview.hasActivity;
    if (!overview.hasActivity) {
        renderFreshness();
        return;
    }
    setText('t-active', fmt(overview.activeTimeMs / 1000));
    const activeProjects = overview.projectDistribution.length;
    setText('t-active-sub', activeProjects > 0
        ? `${activeProjects} active ${activeProjects === 1 ? 'project' : 'projects'} today`
        : _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.trackedAcrossProjects);
    const goalPercent = overview.dailyGoalCompletionPercent;
    const roundedGoal = goalPercent === null ? null : Math.round(goalPercent);
    setText('t-goal', roundedGoal === null ? '—' : `${roundedGoal}%`);
    setText('t-goal-sub', overview.dailyGoalMs === null
        ? _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.goalNotConfigured
        : `${fmt(overview.activeTimeMs / 1000)} ${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.phrases.of} ${fmt(overview.dailyGoalMs / 1000)}`);
    const goalProgress = document.getElementById('overview-goal-progress');
    goalProgress.value = roundedGoal ?? 0;
    goalProgress.setAttribute('aria-valuetext', roundedGoal === null ? _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.goalNotConfigured : `${roundedGoal}%`);
    setText('t-files', overview.uniqueActiveFiles ?? '—');
    setText('t-files-sub', overview.uniqueActiveFiles === null
        ? _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.fileDetailUnavailable
        : _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.exactRetainedFileCount);
    setText('t-flow-blocks', overview.flowBlockCount);
    setText('t-flow-blocks-sub', _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.status.observedFlowBlocks);
    renderOverviewTimeline(overview);
    renderFocusProfile(overview);
    renderOverviewDistribution('overview-project-distribution', overview.projectDistribution, _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.noProjectDistribution);
    renderOverviewDistribution('overview-language-distribution', overview.languageDistribution, _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.noLanguageDistribution);
    renderFreshness();
}
function renderProject() {
    const projectDays = daysForProject(rawProject);
    const days = getFilteredDays(projectDays);
    const previous = rawComparisonProject
        ? daysForProject(rawComparisonProject)
        : [];
    const agg = aggregateDays(days);
    const prevAgg = aggregateDays(previous);
    setText('p-time', fmt(agg.seconds));
    setText('p-time-sub', `${days.length} ${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.phrases.trackedDays}`);
    setDelta('p-time-delta', deltaPct(agg.seconds, prevAgg.seconds));
    setText('p-focus', topThreeFileShare(agg) + '%');
    setText('p-focus-sub', `${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.phrases.observedEditorTransitions} ${agg.contextSwitches}`);
    setText('p-intensity', compact(editIntensity(agg)));
    setText('p-churn', churnRatio(agg) + '%');
    setText('p-churn-sub', `${compact(agg.insertedLineBreaksApprox + agg.removedLineBreaksApprox)} ${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.phrases.approximateLineBreakChanges}`);
    renderTimeline(projectTrendChart, 'projectTrendChart', days, chart => projectTrendChart = chart);
    renderBarList('project-language-list', agg.languages, fmt, _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.noLanguagesInRange);
    renderFileTable('project-files-table', mapToRows(agg.files).slice(0, 15), agg.activeFileCounts, _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.noActivityInRange);
}
function renderQuality() {
    const days = getFilteredDays(daysForProject(rawProject));
    const agg = aggregateDays(days);
    const currentDiagnostics = rawSession.diagnosticsBySeverity;
    setText('q-errors', currentDiagnostics.error);
    setText('q-warnings', currentDiagnostics.warning);
    setText('q-saves', agg.saves);
    setText('q-saves-sub', saveRhythm(agg));
    setText('q-debug', fmt(agg.debugSeconds));
    renderDiagnosticsChart(days);
    renderBarList('branch-list', agg.branches, fmt, _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.gitUnavailable);
    renderBarList('quality-breakdown', {
        [_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.signals.errors]: currentDiagnostics.error,
        [_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.signals.warnings]: currentDiagnostics.warning,
        [_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.signals.info]: currentDiagnostics.info,
        [_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.signals.hints]: currentDiagnostics.hint,
        [_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.signals.dirtyFiles]: rawSession.gitDirtyFiles
    }, compact, _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.diagnosticsUnavailable);
}
function renderGlobal() {
    const days = rangeDays;
    const agg = aggregateDays(days);
    const bestHour = bestHourFromDays(days);
    setText('g-time', fmt(agg.seconds));
    setText('g-projects', dashboardData ? dashboardData.current.projects.length : 0);
    setText('g-best-hour', bestHour.label);
    setText('g-best-hour-sub', bestHour.value > 0 ? `${fmt(bestHour.value)} ${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.phrases.tracked}` : _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.noActivity);
    setText('g-focus', topThreeFileShare(agg) + '%');
    renderHeatmap(days);
    renderProjectTable();
    renderBarList('global-language-list', agg.languages, fmt, _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.noGlobalLanguageActivity);
}
function sessionAsAgg() {
    const agg = emptyAgg();
    agg.seconds = rawSession.seconds;
    agg.focusSeconds = rawSession.focusSeconds;
    agg.idleSeconds = rawSession.idleSeconds;
    agg.debugSeconds = rawSession.debugSeconds;
    agg.insertedCharacters = rawSession.insertedCharacters;
    agg.removedCharacters = rawSession.removedCharacters;
    agg.insertedLineBreaksApprox = rawSession.insertedLineBreaksApprox;
    agg.removedLineBreaksApprox = rawSession.removedLineBreaksApprox;
    agg.editEvents = rawSession.editEvents;
    agg.largeEditEvents = rawSession.largeEditEvents;
    agg.saves = rawSession.saves;
    agg.contextSwitches = rawSession.contextSwitches;
    agg.gitDirtyFiles = rawSession.gitDirtyFiles;
    agg.diagnosticsBySeverity = rawSession.diagnosticsBySeverity;
    agg.flow = rawSession.flow;
    agg.languages = rawSession.languages;
    agg.activeTimeByDocumentMs = rawSession.activeTimeByDocumentMs;
    agg.branches = rawSession.branches;
    return agg;
}
function topThreeFileShare(agg) {
    if (!agg.seconds) {
        return 0;
    }
    const topFiles = mapToRows(agg.files).slice(0, 3).reduce((total, item) => total + item.value, 0);
    return Math.max(0, Math.min(100, Math.round((topFiles / agg.seconds) * 100)));
}
function editIntensity(agg) {
    const hours = agg.seconds / 3600;
    return hours > 0 ? Math.round((agg.insertedCharacters + agg.removedCharacters) / hours) : 0;
}
function churnRatio(agg) {
    const lineActivity = agg.insertedLineBreaksApprox + agg.removedLineBreaksApprox;
    return lineActivity > 0 ? Math.round((agg.removedLineBreaksApprox / lineActivity) * 100) : 0;
}
function saveRhythm(agg) {
    const hours = agg.seconds / 3600;
    const value = hours > 0 ? agg.saves / hours : 0;
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${_src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.phrases.savesPerHour}`;
}
function deltaPct(current, previous) {
    if (!previous && !current) {
        return { label: '0%', value: 0 };
    }
    if (!previous) {
        return { label: '+100%', value: 100 };
    }
    const value = Math.round(((current - previous) / previous) * 100);
    return { label: (value > 0 ? '+' : '') + value + '%', value };
}
function setDelta(id, delta) {
    const el = document.getElementById(id);
    el.textContent = delta.label;
    el.className = 'delta ' + (delta.value > 0 ? 'good' : delta.value < 0 ? 'bad' : '');
}
function renderOverviewTimeline(overview) {
    const labels = overview.timeline.map(bucket => bucket.label);
    const values = overview.timeline.map(bucket => bucket.activeTimeMs / 60000);
    const canvas = document.getElementById('todayTrendChart');
    if (todayTrendChart) {
        todayTrendChart.data.labels = labels;
        todayTrendChart.data.datasets[0].data = values;
        todayTrendChart.update('none');
        return;
    }
    todayTrendChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                    label: _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.chartLabels.activeMinutes,
                    data: values,
                    backgroundColor: colors[0],
                    borderRadius: 2,
                    barPercentage: 1,
                    categoryPercentage: 1
                }]
        },
        options: {
            maintainAspectRatio: false,
            responsive: true,
            scales: {
                y: { beginAtZero: true },
                x: {
                    grid: { display: false },
                    ticks: { autoSkip: true, maxTicksLimit: 12, maxRotation: 0 }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: item => fmt(Number(item.raw) * 60)
                    }
                }
            }
        }
    });
}
function renderFocusProfile(overview) {
    renderFocusMetric('focus-files', overview.focusProfile.topThreeFileSharePercent, value => `${formatDecimal(value)}%`, _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.focusProfile.topThreeFilesDescription);
    renderFocusMetric('focus-switches', overview.focusProfile.fileSwitchesPerActiveHour, value => formatDecimal(value), _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.focusProfile.fileSwitchesDescription);
    renderFocusMetric('focus-flow', overview.focusProfile.typicalFlowActiveMs, value => fmt(value / 1000), _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.focusProfile.typicalFlowDescription);
}
function renderFocusMetric(prefix, insight, formatter, description) {
    const available = insight.value !== null;
    setText(`${prefix}-value`, available ? formatter(insight.value) : _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.focusProfile.unavailable);
    setText(`${prefix}-description`, available ? description : insight.metadata.unavailableWhen);
    setText(`${prefix}-formula`, insight.metadata.formula);
}
function renderOverviewDistribution(id, rows, emptyText) {
    const target = document.getElementById(id);
    target.replaceChildren();
    if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = emptyText;
        target.append(empty);
        return;
    }
    rows.slice(0, 8).forEach(row => {
        const item = document.createElement('div');
        item.className = 'bar-row distribution-row';
        item.setAttribute('aria-label', `${row.label}: ${fmt(row.activeTimeMs / 1000)}, ${formatDecimal(row.sharePercent)}%`);
        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = row.label;
        label.title = row.label;
        const value = document.createElement('div');
        value.className = 'value';
        value.textContent = `${fmt(row.activeTimeMs / 1000)} · ${formatDecimal(row.sharePercent)}%`;
        const track = document.createElement('progress');
        track.className = 'bar-track';
        track.max = 100;
        track.value = row.sharePercent;
        track.setAttribute('aria-hidden', 'true');
        item.append(label, value, track);
        target.append(item);
    });
}
function formatDecimal(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function renderTimeline(chart, canvasId, days, assign) {
    const byDate = {};
    days.forEach(day => byDate[day.date] = (byDate[day.date] || 0) + day.seconds);
    const labels = Object.keys(byDate).sort();
    const values = labels.map(date => Math.round((byDate[date] / 3600) * 100) / 100);
    const canvas = document.getElementById(canvasId);
    if (chart) {
        chart.data.labels = labels.map(date => date.slice(5));
        chart.data.datasets[0].data = values;
        chart.update('none');
        return;
    }
    assign(new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels.map(date => date.slice(5)),
            datasets: [{ label: _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.chartLabels.hours, data: values, backgroundColor: colors[0], borderRadius: 4 }]
        },
        options: {
            maintainAspectRatio: false,
            responsive: true,
            scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => fmt(Number(item.raw) * 3600) } } }
        }
    }));
}
function renderDiagnosticsChart(days) {
    const labels = days.map(day => day.date.slice(5));
    const errors = days.map(day => day.diagnosticsBySeverity.error);
    const warnings = days.map(day => day.diagnosticsBySeverity.warning);
    const infos = days.map(day => day.diagnosticsBySeverity.info + day.diagnosticsBySeverity.hint);
    const canvas = document.getElementById('qualityTrendChart');
    if (qualityTrendChart) {
        qualityTrendChart.data.labels = labels;
        qualityTrendChart.data.datasets[0].data = errors;
        qualityTrendChart.data.datasets[1].data = warnings;
        qualityTrendChart.data.datasets[2].data = infos;
        qualityTrendChart.update('none');
        return;
    }
    qualityTrendChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.chartLabels.errors, data: errors, backgroundColor: colors[6], borderRadius: 3 },
                { label: _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.chartLabels.warnings, data: warnings, backgroundColor: colors[3], borderRadius: 3 },
                { label: _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.chartLabels.info, data: infos, backgroundColor: colors[0], borderRadius: 3 }
            ]
        },
        options: {
            maintainAspectRatio: false,
            responsive: true,
            scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}
function renderBarList(id, dataMap, formatter, emptyText) {
    const target = document.getElementById(id);
    const rows = mapToRows(dataMap).slice(0, 8);
    target.replaceChildren();
    if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = emptyText;
        target.append(empty);
        return;
    }
    const max = rows[0].value || 1;
    rows.forEach(row => {
        const item = document.createElement('div');
        item.className = 'bar-row';
        item.setAttribute('aria-label', row.name + ': ' + formatter(row.value));
        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = row.name;
        label.title = row.name;
        const value = document.createElement('div');
        value.className = 'value';
        value.textContent = formatter(row.value);
        const track = document.createElement('progress');
        track.className = 'bar-track';
        track.max = max;
        track.value = row.value;
        track.setAttribute('aria-hidden', 'true');
        item.append(label, value, track);
        target.append(item);
    });
}
function renderFileTable(id, rows, touches, emptyText) {
    const table = document.getElementById(id);
    table.replaceChildren();
    if (!rows.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 3;
        cell.className = 'empty';
        cell.textContent = emptyText;
        row.append(cell);
        table.append(row);
        return;
    }
    const header = document.createElement('tr');
    _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.tableHeaders.file.forEach(text => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = text;
        if (text !== _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.tableHeaders.file[0]) {
            th.className = 'text-right';
        }
        header.append(th);
    });
    table.append(header);
    rows.forEach(rowData => {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        name.className = 'file-name';
        name.textContent = rowData.name;
        name.title = rowData.name;
        const time = document.createElement('td');
        time.className = 'text-right';
        time.textContent = fmt(rowData.value);
        const touched = document.createElement('td');
        touched.className = 'text-right';
        touched.textContent = compact((touches && touches[rowData.name]) || 0);
        row.append(name, time, touched);
        table.append(row);
    });
}
function renderProjectTable() {
    const table = document.getElementById('global-projects-table');
    const rows = rawAll.map(project => {
        const agg = aggregateDays(getFilteredDays(daysForProject(project)));
        return { name: project.name, value: agg.seconds, concentration: topThreeFileShare(agg) };
    }).filter(row => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 12);
    table.replaceChildren();
    if (!rows.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 3;
        cell.className = 'empty';
        cell.textContent = _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.empty.noActivityInRange;
        row.append(cell);
        table.append(row);
        return;
    }
    const header = document.createElement('tr');
    _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.tableHeaders.project.forEach(text => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = text;
        if (text !== _src_webview_strings__WEBPACK_IMPORTED_MODULE_0__.ENGLISH_STRINGS.tableHeaders.project[0]) {
            th.className = 'text-right';
        }
        header.append(th);
    });
    table.append(header);
    rows.forEach(item => {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = item.name;
        const time = document.createElement('td');
        time.className = 'text-right';
        time.textContent = fmt(item.value);
        const concentration = document.createElement('td');
        concentration.className = 'text-right';
        concentration.textContent = item.concentration + '%';
        row.append(name, time, concentration);
        table.append(row);
    });
}
function renderHeatmap(days) {
    const target = document.getElementById('heatmap');
    const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let max = 0;
    days.forEach(day => {
        const dow = dateFromKey(day.date).getDay();
        Object.entries(day.hours).forEach(([hour, seconds]) => {
            const hourIndex = Number(hour);
            if (hourIndex >= 0 && hourIndex < 24) {
                matrix[dow][hourIndex] += seconds;
                max = Math.max(max, matrix[dow][hourIndex]);
            }
        });
    });
    target.replaceChildren();
    const corner = document.createElement('div');
    corner.className = 'heat-label';
    target.append(corner);
    for (let hour = 0; hour < 24; hour += 1) {
        const label = document.createElement('div');
        label.className = 'heat-label';
        label.textContent = String(hour).padStart(2, '0');
        target.append(label);
    }
    matrix.forEach((row, dayIndex) => {
        const label = document.createElement('div');
        label.className = 'heat-label';
        label.textContent = dayNames[dayIndex];
        target.append(label);
        row.forEach((seconds, hour) => {
            const cell = document.createElement('div');
            cell.className = 'heat-cell';
            const level = max > 0 ? Math.ceil((seconds / max) * 5) : 0;
            cell.classList.add(`heat-${level}`);
            cell.title = dayNames[dayIndex] + ' ' + String(hour).padStart(2, '0') + ':00 - ' + fmt(seconds);
            target.append(cell);
        });
    });
}
function bestHourFromDays(days) {
    const hours = new Array(24).fill(0);
    days.forEach(day => {
        Object.entries(day.hours).forEach(([hour, seconds]) => {
            const hourIndex = Number(hour);
            if (hourIndex >= 0 && hourIndex < 24) {
                hours[hourIndex] += seconds;
            }
        });
    });
    let bestIndex = 0;
    hours.forEach((value, index) => {
        if (value > hours[bestIndex]) {
            bestIndex = index;
        }
    });
    return {
        label: hours[bestIndex] > 0 ? String(bestIndex).padStart(2, '0') + ':00' : '--',
        value: hours[bestIndex]
    };
}
function mapToRows(map) {
    return Object.entries(map || {})
        .map(([name, value]) => ({ name, value: Number(value || 0) }))
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value);
}
function topLabel(map, fallback) {
    const rows = mapToRows(map);
    return rows.length ? rows[0].name : fallback;
}
function setText(id, value) {
    document.getElementById(id).textContent = String(value);
}
function compact(value) {
    const num = Number(value || 0);
    if (Math.abs(num) >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (Math.abs(num) >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return String(num);
}
function fmt(seconds) {
    const safeSeconds = Math.max(0, Number(seconds || 0));
    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    if (h === 0 && m === 0 && safeSeconds > 0) {
        return '< 1m';
    }
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

})();

/******/ })()
;
//# sourceMappingURL=webview.js.map